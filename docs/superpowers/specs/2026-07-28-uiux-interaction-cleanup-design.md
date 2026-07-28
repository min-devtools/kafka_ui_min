# KafkaMin UI/UX interaction cleanup

## Goal

Remove ambiguous or stale interaction state without redesigning the visual system or changing Kafka backend behavior.

## Interaction contract

- An explicit “Produce to topic” intent always updates the existing Produce tab to that topic.
- Message topic and selection state never leak into another tab or a newly selected topic.
- Topic and consumer-group rows open their primary destination on one click; secondary and destructive actions remain in context menus or explicit buttons.
- The titlebar primary action describes and runs the active view’s action: load in Messages, produce in Produce, open Messages elsewhere.
- Sidebar search covers workspace destinations, connections, and topics, using case-insensitive matching.
- Connection shortcuts only act when a connection row owns focus.

## Progressive states

- Messages initially emphasizes topic selection. Fetch, search, projection, filter, and export controls appear after a topic is selected.
- Topics and Consumer Groups show explicit unreachable states with Retry in the main workspace.
- Connection save validates required name and broker fields but does not require a successful handshake.

## Accessibility

- Context-menu items and sortable headers are keyboard-operable.
- Tab activation and tab close remain separate accessible actions.

## Scope boundary

Keep the existing React, Zustand, TanStack Query, Tauri, Monaco, shared CSS, and tab architecture. Do not change Kafka commands, redesign themes, or touch the in-progress resize-handle work.

## Verification

Use focused Node contract/unit tests while implementing, then run the full Node test suite and one production build at the end. Perform one final rendered desktop smoke pass; do not repeat the complete suite after every small edit.
