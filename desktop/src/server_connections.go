package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type ServerManagerState struct {
	ServerConfig
	CurrentURL      string `json:"currentUrl"`
	Locale          Locale `json:"locale"`
	ConnectionPhase string `json:"connectionPhase"`
	ConnectionError string `json:"connectionError"`
}

func (a *App) serverState() ServerManagerState {
	a.mu.Lock()
	current := a.dashboardBase
	phase, connectionError := a.connectionPhase, a.connectionError
	a.mu.Unlock()
	return ServerManagerState{ServerConfig: a.servers.get(), CurrentURL: current, Locale: a.store.get().Locale, ConnectionPhase: phase, ConnectionError: connectionError}
}

func (a *App) setConnectionState(ctx context.Context, phase, message string) {
	a.mu.Lock()
	if ctx.Err() != nil {
		a.mu.Unlock()
		return
	}
	a.connectionPhase, a.connectionError = phase, message
	a.mu.Unlock()
	a.emitConnectionStatus()
	if a.app != nil {
		a.app.Event.Emit("desktop:servers:refresh")
	}
}

func (a *App) emitConnectionStatus() {
	if a.app == nil {
		return
	}
	a.mu.Lock()
	phase, message := a.connectionPhase, a.connectionError
	a.mu.Unlock()
	// The main window may contain a remote page; never broadcast server profiles.
	a.app.Event.Emit("desktop:connection", map[string]string{"connectionPhase": phase, "connectionError": message})
}

func (a *App) GetServerConnections(ctx context.Context) (ServerManagerState, error) {
	if err := a.authorizeServerManager(ctx); err != nil {
		return ServerManagerState{}, err
	}
	return a.serverState(), nil
}

func (a *App) SaveServer(ctx context.Context, previousURL string, profile ServerProfile) (ServerManagerState, error) {
	if err := a.authorizeServerManager(ctx); err != nil {
		return ServerManagerState{}, err
	}
	next := a.servers.get()
	normalized, err := normalizeServerURL(profile.URL)
	if err != nil {
		return ServerManagerState{}, a.serverError(err)
	}
	profile.URL = normalized
	if previousURL == "" {
		next.Servers = append(next.Servers, profile)
	} else {
		found := false
		for i, saved := range next.Servers {
			if saved.URL != previousURL {
				continue
			}
			if next.ActiveURL != nil && *next.ActiveURL == previousURL && profile.URL != previousURL {
				return ServerManagerState{}, a.serverError(errServerInUse)
			}
			next.Servers[i] = profile
			found = true
			break
		}
		if !found {
			return ServerManagerState{}, a.serverError(ErrUnknownServerURL)
		}
	}
	if err := a.servers.save(next); err != nil {
		return ServerManagerState{}, a.serverError(err)
	}
	a.installServerManagerBridge()
	return a.serverState(), nil
}

func (a *App) DeleteServer(ctx context.Context, rawURL string) (ServerManagerState, error) {
	if err := a.authorizeServerManager(ctx); err != nil {
		return ServerManagerState{}, err
	}
	next := a.servers.get()
	if next.ActiveURL != nil && *next.ActiveURL == rawURL {
		return ServerManagerState{}, a.serverError(errServerInUse)
	}
	for i, saved := range next.Servers {
		if saved.URL == rawURL {
			next.Servers = append(next.Servers[:i], next.Servers[i+1:]...)
			if err := a.servers.save(next); err != nil {
				return ServerManagerState{}, a.serverError(err)
			}
			return a.serverState(), nil
		}
	}
	return ServerManagerState{}, a.serverError(ErrUnknownServerURL)
}

func (a *App) ConnectServer(ctx context.Context, rawURL string) (ServerManagerState, error) {
	if err := a.authorizeServerManager(ctx); err != nil {
		return ServerManagerState{}, err
	}
	if err := a.waitForWindows(ctx); err != nil {
		return ServerManagerState{}, err
	}
	next := a.servers.get()
	base := ""
	if rawURL != "" {
		var err error
		base, err = normalizeServerURL(rawURL)
		if err != nil {
			return ServerManagerState{}, a.serverError(err)
		}
		found := false
		for _, saved := range next.Servers {
			found = found || saved.URL == base
		}
		if !found {
			return ServerManagerState{}, a.serverError(ErrUnknownServerURL)
		}
	}
	// Keep the current startup/session intact until the new remote is reachable.
	if err := a.checkServerConnection(ctx, base); err != nil {
		return ServerManagerState{}, err
	}
	return a.connectServer(a.beginConnection(), base, true)
}

func (a *App) ConnectLocalTemporarily(ctx context.Context) (ServerManagerState, error) {
	if err := a.authorizeServerManager(ctx); err != nil {
		return ServerManagerState{}, err
	}
	if err := a.waitForWindows(ctx); err != nil {
		return ServerManagerState{}, err
	}
	return a.connectServer(a.beginConnection(), "", false)
}

func (a *App) RetryServerConnection(ctx context.Context) (ServerManagerState, error) {
	if err := a.authorizeServerManager(ctx); err != nil {
		return ServerManagerState{}, err
	}
	if err := a.waitForWindows(ctx); err != nil {
		return ServerManagerState{}, err
	}
	connection := a.beginConnection()
	base, selected, err := selectedServerURL(a.servers.get(), os.Getenv("OCTOP_DESKTOP_URL"))
	if err != nil {
		message := a.serverError(err)
		a.setConnectionState(connection, "failed", message.Error())
		return ServerManagerState{}, message
	}
	if !selected {
		a.chooseConnection(connection)
		return a.serverState(), nil
	}
	a.setConnectionState(connection, "connecting", "")
	if err := a.checkServerConnection(connection, base); err != nil {
		a.connectionFailed(connection, err)
		return ServerManagerState{}, err
	}
	return a.connectServer(connection, base, false)
}

func (a *App) checkServerConnection(ctx context.Context, base string) error {
	if base == "" {
		return nil
	}
	if err := probeServerHealth(ctx, base); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return a.serverError(err)
	}
	return nil
}

func (a *App) connectionFailed(ctx context.Context, err error) {
	if ctx.Err() == nil {
		a.setStatus(err.Error())
		a.setConnectionState(ctx, "failed", err.Error())
	}
}

func (a *App) connectServer(connection context.Context, base string, remember bool) (state ServerManagerState, err error) {
	if err := connection.Err(); err != nil {
		return ServerManagerState{}, err
	}
	a.setConnectionState(connection, "connecting", "")
	defer func() {
		if err != nil {
			a.connectionFailed(connection, err)
		}
	}()
	if base != "" {
		a.setStatus(desktopText(a.store.get().Locale, copyStatusConnecting))
	}
	a.mu.Lock()
	previousCmd := a.cmd
	a.mu.Unlock()
	localBase := ""
	if base == "" {
		var err error
		localBase, err = a.startLocal(connection)
		if err != nil {
			return ServerManagerState{}, err
		}
	}
	return a.commitConnection(connection, base, localBase, remember, previousCmd)
}

func (a *App) commitConnection(connection context.Context, base, localBase string, remember bool, previousCmd *exec.Cmd) (ServerManagerState, error) {
	a.connectionMu.Lock()
	defer a.connectionMu.Unlock()
	if err := connection.Err(); err != nil {
		return ServerManagerState{}, err
	}
	if remember {
		next := a.servers.get()
		next.ActiveURL = &base
		if err := a.servers.save(next); err != nil {
			a.mu.Lock()
			created := a.cmd
			a.mu.Unlock()
			if created != previousCmd {
				a.stopBackend(created)
			}
			return ServerManagerState{}, a.serverError(err)
		}
	}
	if base == "" {
		a.showDashboard(localBase)
	} else {
		a.stopOwnedBackend()
		a.showDashboard(base)
	}
	a.setConnectionState(connection, "connected", "")
	return a.serverState(), nil
}

func (a *App) ShowServerManager() {
	a.whenWindowsReady(a.showReadyServerManager)
}

func (a *App) showReadyServerManager() {
	if a.serverWindow != nil {
		a.mu.Lock()
		noDashboard := a.dashboardBase == ""
		a.mu.Unlock()
		if noDashboard && a.window != nil {
			a.window.Hide()
		}
		a.app.Event.Emit("desktop:servers:refresh")
		a.serverWindow.Show()
		a.serverWindow.Focus()
	}
}

func (a *App) HideServerManager() {
	if a.serverWindow != nil {
		a.serverWindow.Hide()
	}
}

func (a *App) installServerManagerBridge() {
	a.whenWindowsReady(a.installReadyServerManagerBridge)
}

func (a *App) installReadyServerManagerBridge() {
	if a.window != nil {
		a.window.ExecJS(serverManagerBridgeScript(a.currentServerProfile()))
	}
}

func serverManagerBridgeScript(profile ServerProfile) string {
	data, _ := json.Marshal(profile)
	return fmt.Sprintf(`window.__OCTOP_SERVER_SETTINGS__ = true; window.__OCTOP_CURRENT_SERVER__ = %s; window.dispatchEvent(new CustomEvent('octop:server-connection'));`, data)
}

func (a *App) currentServerProfile() ServerProfile {
	a.mu.Lock()
	base := a.dashboardBase
	a.mu.Unlock()
	if base == "" {
		return ServerProfile{}
	}
	for _, profile := range a.servers.get().Servers {
		if profile.URL == base {
			return profile
		}
	}
	parsed, _ := url.Parse(base)
	name := parsed.Host
	if parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1" {
		name = desktopText(a.store.get().Locale, copyServerLocalLabel)
	}
	return ServerProfile{Name: name, URL: base}
}

func (a *App) beginConnection() context.Context {
	a.connectionMu.Lock()
	defer a.connectionMu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.connectionCancel != nil {
		a.connectionCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.connectionCancel = cancel
	return ctx
}

func (a *App) stopOwnedBackend() {
	a.mu.Lock()
	cmd := a.cmd
	a.mu.Unlock()
	a.stopBackend(cmd)
}

func (a *App) stopBackend(expected *exec.Cmd) {
	a.mu.Lock()
	if a.cmd != expected {
		a.mu.Unlock()
		return
	}
	cmd := a.cmd
	a.cmd = nil
	owned := a.ownsListenPort
	a.ownsListenPort = false
	a.mu.Unlock()
	stopOctop(cmd)
	if owned {
		clearDesktopPort()
	}
}

func selectedServerURL(config ServerConfig, env string) (string, bool, error) {
	if config.ActiveURL != nil {
		return *config.ActiveURL, true, nil
	}
	if strings.TrimSpace(env) == "" {
		return "", false, nil
	}
	base, err := normalizeServerURL(env)
	return base, true, err
}

func probeServerHealth(ctx context.Context, base string) error {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/health", nil)
	if err != nil {
		return errServerUnavailable
	}
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(next *http.Request, via []*http.Request) error {
		original := via[0].URL
		if len(via) >= 5 || next.URL.Hostname() != original.Hostname() ||
			(original.Scheme == "https" && next.URL.Scheme != "https") ||
			next.URL.Path != "/api/health" || next.URL.RawQuery != "" || next.URL.User != nil {
			return errServerUnavailable
		}
		return nil
	}}
	resp, err := client.Do(req)
	if err != nil {
		return errServerUnavailable
	}
	defer resp.Body.Close()
	var health struct {
		OK bool `json:"ok"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&health) != nil || !health.OK {
		return errServerUnavailable
	}
	return nil
}

func waitConnectionHealth(ctx context.Context, locale Locale, base string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	client := &http.Client{Timeout: 4 * time.Second}
	var lastErr error
	var lastStatus int
	for ctx.Err() == nil {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/api/health", nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		lastErr = err
		lastStatus = 0
		if err == nil {
			lastStatus = resp.StatusCode
			resp.Body.Close()
			if lastStatus >= 200 && lastStatus < 500 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(400 * time.Millisecond):
		}
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return ctx.Err()
	}
	return formatHealthWaitError(locale, base, timeout, lastErr, lastStatus)
}

var (
	errServerUnavailable = errors.New("server unavailable")
	errServerInUse       = errors.New("server in use")
)

func (a *App) serverError(err error) error {
	locale := a.store.get().Locale
	key := copyErrorServerSave
	switch {
	case errors.Is(err, ErrInvalidServerURL):
		key = copyErrorServerURL
	case errors.Is(err, ErrDuplicateServerURL):
		key = copyErrorServerDuplicate
	case errors.Is(err, ErrUnknownServerURL):
		key = copyErrorServerUnknown
	case errors.Is(err, errServerUnavailable):
		key = copyErrorServerUnavailable
	case errors.Is(err, errServerInUse):
		key = copyErrorServerInUse
	case errors.Is(err, ErrServerConfigLoad):
		key = copyErrorServerLoad
	}
	return fmt.Errorf("%s", desktopText(locale, key))
}

func (a *App) bootSelected(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	if err := a.servers.loadError(); err != nil {
		message := a.serverError(err).Error()
		a.setStatus(message)
		a.setConnectionState(ctx, "failed", message)
		a.ShowServerManager()
		return
	}
	base, selected, err := selectedServerURL(a.servers.get(), os.Getenv("OCTOP_DESKTOP_URL"))
	if err != nil {
		message := a.serverError(err).Error()
		a.setStatus(message)
		a.setConnectionState(ctx, "failed", message)
		a.ShowServerManager()
		return
	}
	if !selected {
		a.chooseConnection(ctx)
		a.ShowServerManager()
		return
	}
	a.setStatus(desktopText(a.store.get().Locale, copyStatusConnecting))
	a.setConnectionState(ctx, "connecting", "")
	if err := a.checkServerConnection(ctx, base); err != nil {
		a.connectionFailed(ctx, err)
		if ctx.Err() == nil {
			a.ShowServerManager()
		}
		return
	}
	if _, err := a.connectServer(ctx, base, false); err != nil && ctx.Err() == nil {
		a.ShowServerManager()
	}
}

func (a *App) chooseConnection(ctx context.Context) {
	a.setStatus(desktopText(a.store.get().Locale, copyStatusChooseServer))
	a.setConnectionState(ctx, "choose", "")
}

func (a *App) authorizeServerManager(ctx context.Context) error {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || window == nil || window.Name() != "server-manager" {
		return fmt.Errorf("%s", desktopText(a.store.get().Locale, copyErrorServerAccess))
	}
	if err := a.servers.loadError(); err != nil {
		return a.serverError(err)
	}
	return nil
}

func (a *App) needsStartupSelection() bool {
	if a.servers.loadError() != nil {
		return true
	}
	_, selected, err := selectedServerURL(a.servers.get(), os.Getenv("OCTOP_DESKTOP_URL"))
	return !selected || err != nil
}

func (a *App) createServerWindow() {
	win := a.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "server-manager",
		Title:            "HiveWork · 服务器设置",
		URL:              "/server-manager.html",
		Width:            900,
		Height:           740,
		Hidden:           !a.needsStartupSelection(),
		BackgroundColour: application.NewRGB(247, 248, 250),
	})
	a.serverWindow = win
	win.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		a.markWindowRuntimeReady(false)
	})
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		win.Hide()
	})
	a.app.Event.On("desktop:servers:open", func(_ *application.CustomEvent) { a.ShowServerManager() })
}
