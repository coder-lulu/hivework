import assert from "node:assert/strict";
import { test } from "node:test";
import { ConnectionPermissions, type ConnectionSender } from "./permissions";

const remote: ConnectionSender = { id: 1, url: "https://team.example/login", frameUrl: "https://team.example/login", mainFrame: true };
const local: ConnectionSender = { id: 2, url: "octop://app/chat", frameUrl: "octop://app/chat", mainFrame: true };
const manager: ConnectionSender = { id: 3, url: "file:///app/server-manager.html", frameUrl: "file:///app/server-manager.html", mainFrame: true };
function fixture() {
  const permissions = new ConnectionPermissions();
  permissions.allow(1, "remote", "https://team.example");
  permissions.allow(2, "local", "octop://app");
  permissions.allow(3, "manager", manager.url);
  return permissions;
}
test("remote can only read current/open manager; mutation and every local privilege are denied", () => {
  const permissions = fixture();
  assert.equal(permissions.permits(remote, "public"), true);
  assert.equal(permissions.permits(remote, "local"), false);
  assert.equal(permissions.permits(remote, "manager"), false);
  assert.equal(permissions.permits(local, "local"), true);
  assert.equal(permissions.permits(local, "public"), true);
  assert.equal(permissions.permits(local, "manager"), false);
  assert.equal(permissions.permits(manager, "manager"), true);
  assert.equal(permissions.permits(manager, "local"), false);
  assert.equal(permissions.permits(manager, "public"), false);
});
test("matching URL alone, lookalike origins, stale navigation and subframes confer no authority", () => {
  const permissions = fixture();
  for (const sender of [
    { ...remote, id: 99 },
    { ...remote, mainFrame: false },
    { ...remote, frameUrl: "https://team.example.evil/login" },
    { ...remote, url: "http://team.example/login" },
    { ...remote, frameUrl: "https://evil.example", url: "https://evil.example" },
    { ...local, frameUrl: "https://team.example" },
    { ...local, url: "octop://evil/chat" },
    { ...manager, id: 1 },
    { ...manager, mainFrame: false },
    { ...manager, frameUrl: `${manager.url}?trusted=true` },
    { ...manager, url: "file:///app/another.html" },
  ]) {
    assert.equal(permissions.permits(sender, "manager"), false);
    assert.equal(permissions.permits(sender, "local"), false);
    assert.equal(permissions.permits(sender, "public"), false);
  }
  permissions.revoke(remote.id);
  assert.equal(permissions.permits(remote, "public"), false);
});
