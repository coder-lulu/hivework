package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func startupTestApp(t *testing.T) (*App, *atomic.Int32) {
	t.Helper()
	a := testServerApp(t)
	t.Setenv("OCTOP_DESKTOP_URL", "")
	t.Setenv("OCTOP_BIND_HOST", "127.0.0.1")
	t.Setenv("OCTOP_DESKTOP_PORTABLE_ZIP", filepath.Join(octopHome(), "missing.zip"))
	requests := &atomic.Int32{}
	unavailable := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(unavailable.Close)
	t.Setenv("OCTOP_PORT", strconv.Itoa(unavailable.Listener.Addr().(*net.TCPAddr).Port))
	return a, requests
}

func saveStartupDefault(t *testing.T, a *App, target string) {
	t.Helper()
	config := ServerConfig{ActiveURL: &target}
	if target != "" {
		config.Servers = []ServerProfile{{Name: "Saved", URL: target}}
	}
	if err := a.servers.save(config); err != nil {
		t.Fatal(err)
	}
}

func requireNoStartupRuntime(t *testing.T, a *App) {
	t.Helper()
	if a.cmd != nil || a.ownsListenPort {
		t.Fatal("connection unexpectedly owns a local backend")
	}
	for _, path := range []string{portableDir(), filepath.Join(octopHome(), "data"), filepath.Join(octopHome(), "octop.db"), desktopPortPath()} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("unexpected local runtime/data artifact %s: %v", path, err)
		}
	}
}

func TestStartupWithoutSelectionWaitsWithoutLocalSideEffects(t *testing.T) {
	a, requests := startupTestApp(t)
	if !a.needsStartupSelection() {
		t.Fatal("first launch must display the mode selector as the initial window")
	}
	a.bootSelected(a.beginConnection())
	state := a.serverState()
	if state.ConnectionPhase != "choose" || state.CurrentURL != "" || state.ActiveURL != nil {
		t.Fatalf("first launch must wait for a choice: %#v", state)
	}
	if requests.Load() != 0 {
		t.Fatal("first launch probed a local service before user selection")
	}
	if _, err := os.Stat(filepath.Join(octopHome(), "desktop-servers.json")); !os.IsNotExist(err) {
		t.Fatalf("first launch persisted a choice: %v", err)
	}
	requireNoStartupRuntime(t, a)
}

func TestStartupSavedRemoteSkipsLocalService(t *testing.T) {
	a, localRequests := startupTestApp(t)
	remote := httptest.NewServer(octopHealthHandler())
	defer remote.Close()
	saveStartupDefault(t, a, remote.URL)
	t.Setenv("OCTOP_DESKTOP_URL", "https://ignored.example.com")
	if a.needsStartupSelection() {
		t.Fatal("a saved remote default must connect without asking for its address again")
	}
	a.bootSelected(a.beginConnection())
	state := a.serverState()
	if state.CurrentURL != remote.URL || state.ConnectionPhase != "connected" {
		t.Fatalf("saved remote was not opened: %#v", state)
	}
	if localRequests.Load() != 0 {
		t.Fatal("remote startup contacted local service")
	}
	requireNoStartupRuntime(t, a)
}

func TestStartupInvalidConfigurationDoesNotFallBackToLocal(t *testing.T) {
	for _, source := range []string{"saved file", "environment"} {
		t.Run(source, func(t *testing.T) {
			a, requests := startupTestApp(t)
			if source == "saved file" {
				if err := os.WriteFile(filepath.Join(octopHome(), "desktop-servers.json"), []byte("{invalid"), 0o600); err != nil {
					t.Fatal(err)
				}
				a.servers = newServerStore()
			} else {
				t.Setenv("OCTOP_DESKTOP_URL", "https://invalid.example.com/not-a-root")
			}
			if !a.needsStartupSelection() {
				t.Fatal("invalid configuration must keep the local recovery window visible")
			}
			a.bootSelected(a.beginConnection())
			state := a.serverState()
			if state.ConnectionPhase != "failed" || state.ConnectionError == "" || state.CurrentURL != "" {
				t.Fatalf("invalid configuration did not expose failure: %#v", state)
			}
			if requests.Load() != 0 {
				t.Fatal("invalid configuration triggered a local fallback")
			}
			requireNoStartupRuntime(t, a)
		})
	}
}

func TestStartupRemoteFailurePreservesDefaultAndRetryRecovers(t *testing.T) {
	a, localRequests := startupTestApp(t)
	var healthy atomic.Bool
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !healthy.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		octopHealthHandler().ServeHTTP(w, r)
	}))
	defer remote.Close()
	saveStartupDefault(t, a, remote.URL)
	a.bootSelected(a.beginConnection())
	state := a.serverState()
	if state.ConnectionPhase != "failed" || state.ConnectionError == "" || state.CurrentURL != "" {
		t.Fatalf("remote failure must expose retry state: %#v", state)
	}
	if got := newServerStore().get().ActiveURL; got == nil || *got != remote.URL {
		t.Fatal("failed startup replaced the remote default")
	}
	if _, err := a.RetryServerConnection(serverManagerContext()); err == nil {
		t.Fatal("retrying an unavailable remote must report failure")
	}
	healthy.Store(true)
	state, err := a.RetryServerConnection(serverManagerContext())
	if err != nil {
		t.Fatal(err)
	}
	if state.CurrentURL != remote.URL || state.ConnectionPhase != "connected" || state.ConnectionError != "" {
		t.Fatalf("retry did not recover: %#v", state)
	}
	if localRequests.Load() != 0 {
		t.Fatal("remote failure/retry fell back to local service")
	}
	requireNoStartupRuntime(t, a)
}

func TestStartupEnvironmentRemoteAndRetryDoNotCreateDefault(t *testing.T) {
	a, localRequests := startupTestApp(t)
	remote := httptest.NewServer(octopHealthHandler())
	defer remote.Close()
	t.Setenv("OCTOP_DESKTOP_URL", remote.URL)
	a.bootSelected(a.beginConnection())
	if a.serverState().CurrentURL != remote.URL {
		t.Fatal("legacy environment target was not opened")
	}
	state, err := a.RetryServerConnection(serverManagerContext())
	if err != nil || state.CurrentURL != remote.URL || state.ActiveURL != nil {
		t.Fatalf("environment retry = %#v, %v", state, err)
	}
	if newServerStore().get().ActiveURL != nil || localRequests.Load() != 0 {
		t.Fatal("environment startup created a default or contacted local service")
	}
	requireNoStartupRuntime(t, a)
}

func TestTemporaryLocalReusesServiceAndRestartKeepsRemoteDefault(t *testing.T) {
	a, _ := startupTestApp(t)
	remote := httptest.NewServer(octopHealthHandler())
	defer remote.Close()
	local := httptest.NewServer(octopHealthHandler())
	defer local.Close()
	t.Setenv("OCTOP_PORT", strconv.Itoa(local.Listener.Addr().(*net.TCPAddr).Port))
	saveStartupDefault(t, a, remote.URL)
	state, err := a.ConnectLocalTemporarily(serverManagerContext())
	if err != nil {
		t.Fatal(err)
	}
	if state.CurrentURL != local.URL+"/" || state.ActiveURL == nil || *state.ActiveURL != remote.URL {
		t.Fatalf("temporary local changed the default: %#v", state)
	}
	requireNoStartupRuntime(t, a)
	restarted := &App{servers: newServerStore(), store: &settingsStore{cur: defaultSettings()}}
	restarted.bootSelected(restarted.beginConnection())
	if restarted.serverState().CurrentURL != remote.URL {
		t.Fatal("restart did not return to the saved remote")
	}
}

func TestSwitchingFromReusedLocalToRemoteKeepsIndependentServiceRunning(t *testing.T) {
	a, _ := startupTestApp(t)
	remote := httptest.NewServer(octopHealthHandler())
	defer remote.Close()
	local := httptest.NewServer(octopHealthHandler())
	defer local.Close()
	t.Setenv("OCTOP_PORT", strconv.Itoa(local.Listener.Addr().(*net.TCPAddr).Port))
	saveStartupDefault(t, a, remote.URL)
	if _, err := a.ConnectLocalTemporarily(serverManagerContext()); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ConnectServer(serverManagerContext(), remote.URL); err != nil {
		t.Fatal(err)
	}
	if err := probeServerHealth(context.Background(), local.URL); err != nil {
		t.Fatalf("switching remote stopped the independent local service: %v", err)
	}
	requireNoStartupRuntime(t, a)
}

func TestTemporaryLocalFailurePreservesRemoteDefault(t *testing.T) {
	a, _ := startupTestApp(t)
	remote := "https://saved.example.com"
	saveStartupDefault(t, a, remote)
	a.dashboardBase = remote
	if _, err := a.ConnectLocalTemporarily(serverManagerContext()); err == nil {
		t.Fatal("missing portable runtime should fail local connection")
	}
	if got := newServerStore().get().ActiveURL; got == nil || *got != remote {
		t.Fatal("failed temporary local connection changed persisted default")
	}
	if a.serverState().CurrentURL != remote {
		t.Fatal("failed temporary local connection replaced the existing dashboard")
	}
	requireNoStartupRuntime(t, a)
}

func TestStartupExplicitLocalOverridesEnvironmentAndReusesService(t *testing.T) {
	a, _ := startupTestApp(t)
	local := httptest.NewServer(octopHealthHandler())
	defer local.Close()
	t.Setenv("OCTOP_PORT", strconv.Itoa(local.Listener.Addr().(*net.TCPAddr).Port))
	t.Setenv("OCTOP_DESKTOP_URL", "https://ignored.example.com")
	saveStartupDefault(t, a, "")
	a.bootSelected(a.beginConnection())
	if state := a.serverState(); state.CurrentURL != local.URL+"/" || state.ConnectionPhase != "connected" {
		t.Fatalf("saved local choice was not reused: %#v", state)
	}
	requireNoStartupRuntime(t, a)
}

func TestStartupRecoveryRPCsRejectUnauthorizedWindows(t *testing.T) {
	a, requests := startupTestApp(t)
	for _, ctx := range []context.Context{
		context.Background(),
		context.WithValue(context.Background(), application.WindowKey, serverTestCaller{name: "dashboard"}),
	} {
		if _, err := a.ConnectLocalTemporarily(ctx); err == nil {
			t.Fatal("temporary local connection accepted a non-manager caller")
		}
		if _, err := a.RetryServerConnection(ctx); err == nil {
			t.Fatal("retry accepted a non-manager caller")
		}
	}
	if requests.Load() != 0 || a.serverState().CurrentURL != "" || newServerStore().get().ActiveURL != nil {
		t.Fatal("unauthorized recovery changed connection state")
	}
	requireNoStartupRuntime(t, a)
}

func TestStartupCanceledCommitPreservesNewerConnection(t *testing.T) {
	a, _ := startupTestApp(t)
	current, stale := "https://current.example.com", "https://stale.example.com"
	if err := a.servers.save(ServerConfig{
		Servers:   []ServerProfile{{URL: current}, {URL: stale}},
		ActiveURL: &current,
	}); err != nil {
		t.Fatal(err)
	}
	canceled := a.beginConnection()
	newer := a.beginConnection()
	// This command is never started; it represents the newer connection's backend.
	backend := exec.Command("unused-test-backend")
	a.cmd = backend
	a.ownsListenPort = true
	a.dashboardBase = current
	a.setConnectionState(newer, "connected", "")
	if err := writeDesktopPort(42123); err != nil {
		t.Fatal(err)
	}

	if _, err := a.commitConnection(canceled, stale, "", true, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("stale commit must report cancellation: %v", err)
	}
	state := a.serverState()
	if state.CurrentURL != current || state.ConnectionPhase != "connected" {
		t.Fatalf("stale commit replaced the newer dashboard: %#v", state)
	}
	if got := newServerStore().get().ActiveURL; got == nil || *got != current {
		t.Fatal("stale commit overwrote the saved default")
	}
	if a.cmd != backend || !a.ownsListenPort {
		t.Fatal("stale commit stopped or cleared the newer backend")
	}
	if port, ok := readDesktopPort(); !ok || port != 42123 {
		t.Fatal("stale commit cleared the newer backend's port record")
	}
	if newer.Err() != nil {
		t.Fatal("stale commit canceled the newer connection")
	}
}
