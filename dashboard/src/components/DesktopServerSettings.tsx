import { useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import { Server, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getServerConnectionsBridge,
  type DesktopServerConnection,
} from "../utils/desktopBridge";

function currentServer(
  server: DesktopServerConnection | null,
): DesktopServerConnection | undefined {
  if (typeof server?.name !== "string" || typeof server.url !== "string")
    return;
  try {
    const url = new URL(server.url);
    if (
      /^https?:$/.test(url.protocol) &&
      (url.origin === window.location.origin ||
        (window.location.protocol === "octop:" &&
          window.location.hostname === "app"))
    )
      return server;
  } catch {
    // Ignore incomplete bridge metadata while the dashboard is navigating.
  }
}

export default function DesktopServerSettings() {
  const { t } = useTranslation();
  const [desktop, setDesktop] = useState(() =>
    Boolean(getServerConnectionsBridge()),
  );
  const [server, setServer] = useState<DesktopServerConnection>();

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    let attempts = 0;
    const update = () => {
      const connections = getServerConnectionsBridge();
      setDesktop(Boolean(connections));
      if (!connections) return;
      if (timer !== undefined) window.clearInterval(timer);
      unsubscribe ??= connections.onChange(update);
      void connections
        .current()
        .then((next) => {
          if (active) setServer(currentServer(next));
        })
        .catch(() => {
          if (active) setServer(undefined);
        });
    };
    // The native bridge can arrive after the remote dashboard has rendered.
    if (!getServerConnectionsBridge()) {
      timer = window.setInterval(() => {
        update();
        if (++attempts >= 48) window.clearInterval(timer);
      }, 250);
    }
    update();
    return () => {
      active = false;
      unsubscribe?.();
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
            void getServerConnectionsBridge()?.openManager();
          }}
        >
          {t("login.serverSettings.settings")}
        </Button>
      </Tooltip>
    </section>
  );
}
