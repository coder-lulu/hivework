import type { ServerManagerState, ServerProfile } from "../../shared/server-connections";
import { normalizeServerUrl, ServerStore, startupSelection } from "./server-store";

export interface ConnectionTarget extends ServerProfile {
  mode: "local" | "remote";
}

export interface PreparedConnection {
  /** Synchronous: called only after the generation check and atomic save. */
  activate(): void;
  /** Discard a hidden candidate; never disposes the active connection. */
  dispose(): void;
}

export interface ConnectionHooks {
  startLocal(signal: AbortSignal): Promise<string>;
  stopLocal(): Promise<void>;
  checkRemote(url: string, signal: AbortSignal): Promise<void>;
  prepare(target: ConnectionTarget, signal: AbortSignal): Promise<PreparedConnection>;
  changed(): void;
}

/** Abort races also discard hooks which finish late or do not honor cancellation. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new Error("连接已取消。"));
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}

export class ConnectionController {
  private readonly store: ServerStore;
  private readonly hooks: ConnectionHooks;
  private readonly locale: "zh" | "en";
  private generation = 0;
  private attempt: AbortController | null = null;
  private localWork: Promise<unknown> = Promise.resolve();
  private last: { url: string; remember: boolean } | null = null;
  private active: ConnectionTarget | null = null;
  private phase: ServerManagerState["connectionPhase"] = "choose";
  private error = "";
  private pendingUrl = "";

  constructor(store: ServerStore, hooks: ConnectionHooks, locale: "zh" | "en") {
    this.store = store;
    this.hooks = hooks;
    this.locale = locale;
  }

  state(): ServerManagerState {
    return {
      ...this.store.get(),
      currentUrl: this.phase === "loading" ? this.pendingUrl : this.active?.url ?? "",
      locale: this.locale,
      connectionPhase: this.phase,
      connectionError: this.error,
    };
  }

  current(): ServerProfile | null {
    if (!this.active) return null;
    const saved = this.store.get().servers.find((item) => item.url === this.active?.url);
    return { name: saved?.name ?? this.active.name, url: this.active.url };
  }

  save(previous: unknown, value: unknown): ServerManagerState {
    this.store.save(previous, value);
    this.hooks.changed();
    return this.state();
  }

  remove(value: unknown): ServerManagerState {
    this.store.remove(value);
    this.hooks.changed();
    return this.state();
  }

  async startup(environment: string | undefined): Promise<void> {
    let url: string | null;
    try {
      this.store.assertWritable();
      url = startupSelection(this.store.get(), environment);
    } catch (cause) {
      this.failed(cause);
      return;
    }
    // run() alone owns state transitions; a superseded startup must not turn
    // the next user-selected connection into a failure.
    if (url !== null) await this.run(url, false).catch(() => undefined);
  }

  connect(value: unknown): Promise<ServerManagerState> {
    this.store.assertWritable();
    const url = value === "" ? "" : normalizeServerUrl(value);
    if (url && !this.store.get().servers.some((item) => item.url === url)) {
      throw new Error("该服务器已不在保存的列表中。");
    }
    return this.run(url, true);
  }

  retry(): Promise<ServerManagerState> {
    this.store.assertWritable();
    if (!this.last) return Promise.resolve(this.state());
    return this.run(this.last.url, this.last.remember);
  }

  temporaryLocal(): Promise<ServerManagerState> {
    this.store.assertWritable();
    return this.run("", false);
  }

  cancel(): void {
    this.generation += 1;
    this.attempt?.abort(new Error("连接已取消。"));
  }

  private failed(cause: unknown): void {
    this.phase = "failed";
    this.error = cause instanceof Error ? cause.message : String(cause);
    this.hooks.changed();
  }

  private async run(url: string, remember: boolean): Promise<ServerManagerState> {
    this.cancel();
    const generation = this.generation;
    const attempt = new AbortController();
    this.attempt = attempt;
    const signal = attempt.signal;
    const current = () => {
      signal.throwIfAborted();
      if (generation !== this.generation) throw new Error("连接已取消。");
    };
    this.last = { url, remember };
    this.phase = "connecting";
    this.error = "";
    this.hooks.changed();
    let prepared: PreparedConnection | null = null;
    let committed = false;
    try {
      let origin: string;
      if (url) {
        // Keep an existing local connection usable while probing/loading a
        // remote candidate. Only a committed switch may stop its owned sidecar.
        await abortable(this.localWork.catch(() => undefined), signal);
        current();
        await abortable(this.hooks.checkRemote(url, signal), signal);
        origin = url;
      } else {
        // A new local spawn cannot race a superseded prepare or post-commit
        // cleanup. stopLocal captures only the resources it currently owns.
        const previous = this.localWork;
        const preparation = (async () => {
          await previous.catch(() => undefined);
          current();
          await this.hooks.stopLocal();
          current();
          const localOrigin = await this.hooks.startLocal(signal);
          current();
          return localOrigin;
        })();
        this.localWork = preparation;
        origin = await abortable(preparation, signal);
      }
      current();
      const saved = this.store.get().servers.find((item) => item.url === url);
      const target: ConnectionTarget = {
        mode: url ? "remote" : "local",
        url: origin,
        name: url ? saved?.name ?? new URL(url).host : this.locale === "zh" ? "本地服务" : "Local service",
      };
      this.pendingUrl = origin;
      this.phase = "loading";
      this.hooks.changed();
      const candidate = this.hooks.prepare(target, signal).then((window) => {
        // Also dispose a late result from a hook which ignores AbortSignal.
        prepared = window;
        if (signal.aborted) window.dispose();
        current();
        return window;
      });
      const window = await abortable(candidate, signal);
      current();
      // No await between generation validation, atomic persistence and UI commit.
      if (remember) this.store.remember(url);
      window.activate();
      committed = true;
      this.active = target;
      this.phase = "connected";
      if (url) {
        // Capture the old owned resources now, before any later local start.
        // The next local preparation waits for this cleanup promise.
        this.localWork = this.hooks.stopLocal();
      }
      this.hooks.changed();
      if (url) await this.localWork;
      return this.state();
    } catch (cause) {
      if (generation === this.generation && !signal.aborted) this.failed(cause);
      throw cause;
    } finally {
      if (!committed) (prepared as PreparedConnection | null)?.dispose();
    }
  }
}
