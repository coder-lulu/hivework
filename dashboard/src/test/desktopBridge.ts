import { vi } from "vitest";

export function remoteServerConnections() {
  return {
    current: vi.fn().mockResolvedValue({
      name: "Remote server",
      url: window.location.origin,
    }),
    openManager: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn(() => () => {}),
  };
}

/** Compatibility fixture for an older shell's partial octopDesktop. */
export function remoteDesktopBridge() {
  return { serverConnections: remoteServerConnections() };
}

export function localDesktopBridge() {
  const settings = {
    launchAtLogin: false,
    closeBehavior: "quit" as const,
    themeBackground: "system" as const,
    stableOnly: true,
  };
  return {
    ...remoteDesktopBridge(),
    session: {
      register: vi.fn().mockResolvedValue(true),
      renew: vi.fn().mockResolvedValue(null),
      revoke: vi.fn().mockResolvedValue(true),
    },
    setWindowChrome: vi.fn(),
    clientSettings: {
      get: vi.fn().mockResolvedValue(settings),
      set: vi.fn().mockResolvedValue(settings),
    },
    checkForUpdates: vi.fn().mockResolvedValue({
      status: "up-to-date",
      currentVersion: "1.0.3b5",
      latestVersion: null,
      error: null,
    }),
    installUpdate: vi.fn().mockResolvedValue(undefined),
  };
}
