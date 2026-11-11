import { afterEach, describe, expect, it } from "vitest";
import {
  localDesktopBridge,
  remoteDesktopBridge,
  remoteServerConnections,
} from "../test/desktopBridge";
import {
  getDesktopBridge,
  getDesktopUpdater,
  getServerConnectionsBridge,
  hasDesktopChrome,
  hasDesktopSession,
  isDesktopShell,
} from "./desktopBridge";

afterEach(() => {
  delete window.octopDesktop;
  delete window.hiveworkServerConnections;
});

describe("local capabilities and remote server switching", () => {
  it("keeps the standalone remote global outside the desktop shell", () => {
    const connections = remoteServerConnections();
    window.hiveworkServerConnections = connections;

    expect(isDesktopShell()).toBe(false);
    expect(getDesktopBridge()).toBeNull();
    expect(getServerConnectionsBridge()).toBe(connections);
    expect(hasDesktopSession()).toBe(false);
    expect(hasDesktopChrome()).toBe(false);
    expect(getDesktopUpdater()).toBeNull();
  });

  it("supports server switching on an older partial desktop bridge", () => {
    const bridge = remoteDesktopBridge();
    window.octopDesktop = bridge;

    expect(isDesktopShell()).toBe(true);
    expect(getServerConnectionsBridge()).toBe(bridge.serverConnections);
    expect(hasDesktopSession()).toBe(false);
    expect(hasDesktopChrome()).toBe(false);
    expect(getDesktopUpdater()).toBeNull();
  });

  it("keeps local capabilities and prefers its native server manager", () => {
    const bridge = localDesktopBridge();
    window.octopDesktop = bridge;
    window.hiveworkServerConnections = remoteServerConnections();

    expect(isDesktopShell()).toBe(true);
    expect(getServerConnectionsBridge()).toBe(bridge.serverConnections);
    expect(hasDesktopSession()).toBe(true);
    expect(hasDesktopChrome()).toBe(true);
    expect(getDesktopUpdater()).toBe(bridge);
  });
});
