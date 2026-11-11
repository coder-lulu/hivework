import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopServerConnection,
  DesktopServerConnectionsBridge,
} from "../utils/desktopBridge";
import DesktopServerSettings from "./DesktopServerSettings";

const shell = vi.hoisted(() => ({
  serverConnections: undefined as DesktopServerConnectionsBridge | undefined,
}));
vi.mock("../utils/desktopBridge", () => ({
  getServerConnectionsBridge: () => shell.serverConnections ?? null,
}));

function connect(server: DesktopServerConnection | null = null) {
  const unsubscribe = vi.fn();
  let onChange = () => {};
  const current = vi.fn().mockResolvedValue(server);
  const openManager = vi.fn().mockResolvedValue(undefined);
  shell.serverConnections = {
    current,
    openManager,
    onChange: vi.fn((callback) => {
      onChange = callback;
      return unsubscribe;
    }),
  };
  return { current, openManager, unsubscribe, changed: () => onChange() };
}

describe("Electron server settings entry on login and setup pages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    shell.serverConnections = undefined;
  });

  afterEach(() => {
    cleanup();
    shell.serverConnections = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("stays hidden in browsers and older shells and stops probing", () => {
    const { container } = render(<DesktopServerSettings />);
    expect(container).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(12_000));
    expect(container).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the current server and opens only the native manager", async () => {
    const { openManager } = connect({
      name: "团队线路",
      url: window.location.origin,
    });
    const fetch = vi.spyOn(window, "fetch");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    await act(async () => {
      render(<DesktopServerSettings />);
    });

    const line = `团队线路 - ${window.location.origin}`;
    expect(screen.getByText(line)).toHaveAttribute("title", line);
    fireEvent.click(
      screen.getByRole("button", { name: "login.serverSettings.manage" }),
    );
    expect(openManager).toHaveBeenCalledExactlyOnceWith();
    expect(fetch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("detects a late bridge and stops probing", async () => {
    render(<DesktopServerSettings />);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    connect({ name: "Late profile", url: window.location.origin });
    await act(async () => vi.advanceTimersByTime(250));
    expect(
      screen.getByText(`Late profile - ${window.location.origin}`),
    ).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up pending bridge detection when unmounted", () => {
    const { unmount } = render(<DesktopServerSettings />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes metadata from bridge events and unsubscribes on unmount", async () => {
    const { current, changed, unsubscribe } = connect();
    const view = render(<DesktopServerSettings />);
    await act(async () => {});
    expect(
      screen.getByText(
        `login.serverSettings.label - ${window.location.origin}`,
      ),
    ).toBeInTheDocument();
    for (const name of ["远程工作室", "团队主线路"]) {
      current.mockResolvedValue({ name, url: window.location.origin });
      await act(async () => changed());
      expect(
        screen.getByText(`${name} - ${window.location.origin}`),
      ).toBeInTheDocument();
    }
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("ignores stale origins, invalid URLs and failed metadata requests", async () => {
    const { current, changed } = connect({
      name: "Stale",
      url: "https://other.example.com",
    });
    await act(async () => {
      render(<DesktopServerSettings />);
    });
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    current.mockResolvedValue({ name: "Broken", url: "invalid address" });
    await act(async () => changed());
    expect(screen.queryByText(/Broken/)).not.toBeInTheDocument();
    current.mockRejectedValue(new Error("Connection unavailable"));
    await act(async () => changed());
    expect(
      screen.getByText(
        `login.serverSettings.label - ${window.location.origin}`,
      ),
    ).toBeInTheDocument();
  });
});
