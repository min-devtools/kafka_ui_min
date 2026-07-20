import assert from "node:assert/strict";
import test from "node:test";
import { connTabId, pickConnTab, pruneConnTabs } from "./tabs.ts";

const tab = (id, kind, connId) => ({ id, kind, title: id, icon: "topics", iconClass: "", connId });
const WELCOME = tab("welcome", "welcome", undefined);

test("a kind opens a separate tab per connection", () => {
  assert.notEqual(connTabId("topics", "prod"), connTabId("topics", "local"));
});

test("picking a connection prefers its default view over its other tabs", () => {
  const tabs = [tab("cluster:prod", "cluster", "prod"), tab("topics:prod", "topics", "prod")];
  assert.equal(pickConnTab(tabs, "prod", "topics"), "topics:prod");
});

test("picking a connection falls back to whatever of its tabs is open", () => {
  const tabs = [tab("cluster:prod", "cluster", "prod")];
  assert.equal(pickConnTab(tabs, "prod", "topics"), "cluster:prod");
});

test("a connection with nothing open reports null so the caller creates a tab", () => {
  assert.equal(pickConnTab([tab("topics:local", "topics", "local")], "prod", "topics"), null);
});

test("another connection's tabs are never offered", () => {
  const tabs = [tab("topics:local", "topics", "local"), tab("settings", "settings", undefined)];
  assert.equal(pickConnTab(tabs, "prod", "topics"), null);
});

test("pruning drops tabs of deleted connections and keeps global ones", () => {
  const tabs = [tab("topics:gone", "topics", "gone"), tab("topics:prod", "topics", "prod"), WELCOME];
  const out = pruneConnTabs(tabs, "topics:prod", ["prod"], WELCOME);
  assert.deepEqual(out.tabs.map((t) => t.id), ["topics:prod", "welcome"]);
  assert.deepEqual(out.dropped.map((t) => t.id), ["topics:gone"]);
  assert.equal(out.activeTabId, "topics:prod");
});

test("pruning away the active tab moves the selection to a survivor", () => {
  const tabs = [tab("topics:gone", "topics", "gone"), WELCOME];
  assert.equal(pruneConnTabs(tabs, "topics:gone", [], WELCOME).activeTabId, "welcome");
});

test("pruning every tab still leaves one, so activeTabId stays valid", () => {
  const out = pruneConnTabs([tab("topics:gone", "topics", "gone")], "topics:gone", [], WELCOME);
  assert.deepEqual(out.tabs, [WELCOME]);
  assert.equal(out.activeTabId, "welcome");
});

test("nothing to prune reports null so the store skips the update", () => {
  const tabs = [tab("topics:prod", "topics", "prod"), WELCOME];
  assert.equal(pruneConnTabs(tabs, "topics:prod", ["prod"], WELCOME), null);
});
