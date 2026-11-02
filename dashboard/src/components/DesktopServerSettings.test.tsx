import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesktopServerSettings from "./DesktopServerSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type DesktopWindow = Window & {
  _wails?: { invoke: (message: string) => void };
  __OCTOP_SERVER_SETTINGS__?: boolean;
  __OCTOP_CURRENT_SERVER__?: { name: string; url: string };
};

const desktopWindow = window as DesktopWindow;

describe("desktop server settings entry on login and setup pages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete desktopWindow._wails;
    delete desktopWindow.__OCTOP_SERVER_SETTINGS__;
    delete desktopWindow.__OCTOP_CURRENT_SERVER__;
  });

  afterEach(() => {
    cleanup();
    delete desktopWindow._wails;
    delete desktopWindow.__OCTOP_SERVER_SETTINGS__;
    delete desktopWindow.__OCTOP_CURRENT_SERVER__;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("stays hidden in browsers and stops probing after twelve seconds", () => {
    const { container } = render(<DesktopServerSettings />);
    expect(container).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(12_000));
    expect(container).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the current server and only emits the native settings event", () => {
    const invoke = vi.fn();
    desktopWindow._wails = { invoke };
    desktopWindow.__OCTOP_SERVER_SETTINGS__ = true;
    desktopWindow.__OCTOP_CURRENT_SERVER__ = {
      name: "团队线路",
      url: window.location.origin,
    };
    const fetch = vi.spyOn(window, "fetch");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    render(<DesktopServerSettings />);

    const line = `团队线路 - ${window.location.origin}`;
    expect(screen.getByText(line)).toHaveAttribute("title", line);
    expect(
      screen.queryByText("login.serverSettings.description"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "login.serverSettings.manage" }),
    ).toHaveTextContent("login.serverSettings.settings");
    fireEvent.click(
      screen.getByRole("button", { name: "login.serverSettings.manage" }),
    );

    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "wails:event:emit:desktop:servers:open",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("detects late native bridge injection and stops probing", () => {
    render(<DesktopServerSettings />);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    desktopWindow._wails = { invoke: vi.fn() };
    desktopWindow.__OCTOP_SERVER_SETTINGS__ = true;
    desktopWindow.__OCTOP_CURRENT_SERVER__ = {
      name: "Late profile",
      url: window.location.origin,
    };
    act(() => vi.advanceTimersByTime(250));
    expect(
      screen.getByRole("button", { name: "login.serverSettings.manage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Late profile - ${window.location.origin}`),
    ).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up pending bridge detection when unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<DesktopServerSettings />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith(
      "octop:server-connection",
      expect.any(Function),
    );
  });

  it("uses the legacy label and origin when current profile metadata is unavailable", () => {
    desktopWindow._wails = { invoke: vi.fn() };
    desktopWindow.__OCTOP_SERVER_SETTINGS__ = true;
    render(<DesktopServerSettings />);
    expect(
      screen.getByText(
        `login.serverSettings.label - ${window.location.origin}`,
      ),
    ).toBeInTheDocument();
  });

  it("updates late profile metadata and renames from native connection events", () => {
    desktopWindow._wails = { invoke: vi.fn() };
    desktopWindow.__OCTOP_SERVER_SETTINGS__ = true;
    render(<DesktopServerSettings />);
    for (const name of ["远程工作室", "团队主线路"]) {
      desktopWindow.__OCTOP_CURRENT_SERVER__ = {
        name,
        url: window.location.origin,
      };
      act(() =>
        window.dispatchEvent(new CustomEvent("octop:server-connection")),
      );
      expect(
        screen.getByText(`${name} - ${window.location.origin}`),
      ).toBeInTheDocument();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores profile metadata from another origin or with an invalid URL", () => {
    desktopWindow._wails = { invoke: vi.fn() };
    desktopWindow.__OCTOP_SERVER_SETTINGS__ = true;
    desktopWindow.__OCTOP_CURRENT_SERVER__ = {
      name: "Stale",
      url: "https://other.example.com",
    };
    render(<DesktopServerSettings />);
    expect(
      screen.getByText(
        `login.serverSettings.label - ${window.location.origin}`,
      ),
    ).toBeInTheDocument();
    desktopWindow.__OCTOP_CURRENT_SERVER__ = {
      name: "Broken",
      url: "invalid address",
    };
    act(() => window.dispatchEvent(new CustomEvent("octop:server-connection")));
    expect(screen.queryByText(/Stale|Broken/)).not.toBeInTheDocument();
  });

  it("hides the unsupported entry in older desktop clients", () => {
    desktopWindow._wails = { invoke: vi.fn() };
    render(<DesktopServerSettings />);
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
