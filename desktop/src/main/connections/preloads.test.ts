import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind } from "typescript";
import { CONNECTION_IPC } from "../../shared/server-connections";

function load(name: string) {
  const exposed: Record<string, Record<string, unknown>> = {};
  const calls: unknown[][] = [];
  const events = new EventEmitter();
  const electron = {
    contextBridge: { exposeInMainWorld: (key: string, value: Record<string, unknown>) => { exposed[key] = value; } },
    ipcRenderer: {
      invoke: (...args: unknown[]) => { calls.push(args); return Promise.resolve(null); },
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
    },
  };
  const source = readFileSync(new URL(`../../preload/${name}.ts`, import.meta.url), "utf8");
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  runInNewContext(js, {
    exports: {},
    require: (id: string) => {
      assert.equal(id, "electron", "restricted sandbox preload must be self-contained");
      return electron;
    },
  });
  return { exposed, calls, events };
}

test("remote preload exposes exactly current/openManager/onChange and never the IPC event", async () => {
  const { exposed, calls, events } = load("remote");
  assert.deepEqual(Object.keys(exposed), ["hiveworkServerConnections"]);
  assert.equal(exposed.octopDesktop, undefined);
  const bridge = exposed.hiveworkServerConnections as {
    current(): Promise<unknown>;
    openManager(): Promise<void>;
    onChange(cb: (...args: unknown[]) => void): () => void;
  };
  assert.deepEqual(Object.keys(bridge).sort(), ["current", "onChange", "openManager"]);
  await bridge.current();
  await bridge.openManager();
  assert.deepEqual(calls, [[CONNECTION_IPC.current], [CONNECTION_IPC.openManager]]);
  const observed: unknown[][] = [];
  const unsubscribe = bridge.onChange((...args) => observed.push(args));
  events.emit(CONNECTION_IPC.changed, { sender: "must never escape" }, { profiles: ["private"] });
  assert.deepEqual(observed, [[]]);
  unsubscribe();
  events.emit(CONNECTION_IPC.changed);
  assert.equal(observed.length, 1);
});

test("manager preload uses only fixed management commands and strips event objects", async () => {
  const { exposed, calls, events } = load("server-manager");
  assert.deepEqual(Object.keys(exposed), ["octopServerManager"]);
  const bridge = exposed.octopServerManager as Record<string, (...args: unknown[]) => unknown>;
  await bridge.GetServerConnections!();
  await bridge.SaveServer!("", { name: "A", url: "https://a.example" });
  await bridge.DeleteServer!("https://a.example");
  await bridge.ConnectServer!("");
  await bridge.RetryServerConnection!();
  await bridge.ConnectLocalTemporarily!();
  assert.equal(calls.length, 6);
  assert.ok(calls.every((call) => call[0] === CONNECTION_IPC.manager));
  assert.deepEqual(calls.map((call) => call[1]), [
    "GetServerConnections", "SaveServer", "DeleteServer", "ConnectServer",
    "RetryServerConnection", "ConnectLocalTemporarily",
  ]);
  const observed: unknown[] = [];
  const off = bridge.onChange!((value: unknown) => observed.push(value)) as () => void;
  const state = { connectionPhase: "failed" };
  events.emit(CONNECTION_IPC.managerChanged, { sender: "private" }, state);
  assert.deepEqual(observed, [state]);
  off();
  assert.equal(events.listenerCount(CONNECTION_IPC.managerChanged), 0);
});
