# Messages Live and Filter UX Design

## Goal

Make the Messages workspace understandable at a glance, add a read-only live tail for one topic, expose every saved JavaScript filter, and preserve Vim's modal Escape behavior.

## Interaction model

Messages has one stable mode switch: **Browse**, **Live**, and **Full search**.

- The mode switch stays at the left edge of the primary toolbar.
- Topic and partition are shared source controls beside it.
- The primary action stays at the right edge and changes with the mode:
  - Browse: **Load**
  - Live: **Start live** / **Stop live**
  - Full search: **Search** / **Cancel**
- Full search is no longer entered through a button mixed into Browse source options.

Browse keeps the finite newest/oldest/offset/time fetch behavior. Live starts at the current high watermark and therefore receives only messages produced after **Start live**. It never joins a consumer group and never commits offsets. Full search remains a finite high-watermark snapshot.

## JavaScript filters

All three modes use the same per-connection, per-topic filter collection.

- A filter strip appears immediately below the source toolbar whenever filters exist.
- Every filter shows an enabled switch, a one-line code preview, Edit, and Remove.
- Disabled filters remain visible and visually muted.
- **Add JS filter** is a stable action at the end of the strip.
- Full search no longer shows only `JS filters (N)`; users can inspect and manage the exact filters before starting a scan.

## Vim Escape contract

`CodeInput` reports its current Vim mode to the owning modal.

- In Insert, Replace, or Visual mode, Escape is allowed to reach `monaco-vim` and returns the editor to Normal mode.
- In Normal mode, Escape closes the JS filter modal.
- With Vim disabled, Escape closes the modal immediately.
- Cancel and backdrop dismissal remain unchanged.

## Live lifecycle

The Rust backend owns a cancellable live consumer identified by `liveId`.

- Start resolves each selected partition's current high watermark and assigns that exact offset.
- Messages are emitted in small batches through a Tauri event.
- Stop sets a cancellation flag and wakes the worker.
- Changing topic/mode, closing the view, or unmounting stops the worker.
- The UI retains the latest 5,000 messages and reports how many older rows were dropped.
- Text search, projected columns, JS filters, sorting, selection, inspector, pagination, and NDJSON reuse the existing Messages table pipeline.

## Error and empty states

- Live before topic selection is disabled.
- Startup failures return the mode to stopped and show the existing error toast.
- An active live session shows a visible pulsing status and received count.
- A stopped empty session says that only messages produced after Start live will appear.

## Verification

- Source contract tests cover mode placement, visible filter management, Vim Escape priority, and live command/event wiring.
- Rust tests cover the high-watermark start contract where practical.
- TypeScript build, Node suite, Rust suite, diff check, and a rendered interaction smoke test are run once after the batch.

