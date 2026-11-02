package main

import (
	"context"
	"errors"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestWindowsReadyRequiresBothRuntimesAndIgnoresDuplicateEvents(t *testing.T) {
	for _, mainFirst := range []bool{true, false} {
		a := &App{windowsReady: make(chan struct{})}
		a.markWindowRuntimeReady(mainFirst)
		a.markWindowRuntimeReady(mainFirst)
		select {
		case <-a.windowsReady:
			t.Fatal("one runtime released startup")
		default:
		}
		a.markWindowRuntimeReady(!mainFirst)
		a.markWindowRuntimeReady(!mainFirst)
		if err := a.waitForWindows(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestWindowsReadyWaitHonorsCancellation(t *testing.T) {
	a := &App{windowsReady: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := a.waitForWindows(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("waiting after cancellation = %v", err)
	}
	a.markWindowRuntimeReady(true)
	a.markWindowRuntimeReady(false)
	if err := a.waitForWindows(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("ready after cancellation = %v", err)
	}
}

func TestBootDoesNotConnectBeforeBothWindowsAreReady(t *testing.T) {
	a, requests := startupTestApp(t)
	a.windowsReady = make(chan struct{})
	remote := httptest.NewServer(octopHealthHandler())
	defer remote.Close()
	saveStartupDefault(t, a, remote.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		a.bootWhenWindowsReady(ctx)
		close(done)
	}()
	a.markWindowRuntimeReady(true)
	select {
	case <-done:
		t.Fatal("boot completed while server manager was uninitialized")
	case <-time.After(20 * time.Millisecond):
	}
	if a.serverState().CurrentURL != "" || requests.Load() != 0 {
		t.Fatal("boot navigated or contacted local service before windows were ready")
	}
	a.markWindowRuntimeReady(false)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("boot did not continue after windows became ready")
	}
	if a.serverState().CurrentURL != remote.URL {
		t.Fatal("saved remote was not opened after runtime readiness")
	}
	requireNoStartupRuntime(t, a)
}

func TestWindowActionsWaitForRuntimeReadiness(t *testing.T) {
	a := &App{windowsReady: make(chan struct{})}
	action := make(chan struct{}, 1)
	a.whenWindowsReady(func() { action <- struct{}{} })
	a.markWindowRuntimeReady(true)
	select {
	case <-action:
		t.Fatal("window action ran before both runtimes were ready")
	case <-time.After(20 * time.Millisecond):
	}
	a.markWindowRuntimeReady(false)
	select {
	case <-action:
	case <-time.After(time.Second):
		t.Fatal("window action did not continue after readiness")
	}
	a.whenWindowsReady(func() { action <- struct{}{} })
	select {
	case <-action:
	default:
		t.Fatal("ready window action was not run immediately")
	}
}

func TestLateStartupDoesNotOverwriteManualTemporaryLocalChoice(t *testing.T) {
	a, _ := startupTestApp(t)
	remote := httptest.NewServer(octopHealthHandler())
	defer remote.Close()
	saveStartupDefault(t, a, remote.URL)
	startup := a.beginConnection()
	a.windowsReady = make(chan struct{})
	a.markWindowRuntimeReady(true)
	a.markWindowRuntimeReady(false)
	local := httptest.NewServer(octopHealthHandler())
	defer local.Close()
	port, err := strconv.Atoi(strings.TrimPrefix(local.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("OCTOP_PORT", strconv.Itoa(port))
	if _, err := a.ConnectLocalTemporarily(serverManagerContext()); err != nil {
		t.Fatal(err)
	}
	a.bootWhenWindowsReady(startup)
	state := a.serverState()
	if strings.TrimRight(state.CurrentURL, "/") != local.URL || state.ActiveURL == nil || *state.ActiveURL != remote.URL {
		t.Fatalf("late startup replaced the temporary local choice: %#v", state)
	}
	if !errors.Is(startup.Err(), context.Canceled) {
		t.Fatal("manual connection did not cancel the original startup")
	}
	requireNoStartupRuntime(t, a)
}
