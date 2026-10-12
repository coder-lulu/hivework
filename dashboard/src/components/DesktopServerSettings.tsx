import { useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import { Server, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isDesktopShell } from "../utils/desktopChrome";

type CurrentServer = { name: string; url: string };

type DesktopWindow = Window & {
  _wails?: { invoke?: (message: string) => void };
  __OCTOP_SERVER_SETTINGS__?: boolean;
  __OCTOP_CURRENT_SERVER__?: CurrentServer;
};

function serverSettingsAvailable(): boolean {
  return (
    isDesktopShell() &&
    (window as DesktopWindow).__OCTOP_SERVER_SETTINGS__ === true
  );
}

function currentServer(): CurrentServer | undefined {
  const server = (window as DesktopWindow).__OCTOP_CURRENT_SERVER__;
  if (typeof server?.name !== "string" || typeof server.url !== "string")
    return;
  try {
    if (new URL(server.url).origin === window.location.origin) return server;
  } catch {
    // Ignore incomplete bridge metadata while the dashboard is navigating.
  }
}

export default function DesktopServerSettings() {
  const { t } = useTranslation();
  const [desktop, setDesktop] = useState(serverSettingsAvailable);
  const [server, setServer] = useState(currentServer);

  useEffect(() => {
    let timer: number | undefined;
    let attempts = 0;
    const update = () => {
      const available = serverSettingsAvailable();
      setDesktop(available);
      setServer(currentServer());
      if (available && timer !== undefined) window.clearInterval(timer);
    };
    window.addEventListener("octop:server-connection", update);
    // The native bridge can arrive after the remote dashboard has rendered.
    if (!serverSettingsAvailable()) {
      timer = window.setInterval(() => {
        update();
        if (++attempts >= 48) window.clearInterval(timer);
      }, 250);
    }
    update();
    return () => {
      window.removeEventListener("octop:server-connection", update);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  if (!desktop) return null;

  const label = `${server?.name || t("login.serverSettings.label")} - ${
    server?.url || window.location.origin
  }`;

  return (
    <section
      aria-label={t("login.serverSettings.label")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        marginBlock: 12,
        minWidth: 0,
        fontSize: 13,
        color: "var(--fn-text-secondary)",
      }}
    >
      <Server size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span
        title={label}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <Tooltip title={t("login.serverSettings.manage")}>
        <Button
          size="small"
          icon={<Settings size={14} aria-hidden="true" />}
          aria-label={t("login.serverSettings.manage")}
          style={{ borderRadius: 8, fontSize: 13, flexShrink: 0 }}
          onClick={() => {
            (window as DesktopWindow)._wails?.invoke?.(
              "wails:event:emit:desktop:servers:open",
            );
          }}
        >
          {t("login.serverSettings.settings")}
        </Button>
      </Tooltip>
    </section>
  );
}
