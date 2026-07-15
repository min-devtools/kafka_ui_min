# KafkaMin

Minimal Kafka/Redpanda desktop client (Tauri + React). Shares the design system
used by ElasticMin and RequestsMin.

## Features

- Multiple saved connections (plaintext / SSL / SASL PLAIN / SCRAM), switch from the sidebar or ⌘K
- Topics: partitions, replicas, low/high watermarks
- Messages: tail newest/oldest N per topic or partition, client-side filter on key/payload, payload inspector (read-only — never commits offsets)
- Consumer groups: state, members, committed offsets, lag; reset offsets to earliest/latest (asks for confirmation, group must be empty)
- Works with Redpanda out of the box — it speaks the Kafka wire protocol (default port 9092)

## Development

```sh
npm install
npm run tauri dev
```

Rust backend uses `rdkafka` with vendored librdkafka/OpenSSL — first build needs
`cmake` (`brew install cmake`).

## Build

```sh
npm run app   # .app bundle
```
