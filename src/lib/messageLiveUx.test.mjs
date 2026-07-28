import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldCloseFilterModalOnEscape } from "./messageFilter.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const messages = read("../components/views/MessagesView.tsx");
const fullSearch = read("../components/views/FullTopicSearch.tsx");
const codeInput = read("../ui/CodeInput.tsx");
const vimTypes = read("../types/monaco-vim.d.ts");
const kafka = read("./kafka.ts");
const rust = read("../../src-tauri/src/lib.rs");

test("Messages exposes Browse, Live and Full search as peer modes", () => {
  assert.match(messages, /type MessageMode = "browse" \| "live" \| "search"/);
  assert.match(messages, />Browse</);
  assert.match(messages, />Live</);
  assert.match(messages, />Full search</);
  assert.doesNotMatch(messages, /<Icon name="search" \/> Full search/);
});

test("Browse and Full search expose the same inspectable JS filter manager", () => {
  assert.match(messages, /<JsFilterBar/);
  assert.match(fullSearch, /<JsFilterBar/);
  assert.match(fullSearch, /onToggleFilter/);
  assert.match(fullSearch, /onEditFilter/);
  assert.match(fullSearch, /onRemoveFilter/);
});

test("Vim gets the first Escape and the modal closes only from Normal mode", () => {
  assert.match(codeInput, /onVimModeChange/);
  assert.match(codeInput, /vim-mode-change/);
  assert.match(vimTypes, /on\(event: "vim-mode-change"/);
  assert.match(messages, /vimEditorModeRef/);
  assert.match(messages, /shouldCloseFilterModalOnEscape\(vimMode, vimEditorModeRef\.current\)/);
  assert.equal(shouldCloseFilterModalOnEscape(true, "insert"), false);
  assert.equal(shouldCloseFilterModalOnEscape(true, "normal"), true);
  assert.equal(shouldCloseFilterModalOnEscape(false, "insert"), true);
});

test("frontend exposes cancellable live message commands", () => {
  assert.match(kafka, /startLiveMessages/);
  assert.match(kafka, /"kafka_live_start"/);
  assert.match(kafka, /stopLiveMessages/);
  assert.match(kafka, /"kafka_live_stop"/);
});

test("Rust live consumption starts at high watermarks and emits scoped batches", () => {
  assert.match(rust, /struct LiveRegistry/);
  assert.match(rust, /async fn kafka_live_start/);
  assert.match(rust, /fn kafka_live_stop/);
  assert.match(rust, /Offset::Offset\(high\)/);
  assert.match(rust, /"kafka-live-batch"/);
  assert.match(rust, /"kafka-live-finished"/);
});
