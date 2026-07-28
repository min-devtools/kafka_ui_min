import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const store = read("../store.ts");
const sidebar = read("../components/Sidebar.tsx");
const titlebar = read("../components/Titlebar.tsx");
const tabsBar = read("../components/TabsBar.tsx");
const topics = read("../components/views/TopicsView.tsx");
const groups = read("../components/views/GroupsView.tsx");
const messages = read("../components/views/MessagesView.tsx");
const produce = read("../components/views/ProduceView.tsx");
const settings = read("../components/views/SettingsView.tsx");
const connection = read("../components/views/ConnectionView.tsx");
const contextMenu = read("../ui/ContextMenu.tsx");
const sortTh = read("../ui/SortTh.tsx");

test("explicit produce intents carry the topic into an existing Produce tab", () => {
  assert.match(store, /openProduceTab:\s*\(topic\?: string\)/);
  assert.match(store, /produceIntent:/);
  assert.match(sidebar, /openProduceTab\(topicMenu\.topic\)/);
  assert.match(topics, /openProduceTab\(menu\.topic\)/);
  assert.match(produce, /produceIntent/);
});

test("message topic changes clear stale selection and persist the tab topic", () => {
  assert.match(store, /setMessagesTabTopic:/);
  assert.match(messages, /setMessagesTabTopic\(tabId,\s*v\)/);
  assert.match(messages, /selectMsg\(null\)/);
  assert.match(store, /to\.id !== s\.activeTabId[\s\S]*selectedMsg:\s*null/);
});

test("topic and consumer-group rows use one click for their primary destination", () => {
  assert.match(topics, /onClick=\{\(\) => openMessagesTab\(t\.name\)\}/);
  assert.doesNotMatch(topics, /onDoubleClick/);
  assert.match(groups, /onClick=\{\(\) => openGroupTab\(g\.name\)\}/);
  assert.doesNotMatch(groups, /onDoubleClick/);
});

test("the titlebar and settings describe the active action accurately", () => {
  assert.match(titlebar, /Produce message \(⌘↵\)/);
  assert.match(titlebar, /Load messages \(⌘↵\)/);
  assert.match(titlebar, /aria-label=\{primaryActionLabel\}/);
  assert.match(settings, />Run active action</);
});

test("sidebar search covers navigation and connections with case-insensitive topic matching", () => {
  assert.match(sidebar, /shownNav/);
  assert.match(sidebar, /shownConnections/);
  assert.match(sidebar, /t\.name\.toLowerCase\(\)\.includes\(q\)/);
  assert.match(sidebar, /data-connection-id=\{c\.id\}/);
  assert.match(sidebar, /focusedConnId/);
});

test("cluster-backed index views expose an inline error and retry action", () => {
  assert.match(topics, /meta\.isError[\s\S]*meta\.refetch/);
  assert.match(groups, /groups\.isError[\s\S]*groups\.refetch/);
  assert.match(connection, /connectionValid/);
});

test("messages progressively reveal secondary controls after a topic is selected", () => {
  assert.match(messages, /\{topic && \([\s\S]*Full search/);
  assert.match(messages, /\{topic && \([\s\S]*JS filter/);
});

test("tabs, context menus and sortable headers expose keyboard semantics", () => {
  assert.match(tabsBar, /role="tab"/);
  assert.match(tabsBar, /aria-selected=\{tab\.id === activeTabId\}/);
  assert.match(tabsBar, /className="tab-close"/);
  assert.match(contextMenu, /role="menu"/);
  assert.match(contextMenu, /role="menuitem"/);
  assert.match(sortTh, /aria-sort=/);
  assert.match(sortTh, /<button/);
});
