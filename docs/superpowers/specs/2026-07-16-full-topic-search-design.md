# Full Topic Search Design

## Goal

Add an exhaustive search mode for JSON/text Kafka topics. The search scans a finite snapshot of every partition, reports progress, supports cancellation, combines visual and JavaScript filters, and safely displays large result sets.

The existing bounded message browser remains unchanged for quick newest/oldest/offset/timestamp reads.

## Snapshot Semantics

At search start, the backend records each partition's low and high watermark. It scans offsets in `[low, high)` for every partition. Messages produced after the snapshot is recorded are excluded, so an active topic cannot make the search run forever.

The search runs through the complete snapshot even after matches are found. Completion therefore means either:

- all snapshot messages were scanned and matches were found; or
- all snapshot messages were scanned and no matches were found.

## Filters

Search supports both filter styles and applies them with AND semantics:

- Text search against message key and payload.
- Visual conditions against message metadata, headers, and JSON payload fields.
- Existing JavaScript filters over `value`, `key`, `partition`, `offset`, `timestamp`, and `headers`.

Visual conditions support `equals`, `not equals`, `contains`, `exists`, and numeric comparisons. Multiple visual conditions must all match. Invalid visual or JavaScript filters prevent the search from starting and show an actionable validation error.

Filtering executes in the Rust backend. This avoids transferring every scanned payload through Tauri IPC and keeps memory bounded. JavaScript filters are evaluated in the frontend against backend-filtered candidates because the Rust backend does not embed a JavaScript runtime. The backend search request therefore applies text and visual filters, while the frontend applies enabled JavaScript filters before accepting a result. Progress distinguishes scanned records from accepted matches.

## Execution Model

The frontend starts a search and receives a search ID. A blocking backend worker scans assigned partitions and stores bounded search state keyed by that ID. The frontend polls search status at a short interval to retrieve progress and newly matched records. Cancellation marks the search as cancelled; the worker checks this flag between polls and exits promptly.

Backend state includes:

- snapshot message total;
- scanned message count;
- completed and total partitions;
- backend candidate count;
- elapsed time and current scan rate;
- terminal state: running, completed, cancelled, or failed;
- a bounded result buffer.

Search state is removed explicitly when the UI closes or replaces a search, and stale completed searches are cleaned up defensively.

## Result Limits And Pagination

The UI retains at most 10,000 accepted matches in memory. It continues scanning the complete snapshot after reaching that cap so completion and scanned totals remain accurate. The status explains truncation, for example: `Showing first 10,000 of at least 34,521 backend matches`.

Results use client-side pagination with selectable page sizes of 25, 50, 100, and 250. The default is 50. Starting a new search resets the page to one.

Because JavaScript filters execute after backend polling, the exact total accepted JavaScript-filtered matches is only guaranteed while the backend candidate count remains within the transfer cap. When the cap is exceeded, the UI reports the result as truncated rather than presenting an incorrect exact total.

## User Interface

Messages view gains a `Full topic search` mode next to the existing bounded browser. Search controls include:

- topic selection;
- text query;
- visual condition builder;
- existing JavaScript filter editor;
- Search and Cancel actions.

While running, the UI shows scanned/total messages, completed/total partitions, matches retained, scan rate, elapsed time, and percentage progress. Terminal summaries are explicit:

- `Completed · 128 matches`
- `Completed · no matching messages`
- `Cancelled · scanned 42%`
- `Failed · <actionable error>`

The existing message table and inspector display search results. Pagination controls appear below the table.

## Error Handling

- A missing connection or topic blocks start.
- Invalid field paths, values, or JavaScript syntax block start.
- Kafka polling errors terminate the search and preserve already received results for inspection.
- Cancellation is idempotent.
- Closing or replacing the active search requests cancellation and cleanup.
- Payloads retain the existing 32 KiB cap and expose the truncated marker.

## Testing

Rust unit tests cover visual path extraction, operators, snapshot totals, result caps, and cancellation state transitions. React tests cover filter validation, progress summaries, pagination, result truncation, and JavaScript post-filter behavior where practical. Build verification runs TypeScript/Vite compilation and Rust tests/checks.

## Non-Goals

- Searching messages produced after the snapshot starts.
- Persisting or indexing Kafka data locally.
- Returning more than 10,000 displayed results.
- Schema Registry, Avro, or Protobuf decoding.
- Cluster-wide search across multiple topics.
