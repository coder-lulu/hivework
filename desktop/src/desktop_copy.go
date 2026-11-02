package main

import "fmt"

const (
	copyStatusChooseServer     = "status.choose_server"
	copyStatusConnecting       = "status.connecting"
	copyStatusCheckingRuntime  = "status.checking_runtime"
	copyStatusStartingService  = "status.starting_service"
	copyStatusReady            = "status.ready"
	copyStatusUsingRuntime     = "status.using_runtime"
	copyStatusBackupDatabase   = "status.backup_database"
	copyStatusInstallingUpdate = "status.installing_update"
	copyStatusUpdatingRuntime  = "status.updating_runtime"
	copyStatusFirstExtract     = "status.first_extract"
	copyStatusUpdateFailedKeep = "status.update_failed_keep"
	copyStatusUsingExisting    = "status.using_existing"
	copyErrorBackupFailed      = "error.backup_failed"
	copyErrorUpgradeFailed     = "error.upgrade_failed"
	copyErrorNoFreePort        = "error.no_free_port"
	copyErrorCannotBind        = "error.cannot_bind"
	copyWait1Minute            = "wait.1_minute"
	copyWaitNMinutes           = "wait.n_minutes"
	copyWait1Second            = "wait.1_second"
	copyWaitNSeconds           = "wait.n_seconds"
	copyHealthNotReady5xx      = "health.not_ready_5xx"
	copyHealthNotReadyConnect  = "health.not_ready_connect"
	copyHealthNotReady         = "health.not_ready"
	copyErrorServerURL         = "server.invalid_url"
	copyErrorServerDuplicate   = "server.duplicate"
	copyErrorServerUnknown     = "server.unknown"
	copyErrorServerUnavailable = "server.unavailable"
	copyErrorServerInUse       = "server.in_use"
	copyErrorServerSave        = "server.save_failed"
	copyErrorServerAccess      = "server.access_denied"
	copyServerLocalLabel       = "server.local_label"
	copyErrorServerLoad        = "server.load_failed"
)

var desktopCopy = map[Locale]map[string]string{
	LocaleEN: {
		copyStatusChooseServer:     "Choose an existing server or use the local service on this computer.",
		copyErrorServerLoad:        "Could not read desktop-servers.json. Check the file and its permissions, then restart the desktop app. Your settings have been preserved.",
		copyErrorServerURL:         "Enter an HTTP or HTTPS server address without a path, credentials or query parameters.",
		copyErrorServerDuplicate:   "This server address is already saved.",
		copyErrorServerUnknown:     "This server is no longer in the saved list. Refresh and select it again.",
		copyErrorServerUnavailable: "Could not connect to this HiveWork server. Check its address and connection, then try again.",
		copyErrorServerInUse:       "Set another server or the local service as default before changing or deleting this default address.",
		copyErrorServerSave:        "Could not save server settings. Check permissions for the desktop data directory.",
		copyErrorServerAccess:      "Open server settings in the desktop app to manage connections.",
		copyServerLocalLabel:       "Local service",
		copyStatusConnecting:       "Connecting to Octop…",
		copyStatusCheckingRuntime:  "Checking the runtime…",
		copyStatusStartingService:  "Starting the Octop service…",
		copyStatusReady:            "Octop is ready",
		copyStatusUsingRuntime:     "Using the existing runtime…",
		copyStatusBackupDatabase:   "Desktop update %s found. Backing up the database…",
		copyStatusInstallingUpdate: "Installing the bundled desktop update…",
		copyStatusUpdatingRuntime:  "Updating the bundled runtime…",
		copyStatusFirstExtract:     "First launch: unpacking the bundled runtime…",
		copyStatusUpdateFailedKeep: "Runtime update failed; using the existing runtime…",
		copyStatusUsingExisting:    "Octop is already running. Opening it…",
		copyErrorBackupFailed:      "Database backup failed before upgrade; the current version was preserved",
		copyErrorUpgradeFailed:     "Desktop runtime upgrade failed; the current version was preserved",
		copyErrorNoFreePort:        "No free port from %d to %d. Close the program using these ports and try again.",
		copyErrorCannotBind:        "Cannot listen on %s:%d (%s). Check bind_host in config.json.",
		copyWait1Minute:            "1 minute",
		copyWaitNMinutes:           "%d minutes",
		copyWait1Second:            "1 second",
		copyWaitNSeconds:           "%d seconds",
		copyHealthNotReady5xx:      "Octop did not become ready within %s (%s). The service responded but is not ready yet. Try again, or check the terminal logs.",
		copyHealthNotReadyConnect:  "Octop did not become ready within %s (%s). Could not connect — make sure Octop is running.",
		copyHealthNotReady:         "Octop did not become ready within %s (%s). Make sure Octop is running at this address, or check the terminal logs.",
	},
	LocaleZH: {
		copyServerLocalLabel:       "本地服务",
		copyStatusChooseServer:     "请选择连接已有服务器，或使用此电脑上的本地服务。",
		copyErrorServerLoad:        "无法读取 desktop-servers.json，请检查文件和权限后重启客户端。原配置已保留。",
		copyErrorServerURL:         "请输入 HTTP 或 HTTPS 服务器根地址，不包含路径、账号密码或查询参数。",
		copyErrorServerDuplicate:   "该服务器地址已保存。",
		copyErrorServerUnknown:     "该服务器已不在保存列表中，请刷新后重新选择。",
		copyErrorServerUnavailable: "无法连接该蜂巢智工服务器，请检查地址和网络后重试。",
		copyErrorServerInUse:       "请先将其他服务器或本地服务设为默认，再修改或删除默认地址。",
		copyErrorServerSave:        "无法保存服务器设置，请检查桌面数据目录的写入权限。",
		copyErrorServerAccess:      "请通过桌面客户端的服务器设置窗口管理连接。",
		copyStatusConnecting:       "正在连接 Octop…",
		copyStatusCheckingRuntime:  "正在检查运行环境…",
		copyStatusStartingService:  "正在启动 Octop 服务…",
		copyStatusReady:            "Octop 已就绪",
		copyStatusUsingRuntime:     "正在使用已有运行环境…",
		copyStatusBackupDatabase:   "发现客户端新版 %s，正在备份数据库…",
		copyStatusInstallingUpdate: "正在安装客户端内置新版…",
		copyStatusUpdatingRuntime:  "正在更新内置运行环境…",
		copyStatusFirstExtract:     "首次启动，正在解压内置运行环境…",
		copyStatusUpdateFailedKeep: "更新内置运行环境失败，继续使用已有运行环境…",
		copyStatusUsingExisting:    "Octop 已在运行，正在打开…",
		copyErrorBackupFailed:      "升级前数据库备份失败，已保留当前版本",
		copyErrorUpgradeFailed:     "客户端运行环境升级失败，已保留当前版本",
		copyErrorNoFreePort:        "从 %d 到 %d 没有空闲端口，请关闭占用这些端口的程序后再试。",
		copyErrorCannotBind:        "无法在 %s:%d 上监听（%s）。请检查 config.json 里的 bind_host。",
		copyWait1Minute:            "1 分钟",
		copyWaitNMinutes:           "%d 分钟",
		copyWait1Second:            "1 秒",
		copyWaitNSeconds:           "%d 秒",
		copyHealthNotReady5xx:      "Octop 服务未在%s内就绪（%s）。服务已响应但尚未就绪，请稍后再试，或查看终端日志。",
		copyHealthNotReadyConnect:  "Octop 服务未在%s内就绪（%s）。目前无法连接该地址，请确认 Octop 正在运行。",
		copyHealthNotReady:         "Octop 服务未在%s内就绪（%s）。请确认本机已启动 Octop，且地址、端口正确；也可查看终端日志。",
	},
}

func desktopText(locale Locale, key string, args ...any) string {
	msg := lookupDesktopCopy(locale, key)
	if len(args) == 0 {
		return msg
	}
	return fmt.Sprintf(msg, args...)
}

func lookupDesktopCopy(locale Locale, key string) string {
	if msgs := desktopCopy[locale]; msgs != nil {
		if msg, ok := msgs[key]; ok {
			return msg
		}
	}
	if msg, ok := desktopCopy[LocaleEN][key]; ok {
		return msg
	}
	return key
}
