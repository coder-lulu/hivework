import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(
  resolve(process.cwd(), "../desktop/src/assets/server-manager.html"),
  "utf8",
);
const script = html
  .match(/<script type="module">([\s\S]*?)<\/script>/)![1]
  .replace(/import \{ Call, Events \} from "\/wails\/runtime.js";/, "");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const url = "https://work.example.com";
const initialState = {
  servers: [] as { name: string; url: string }[],
  activeUrl: null as string | null,
  currentUrl: "",
  locale: "zh",
  connectionPhase: "choose",
  connectionError: "",
};
type State = typeof initialState;
const element = (id: string) => document.getElementById(id)!;

async function boot(overrides: Partial<State> = {}) {
  const state = { ...initialState, ...overrides };
  const handlers = new Map<string, (event: unknown) => void>();
  const call = vi.fn(async (name: string) => {
    if (name === "main.App.GetServerConnections") return state;
    throw new Error(`Unexpected call: ${name}`);
  });
  document.body.innerHTML = html.match(
    /<body>([\s\S]*?)<script type="module">/,
  )![1];
  await new AsyncFunction("Call", "Events", script)(
    { ByName: call },
    {
      On: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
    },
  );
  return {
    call,
    emit: (data: Partial<State>) =>
      handlers.get("desktop:connection")!({ data }),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("desktop server page loading", () => {
  it("shows the initial loading state and explains a slow page load", async () => {
    await boot({ connectionPhase: "loading", currentUrl: url });
    expect(element("page-loading")).toBeVisible();
    expect(element("page-loading")).toHaveAttribute("role", "status");
    expect(element("page-loading")).toHaveAttribute("aria-live", "polite");
    expect(element("loading-label")).toHaveTextContent(
      "服务器已连接，正在加载页面…",
    );
    expect(element("loading-url")).toHaveTextContent(url);
    expect(element("remote-view")).not.toBeVisible();
    expect(element("startup")).not.toBeVisible();
    expect(element("progress")).not.toBeVisible();
    expect(element("loading-slow")).not.toBeVisible();
    await vi.advanceTimersByTimeAsync(10000);
    expect(element("loading-slow")).toBeVisible();
  });

  it("keeps loading visible after save-and-connect settles without switching windows", async () => {
    const { call } = await boot();
    element("choose-remote").click();
    (element("server-url") as HTMLInputElement).value = url;
    call.mockResolvedValueOnce({
      ...initialState,
      servers: [{ name: "Work", url }],
    });
    call.mockResolvedValueOnce({
      ...initialState,
      activeUrl: url,
      currentUrl: url,
      connectionPhase: "loading",
    });
    element("server-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledWith("main.App.ConnectServer", url);
    expect(element("page-loading")).toBeVisible();
    expect(element("loading-url")).toHaveTextContent(url);
    expect(element("save")).not.toBeDisabled();
    expect(call).not.toHaveBeenCalledWith("main.App.HideServerManager");
    expect(call).not.toHaveBeenCalledWith("main.App.ShowMain");
  });

  it("cleans up loading on failure and allows retry", async () => {
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    const { call, emit } = await boot({
      connectionPhase: "loading",
      currentUrl: url,
    });
    clearTimer.mockClear();
    emit({ connectionPhase: "failed", connectionError: "Page timed out" });
    expect(clearTimer).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(element("loading-slow")).not.toBeVisible();
    expect(element("page-loading")).not.toBeVisible();
    expect(element("recovery")).toBeVisible();
    expect(element("connection-error")).toHaveTextContent("Page timed out");
    expect(element("switch-server")).toBeVisible();
    call.mockResolvedValueOnce({
      ...initialState,
      currentUrl: url,
      connectionPhase: "loading",
    });
    element("retry").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledWith("main.App.RetryServerConnection");
    expect(element("page-loading")).toBeVisible();
    expect(element("recovery")).not.toBeVisible();
  });

  it("handles English loading events and clears the timer when the page is ready", async () => {
    const { call, emit } = await boot({ locale: "en" });
    const setTimer = vi.spyOn(globalThis, "setTimeout");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    emit({ connectionPhase: "loading", currentUrl: url });
    expect(element("loading-label")).toHaveTextContent(
      "Server connected. Loading the page…",
    );
    expect(element("loading-url")).toHaveTextContent(url);
    const timerIndex = setTimer.mock.calls.findIndex(
      (args) => args[1] === 10000,
    );
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    emit({ connectionPhase: "connected" });
    expect(clearTimer).toHaveBeenCalledWith(
      setTimer.mock.results[timerIndex].value,
    );
    expect(element("page-loading")).not.toBeVisible();
    await vi.advanceTimersByTimeAsync(10000);
    expect(element("loading-slow")).not.toBeVisible();
    expect(call).not.toHaveBeenCalledWith("main.App.HideServerManager");
    expect(call).not.toHaveBeenCalledWith("main.App.ShowMain");
  });
});
