import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { normalizeServerUrl, ServerStore, startupSelection } from "./server-store";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "hivework-servers-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "desktop-servers.json");
  return { path, dir, store: new ServerStore(path) };
}

test("legacy root URLs normalize without changing local/remote identity", () => {
  for (const [input, expected] of [
    [" https://WORK.example.com:443/ ", "https://work.example.com"],
    ["work.example.com", "https://work.example.com"],
    ["localhost:8088", "http://localhost:8088"],
    ["LOCALHOST:8088", "http://localhost:8088"],
    ["127.0.0.1:8088/", "http://127.0.0.1:8088"],
    ["[::1]:8088", "http://[::1]:8088"],
    ["HTTP://example.com:80", "http://example.com"],
  ]) assert.equal(normalizeServerUrl(input), expected);
});

test("credentials, query, fragments, normalized paths and non-HTTP URLs are refused", () => {
  for (const value of [
    "", "javascript:alert(1)", "file:///tmp", "ftp://example.com", "https://u:p@example.com",
    "https://@example.com", "https://example.com?", "https://example.com#", "https://example.com/a",
    "https://example.com/..", "https://example.com/%2e", "https://example.com//",
    "https://example.com\\", "https://example.com:0", "https://example.com:", "https://example.com:65536",
    "https://a..com", "https://a-.com", "https://example.com\n", null, {}, "https://exa mple.com",
  ]) assert.throws(() => normalizeServerUrl(value), String(value));
});

test("null / explicit local / saved remote keep old startup precedence", () => {
  const servers = [{ name: "Cloud", url: "https://cloud.example" }];
  assert.equal(startupSelection({ servers, activeUrl: null }, undefined), null);
  assert.equal(startupSelection({ servers, activeUrl: null }, "https://env.example/"), "https://env.example");
  assert.equal(startupSelection({ servers, activeUrl: "" }, "invalid"), "");
  assert.equal(startupSelection({ servers, activeUrl: servers[0]!.url }, "https://env.example"), servers[0]!.url);
  assert.throws(() => startupSelection({ servers, activeUrl: null }, "https://env.example/path"));
});

test("save, reopen, rename, duplicate and active-profile protections retain legacy format", (t) => {
  const { store, path } = fixture(t);
  store.remember("");
  store.save("", { name: " Team ", url: "https://TEAM.example/" });
  store.save("", { name: "", url: "localhost:8088" });
  assert.throws(() => store.save("", { name: "duplicate", url: "https://team.example:443" }));
  store.remember("https://team.example");
  store.save("https://team.example", { name: "Renamed", url: "https://team.example" });
  assert.throws(() => store.save("https://team.example", { name: "Moved", url: "https://new.example" }));
  assert.throws(() => store.remove("https://team.example"));
  assert.equal(new ServerStore(path).get().servers[0]!.name, "Renamed");
  assert.equal(new ServerStore(path).get().activeUrl, "https://team.example");
  store.remember("");
  store.remove("https://team.example");
  assert.deepEqual(new ServerStore(path).get(), {
    servers: [{ name: "localhost:8088", url: "http://localhost:8088" }],
    activeUrl: "",
  });
});

test("existing malformed or unreadable profile files are never overwritten", (t) => {
  const { path } = fixture(t);
  for (const contents of [
    "{broken", "null", "[]", '{"servers":"wrong"}',
    '{"servers":[],"activeUrl":"https://unknown.example"}',
    '{"servers":[{"url":"https://same.example"},{"url":"https://same.example/"}]}',
  ]) {
    writeFileSync(path, contents);
    const store = new ServerStore(path);
    assert.ok(store.loadError);
    assert.throws(() => store.save("", { name: "new", url: "https://new.example" }));
    assert.throws(() => store.remember(""));
    assert.throws(() => store.remove("https://new.example"));
    assert.equal(readFileSync(path, "utf8"), contents);
  }
  rmSync(path);
  mkdirSync(path);
  assert.ok(new ServerStore(path).loadError);
});

test("failed atomic replacement preserves memory and cleans its temporary file", (t) => {
  const { store, path, dir } = fixture(t);
  mkdirSync(path);
  assert.throws(() => store.save("", { url: "https://one.example" }));
  assert.deepEqual(store.get(), { servers: [], activeUrl: null });
  assert.deepEqual(readdirSync(dir), ["desktop-servers.json"]);
});
