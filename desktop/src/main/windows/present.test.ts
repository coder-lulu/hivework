import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isWindowOnScreen,
  presentWindows,
  shouldKeepWindowOnClose,
  type PresentableWindow,
} from "./present";

function fakeWindow(state: {
  destroyed?: boolean;
  minimized?: boolean;
  visible?: boolean;
}): PresentableWindow & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => state.destroyed === true,
    isMinimized: () => state.minimized === true,
    isVisible: () => state.visible ?? !state.minimized,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };
}

test("Dock click restores a minimized window before showing it", () => {
  const win = fakeWindow({ minimized: true });
  assert.equal(presentWindows([win]), 1);
  assert.deepEqual(win.calls, ["restore", "show", "focus"]);
});

test("Dock click shows a hidden window without un-maximizing it", () => {
  const win = fakeWindow({ minimized: false, visible: false });
  assert.equal(presentWindows([win]), 1);
  assert.deepEqual(win.calls, ["show", "focus"]);
});

test("a destroyed window is skipped", () => {
  const gone = fakeWindow({ destroyed: true });
  const live = fakeWindow({});
  assert.equal(presentWindows([gone, live]), 1);
  assert.deepEqual(gone.calls, []);
  assert.deepEqual(live.calls, ["show", "focus"]);
});

test("no windows means the caller should open one", () => {
  assert.equal(presentWindows([]), 0);
});

test("Dock activation leaves the hidden connection chooser hidden", () => {
  const dashboard = fakeWindow({ visible: true });
  const chooser = fakeWindow({ visible: false });
  assert.equal(presentWindows([dashboard, chooser], dashboard), 1);
  assert.deepEqual(dashboard.calls, ["show", "focus"]);
  assert.deepEqual(chooser.calls, []);
});

test("Dock activation restores the minimized dashboard instead of the hidden chooser", () => {
  const chooser = fakeWindow({ visible: false });
  const dashboard = fakeWindow({ minimized: true });
  assert.equal(presentWindows([chooser, dashboard], dashboard), 1);
  assert.deepEqual(dashboard.calls, ["restore", "show", "focus"]);
  assert.deepEqual(chooser.calls, []);
});

test("Dock activation restores a dashboard hidden by close-to-tray", () => {
  const chooser = fakeWindow({ visible: false });
  const dashboard = fakeWindow({ visible: false });
  assert.equal(presentWindows([chooser, dashboard], dashboard), 1);
  assert.deepEqual(dashboard.calls, ["show", "focus"]);
  assert.deepEqual(chooser.calls, []);
});

test("an explicitly opened connection chooser remains available", () => {
  const chooser = fakeWindow({ visible: true });
  const dashboard = fakeWindow({ visible: false });
  assert.equal(presentWindows([chooser, dashboard], dashboard), 1);
  assert.deepEqual(chooser.calls, ["show", "focus"]);
  assert.deepEqual(dashboard.calls, []);
});

test("activation during startup does not show a pending dashboard", () => {
  const chooser = fakeWindow({ visible: true });
  const pending = fakeWindow({ visible: false });
  assert.equal(presentWindows([pending, chooser]), 1);
  assert.deepEqual(chooser.calls, ["show", "focus"]);
  assert.deepEqual(pending.calls, []);
});

test("a destroyed preferred dashboard falls back to the remaining chooser", () => {
  const chooser = fakeWindow({ visible: false });
  const dashboard = fakeWindow({ destroyed: true });
  assert.equal(presentWindows([dashboard, chooser], dashboard), 1);
  assert.deepEqual(chooser.calls, ["show", "focus"]);
  assert.deepEqual(dashboard.calls, []);
});

test("macOS tray close hides the window until the next Dock click", () => {
  assert.equal(
    shouldKeepWindowOnClose({ platform: "darwin", closeBehavior: "tray", quitting: false }),
    true,
  );
});

test("Windows and Linux tray close hides the window when the tray icon can open it", () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(
      shouldKeepWindowOnClose({
        platform,
        closeBehavior: "tray",
        quitting: false,
        trayReady: true,
      }),
      true,
    );
    assert.equal(
      shouldKeepWindowOnClose({
        platform,
        closeBehavior: "tray",
        quitting: false,
        trayReady: false,
      }),
      false,
    );
  }
});

test("quit, and closing while the app is exiting, lets the window close", () => {
  assert.equal(
    shouldKeepWindowOnClose({ platform: "darwin", closeBehavior: "quit", quitting: false }),
    false,
  );
  assert.equal(
    shouldKeepWindowOnClose({ platform: "darwin", closeBehavior: "tray", quitting: true }),
    false,
  );
  assert.equal(
    shouldKeepWindowOnClose({ platform: "win32", closeBehavior: "tray", quitting: false }),
    false,
  );
  assert.equal(
    shouldKeepWindowOnClose({
      platform: "win32",
      closeBehavior: "quit",
      quitting: false,
      trayReady: true,
    }),
    false,
  );
  assert.equal(
    shouldKeepWindowOnClose({
      platform: "linux",
      closeBehavior: "quit",
      quitting: false,
      trayReady: true,
    }),
    false,
  );
});

test("a window on a disconnected display is not on screen", () => {
  const laptop = { x: 0, y: 0, width: 1440, height: 900 };
  assert.equal(isWindowOnScreen({ x: 100, y: 100, width: 1080, height: 720 }, [laptop]), true);
  assert.equal(isWindowOnScreen({ x: 2000, y: 100, width: 1080, height: 720 }, [laptop]), false);
  assert.equal(isWindowOnScreen({ x: 1400, y: 100, width: 1080, height: 720 }, [laptop]), false);
});
