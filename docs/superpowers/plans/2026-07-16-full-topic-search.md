# Full Topic Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exhaustive snapshot search for a JSON/text topic with visual and JavaScript filters, progress, cancellation, a 10,000-result cap, and configurable pagination.

**Architecture:** A Rust search worker records partition watermarks and consumes the finite snapshot in one pass. Tauri events carry progress and bounded candidate batches to React; frontend state applies JavaScript filters, caps accepted results, and paginates them without polling large arrays through IPC.

**Tech Stack:** Rust, `rdkafka`, Tauri 2 events, React 18, TypeScript, Zustand, existing UI primitives.

---

### Task 1: Search Types And Pure Filtering

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/kafka.ts`

- [ ] **Step 1: Write failing Rust tests**

Add tests for dotted JSON paths, metadata/header paths, `equals`, `notEquals`, `contains`, `exists`, `gt`, `gte`, `lt`, and `lte`.

- [ ] **Step 2: Verify failure**

Run: `cargo test --lib` in `src-tauri`
Expected: FAIL because `SearchCondition` and `matches_conditions` do not exist.

- [ ] **Step 3: Implement shared contracts**

Add `SearchCondition`, `SearchProgress`, `SearchBatch`, and `SearchFinished` serializable types. Add matching helpers that parse JSON once per record and resolve `value.*`, `key`, `partition`, `offset`, `timestamp`, and `headers.*`. Add matching TypeScript types and Tauri wrappers.

- [ ] **Step 4: Verify tests**

Run: `cargo test --lib` in `src-tauri`
Expected: PASS.

### Task 2: Snapshot Search Worker

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing state tests**

Test cancellation registration/removal and the 10,000-candidate cap helper.

- [ ] **Step 2: Verify failure**

Run: `cargo test --lib` in `src-tauri`
Expected: FAIL because search state helpers do not exist.

- [ ] **Step 3: Implement Tauri search commands**

Add `kafka_search_start` and `kafka_search_cancel`. Start records low/high watermarks, assigns all non-empty partitions, polls until every recorded high watermark is reached, applies text and visual filters, emits candidate batches and throttled progress, checks cancellation, and emits one terminal event. Register commands and manage cancellation flags in Tauri state.

- [ ] **Step 4: Verify backend**

Run: `cargo test --lib && cargo check` in `src-tauri`
Expected: all tests pass and check exits 0.

### Task 3: Search UI State And Controls

**Files:**
- Create: `src/components/views/FullTopicSearch.tsx`
- Modify: `src/components/views/MessagesView.tsx`
- Modify: `src/styles/views.css`

- [ ] **Step 1: Add search mode and condition builder**

Add Browse/Search mode controls. Search mode provides topic, key/payload text, repeatable visual conditions, existing JS filters, Search, and Cancel.

- [ ] **Step 2: Wire event lifecycle**

Subscribe before invoking start, filter incoming candidates through enabled compiled JS filters, deduplicate by partition/offset, cap retained rows at 10,000, update progress, and unlisten/cancel on replacement or unmount.

- [ ] **Step 3: Add progress and terminal summaries**

Show scanned/total, partition completion, accepted matches, rate, elapsed time, and running/completed/cancelled/failed state.

- [ ] **Step 4: Build frontend**

Run: `npm run build`
Expected: TypeScript and Vite build pass.

### Task 4: Pagination And Final Verification

**Files:**
- Modify: `src/components/views/FullTopicSearch.tsx`
- Modify: `README.md`

- [ ] **Step 1: Implement bounded pagination**

Paginate accepted results at 25, 50, 100, or 250 rows, default 50. Clamp page after result changes and show the 10,000-result truncation notice.

- [ ] **Step 2: Document feature**

Update README to describe finite full-topic snapshot search, filter support, cancellation, and display cap.

- [ ] **Step 3: Run complete verification**

Run: `npm run build`
Expected: exits 0.

Run: `cargo test --lib && cargo check` in `src-tauri`
Expected: all tests pass and check exits 0.

- [ ] **Step 4: Inspect changes**

Run: `git diff --check && git status --short`
Expected: no whitespace errors; only intended files appear.
