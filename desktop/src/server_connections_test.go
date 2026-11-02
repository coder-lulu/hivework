package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type serverTestCaller struct {
	application.Window
	name string
}

func (w serverTestCaller) Name() string { return w.name }

func serverManagerContext() context.Context {
	return context.WithValue(context.Background(), application.WindowKey, serverTestCaller{name: "server-manager"})
}

func testServerApp(t *testing.T) *App {
	t.Helper()
	t.Setenv("OCTOP_HOME", t.TempDir())
	return &App{servers: newServerStore(), store: &settingsStore{cur: defaultSettings()}}
}

func TestCurrentServerMetadataTracksTheOpenLineAndRenames(t *testing.T) {
	a := testServerApp(t)
	ctx := serverManagerContext()
	current := ServerProfile{Name: "办公线路", URL: "https://work.example.com"}
	other := ServerProfile{Name: "其他私有线路", URL: "https://private.example.com"}
	for _, profile := range []ServerProfile{current, other} {
		if _, err := a.SaveServer(ctx, "", profile); err != nil {
			t.Fatal(err)
		}
	}
	a.dashboardBase = current.URL
	if got := a.currentServerProfile(); got != current {
		t.Fatalf("current metadata = %#v; want %#v", got, current)
	}
	current.Name = "重命名线路"
	if _, err := a.SaveServer(ctx, current.URL, current); err != nil {
		t.Fatal(err)
	}
	if got := a.currentServerProfile(); got != current {
		t.Fatalf("renamed metadata = %#v; want %#v", got, current)
	}
	script := serverManagerBridgeScript(a.currentServerProfile())
	if strings.Contains(script, other.Name) || strings.Contains(script, other.URL) {
		t.Fatal("bridge exposed an inactive server")
	}
	if !strings.Contains(script, "octop:server-connection") {
		t.Fatal("bridge omitted its metadata update event")
	}
}

func TestCurrentServerMetadataUsesLocalLabelAndRemoteHostFallback(t *testing.T) {
	a := testServerApp(t)
	for _, tc := range []struct {
		url, name string
		locale    Locale
	}{
		{"http://127.0.0.1:8088", "本地服务", LocaleZH},
		{"http://[::1]:8088", "Local service", LocaleEN},
		{"https://legacy.example.com:8443", "legacy.example.com:8443", LocaleZH},
		{"", "", LocaleZH},
	} {
		a.dashboardBase = tc.url
		a.store.cur.Locale = tc.locale
		if got := a.currentServerProfile(); got.Name != tc.name || got.URL != tc.url {
			t.Fatalf("metadata for %q = %#v", tc.url, got)
		}
	}
}

func TestServerMetadataBridgeEscapesProfileNames(t *testing.T) {
	profile := ServerProfile{Name: "\"; window.injected=true; // </script>", URL: "https://work.example.com"}
	script := serverManagerBridgeScript(profile)
	encoded := strings.SplitN(strings.SplitN(script, "window.__OCTOP_CURRENT_SERVER__ = ", 2)[1], "; window.dispatchEvent", 2)[0]
	var decoded ServerProfile
	if err := json.Unmarshal([]byte(encoded), &decoded); err != nil || decoded != profile {
		t.Fatalf("metadata was not safely serialized: %v, %#v", err, decoded)
	}
	if strings.Contains(encoded, "</script>") {
		t.Fatal("HTML closing tag was not escaped")
	}
}

func TestSavedServerSelectionTakesPrecedenceOverEnvironment(t *testing.T) {
	remote, local := "https://work.example.com", ""
	for _, tc := range []struct {
		name   string
		active *string
		env    string
		want   string
		chosen bool
	}{
		{"unselected", nil, "", "", false},
		{"legacy environment", nil, " https://WORK.example.com/ ", remote, true},
		{"saved remote", &remote, "https://other.example.com", remote, true},
		{"explicit local", &local, remote, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, chosen, err := selectedServerURL(ServerConfig{ActiveURL: tc.active}, tc.env)
			if err != nil || got != tc.want || chosen != tc.chosen {
				t.Fatalf("selected = %q, %v, %v; want %q, %v", got, chosen, err, tc.want, tc.chosen)
			}
		})
	}
}

func TestServerManagementRejectsOtherWindows(t *testing.T) {
	a := testServerApp(t)
	for _, ctx := range []context.Context{
		context.Background(),
		context.WithValue(context.Background(), application.WindowKey, serverTestCaller{name: "dashboard"}),
	} {
		if _, err := a.GetServerConnections(ctx); err == nil {
			t.Fatal("read allowed outside manager")
		}
		if _, err := a.SaveServer(ctx, "", ServerProfile{URL: "https://work.example.com"}); err == nil {
			t.Fatal("save allowed outside manager")
		}
		if _, err := a.DeleteServer(ctx, "https://work.example.com"); err == nil {
			t.Fatal("delete allowed outside manager")
		}
		if _, err := a.ConnectServer(ctx, ""); err == nil {
			t.Fatal("connect allowed outside manager")
		}
	}
	if len(a.servers.get().Servers) != 0 {
		t.Fatal("unauthorized call changed store")
	}
	if _, err := os.Stat(filepath.Join(octopHome(), "desktop-servers.json")); !os.IsNotExist(err) {
		t.Fatalf("unexpected settings file: %v", err)
	}
}

func TestConnectServerPersistsOnlyAfterSuccessfulHealthCheck(t *testing.T) {
	a := testServerApp(t)
	ctx := serverManagerContext()
	observations := make(chan [2]string, 1)
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case observations <- [2]string{r.URL.Path, r.Header.Get("Authorization")}:
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer healthy.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer bad.Close()
	for _, profile := range []ServerProfile{{Name: "Primary", URL: healthy.URL}, {Name: "Offline", URL: bad.URL}} {
		if _, err := a.SaveServer(ctx, "", profile); err != nil {
			t.Fatal(err)
		}
	}
	state, err := a.ConnectServer(ctx, healthy.URL)
	if err != nil {
		t.Fatal(err)
	}
	if state.ActiveURL == nil || *state.ActiveURL != healthy.URL || state.CurrentURL != healthy.URL {
		t.Fatalf("state = %#v", state)
	}
	observed := <-observations
	if observed[0] != "/api/health" || observed[1] != "" {
		t.Fatalf("probe path=%q Authorization=%q", observed[0], observed[1])
	}
	previousStartup := a.beginConnection()
	if _, err := a.ConnectServer(ctx, bad.URL); err == nil {
		t.Fatal("offline server accepted")
	}
	if previousStartup.Err() != nil {
		t.Fatal("failed remote probe canceled existing startup")
	}
	loaded := newServerStore().get()
	if loaded.ActiveURL == nil || *loaded.ActiveURL != healthy.URL || a.serverState().CurrentURL != healthy.URL {
		t.Fatalf("failed probe changed previous selection: %#v", loaded)
	}
	if _, err := a.ConnectServer(ctx, "https://unknown.example.com"); err == nil {
		t.Fatal("unknown server accepted")
	}
	if _, err := a.DeleteServer(ctx, healthy.URL); err == nil {
		t.Fatal("selected address deleted")
	}
	if _, err := a.SaveServer(ctx, healthy.URL, ServerProfile{Name: "Renamed", URL: healthy.URL + "/"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveServer(ctx, healthy.URL, ServerProfile{URL: "https://different.example.com"}); err == nil {
		t.Fatal("selected address changed")
	}
	if _, err := a.DeleteServer(ctx, bad.URL); err != nil {
		t.Fatal(err)
	}
	if len(a.servers.get().Servers) != 1 {
		t.Fatal("inactive address not deleted")
	}
}

func TestFailedLocalConnectionKeepsRemoteDefault(t *testing.T) {
	a := testServerApp(t)
	remote := "https://work.example.com"
	if err := a.servers.save(ServerConfig{Servers: []ServerProfile{{URL: remote}}, ActiveURL: &remote}); err != nil {
		t.Fatal(err)
	}
	a.dashboardBase = remote
	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	port := strings.TrimPrefix(closed.URL, "http://127.0.0.1:")
	closed.Close()
	t.Setenv("OCTOP_BIND_HOST", "127.0.0.1")
	t.Setenv("OCTOP_PORT", port)
	t.Setenv("OCTOP_DESKTOP_PORTABLE_ZIP", filepath.Join(octopHome(), "missing.zip"))
	if _, err := a.ConnectServer(serverManagerContext(), ""); err == nil {
		t.Fatal("missing local runtime accepted")
	}
	if got := newServerStore().get().ActiveURL; got == nil || *got != remote {
		t.Fatalf("local failure changed default: %v", got)
	}
	if a.serverState().CurrentURL != remote {
		t.Fatal("local failure changed current dashboard")
	}
}

func TestConnectLocalReusesExistingServiceAndRemembersChoice(t *testing.T) {
	a := testServerApp(t)
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"users_loaded":0,"agents_running":0}`))
	}))
	defer local.Close()
	port, err := strconv.Atoi(strings.TrimPrefix(local.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("OCTOP_BIND_HOST", "127.0.0.1")
	t.Setenv("OCTOP_PORT", strconv.Itoa(port))
	state, err := a.ConnectServer(serverManagerContext(), "")
	if err != nil {
		t.Fatal(err)
	}
	if state.ActiveURL == nil || *state.ActiveURL != "" || state.CurrentURL != local.URL+"/" {
		t.Fatalf("local state = %#v", state)
	}
	if a.cmd != nil || a.ownsListenPort {
		t.Fatal("existing service was incorrectly claimed as owned")
	}
	if got := newServerStore().get().ActiveURL; got == nil || *got != "" {
		t.Fatal("local choice not remembered")
	}
}

func TestProbeServerHealthRejectsOtherPagesAndErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"html", 200, "<html>not HiveWork</html>"},
		{"unhealthy", 200, `{"ok":false}`},
		{"missing", 404, `{"ok":true}`},
		{"backend error", 503, `{"ok":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			if err := probeServerHealth(context.Background(), srv.URL); !errors.Is(err, errServerUnavailable) {
				t.Fatalf("probe = %v", err)
			}
		})
	}
}

func TestServerHealthDoesNotFollowCrossHostRedirect(t *testing.T) {
	called := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; _, _ = w.Write([]byte(`{"ok":true}`)) }))
	defer target.Close()
	destination := strings.Replace(target.URL, "127.0.0.1", "localhost", 1)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination+"/api/health", http.StatusFound)
	}))
	defer source.Close()
	if err := probeServerHealth(context.Background(), source.URL); !errors.Is(err, errServerUnavailable) {
		t.Fatalf("probe = %v", err)
	}
	if called {
		t.Fatal("redirect exposed request to a different server")
	}
}

func TestNewServerConnectionCancelsPreviousStartup(t *testing.T) {
	a := testServerApp(t)
	previous := a.beginConnection()
	next := a.beginConnection()
	if previous.Err() != context.Canceled || next.Err() != nil {
		t.Fatal("previous connection was not canceled")
	}
	started := time.Now()
	if err := waitConnectionHealth(previous, LocaleEN, "http://127.0.0.1:1", time.Minute); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait = %v", err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("canceled startup did not stop promptly")
	}
}
