import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { test, type TestContext } from "node:test";
import { buildSync } from "esbuild";
import { CONNECTION_IPC, type ServerManagerState } from "../../shared/server-connections";
import { IPC_CHANNELS } from "../../shared/ipc-contract";
import { EARLY_IPC } from "../../shared/early-ipc";

const require = createRequire(import.meta.url);
const source = fileURLToPath(new URL("../index.ts", import.meta.url));
const bundle = buildSync({
  entryPoints: [source],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  write: false,
  external: ["electron", "adm-zip"],
  logLevel: "silent",
  define: { "process.env.OCTOP_ALLOW_OFFICIAL_SELF_UPDATE": '"false"' },
}).outputFiles![0]!.text;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Run the real bundled main entry against Electron's window/IPC boundary. */
function fixture(t: TestContext, options: {
  active?: string | null;
  probe?: (url: string) => Promise<Response>;
  page?: (url: string) => Promise<void>;
  managerPage?: Promise<void>;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "hivework-electron-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profiles = join(root, "desktop-servers.json");
  writeFileSync(profiles, JSON.stringify({
    servers: [{ name: "A", url: "https://a.example" }, { name: "B", url: "https://b.example" }],
    activeUrl: options.active ?? null,
  }));
  let sequence = 0;
  let spawned = 0;
  let keychain = 0;
  let registeredProtocol = 0;
  let relaunched = 0;
  let rejectWrites = false;
  const probes: string[] = [];
  const windows: Window[] = [];
  class Contents extends EventEmitter {
    id = ++sequence;
    url = "";
    mainFrame = { url: "", parent: null };
    sent: { channel: string; payload: unknown[] }[] = [];
    getURL() { return this.url; }
    isDestroyed() { return windows.find((win) => win.webContents === this)?.destroyed ?? false; }
    send(channel: string, ...payload: unknown[]) { this.sent.push({ channel, payload }); }
    setWindowOpenHandler() {}
  }
  class Window extends EventEmitter {
    static getAllWindows() { return windows.filter((win) => !win.destroyed); }
    static fromWebContents(contents: Contents) { return windows.find((win) => win.webContents === contents); }
    readonly options: Record<string, unknown>;
    webContents = new Contents();
    destroyed = false;
    shown = false;
    constructor(settings: Record<string, unknown>) {
      super();
      this.options = settings;
      windows.push(this);
    }
    async loadFile(path: string) {
      this.webContents.url = pathToFileURL(path).href;
      this.webContents.mainFrame.url = this.webContents.url;
      if (path.endsWith("server-manager.html")) await options.managerPage;
      this.emit("ready-to-show");
    }
    async loadURL(url: string) {
      this.webContents.url = url;
      this.webContents.mainFrame.url = url;
      await options.page?.(url);
      if (!this.destroyed) {
        this.webContents.emit("did-finish-load");
        this.emit("ready-to-show");
      }
    }
    isDestroyed() { return this.destroyed; }
    show() { this.shown = true; }
    hide() { this.shown = false; }
    focus() {}
    destroy() { this.destroyed = true; this.emit("closed"); }
    setAutoHideMenuBar() {}
    setMenuBarVisibility() {}
  }
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const events = new EventEmitter();
  const appEvents = new EventEmitter();
  let boot!: Promise<unknown>;
  const app = {
    isPackaged: true,
    whenReady: () => ({
      then(callback: () => unknown) {
        boot = Promise.resolve().then(callback);
        return boot;
      },
    }),
    on: appEvents.on.bind(appEvents),
    getVersion: () => "1.0.3b5",
    getLocale: () => "zh-CN",
    getPath: (key: string) => join(root, key),
    requestSingleInstanceLock: () => true,
    setAppUserModelId() {},
    relaunch() { relaunched += 1; },
    async getFileIcon() { return { isEmpty: () => true }; },
    quit() {},
    exit() {},
  };
  const electron = {
    app,
    BrowserWindow: Window,
    ipcMain: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
      on: events.on.bind(events),
    },
    nativeTheme: { shouldUseDarkColors: false, themeSource: "system" },
    Menu: { buildFromTemplate: () => [], setApplicationMenu() {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    protocol: {
      registerSchemesAsPrivileged() {},
      handle() { registeredProtocol += 1; },
    },
    safeStorage: {
      async isAsyncEncryptionAvailable() { keychain += 1; return false; },
    },
  };
  const processMock = {
    env: { ...process.env, OCTOP_HOME: root, OCTOP_DESKTOP_URL: "", OCTOP_PORTABLE_DIR: "" },
    platform: "win32",
    arch: "x64",
    execPath: process.execPath,
    resourcesPath: join(root, "resources"),
    versions: process.versions,
    on() {},
  };
  runInNewContext(bundle, {
    require: (id: string) => {
      if (id === "electron") return electron;
      if (id === "node:fs") return {
        ...require(id),
        renameSync: (from: string, to: string) => {
          if (rejectWrites) throw new Error("atomic profile rename failed");
          require(id).renameSync(from, to);
        },
      };
      if (id === "node:child_process") return {
        ...require(id),
        execFileSync: () => "",
        spawn: () => { spawned += 1; throw new Error("unexpected local process"); },
      };
      return require(id);
    },
    __dirname: dirname(source),
    __filename: source,
    module: { exports: {} },
    exports: {},
    process: processMock,
    console,
    Buffer,
    URL,
    Response,
    Headers,
    AbortSignal,
    AbortController,
    structuredClone,
    setTimeout,
    clearTimeout,
    fetch: async (input: string) => {
      probes.push(input);
      return options.probe ? options.probe(input) : new Response('{"ok":true}');
    },
  });
  const manager = () => windows.find((win) => String((win.options.webPreferences as Record<string, unknown>).preload).endsWith("server-manager.js"))!;
  const invoke = (window: Window, name: string, ...args: unknown[]) => Promise.resolve().then(() => {
    const handler = handlers.get(name);
    assert.ok(handler, `IPC ${name} is registered`);
    return handler({
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    }, ...args);
  });
  t.after(() => {
    appEvents.emit("before-quit", { preventDefault() {} });
    for (const window of windows) if (!window.destroyed) window.destroy();
  });
  return {
    boot: () => boot,
    root,
    profiles,
    probes,
    windows,
    manager,
    invoke,
    handlers,
    send: (window: Window, channel: string) => events.emit(channel, {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    }),
    relaunched: () => relaunched,
    failWrites: () => { rejectWrites = true; },
    counters: () => ({ spawned, keychain, registeredProtocol }),
  };
}

test("real Electron startup wiring restores a saved remote with no local runtime/token/relay", async (t) => {
  const f = fixture(t, { active: "https://a.example" });
  await f.boot();
  const remote = f.windows.find((win) => win.webContents.getURL() === "https://a.example/")!;
  assert.ok(remote);
  assert.equal(f.manager().shown, false);
  assert.equal(remote.options.frame, true);
  const preferences = remote.options.webPreferences as Record<string, unknown>;
  assert.ok(String(preferences.preload).endsWith("remote.js"));
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
  assert.deepEqual(f.counters(), { spawned: 0, keychain: 0, registeredProtocol: 0 });
  assert.deepEqual(f.probes, ["https://a.example/api/health"]);
  assert.ok(!readdirSync(f.root).includes("portable"));
  const current = await f.invoke(remote, CONNECTION_IPC.current) as { name: string; url: string };
  assert.equal(current.name, "A");
  assert.equal(current.url, "https://a.example");
  await f.invoke(remote, CONNECTION_IPC.openManager);
  assert.equal(f.manager().shown, true);
  for (const channel of [
    IPC_CHANNELS.sessionRegister, IPC_CHANNELS.sessionRenew, IPC_CHANNELS.sessionRevoke,
    IPC_CHANNELS.clientSettingsSet, IPC_CHANNELS.installUpdate, IPC_CHANNELS.getPlatformInfo,
  ]) await assert.rejects(f.invoke(remote, channel, "secret"), /本地/);
  await assert.rejects(f.invoke(remote, CONNECTION_IPC.manager, "GetServerConnections"), /本地服务器/);
  await assert.rejects(f.invoke(remote, CONNECTION_IPC.manager, "SaveServer", "", { url: "https://evil.example" }));
  f.send(remote, EARLY_IPC.restart);
  f.send(f.manager(), EARLY_IPC.restart);
  assert.equal(f.relaunched(), 0);
  await f.invoke(f.manager(), CONNECTION_IPC.manager, "SaveServer", "", { name: "C", url: "https://c.example" });
  const state = await f.invoke(f.manager(), CONNECTION_IPC.manager, "GetServerConnections") as ServerManagerState;
  assert.equal(state.servers.length, 3);
  remote.emit("enter-full-screen");
  remote.emit("leave-full-screen");
  assert.ok(remote.webContents.sent.every((message) => message.payload.length === 0));
});

test("initial manager readiness precedes fast remote startup and cannot cover the dashboard later", async (t) => {
  const ready = deferred<void>();
  const f = fixture(t, { active: "https://a.example", managerPage: ready.promise });
  await setImmediate();
  assert.deepEqual(f.probes, []);
  ready.resolve();
  await f.boot();
  assert.deepEqual(f.probes, ["https://a.example/api/health"]);
  assert.equal(f.manager().shown, false);
});

test("real boot failure preserves the saved remote and shows recovery without starting local", async (t) => {
  const f = fixture(t, {
    active: "https://a.example",
    probe: async () => { throw new Error("certificate verify failed"); },
  });
  const before = readFileSync(f.profiles, "utf8");
  await f.boot();
  const state = await f.invoke(f.manager(), CONNECTION_IPC.manager, "GetServerConnections") as ServerManagerState;
  assert.equal(state.connectionPhase, "failed");
  assert.match(state.connectionError, /certificate/);
  assert.equal(f.manager().shown, true);
  assert.equal(readFileSync(f.profiles, "utf8"), before);
  assert.equal(f.windows.filter((win) => win.webContents.url.startsWith("https:")).length, 0);
  assert.deepEqual(f.counters(), { spawned: 0, keychain: 0, registeredProtocol: 0 });
});

test("actual manager switch destroys/revokes the old remote and rejects foreign main frames", async (t) => {
  const f = fixture(t, { active: "https://a.example" });
  await f.boot();
  const old = f.windows.find((win) => win.webContents.getURL() === "https://a.example/")!;
  await f.invoke(f.manager(), CONNECTION_IPC.manager, "ConnectServer", "https://b.example");
  assert.equal(old.destroyed, true);
  await assert.rejects(f.invoke(old, CONNECTION_IPC.current));
  const remote = f.windows.find((win) => win.webContents.getURL() === "https://b.example/")!;
  assert.equal((await f.invoke(remote, CONNECTION_IPC.current) as { url: string }).url, "https://b.example");
  let redirectsBlocked = 0;
  remote.webContents.emit("will-redirect", { preventDefault() { redirectsBlocked += 1; } }, "https://evil.example");
  assert.equal(redirectsBlocked, 1);
  remote.webContents.url = "https://evil.example";
  remote.webContents.mainFrame.url = "https://evil.example";
  await assert.rejects(f.invoke(remote, CONNECTION_IPC.current));
  await assert.rejects(f.invoke(remote, CONNECTION_IPC.openManager));
  const handler = f.handlers.get(CONNECTION_IPC.manager)!;
  assert.throws(() => handler({
    sender: f.manager().webContents,
    senderFrame: { url: f.manager().webContents.getURL(), parent: f.manager().webContents.mainFrame },
  }, "DeleteServer", "https://a.example"), /本地服务器/);
  assert.equal(JSON.parse(readFileSync(f.profiles, "utf8")).activeUrl, "https://b.example");
});

test("actual cancelled late page load cannot show a stale window or overwrite a newer default", async (t) => {
  const page = deferred<void>();
  const f = fixture(t, {
    page: (url) => url === "https://a.example/" ? page.promise : Promise.resolve(),
  });
  await f.boot();
  const pending = f.invoke(f.manager(), CONNECTION_IPC.manager, "ConnectServer", "https://a.example");
  const rejected = assert.rejects(pending, /取消/);
  await setImmediate();
  await setImmediate();
  const old = f.windows.find((win) => win.webContents.getURL() === "https://a.example/")!;
  assert.ok(old);
  await f.invoke(f.manager(), CONNECTION_IPC.manager, "ConnectServer", "https://b.example");
  page.resolve();
  await rejected;
  await setImmediate();
  assert.equal(old.destroyed, true);
  assert.equal(old.shown, false);
  assert.equal(JSON.parse(readFileSync(f.profiles, "utf8")).activeUrl, "https://b.example");
  assert.deepEqual(f.counters(), { spawned: 0, keychain: 0, registeredProtocol: 0 });
});

test("actual hidden-window preparation failure leaves the previous dashboard intact", async (t) => {
  const f = fixture(t, {
    active: "https://a.example",
    page: async (url) => {
      if (url === "https://b.example/") throw new Error("new remote page failed");
    },
  });
  await f.boot();
  const old = f.windows.find((win) => win.webContents.url === "https://a.example/")!;
  const before = readFileSync(f.profiles, "utf8");
  await assert.rejects(
    f.invoke(f.manager(), CONNECTION_IPC.manager, "ConnectServer", "https://b.example"),
    /new remote page failed/,
  );
  const rejected = f.windows.find((win) => win.webContents.url === "https://b.example/")!;
  assert.equal(old.destroyed, false);
  assert.equal(old.shown, true);
  assert.equal(rejected.destroyed, true);
  assert.equal(rejected.shown, false);
  assert.equal(readFileSync(f.profiles, "utf8"), before);
  assert.equal((await f.invoke(old, CONNECTION_IPC.current) as { url: string }).url, "https://a.example");
});

test("actual atomic save failure disposes hidden candidate and never destroys/shows over old dashboard", async (t) => {
  const f = fixture(t, { active: "https://a.example" });
  await f.boot();
  const old = f.windows.find((win) => win.webContents.url === "https://a.example/")!;
  const before = readFileSync(f.profiles, "utf8");
  f.failWrites();
  await assert.rejects(
    f.invoke(f.manager(), CONNECTION_IPC.manager, "ConnectServer", "https://b.example"),
    /atomic profile rename failed/,
  );
  const rejected = f.windows.find((win) => win.webContents.url === "https://b.example/")!;
  assert.equal(old.destroyed, false);
  assert.equal(old.shown, true);
  assert.equal(rejected.destroyed, true);
  assert.equal(rejected.shown, false);
  assert.equal(f.manager().shown, true);
  assert.equal(readFileSync(f.profiles, "utf8"), before);
  const state = await f.invoke(f.manager(), CONNECTION_IPC.manager, "GetServerConnections") as ServerManagerState;
  assert.equal(state.activeUrl, "https://a.example");
  assert.equal(state.currentUrl, "https://a.example");
  assert.equal((await f.invoke(old, CONNECTION_IPC.current) as { url: string }).url, "https://a.example");
  await assert.rejects(f.invoke(rejected, CONNECTION_IPC.current));
});
