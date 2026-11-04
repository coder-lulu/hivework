package main

import (
	"context"
	"testing"
	"time"
)

func TestDashboardRemainsLoadingUntilPageRendered(t *testing.T) {
	a := testServerApp(t)
	ctx := a.beginConnection()
	id := a.beginDashboardLoad(ctx, "https://work.example.com", time.Minute)
	if state := a.serverState(); state.ConnectionPhase != "loading" {
		t.Fatalf("page was marked ready before it rendered: %#v", state)
	}
	if !a.finishDashboardLoad(id, true) {
		t.Fatal("rendered page was not accepted")
	}
	if state := a.serverState(); state.ConnectionPhase != "connected" || state.ConnectionError != "" {
		t.Fatalf("rendered page did not finish connecting: %#v", state)
	}
	if a.finishDashboardLoad(id, true) {
		t.Fatal("duplicate page-ready event was accepted")
	}
}

func TestDashboardLoadTimeoutExposesRecoveryAndIgnoresLateReady(t *testing.T) {
	a := testServerApp(t)
	id := a.beginDashboardLoad(a.beginConnection(), "https://slow.example.com", time.Millisecond)
	deadline := time.After(time.Second)
	for a.serverState().ConnectionPhase != "failed" {
		select {
		case <-deadline:
			t.Fatal("page load timeout did not expose recovery")
		case <-time.After(time.Millisecond):
		}
	}
	if a.serverState().ConnectionError == "" {
		t.Fatal("load timeout did not provide an error message")
	}
	if a.finishDashboardLoad(id, true) || a.serverState().ConnectionPhase != "failed" {
		t.Fatal("late ready event dismissed the timeout")
	}
}

func TestNewConnectionInvalidatesPreviousDashboardLoad(t *testing.T) {
	a := testServerApp(t)
	first := a.beginConnection()
	oldID := a.beginDashboardLoad(first, "https://old.example.com", time.Minute)
	second := a.beginConnection()
	id := a.beginDashboardLoad(second, "https://new.example.com", time.Minute)
	defer a.finishDashboardLoad(id, true)
	if first.Err() == nil || id == oldID {
		t.Fatal("new connection reused the previous page load")
	}
	if a.finishDashboardLoad(oldID, true) || a.finishDashboardLoad(oldID, false) {
		t.Fatal("old page callback changed the new connection")
	}
	if a.serverState().ConnectionPhase != "loading" {
		t.Fatal("stale callback ended the current loading state")
	}
}

func TestCanceledConnectionCannotStartOrCompleteDashboardLoad(t *testing.T) {
	a := testServerApp(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if id := a.beginDashboardLoad(ctx, "https://work.example.com", time.Minute); id != 0 {
		t.Fatal("canceled connection started a page load")
	}
	ctx, cancel = context.WithCancel(context.Background())
	id := a.beginDashboardLoad(ctx, "https://work.example.com", time.Minute)
	cancel()
	defer a.beginConnection()
	if a.finishDashboardLoad(id, true) {
		t.Fatal("canceled page load was allowed to show the main window")
	}
}

func TestDashboardRenderCheckWaitsForNavigationTransition(t *testing.T) {
	a := testServerApp(t)
	finished := make(chan struct{})
	a.connectionMu.Lock()
	go func() {
		a.watchDashboardRender()
		close(finished)
	}()
	select {
	case <-finished:
		a.connectionMu.Unlock()
		t.Fatal("render check ran while a connection was replacing the old page")
	case <-time.After(20 * time.Millisecond):
	}
	a.connectionMu.Unlock()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("render check did not resume after the navigation transition")
	}
}
