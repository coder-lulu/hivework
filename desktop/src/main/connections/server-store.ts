import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerConfig, ServerProfile } from "../../shared/server-connections";

export function normalizeServerUrl(value: unknown): string {
  const invalid = () => new Error("请输入 HTTP/HTTPS 服务器根地址，不包含路径、账号、查询参数或片段。");
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\\]/.test(value)) throw invalid();
  let raw = value.trim();
  if (!raw || /\s/.test(raw)) throw invalid();
  if (!raw.includes("://")) {
    const host = (raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.split(":")[0]!).toLowerCase();
    const loopback = host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
    raw = `${loopback ? "http" : "https"}://${raw}`;
  }
  // URL() normalizes "/.." and "/%2e" to "/"; reject them before parsing.
  if (!/^https?:\/\/[^/?#@]+\/?$/i.test(raw)) throw invalid();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    url.port === "0" ||
    raw.replace(/\/$/, "").endsWith(":")
  ) throw invalid();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(hostname) && hostname.replace(/\.$/, "").split(".").some(
    (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  )) throw invalid();
  return url.origin;
}

function profile(value: unknown): ServerProfile {
  if (!value || typeof value !== "object") throw new Error("服务器配置格式无效。");
  const raw = value as Record<string, unknown>;
  const url = normalizeServerUrl(raw.url);
  if (raw.name !== undefined && typeof raw.name !== "string") throw new Error("服务器名称格式无效。");
  return { name: (raw.name as string | undefined)?.trim() || new URL(url).host, url };
}

function config(value: unknown): ServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("服务器配置格式无效。");
  const raw = value as Record<string, unknown>;
  const entries = raw.servers ?? [];
  if (!Array.isArray(entries)) throw new Error("服务器列表格式无效。");
  const servers = entries.map(profile);
  if (new Set(servers.map((item) => item.url)).size !== servers.length) throw new Error("服务器地址已保存。");
  const activeUrl = raw.activeUrl === undefined || raw.activeUrl === null
    ? null
    : raw.activeUrl === "" ? "" : normalizeServerUrl(raw.activeUrl);
  if (activeUrl && !servers.some((item) => item.url === activeUrl)) throw new Error("默认服务器不在保存的列表中。");
  return { servers, activeUrl };
}

export class ServerStore {
  readonly path: string;
  readonly loadError: Error | null;
  private value: ServerConfig = { servers: [], activeUrl: null };

  constructor(path: string) {
    this.path = path;
    let error: Error | null = null;
    try {
      this.value = config(JSON.parse(readFileSync(path, "utf8")));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        error = new Error(`无法读取 desktop-servers.json，原文件已保留，请检查后重启客户端。${String(cause)}`);
      }
    }
    this.loadError = error;
  }

  get(): ServerConfig {
    return structuredClone(this.value);
  }

  assertWritable(): void {
    if (this.loadError) throw this.loadError;
  }

  private write(next: ServerConfig): void {
    this.assertWritable();
    const validated = config(next);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.path);
      this.value = validated;
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  save(previous: unknown, input: unknown): void {
    this.assertWritable();
    const next = this.get();
    const item = profile(input);
    const before = previous === "" ? "" : normalizeServerUrl(previous);
    const index = before ? next.servers.findIndex((entry) => entry.url === before) : -1;
    if (before && index < 0) throw new Error("该服务器已不在保存的列表中。");
    if (before && before === next.activeUrl && before !== item.url) throw new Error("请先切换默认服务器，再修改此地址。");
    if (next.servers.some((entry, i) => i !== index && entry.url === item.url)) throw new Error("服务器地址已保存。");
    if (index < 0) next.servers.push(item);
    else next.servers[index] = item;
    this.write(next);
  }

  remove(value: unknown): void {
    this.assertWritable();
    const url = normalizeServerUrl(value);
    const next = this.get();
    if (url === next.activeUrl) throw new Error("请先切换默认服务器，再删除此地址。");
    if (!next.servers.some((item) => item.url === url)) throw new Error("该服务器已不在保存的列表中。");
    next.servers = next.servers.filter((item) => item.url !== url);
    this.write(next);
  }

  remember(url: string): void {
    this.write({ ...this.get(), activeUrl: url });
  }
}

export function startupSelection(value: ServerConfig, environment: string | undefined): string | null {
  if (value.activeUrl !== null) return value.activeUrl;
  return environment?.trim() ? normalizeServerUrl(environment) : null;
}
