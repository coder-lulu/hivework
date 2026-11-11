import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  localDesktopBridge,
  remoteDesktopBridge,
  remoteServerConnections,
} from "../test/desktopBridge";
import { useDesktopChrome } from "./useDesktopChrome";

afterEach(() => {
  delete window.octopDesktop;
  delete window.hiveworkServerConnections;
  delete document.documentElement.dataset.octopDesktopChrome;
  document.documentElement.style.removeProperty(
    "--window-controls-inset-start",
  );
  document.documentElement.style.removeProperty("--window-controls-inset-end");
  vi.restoreAllMocks();
});

describe("desktop chrome capabilities", () => {
  it.each(["standalone", "legacy"])(
    "leaves %s remote pages in their native frame without custom insets",
    (kind) => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows");
      if (kind === "standalone") {
        window.hiveworkServerConnections = remoteServerConnections();
      } else {
        window.octopDesktop = remoteDesktopBridge();
      }
      const { result } = renderHook(() => useDesktopChrome());

      expect(result.current).toBeNull();
      expect(document.documentElement).not.toHaveAttribute(
        "data-octop-desktop-chrome",
      );
      expect(
        document.documentElement.style.getPropertyValue(
          "--window-controls-inset-end",
        ),
      ).toBe("");
    },
  );

  it("retains native caption space for the local custom chrome", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows");
    window.octopDesktop = localDesktopBridge();
    const { result } = renderHook(() => useDesktopChrome());

    expect(result.current).toBe("windows");
    expect(document.documentElement).toHaveAttribute(
      "data-octop-desktop-chrome",
      "windows",
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--window-controls-inset-end",
      ),
    ).toBe("138px");
  });
});
