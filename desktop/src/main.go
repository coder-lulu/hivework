package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed assets/*
var assets embed.FS

const trayDoubleClick = 400 * time.Millisecond

// App is the Wails service bound to the shell UI.
type App struct {
	app                *application.App
	window             *application.WebviewWindow
	settingsWindow     *application.WebviewWindow
	serverWindow       *application.WebviewWindow
	store              *settingsStore
	servers            *serverStore
	sleep              *sleepGuard
	cmd                *exec.Cmd
	mu                 sync.Mutex
	connectionMu       sync.Mutex
	localStartMu       sync.Mutex
	quitting           bool
	dashboardBase      string
	connectionCancel   context.CancelFunc
	connectionPhase    string
	connectionError    string
	windowsReady       chan struct{}
	mainRuntimeReady   bool
	serverRuntimeReady bool

	trayClickMu    sync.Mutex
	lastTrayClick  time.Time
	trayClickTimer *time.Timer
	drops          dropServer
	ownsListenPort bool
}

func (a *App) ServiceName() string { return "desktop" }

func (a *App) ServiceStartup(context.Context, application.ServiceOptions) error { return nil }

func (a *App) ServiceShutdown() error {
	a.sleep.stop()
	a.connectionMu.Lock()
	defer a.connectionMu.Unlock()
	a.mu.Lock()
	if a.connectionCancel != nil {
		a.connectionCancel()
	}
	cmd := a.cmd
	a.cmd = nil
	ownsPort := a.ownsListenPort
	a.ownsListenPort = false
	a.mu.Unlock()
	stopOctop(cmd)
	if ownsPort {
		clearDesktopPort()
	}
	return nil
}

func (a *App) GetSettings() Settings {
	return a.store.get()
}

func (a *App) GetSettingsStatus() (Settings, error) {
	s := a.store.get()
	if a.app == nil {
		return s, nil
	}
	status, err := a.app.Autostart.Status()
	if err != nil {
		return s, fmt.Errorf("read autostart status: %w", err)
	}
	if s.Autostart != status.Enabled {
		s.Autostart = status.Enabled
		if err := a.store.save(s); err != nil {
			return s, err
		}
	}
	return s, nil
}

func (a *App) SaveSettings(next Settings) (Settings, error) {
	cur, err := a.GetSettingsStatus()
	if err != nil {
		return cur, err
	}
	autostart, err := a.setAutostart(next.Autostart)
	if err != nil {
		return cur, err
	}
	if err := a.sleep.set(next.PreventSleep); err != nil {
		if _, rollbackErr := a.setAutostart(cur.Autostart); rollbackErr != nil {
			log.Printf("rollback autostart after sleep prevention failure: %v", rollbackErr)
		}
		return cur, err
	}
	next.Autostart = autostart
	if err := a.store.save(next); err != nil {
		return cur, err
	}
	saved := a.store.get()
	a.applyDashboardPrefs(saved)
	return saved, nil
}

func (a *App) ShowMain() {
	a.showWindow()
}

func (a *App) HideSettings() {
	if a.settingsWindow == nil {
		return
	}
	a.settingsWindow.Hide()
}

func (a *App) Quit() {
	a.requestQuit()
}

func (a *App) setAutostart(on bool) (bool, error) {
	if a.app == nil {
		return false, fmt.Errorf("autostart is unavailable before the application starts")
	}
	if on {
		if err := a.app.Autostart.Enable(); err != nil {
			return false, fmt.Errorf("enable autostart: %w", err)
		}
	} else if err := a.app.Autostart.Disable(); err != nil {
		return false, fmt.Errorf("disable autostart: %w", err)
	}
	status, err := a.app.Autostart.Status()
	if err != nil {
		return false, fmt.Errorf("read autostart status: %w", err)
	}
	if status.Enabled != on {
		return status.Enabled, fmt.Errorf("autostart state did not update")
	}
	return status.Enabled, nil
}

func (a *App) applyDashboardPrefs(s Settings) {
	if a.window == nil {
		return
	}
	js := fmt.Sprintf(
		`(function(){try{localStorage.setItem('octop:ui-locale',%s);}catch(e){}})();`,
		jsonString(string(s.Locale)),
	)
	a.window.ExecJS(js)
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func (a *App) setStatus(msg string) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit("desktop:status", msg)
}

func (a *App) boot() {
	a.bootWhenWindowsReady(a.beginConnection())
}

func (a *App) bootWhenWindowsReady(ctx context.Context) {
	if a.waitForWindows(ctx) == nil {
		a.bootSelected(ctx)
	}
}

func (a *App) waitForWindows(ctx context.Context) error {
	if a.windowsReady == nil {
		return ctx.Err()
	}
	select {
	case <-a.windowsReady:
		return ctx.Err()
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *App) whenWindowsReady(action func()) {
	if a.windowsReady == nil {
		action()
		return
	}
	select {
	case <-a.windowsReady:
		action()
	default:
		ctx := context.Background()
		if a.app != nil {
			ctx = a.app.Context()
		}
		go func() {
			if a.waitForWindows(ctx) == nil {
				action()
			}
		}()
	}
}

func (a *App) markWindowRuntimeReady(mainWindow bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if mainWindow {
		a.mainRuntimeReady = true
	} else {
		a.serverRuntimeReady = true
	}
	if a.windowsReady != nil && a.mainRuntimeReady && a.serverRuntimeReady {
		select {
		case <-a.windowsReady:
		default:
			close(a.windowsReady)
		}
	}
}

func (a *App) startLocal(ctx context.Context) (string, error) {
	a.localStartMu.Lock()
	defer a.localStartMu.Unlock()
	locale := LocaleEN
	if a.store != nil {
		locale = a.store.get().Locale
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	host, preferred := resolveListen()
	if existing := findRunningDashboard(host, preferred); existing != "" {
		a.setStatus(desktopText(locale, copyStatusUsingExisting))
		if err := waitConnectionHealth(ctx, locale, existing, 30*time.Second); err != nil {
			return "", err
		}
		return existing, ctx.Err()
	}
	a.setStatus(desktopText(locale, copyStatusCheckingRuntime))
	if err := ensurePortable(locale, func(msg string) {
		if ctx.Err() == nil {
			a.setStatus(msg)
		}
	}); err != nil {
		return "", err
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	root := portableDir()
	a.stopOwnedBackend()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	port, err := chooseFreePort(host, preferred)
	if err != nil {
		var busy noFreePortError
		var bind cannotBindError
		switch {
		case errors.As(err, &busy):
			return "", fmt.Errorf("%s", desktopText(locale, copyErrorNoFreePort, busy.From, busy.To))
		case errors.As(err, &bind):
			return "", fmt.Errorf("%s", desktopText(locale, copyErrorCannotBind, bind.Host, bind.Port, bind.Err.Error()))
		default:
			return "", err
		}
	}
	a.mu.Lock()
	if ctx.Err() != nil {
		a.mu.Unlock()
		return "", ctx.Err()
	}
	cmd, err := startOctop(root, port)
	a.cmd = cmd
	a.mu.Unlock()
	if err != nil {
		return "", err
	}
	base := dashboardURL(host, port)
	a.setStatus(desktopText(locale, copyStatusStartingService))
	if err := waitConnectionHealth(ctx, locale, base, 2*time.Minute); err != nil {
		a.stopBackend(cmd)
		return "", err
	}
	a.connectionMu.Lock()
	a.mu.Lock()
	if ctx.Err() != nil || a.cmd != cmd {
		a.mu.Unlock()
		a.connectionMu.Unlock()
		a.stopBackend(cmd)
		return "", context.Canceled
	}
	if err := writeDesktopPort(port); err != nil {
		log.Printf("desktop port: %v", err)
	} else {
		a.ownsListenPort = true
	}
	a.mu.Unlock()
	a.connectionMu.Unlock()
	return base, nil
}

func (a *App) showDashboard(base string) {
	a.mu.Lock()
	a.dashboardBase = base
	a.mu.Unlock()
	if a.window == nil {
		return
	}
	a.window.SetURL(base)
	a.HideServerManager()
	a.showWindow()
	a.scheduleDragOverlay()
	s := a.store.get()
	go func() {
		time.Sleep(800 * time.Millisecond)
		a.applyDashboardPrefs(s)
	}()
	a.setStatus(desktopText(s.Locale, copyStatusReady))
}

func (a *App) hideToTray() {
	if a.window == nil {
		return
	}
	a.window.Hide()
}

func (a *App) showWindow() {
	a.whenWindowsReady(a.showReadyWindow)
}

func (a *App) showReadyWindow() {
	a.mu.Lock()
	needsChoice := a.dashboardBase == "" && (a.connectionPhase == "choose" || a.connectionPhase == "failed")
	a.mu.Unlock()
	if needsChoice {
		a.ShowServerManager()
		return
	}
	if a.window == nil {
		return
	}
	if a.window.IsMinimised() {
		a.window.UnMinimise()
	}
	a.window.Show()
	a.window.Focus()
}

func (a *App) toggleMainWindow() {
	if a.window == nil {
		return
	}
	if a.window.IsVisible() && !a.window.IsMinimised() {
		a.hideToTray()
		return
	}
	a.showWindow()
}

func (a *App) onTrayLeftClick() {
	a.trayClickMu.Lock()
	defer a.trayClickMu.Unlock()
	if a.trayClickTimer != nil {
		a.trayClickTimer.Stop()
		a.trayClickTimer = nil
	}
	now := time.Now()
	if !a.lastTrayClick.IsZero() && now.Sub(a.lastTrayClick) < trayDoubleClick {
		a.lastTrayClick = time.Time{}
		go a.toggleMainWindow()
		return
	}
	a.lastTrayClick = now
	a.trayClickTimer = time.AfterFunc(trayDoubleClick, func() {
		a.trayClickMu.Lock()
		a.trayClickTimer = nil
		a.trayClickMu.Unlock()
		a.showWindow()
	})
}

func (a *App) installDragOverlay() {
	if a.window == nil {
		return
	}
	a.window.ExecJS(dragOverlayJS())
	a.window.ExecJS(fileDropJS())
}

func (a *App) scheduleDragOverlay() {
	go func() {
		for range 40 {
			time.Sleep(250 * time.Millisecond)
			a.installDragOverlay()
			a.installExternalLinks()
		}
	}()
}

func (a *App) requestQuit() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	if a.app != nil {
		a.app.Quit()
	}
}

func main() {
	store := &settingsStore{cur: loadSettings()}
	api := &App{
		store:           store,
		servers:         newServerStore(),
		sleep:           &sleepGuard{},
		connectionPhase: "choose",
		windowsReady:    make(chan struct{}),
	}

	app := application.New(application.Options{
		Name:        "Octop",
		Description: "HiveWork desktop",
		Logger:      slog.New(slog.NewTextHandler(os.Stderr, nil)),
		Services: []application.Service{
			application.NewService(api),
		},
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})
	api.app = app
	attachOpenURLEventListener(app, api.OpenExternal)
	attachFileDropEventListener(app, api)
	startupConnection := api.beginConnection()
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
		applyAppIcon(app)
		go api.bootWhenWindowsReady(startupConnection)
	})

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:                "HiveWork · 蜂巢智工",
		Width:                1200,
		Height:               800,
		URL:                  "/",
		Hidden:               api.needsStartupSelection(),
		Frameless:            true,
		AllowSimpleEventEmit: true,
		EnableFileDrop:       true,
		BackgroundColour:     application.NewRGB(247, 248, 250),
	})
	api.window = win
	win.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		api.markWindowRuntimeReady(true)
	})
	app.Event.On("desktop:toggle-maximise", func(_ *application.CustomEvent) {
		win.ToggleMaximise()
	})
	app.Event.On("desktop:minimise", func(_ *application.CustomEvent) {
		win.Minimise()
	})
	app.Event.On("desktop:close", func(_ *application.CustomEvent) {
		api.hideToTray()
	})
	installDragOverlay := func(_ *application.WindowEvent) {
		api.scheduleDragOverlay()
		api.installServerManagerBridge()
		api.emitConnectionStatus()
	}
	win.OnWindowEvent(events.Mac.WebViewDidFinishNavigation, installDragOverlay)
	win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, installDragOverlay)
	win.OnWindowEvent(events.Linux.WindowLoadFinished, installDragOverlay)
	settingsWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "蜂巢智工设置",
		Width:            settingsWindowWidth,
		Height:           settingsWindowOuterHeight(),
		URL:              "/?settings=1",
		Hidden:           true,
		Frameless:        true,
		AlwaysOnTop:      true,
		DisableResize:    true,
		BackgroundColour: application.NewRGB(255, 255, 255),
		Windows: application.WindowsWindow{
			HiddenOnTaskbar: true,
		},
	})
	api.settingsWindow = settingsWin
	api.createServerWindow()
	app.Event.RegisterApplicationEventHook(events.Mac.ApplicationShouldHandleReopen, func(event *application.ApplicationEvent) {
		event.Cancel()
		api.HideSettings()
		api.showWindow()
	})

	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		api.mu.Lock()
		quit := api.quitting
		api.mu.Unlock()
		if quit {
			return
		}
		e.Cancel()
		api.hideToTray()
	})
	win.OnWindowEvent(events.Common.WindowMinimise, func(_ *application.WindowEvent) {
		if api.store.get().MinimizeToTray {
			api.hideToTray()
		}
	})
	settingsWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		settingsWin.Hide()
	})
	settingsWin.OnWindowEvent(events.Common.WindowLostFocus, func(_ *application.WindowEvent) {
		settingsWin.Hide()
	})

	tray := app.SystemTray.New()
	applyTrayIcon(tray)
	tray.SetTooltip("HiveWork · 蜂巢智工")
	tray.AttachWindow(settingsWin).WindowOffset(6)
	showSettings := func() { tray.ShowWindow() }
	if trayLeftClickShowsSettings(runtime.GOOS) {
		tray.OnClick(showSettings)
	} else {
		tray.OnClick(func() { api.onTrayLeftClick() })
	}
	tray.OnRightClick(showSettings)

	if _, err := api.setAutostart(store.get().Autostart); err != nil {
		log.Printf("sync autostart: %v", err)
	}
	if err := api.sleep.set(store.get().PreventSleep); err != nil {
		log.Printf("enable sleep prevention: %v", err)
	}

	api.scheduleDragOverlay()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
