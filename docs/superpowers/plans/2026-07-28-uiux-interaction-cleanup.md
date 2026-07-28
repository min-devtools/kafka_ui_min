# KafkaMin UI/UX Interaction Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make KafkaMin’s primary navigation and context-sensitive actions predictable while preserving the current visual system and backend behavior.

**Architecture:** Keep the current Zustand store and per-connection tabs. Add only the missing explicit intent/state actions, then update existing views to consume them. Use source contract tests for DOM interaction rules and pure helper tests for state decisions.

**Tech Stack:** React 18, TypeScript, Zustand, TanStack Query, Node test runner, Tauri 2.

---

### Task 1: Add regression contracts

**Files:**
- Create: `src/lib/uiUxContracts.test.mjs`
- Modify: `src/lib/tabs.test.mjs`
- Modify: `src/lib/tabs.ts`

- [ ] Add failing tests for case-insensitive matching, tab-selection clearing, explicit Produce topic routing, one-click row activation, dynamic primary-action copy, scoped connection shortcuts, error states, and keyboard semantics.
- [ ] Run `node --experimental-strip-types --test src/lib/uiUxContracts.test.mjs src/lib/tabs.test.mjs` and confirm failures describe the missing contracts.
- [ ] Add the smallest pure helpers needed by store/view code.

### Task 2: Fix context and tab state

**Files:**
- Modify: `src/store.ts`
- Modify: `src/components/views/ProduceView.tsx`
- Modify: `src/components/views/MessagesView.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/views/TopicsView.tsx`

- [ ] Add `openProduceTab(topic?)` and an explicit per-connection Produce intent.
- [ ] Update a Messages tab’s persisted topic when its picker changes and clear stale selection on topic/tab switches.
- [ ] Scope stored JS filters by connection and topic.

### Task 3: Simplify interactions and states

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Titlebar.tsx`
- Modify: `src/components/views/SettingsView.tsx`
- Modify: `src/components/views/TopicsView.tsx`
- Modify: `src/components/views/GroupsView.tsx`
- Modify: `src/components/views/MessagesView.tsx`
- Modify: `src/components/views/ConnectionView.tsx`

- [ ] Make topic/group rows single-click destinations.
- [ ] Make sidebar search truthful and case-insensitive, and remove duplicate group navigation.
- [ ] Show contextual primary-action labels, progressive Messages controls, workspace error/retry states, and required connection validation.
- [ ] Scope connection shortcuts to a focused connection row.

### Task 4: Complete keyboard semantics

**Files:**
- Modify: `src/components/TabsBar.tsx`
- Modify: `src/ui/ContextMenu.tsx`
- Modify: `src/ui/SortTh.tsx`

- [ ] Separate tab activation from close controls.
- [ ] Use menu/menuitem semantics with keyboard navigation.
- [ ] Make sortable headers expose `aria-sort` and a real button.

### Task 5: Verify once at the intended boundaries

- [ ] Run the focused Node tests and fix only relevant failures.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Render one desktop smoke pass covering Welcome, Topics error, Messages empty state, Produce action copy, sidebar search, tabs, and keyboard focus.
