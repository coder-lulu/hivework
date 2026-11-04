package main

import (
	"context"
	_ "embed"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const dashboardLoadTimeout = 45 * time.Second
const dashboardReadyEventPrefix = "desktop:dashboard-ready:"

//go:embed assets/dashboard-ready.js
var dashboardReadyScript string

type dashboardLoad struct {
	id    uint64
	base  string
	ctx   context.Context
	timer *time.Timer
}

// a.mu must be held. A new connection invalidates callbacks from the old page.
func (a *App) cancelDashboardLoadLocked() {
	if a.dashboardLoad != nil {
		a.dashboardLoad.timer.Stop()
		a.dashboardLoad = nil
	}
}

func (a *App) beginDashboardLoad(ctx context.Context, base string, timeout time.Duration) uint64 {
	a.mu.Lock()
	if ctx.Err() != nil {
		a.mu.Unlock()
		return 0
	}
	a.cancelDashboardLoadLocked()
	a.dashboardLoadID++
	id := a.dashboardLoadID
	a.dashboardRendered = false
	a.connectionPhase, a.connectionError = "loading", ""
	load := &dashboardLoad{id: id, base: base, ctx: ctx}
	a.dashboardLoad = load
	load.timer = time.AfterFunc(timeout, func() { a.finishDashboardLoad(id, false) })
	a.mu.Unlock()
	a.emitConnectionStatus()
	if a.app != nil {
		a.app.Event.Emit("desktop:servers:refresh")
	}
	return id
}

func (a *App) finishDashboardLoad(id uint64, ready bool) bool {
	a.connectionMu.Lock()
	defer a.connectionMu.Unlock()
	a.mu.Lock()
	load := a.dashboardLoad
	if load == nil || load.id != id || load.ctx.Err() != nil {
		a.mu.Unlock()
		return false
	}
	a.cancelDashboardLoadLocked()
	a.dashboardRendered = ready
	a.connectionPhase, a.connectionError = "connected", ""
	if !ready {
		a.connectionPhase = "failed"
		a.connectionError = desktopText(a.store.get().Locale, copyErrorDashboardLoad)
	}
	a.mu.Unlock()
	a.emitConnectionStatus()
	if a.app != nil {
		a.app.Event.Emit("desktop:servers:refresh")
	}
	if ready {
		a.HideServerManager()
		a.showWindow()
		a.setStatus(desktopText(a.store.get().Locale, copyStatusReady))
	} else {
		a.ShowServerManager()
	}
	return true
}

func (a *App) watchDashboardRender() {
	a.connectionMu.Lock()
	defer a.connectionMu.Unlock()
	a.mu.Lock()
	load := a.dashboardLoad
	if load == nil || load.ctx.Err() != nil || a.window == nil {
		a.mu.Unlock()
		return
	}
	id, base := load.id, load.base
	a.mu.Unlock()
	a.window.ExecJS(dashboardRenderJS(id, base))
}

func dashboardRenderJS(id uint64, base string) string {
	return fmt.Sprintf("window.__OCTOP_DASHBOARD_LOAD__ = {id:%s,base:%s};\n%s",
		jsonString(strconv.FormatUint(id, 10)), jsonString(base), dashboardReadyScript)
}

type dashboardReadyEventListener struct{ app *App }

func (listener *dashboardReadyEventListener) DispatchWailsEvent(event *application.CustomEvent) {
	if event == nil || listener.app == nil || listener.app.window == nil ||
		event.Sender != listener.app.window.Name() || !strings.HasPrefix(event.Name, dashboardReadyEventPrefix) {
		return
	}
	id, err := strconv.ParseUint(strings.TrimPrefix(event.Name, dashboardReadyEventPrefix), 10, 64)
	if err == nil {
		go listener.app.finishDashboardLoad(id, true)
	}
}
