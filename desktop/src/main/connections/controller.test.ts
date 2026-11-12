import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { ConnectionController, type ConnectionHooks, type PreparedConnection } from "./controller";
import { ServerStore } from "./server-store";

const A = "https://a.example";
const B = "https://b.example";
function candidate(): PreparedConnection {
  return { activate() {}, dispose() {} };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function fixture(t: TestContext, override: Partial<ConnectionHooks> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hivework-connect-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const path = join(dir, "desktop-servers.json");
  const store = new ServerStore(path);
  store.save("", { name: "A", url: A });
  store.save("", { name: "B", url: B });
  const calls: string[] = [];
  let localRunning = false;
  const hooks: ConnectionHooks = {
    startLocal: async () => { calls.push("spawn-owned"); localRunning = true; return "octop://app"; },
    stopLocal: async () => { calls.push("stop-owned"); localRunning = false; },
    isLocalRunning: () => localRunning,
    checkRemote: async (url) => { calls.push(`health:${url}`); },
    prepare: async (target) => {
      calls.push(`prepare:${target.mode}:${target.url}`);
      return candidate();
    },
    changed: () => {},
    ...override,
  };
  return { controller: new ConnectionController(store, hooks, "zh"), store, path, calls, hooks };
}

test("unselected launch waits; env and saved remote never prepare/spawn local runtime", async (t) => {
  const { controller, store, calls } = fixture(t);
  await controller.startup(undefined);
  assert.equal(controller.state().connectionPhase, "choose");
  assert.equal(calls.length, 0);
  await controller.startup(A);
  assert.deepEqual(controller.current(), { name: "A", url: A });
  assert.equal(store.get().activeUrl, null);
  assert.ok(!calls.includes("spawn-owned"));
  calls.length = 0;
  store.remember(B);
  await controller.startup(A);
  assert.deepEqual(controller.current(), { name: "B", url: B });
  assert.ok(!calls.includes(`health:${A}`));
  assert.ok(!calls.includes("spawn-owned"));
});

test("explicit local overrides the env and only successful page load persists a default", async (t) => {
  const page = deferred<void>();
  const { controller, store, calls } = fixture(t, { prepare: () => page.promise.then(candidate) });
  store.remember("");
  const launch = controller.startup(A);
  await setImmediate();
  assert.equal(controller.state().connectionPhase, "loading");
  assert.ok(calls.includes("spawn-owned"));
  assert.ok(!calls.includes(`health:${A}`));
  page.resolve();
  await launch;
  assert.equal(store.get().activeUrl, "");
});

test("health or page failure preserves the old default and never falls back locally", async (t) => {
  const { controller, store, calls, hooks } = fixture(t);
  store.remember(A);
  hooks.checkRemote = async () => { throw new Error("TLS/network failed"); };
  await assert.rejects(controller.connect(B), /TLS/);
  assert.equal(store.get().activeUrl, A);
  assert.equal(controller.state().connectionPhase, "failed");
  assert.ok(!calls.includes("spawn-owned"));
  hooks.checkRemote = async () => {};
  hooks.prepare = async () => { throw new Error("page timeout"); };
  await assert.rejects(controller.retry(), /page timeout/);
  assert.equal(store.get().activeUrl, A);
});

test("temporary local keeps the remote default across reopen, retry and back-switch", async (t) => {
  const { controller, store, path, calls } = fixture(t);
  store.remember(A);
  await controller.startup(B);
  await controller.temporaryLocal();
  assert.equal(controller.current()!.url, "octop://app");
  assert.equal(new ServerStore(path).get().activeUrl, A);
  await controller.retry();
  assert.equal(store.get().activeUrl, A);
  await controller.connect(B);
  assert.equal(store.get().activeUrl, B);
  assert.equal(controller.current()!.url, B);
  assert.equal(calls.filter((call) => call === "spawn-owned").length, 1);
});

test("late health from cancelled selection cannot load or persist over its successor", async (t) => {
  const slow = deferred<void>();
  const { controller, store, hooks, calls } = fixture(t, {
    checkRemote: (url) => url === A ? slow.promise : Promise.resolve(),
  });
  const first = controller.connect(A);
  const rejected = assert.rejects(first, /取消/);
  await setImmediate();
  await controller.connect(B);
  slow.resolve();
  await rejected;
  await setImmediate();
  assert.equal(store.get().activeUrl, B);
  assert.equal(controller.current()!.url, B);
  assert.ok(!calls.includes(`prepare:remote:${A}`));
  hooks.changed = () => {};
});

test("late login/page-ready cannot replace current state or commit the old default", async (t) => {
  const page = deferred<void>();
  const { controller, store } = fixture(t, {
    prepare: (target) => target.url === A ? page.promise.then(candidate) : Promise.resolve(candidate()),
  });
  const first = controller.connect(A);
  const rejected = assert.rejects(first, /取消/);
  await setImmediate();
  assert.equal(controller.state().connectionPhase, "loading");
  await controller.connect(B);
  page.resolve();
  await rejected;
  await setImmediate();
  assert.equal(controller.state().connectionPhase, "connected");
  assert.equal(controller.current()!.url, B);
  assert.equal(store.get().activeUrl, B);
});

test("cancelled startup cannot report its error into a newer user connection", async (t) => {
  const health = deferred<void>();
  const { controller, store } = fixture(t, {
    checkRemote: (url) => url === A ? health.promise : Promise.resolve(),
  });
  const startup = controller.startup(A);
  await setImmediate();
  await controller.connect(B);
  await startup;
  health.reject(new Error("late failed probe"));
  await setImmediate();
  assert.equal(controller.state().connectionPhase, "connected");
  assert.equal(store.get().activeUrl, B);
});

test("cancelled local prepare is serialized before the new owned-process cleanup", async (t) => {
  const prepared = deferred<string>();
  const trace: string[] = [];
  const { controller, store } = fixture(t, {
    startLocal: async () => { trace.push("preparing"); return prepared.promise; },
    stopLocal: async () => { trace.push("stop-owned-only"); },
    checkRemote: async () => { trace.push("remote-health"); },
  });
  const local = controller.connect("");
  const rejected = assert.rejects(local, /取消/);
  await setImmediate();
  const remote = controller.connect(B);
  await setImmediate();
  assert.deepEqual(trace, ["stop-owned-only", "preparing"]);
  prepared.resolve("octop://app");
  await remote;
  await rejected;
  assert.deepEqual(trace, ["stop-owned-only", "preparing", "stop-owned-only", "remote-health", "stop-owned-only"]);
  assert.equal(store.get().activeUrl, B);
});

test("bad legacy file blocks startup and mutations without overwriting any bytes", async (t) => {
  const { path, hooks, calls } = fixture(t);
  writeFileSync(path, "{broken");
  const controller = new ConnectionController(new ServerStore(path), hooks, "zh");
  await controller.startup(A);
  assert.equal(controller.state().connectionPhase, "failed");
  assert.deepEqual(calls, []);
  assert.throws(() => controller.connect(B), /desktop-servers/);
  assert.throws(() => controller.temporaryLocal(), /desktop-servers/);
  assert.throws(() => controller.save("", { name: "B", url: B }));
  assert.equal(readFileSync(path, "utf8"), "{broken");
});

test("unknown profiles are refused before stopping anything; renames update current display", async (t) => {
  const { controller, calls } = fixture(t);
  assert.throws(() => controller.connect("https://unknown.example"));
  assert.deepEqual(calls, []);
  await controller.connect(A);
  controller.save(A, { name: "New name", url: A });
  assert.deepEqual(controller.current(), { name: "New name", url: A });
});

test("failed remote health or hidden-page preparation leaves the current local sidecar running", async (t) => {
  const { controller, store, hooks, calls } = fixture(t);
  await controller.connect("");
  calls.length = 0;
  hooks.checkRemote = async () => { throw new Error("health failed"); };
  await assert.rejects(controller.connect(B), /health failed/);
  assert.deepEqual(calls, []);
  assert.equal(controller.current()!.url, "octop://app");
  assert.equal(store.get().activeUrl, "");
  hooks.checkRemote = async () => {};
  hooks.prepare = async () => { throw new Error("hidden-page failed"); };
  await assert.rejects(controller.connect(B), /hidden-page failed/);
  assert.deepEqual(calls, []);
  assert.equal(controller.current()!.url, "octop://app");
  assert.equal(store.get().activeUrl, "");
});

test("atomic remember failure disposes the candidate without activating or stopping the old local", async (t) => {
  const { controller, store, path, hooks, calls } = fixture(t);
  await controller.connect("");
  calls.length = 0;
  const before = readFileSync(path, "utf8");
  const trace: string[] = [];
  hooks.prepare = async () => ({
    activate: () => trace.push("destroy-old-and-show-new"),
    dispose: () => trace.push("dispose-hidden"),
  });
  store.remember = () => { throw new Error("atomic rename failed"); };
  await assert.rejects(controller.connect(B), /atomic rename failed/);
  assert.deepEqual(trace, ["dispose-hidden"]);
  assert.deepEqual(calls, [`health:${B}`]);
  assert.equal(controller.current()!.url, "octop://app");
  assert.equal(store.get().activeUrl, "");
  assert.equal(readFileSync(path, "utf8"), before);
});

test("remote commits save then activate before stopping captured owned resources; the next local waits", async (t) => {
  const { controller, store, hooks } = fixture(t);
  await controller.connect("");
  const trace: string[] = [];
  const cleanup = deferred<void>();
  let stopCount = 0;
  const remember = store.remember.bind(store);
  store.remember = (url) => { trace.push(`remember:${url}`); remember(url); };
  hooks.prepare = async () => ({
    activate: () => trace.push("activate"),
    dispose: () => trace.push("dispose"),
  });
  hooks.stopLocal = async () => {
    trace.push(`stop-captured:${++stopCount}`);
    if (stopCount === 1) await cleanup.promise;
    trace.push(`stopped:${stopCount}`);
  };
  hooks.startLocal = async () => { trace.push("spawn-next-local"); return "octop://app"; };
  const remote = controller.connect(B);
  await setImmediate();
  assert.deepEqual(trace, [`remember:${B}`, "activate", "stop-captured:1"]);
  const local = controller.connect("");
  await setImmediate();
  assert.ok(!trace.includes("spawn-next-local"));
  cleanup.resolve();
  await remote;
  await local;
  assert.ok(trace.indexOf("stopped:1") < trace.indexOf("spawn-next-local"));
  assert.equal(controller.current()!.url, "octop://app");
  assert.equal(store.get().activeUrl, "");
});

test("a prepared but superseded candidate is disposed without activation or default persistence", async (t) => {
  const late = deferred<PreparedConnection>();
  const trace: string[] = [];
  const { controller, store } = fixture(t, {
    prepare: (target) => target.url === A ? late.promise : Promise.resolve(candidate()),
  });
  const old = controller.connect(A);
  const rejected = assert.rejects(old, /取消/);
  await setImmediate();
  await controller.connect(B);
  late.resolve({
    activate: () => trace.push("activate-old"),
    dispose: () => trace.push("dispose-old"),
  });
  await rejected;
  await setImmediate();
  assert.deepEqual(trace, ["dispose-old"]);
  assert.equal(controller.current()!.url, B);
  assert.equal(store.get().activeUrl, B);
});

test("failed local page or default persistence releases its newly started backend", async (t) => {
  for (const failure of ["page", "save"]) {
    await t.test(failure, async (t) => {
      let running = false;
      const { controller, store, hooks } = fixture(t, {
        startLocal: async () => { running = true; return "octop://app"; },
        stopLocal: async () => { running = false; },
      });
      await controller.connect(A);
      if (failure === "page") hooks.prepare = async () => { throw new Error("page failed"); };
      else store.remember = () => { throw new Error("save failed"); };
      await assert.rejects(controller.connect(""), /failed/);
      assert.equal(running, false, "an uncommitted local candidate must not retain a backend");
      assert.equal(controller.current()!.url, A);
      assert.equal(store.get().activeUrl, A);
    });
  }
});

test("cancelled local page cleanup completes before a failing remote probe", async (t) => {
  let running = false;
  const localPage = deferred<PreparedConnection>();
  const { controller, hooks } = fixture(t, {
    startLocal: async () => { running = true; return "octop://app"; },
    stopLocal: async () => { running = false; },
    prepare: (target) => target.mode === "local" ? localPage.promise : Promise.resolve(candidate()),
  });
  await controller.connect(A);
  const local = controller.connect("");
  const rejected = assert.rejects(local, /取消/);
  await setImmediate();
  assert.equal(running, true);
  hooks.checkRemote = async () => {
    assert.equal(running, false, "a superseded local attempt must finish its cleanup first");
    throw new Error("remote unavailable");
  };
  await assert.rejects(controller.connect(B), /remote unavailable/);
  await rejected;
  assert.equal(running, false);
  assert.equal(controller.current()!.url, A);
  localPage.resolve(candidate());
  await setImmediate();
});

test("a late cancelled local start is cleaned before its local successor can spawn", async (t) => {
  const firstStart = deferred<string>();
  const cleanup = deferred<void>();
  let starts = 0;
  let stops = 0;
  const { controller } = fixture(t, {
    startLocal: async () => ++starts === 1 ? firstStart.promise : "octop://app",
    stopLocal: async () => { if (++stops === 2) await cleanup.promise; },
  });
  const first = controller.connect("");
  const rejected = assert.rejects(first, /取消/);
  await setImmediate();
  const next = controller.connect("");
  firstStart.resolve("octop://app");
  await setImmediate();
  assert.equal(stops, 2);
  assert.equal(starts, 1, "the next spawn must wait for the cancelled process to stop");
  cleanup.resolve();
  await rejected;
  await next;
  assert.equal(starts, 2);
  assert.equal(controller.current()!.url, "octop://app");
});

test("remembering an active temporary local connection preserves its running backend", async (t) => {
  const { controller, store, calls, hooks } = fixture(t);
  await controller.connect(A);
  await controller.temporaryLocal();
  assert.equal(store.get().activeUrl, A);
  calls.length = 0;
  await controller.connect("");
  assert.equal(store.get().activeUrl, "");
  assert.equal(controller.current()!.url, "octop://app");
  assert.equal(hooks.isLocalRunning(), true);
  assert.deepEqual(calls, ["prepare:local:octop://app"]);
});

test("a failed local reselection leaves the existing local backend usable", async (t) => {
  for (const failure of ["page", "save"]) {
    await t.test(failure, async (t) => {
      const { controller, store, calls, hooks } = fixture(t);
      await controller.connect(A);
      await controller.temporaryLocal();
      calls.length = 0;
      if (failure === "page") hooks.prepare = async () => { throw new Error("page failed"); };
      else store.remember = () => { throw new Error("save failed"); };
      await assert.rejects(controller.connect(""), /failed/);
      assert.equal(hooks.isLocalRunning(), true);
      assert.equal(controller.current()!.url, "octop://app");
      assert.equal(store.get().activeUrl, A);
      assert.ok(!calls.includes("stop-owned"));
      assert.ok(!calls.includes("spawn-owned"));
    });
  }
});

test("retrying a crashed local backend still spawns a replacement", async (t) => {
  const { controller, calls, hooks } = fixture(t);
  await controller.connect("");
  hooks.isLocalRunning = () => false;
  calls.length = 0;
  await controller.retry();
  assert.deepEqual(calls, ["stop-owned", "spawn-owned", "prepare:local:octop://app"]);
});

test("cancelling a reused local page never stops the current local backend", async (t) => {
  const { controller, hooks, calls } = fixture(t);
  await controller.connect("");
  const page = deferred<PreparedConnection>();
  hooks.prepare = () => page.promise;
  hooks.checkRemote = async () => { throw new Error("remote unavailable"); };
  calls.length = 0;
  const local = controller.connect("");
  const cancelled = assert.rejects(local, /取消/);
  await setImmediate();
  await assert.rejects(controller.connect(B), /remote unavailable/);
  await cancelled;
  assert.equal(hooks.isLocalRunning(), true);
  assert.equal(controller.current()!.url, "octop://app");
  assert.deepEqual(calls, []);
  let disposed = false;
  page.resolve({
    activate: () => assert.fail("a cancelled page cannot activate"),
    dispose: () => { disposed = true; },
  });
  await setImmediate();
  assert.equal(disposed, true);
});
