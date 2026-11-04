import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "../desktop/src/assets/dashboard-ready.js"),
  "utf8",
);
const nativeWindow = window as unknown as {
  __OCTOP_DASHBOARD_LOAD__?: { id: string; base: string };
  __OCTOP_DASHBOARD_WATCH__?: string;
  __OCTOP_PAGE_LEAVING__?: boolean;
  _wails?: { invoke: ReturnType<typeof vi.fn> };
};

function watch(base = window.location.origin) {
  nativeWindow.__OCTOP_DASHBOARD_LOAD__ = { id: "42", base };
  new Function(script)();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  nativeWindow._wails = { invoke: vi.fn() };
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  delete nativeWindow.__OCTOP_DASHBOARD_LOAD__;
  delete nativeWindow.__OCTOP_DASHBOARD_WATCH__;
  delete nativeWindow.__OCTOP_PAGE_LEAVING__;
  delete nativeWindow._wails;
  document.body.replaceChildren();
});

describe("desktop dashboard render detection", () => {
  it("keeps an empty React root loading until content is mounted", async () => {
    watch();
    expect(nativeWindow._wails!.invoke).not.toHaveBeenCalled();
    document.getElementById("root")!.append(document.createElement("main"));
    await Promise.resolve();
    expect(nativeWindow._wails!.invoke).toHaveBeenCalledExactlyOnceWith(
      "wails:event:emit:desktop:dashboard-ready:42",
    );
    document.getElementById("root")!.append(document.createElement("div"));
    await Promise.resolve();
    expect(nativeWindow._wails!.invoke).toHaveBeenCalledTimes(1);
  });

  it("accepts an already mounted page and ignores duplicate injection", () => {
    document.getElementById("root")!.innerHTML = "<main>Login</main>";
    watch();
    watch();
    expect(nativeWindow._wails!.invoke).toHaveBeenCalledTimes(1);
  });

  it("ignores the previous page while it is leaving and unrelated origins", () => {
    document.getElementById("root")!.innerHTML = "<main>Old page</main>";
    nativeWindow.__OCTOP_PAGE_LEAVING__ = true;
    watch();
    delete nativeWindow.__OCTOP_PAGE_LEAVING__;
    watch("https://other.example.com");
    expect(nativeWindow._wails!.invoke).not.toHaveBeenCalled();
  });

  it("stops observing when the page has timed out", async () => {
    watch();
    await vi.advanceTimersByTimeAsync(45000);
    document.getElementById("root")!.append(document.createElement("main"));
    await Promise.resolve();
    expect(nativeWindow._wails!.invoke).not.toHaveBeenCalled();
  });
});
