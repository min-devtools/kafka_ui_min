# Messages Live and Filter UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a topic-scoped live tail, visible JavaScript filter management, coherent Browse/Live/Full search controls, and Vim-correct Escape behavior.

**Architecture:** A cancellable Rust worker assigns topic partitions at their current high watermarks and emits `kafka-live-batch` events. `MessagesView` owns the three modes and one shared filter manager, while `FullTopicSearch` owns only snapshot-specific controls and results. `CodeInput` exposes Vim mode changes so modal dismissal can distinguish Normal mode from an Escape intended for Vim.

**Tech Stack:** React, TypeScript, Zustand, Monaco, monaco-vim, Tauri 2, Rust, rdkafka, Node test runner.

---

### Task 1: Lock the interaction contracts

**Files:**
- Create: `src/lib/messageLiveUx.test.mjs`
- Modify: `src/lib/uiUxContracts.test.mjs`

- [ ] Add source-contract assertions requiring:
  - a `Browse`, `Live`, `Full search` mode switch in `MessagesView`;
  - shared filter rows with enable, edit, and remove controls;
  - `FullTopicSearch` rendering the supplied filter collection rather than only an enabled count;
  - `CodeInput` exposing `onVimModeChange`;
  - modal Escape closing only when the tracked mode is `normal`;
  - Rust commands `kafka_live_start` and `kafka_live_stop` plus the `kafka-live-batch` event.
- [ ] Run:
  `node --experimental-strip-types --test src/lib/messageLiveUx.test.mjs`
  and confirm it fails for the missing contracts.

### Task 2: Expose Vim mode without coupling the modal to Monaco internals

**Files:**
- Modify: `src/types/monaco-vim.d.ts`
- Modify: `src/ui/CodeInput.tsx`
- Modify: `src/components/views/MessagesView.tsx`

- [ ] Expand the local `initVimMode` return type with typed `on` and `off` methods for `vim-mode-change`.
- [ ] Add `onVimModeChange?: (mode: string) => void` to `CodeInput`.
- [ ] Subscribe when Vim initializes, emit `normal` initially, and unsubscribe on disposal.
- [ ] Track the modal's mode in a ref. In the capture listener, let Escape pass when Vim is enabled and the mode is not `normal`; otherwise stop propagation and close.

### Task 3: Add the read-only live consumer

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/kafka.ts`
- Modify: `src/lib/types.ts`

- [ ] Add `LiveRegistry`, a cancellation flag per `liveId`, and serializable `LiveBatch` / `LiveFinished` payloads.
- [ ] Implement `live_impl`:
  - fetch the topic metadata;
  - apply an optional partition restriction;
  - fetch each partition's high watermark;
  - assign `Offset::Offset(high)`;
  - poll until cancelled;
  - emit batches at 100 messages or 200 ms;
  - emit a finished event and remove the registry entry.
- [ ] Register `kafka_live_start` and `kafka_live_stop` with Tauri.
- [ ] Add typed frontend wrappers `startLiveMessages` and `stopLiveMessages`.

### Task 4: Unify the Messages modes and filter manager

**Files:**
- Create: `src/components/views/JsFilterBar.tsx`
- Modify: `src/components/views/MessagesView.tsx`
- Modify: `src/components/views/FullTopicSearch.tsx`
- Modify: `src/styles/views.css`

- [ ] Replace the binary browse/search state with `"browse" | "live" | "search"`.
- [ ] Add a stable mode switch before topic/partition controls.
- [ ] Move mode-specific actions to the right edge.
- [ ] Start Live with a new `liveId`, subscribe to matching batch/finished events, append messages, retain the newest 5,000, and count dropped rows.
- [ ] Stop Live on explicit Stop, mode/topic changes, and unmount.
- [ ] Implement `JsFilterBar` as the single manager for toggle, code preview, edit, remove, and Add.
- [ ] Pass filter mutation callbacks into `FullTopicSearch` and render `JsFilterBar` below snapshot conditions.
- [ ] Add compact responsive styles without adding another nested card.

### Task 5: Verify once as a complete batch

**Files:**
- Verify all files above.

- [ ] Run the focused contract test and confirm it passes.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `git diff --check`.
- [ ] Smoke test the rendered app:
  - mode switch order and action placement;
  - exact filters visible in Full search;
  - first Escape changes Insert to Normal;
  - second Escape closes the filter modal;
  - Live empty/status/stop behavior without requiring an offset commit.
