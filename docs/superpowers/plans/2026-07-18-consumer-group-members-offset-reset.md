# Consumer Group Members and Offset Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show consumer group members and allow group offsets to be reset by topic or a single partition to earliest, latest, an absolute offset, or a timestamp.

**Architecture:** Rust exposes group-member and expanded offset-reset Tauri commands backed by librdkafka. React Query fetches members beside offsets, and the existing selected-group panel renders assignments plus controls at topic and partition scope.

**Tech Stack:** Tauri 2, Rust, rdkafka, React 18, TypeScript, TanStack React Query.

## Global Constraints

- Kafka offsets are committed per group, not per individual member.
- A reset must retain Kafka's active-member rejection behavior.
- `partition: null` means every partition in the selected topic.
- Timestamp reset uses the first message at or after the timestamp; no later message means the partition high watermark.
- Do not modify the unrelated unstaged `src/components/Sidebar.tsx` change.

---

## File Structure

- Modify `src-tauri/src/lib.rs`: group-member DTO/command, timestamp target resolution, and Rust unit tests.
- Modify `src/lib/types.ts`: member and assignment client types.
- Modify `src/lib/kafka.ts`: Tauri invoke wrappers and timestamp reset arguments.
- Modify `src/lib/queries.ts`: member query with the current polling policy.
- Modify `src/components/views/GroupsView.tsx`: member display, timestamp entry, and topic/partition-scoped reset actions.
- Modify `README.md`: document the expanded Consumer Groups capabilities.

### Task 1: Rust Group Inspection and Reset Semantics

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `kafka_group_members(conn: KafkaConnection, group: String) -> Result<Vec<GroupMember>, String>`.
- Produces: `kafka_reset_offsets(..., timestamp_ms: Option<i64>) -> Result<Vec<GroupOffset>, String>`.

- [ ] **Step 1: Write failing unit tests for reset target selection**

Extract a pure helper accepting low watermark, high watermark, target kind, requested offset, and resolved timestamp offset. Test that earliest resolves to low, latest to high, explicit offset clamps to range, timestamp resolution uses the returned offset, and missing timestamp resolution uses high.

- [ ] **Step 2: Run Rust tests to verify the new tests fail**

Run: `cargo test` from `src-tauri`

Expected: compile failure because the target-resolution helper does not exist.

- [ ] **Step 3: Implement group-member DTO and command**

Define serializable `GroupMember` and `GroupAssignment` structures with camel-case output. Fetch the named group with `fetch_group_list(Some(group), TIMEOUT)`, reject a missing group, and convert each member's id, client id, host, and assignment into the DTO. Register `kafka_group_members` in `tauri::generate_handler!`.

- [ ] **Step 4: Implement timestamp reset resolution**

Add `timestamp_ms: Option<i64>` to the command and implementation. Build an `Offset::Offset(timestamp_ms)` request list for all reset partitions, call `offsets_for_times`, then pass its per-partition offsets to the pure target helper. Use the high watermark when a partition has no resolved offset. Preserve offset clamping and synchronous group commit.

- [ ] **Step 5: Run Rust tests**

Run: `cargo test` from `src-tauri`

Expected: PASS.

- [ ] **Step 6: Commit backend work**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: inspect consumer group members and reset by timestamp"
```

### Task 2: Consumer Group UI and Client API

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/kafka.ts`
- Modify: `src/lib/queries.ts`
- Modify: `src/components/views/GroupsView.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `kafka_group_members` and `kafka_reset_offsets` from Task 1.
- Produces: `useGroupMembers(group: string | null)` and member/reset controls in `GroupsView`.

- [ ] **Step 1: Add frontend types, invoke wrapper, and query**

Add `GroupMember` and `GroupAssignment` types. Add `fetchGroupMembers(conn, group)`, allow `resetOffsets` target `timestamp`, and send `timestampMs`. Add `useGroupMembers` with query key `['group-members', conn?.id, group]`, enabled only when connection and group exist, using the existing ten-second refresh policy.

- [ ] **Step 2: Render members in the selected group panel**

Load `useGroupMembers(selected)`. Add a `Members (N)` section before offsets, including loading, no-active-member, and error states. Render member ID, client ID, host, and `topic [partition, ...]` assignments.

- [ ] **Step 3: Generalize reset interaction by scope and target**

Replace topic-only reset callbacks with one handler accepting topic, optional partition, target, and optional value. Confirmation includes topic, target and either all partitions or `partition N`. Preserve existing earliest/latest and numeric offset actions. Add timestamp input through the project date-time modal or prompt pattern and convert its date-time to epoch milliseconds before invoke.

- [ ] **Step 4: Add partition-level actions**

Add an Actions table column to `OffsetTable`, passing a callback that produces earliest/latest/offset/timestamp buttons for each row. Keep topic-header controls for all partitions. Disable every mutation control while reset is in progress. After success invalidate `groups`, `group-members`, and `group-offsets`.

- [ ] **Step 5: Update feature documentation**

Change the Consumer Groups README bullet to name member inspection and topic/partition reset targets including timestamp.

- [ ] **Step 6: Run TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit frontend work**

```bash
git add src/lib/types.ts src/lib/kafka.ts src/lib/queries.ts src/components/views/GroupsView.tsx README.md
git commit -m "feat: add consumer group member and partition controls"
```

### Task 3: End-to-End Verification

**Files:**
- No code changes expected.

**Interfaces:**
- Consumes: completed backend and frontend functionality.

- [ ] **Step 1: Run all required checks**

Run: `cargo test` from `src-tauri`

Run: `npm run build` from the repository root.

Expected: both commands PASS.

- [ ] **Step 2: Inspect final diff**

Run: `git status --short` and `git diff HEAD~2..HEAD --check`.

Expected: no whitespace errors; only the unrelated `src/components/Sidebar.tsx` remains unstaged.
