# Consumer Group Members and Offset Reset Design

## Goal

Expand the Consumer Groups view so an operator can inspect a group's members
and reset its committed offsets by topic or individual partition. Supported
targets are earliest, latest, a numeric offset, and a timestamp.

Kafka commits offsets for a consumer group, not for a particular member. Member
data is therefore informational; every reset operation changes the selected
group's commits.

## Scope

- Show each selected group's active members and their assignments.
- Reset all partitions of one topic in a group.
- Reset one chosen topic partition in a group.
- Support earliest, latest, absolute offset, and timestamp targets.
- Preserve the existing confirmation flow and fail if Kafka rejects a reset for
  an active group.

## Backend

Add a `kafka_group_members` Tauri command. It describes the selected group and
returns members with these camel-case fields:

- `memberId`
- `clientId`
- `clientHost`
- `assignment`: topic-to-partitions entries

The group description is fetched through librdkafka's group-list API. The
backend decodes member assignment data into topic and partition lists before
returning it to the frontend.

Extend `kafka_reset_offsets` with the `timestamp` reset target and an optional
`timestampMs` argument. The existing optional `partition` argument defines
scope: `null` selects every partition in the topic, and a partition number
selects only that partition.

For each target partition:

- `earliest` commits its low watermark.
- `latest` commits its high watermark.
- `offset` commits the requested offset clamped to its current low/high
  watermarks.
- `timestamp` resolves the first record at or after the requested epoch
  timestamp with `offsets_for_times`. If no record exists at or after that
  timestamp, it commits the high watermark.

The command commits all calculated topic-partition offsets synchronously. It
does not bypass Kafka's rule that the group must not have active members.

## Frontend

Add matching `GroupMember` and assignment TypeScript types, an invoke wrapper,
and a `useGroupMembers(selectedGroup)` query. Member and offset queries refresh
every ten seconds and are invalidated after a successful reset.

The selected group panel contains two sections:

- `Members (N)`: member ID, client ID, client host, and assigned
  topic-partitions. It includes loading and empty states.
- `Offsets and lag`: existing topic grouping and table.

Each topic header retains actions that affect all its partitions: `Earliest`,
`Latest`, `Offset...`, and `Timestamp...`.

Each partition row gains an Actions column with the same reset choices scoped
to that row's partition. Numeric offset input accepts non-negative integers.
Timestamp input uses the existing date-time input pattern and sends epoch
milliseconds to Rust.

Every reset displays a danger confirmation naming group, topic, scope, and
target. The confirmation states that the group must have no active members.
Success refreshes group, member, and offset data. Backend errors are shown in
the existing error toast.

## Testing

Add focused Rust tests for reset-target resolution:

- earliest and latest use watermarks;
- numeric offsets clamp to watermarks;
- timestamp resolution uses the resolved offset;
- an unresolved timestamp commits the high watermark.

Run Rust tests and the TypeScript production build. Manual verification against
a Kafka or Redpanda cluster covers member assignments, topic-level reset,
partition-level reset, timestamp fallback, and rejection while members are
active.
