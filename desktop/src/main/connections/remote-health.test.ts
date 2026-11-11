import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { checkRemoteHealth } from "./remote-health";

test("remote probe sends no account credentials and uses only the selected root /api/health", async (t) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    assert.equal(req.url, "/api/health");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true,"users_loaded":1}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as { port: number };
  await checkRemoteHealth(`http://127.0.0.1:${address.port}`, new AbortController().signal);
  assert.equal(requests, 1);
});

test("cross-origin redirects are never followed by a health check", async (t) => {
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url !== "/api/health") redirected = true;
    res.writeHead(302, { Location: "/other" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as { port: number };
  await assert.rejects(checkRemoteHealth(`http://127.0.0.1:${address.port}`, new AbortController().signal));
  assert.equal(redirected, false);
});

test("HTTP errors, invalid health bodies, cancellation and TLS failures are surfaced", async () => {
  for (const response of [new Response('{"ok":true}', { status: 503 }), new Response('{"ok":false}')]) {
    await assert.rejects(checkRemoteHealth("https://team.example", new AbortController().signal, async () => response));
  }
  await assert.rejects(checkRemoteHealth(
    "https://team.example",
    new AbortController().signal,
    async (_url, options) => {
      assert.equal(options?.redirect, "error");
      assert.equal(options?.credentials, "omit");
      throw new Error("certificate has expired");
    },
  ), /certificate/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(checkRemoteHealth("https://team.example", abort.signal));
});
