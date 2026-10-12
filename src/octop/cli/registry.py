"""CLI command registry for lazy loading."""

from __future__ import annotations

from octop.branding import brand_name

# command name -> (relative module path, attribute name, short help)
COMMANDS: dict[str, tuple[str, str, str]] = {
    "memory": (".commands.memory", "memory", "Live memory maintenance (backup and slim)."),
    "init": (".commands.init", "init", f"Bootstrap an {brand_name()} server install."),
    "run": (".commands.run", "run", "Run octop-server in the foreground."),
    "service": (
        ".commands.service",
        "service",
        "System service lifecycle (start/stop/restart/status).",
    ),
    "config": (".commands.config", "config_group", "CLI defaults (pinned user/agent)."),
    "user": (".commands.user", "user", "User management commands (admin only)."),
    "agent": (".commands.agent", "agent", "Agent lifecycle commands."),
    "chats": (".commands.chats", "chats", "Chat REPL and session management."),
    "channel": (".commands.channel", "channel", "Channel management commands."),
    "cron": (".commands.cron", "cron", "Cron job management commands."),
    "provider": (".commands.provider", "provider", "Provider management (admin write)."),
    "models": (".commands.models", "models", "Provider presets and resolved models."),
    "skills": (".commands.skills", "skills", "Per-agent skill enable/disable."),
    "admin": (".commands.admin", "admin", "Admin commands."),
    "captcha": (
        ".commands.captcha",
        "captcha",
        "Login captcha maintenance (lockout escape hatch).",
    ),
    "version": (".commands.version", "version", f"Show the installed {brand_name()} version."),
    "completion": (".commands.completion", "completion", "Shell completion utilities."),
    "update": (
        ".commands.update",
        "update",
        f"Show upgrade guidance for {brand_name()}.",
    ),
    "clean": (".commands.clean", "clean", "Remove CLI state or wipe all of ~/.octop."),
    "backup": (".commands.backup", "backup", f"Export and restore {brand_name()} backups."),
    "bridge": (".commands.bridge", "bridge", f"Manage remote {brand_name()} bridge peers."),
    "acp": (".commands.acp", "acp_cmd", f"Run {brand_name()} agent as ACP server (stdio)."),
    "plugin": (".commands.plugin", "plugin", "Install and manage plugins."),
}
