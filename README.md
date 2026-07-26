# KafkaMin

Minimal Kafka/Redpanda desktop client (Tauri + React). Shares the design system
used by ElasticMin and RequestsMin.

## Features

- Multiple saved connections (plaintext / SSL / SASL PLAIN / SCRAM), switch from the sidebar or ⌘K
- Topics: partitions, replicas, low/high watermarks
- Messages: tail newest/oldest N per topic or partition, client-side filter on key/payload, payload inspector (read-only — never commits offsets)
- Full topic search: scans a finite low/high-watermark snapshot across every partition, supports text, JSON-field, metadata, header, and JavaScript filters, reports progress, and can be cancelled; results are paginated and capped at 10,000 for safety
- Consumer groups: state, member assignments, committed offsets and lag; reset a topic or one partition to earliest, latest, an offset, or a timestamp (asks for confirmation, group must be empty)
- Works with Redpanda out of the box — it speaks the Kafka wire protocol (default port 9092)

## Development

```sh
npm install
npm run tauri dev
```

Rust backend uses `rdkafka` with vendored librdkafka/OpenSSL — first build needs
`cmake` (`brew install cmake`).

### Windows

- First build needs `cmake` **and a native Windows Perl** (`winget install
  Kitware.CMake StrawberryPerl.StrawberryPerl`) — `openssl-src` shells out to
  `perl Configure`, and the MSYS/Git-Bash perl is not a substitute. NASM is not
  needed: the MSVC target is configured `no-asm`.
- `src/styles/` holds **git symlinks** into `../design-systems` (5 of the 6
  files). Windows needs that repo cloned next to this one *and* `git config
  core.symlinks true` (Developer Mode) — otherwise git writes the link target as
  plain text, the token/theme cascade silently drops and the app renders
  unstyled.
- Connection passwords go to the Windows Credential Manager instead of the macOS
  keychain (`keyring`'s `windows-native` backend). Secrets do not travel between
  the two, so passwords must be re-entered after moving a `kafkamin.json`.
- The font picker enumerates families through `powershell.exe` +
  `System.Drawing.Text.InstalledFontCollection`; macOS uses NSFontManager.
- `tauri.windows.conf.json` makes the window opaque: `transparent` plus the
  `windowBackground` vibrancy effect are macOS-only. The native title bar stays
  visible, so the in-app titlebar still reserves its macOS traffic-light inset —
  cosmetic, and it lives in the shared `design-systems` stylesheet.

## Build

```sh
npm run app   # .app bundle
```
