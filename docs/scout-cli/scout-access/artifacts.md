---
title: scout artifacts upload
sidebar_label: artifacts
sidebar_position: 10
description:
  Upload debug artifacts — dSYM, Dart symbols, NDK symbols, ProGuard mappings,
  and source maps — so Scout can symbolicate crash reports back to source.
keywords:
  - scout artifacts
  - artifacts upload
  - crash symbolication
  - debug symbols upload
  - dsym upload
  - dart symbols
  - ndk symbols
  - proguard mapping
  - source map upload
---

# scout artifacts upload

Upload debug artifacts to the Scout platform so crash reports symbolicate back to
your source — turning stripped, obfuscated stack frames into readable file, line,
and symbol names. Scout matches each crash to the artifact you uploaded for that
build, so you upload once per release.

## Usage

```bash
scout artifacts upload <PATH> [flags]
```

## Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `PATH` | string | *(required)* Path to the artifact file, or an iOS/macOS `.dSYM` bundle. For a `.dSYM` directory the CLI automatically resolves the inner DWARF binary. |

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--type` | string | *(inferred)* | Artifact type. Inferred from the filename when omitted (see [Artifact types](#artifact-types)) |
| `--platform` | string | *(inferred)* | Platform: `android`, `ios`, or `web` |
| `--app` | string | — | Application identifier (bundle id / package name) |
| `--version` | string | — | Application version |
| `--build` | string | — | Build number |
| `--debug-id` | string | *(extracted)* | Debug identifier. Auto-extracted from the binary when omitted |
| `--arch` | string | *(extracted)* | CPU architecture; selects a slice of a fat binary. Auto-extracted when omitted |
| `--commit` | string | — | Source commit SHA |
| `--environment` | string | — | Deployment environment |
| `-a, --account` | string | *(active context)* | Account slug to upload under. Env: `SCOUT_ACCOUNT_SLUG` |

## Artifact types

| Type | Resolves | Auto-inferred from filename |
|------|----------|------------------------------|
| `dsym` | iOS / macOS native crashes | `*.dSYM` |
| `dart_symbols` | Flutter Dart AOT frames (`libapp.so`) | `*.symbols` |
| `ndk_symbols` | Android native / NDK and Flutter engine `.so` frames | *(pass `--type`)* |
| `proguard_mapping` | Android Java/Kotlin deobfuscation | `mapping.txt`, `*-mapping.txt` |
| `dart_obfuscation_map` | Flutter obfuscation map | *(pass `--type`)* |
| `js_sourcemap` | JavaScript / web stack traces | `*.map`, `*.js.map` |
| `rn_sourcemap` | React Native stack traces | *(pass `--type`)* |

When the filename doesn't map to one of the patterns above, pass `--type`
explicitly.

## Required information by type

The CLI validates locally before uploading, so you get a fast error instead of a
round trip.

- **`dsym` and `dart_symbols`** are matched by their embedded `debug_id` and
  `arch`. Both are auto-extracted from the binary — pass `--debug-id` / `--arch`
  only to override.
- **All other types** (`ndk_symbols`, `proguard_mapping`, `dart_obfuscation_map`,
  `js_sourcemap`, `rn_sourcemap`) are matched by build coordinates, so `--app`,
  `--version`, `--build`, and `--platform` are required. For `ndk_symbols` the
  `debug_id` / `arch` are additionally auto-extracted from the `.so`.

## Examples

Upload an iOS dSYM — type, platform, debug id, and arch are all auto-detected:

```bash
scout artifacts upload ./Runner.app.dSYM --account my-org
```

Upload Flutter Dart symbols produced by `flutter build --split-debug-info`:

```bash
scout artifacts upload ./build/symbols/app.android-arm64.symbols \
  --type dart_symbols --platform android \
  --app com.example.app --version 2.2.7 --build 236 \
  --account my-org
```

Upload an Android ProGuard / R8 mapping file:

```bash
scout artifacts upload ./app/build/outputs/mapping/release/mapping.txt \
  --platform android \
  --app com.example.app --version 2.2.7 --build 236 \
  --account my-org
```

Upload Android NDK / engine native symbols:

```bash
scout artifacts upload ./arm64-v8a/libflutter.so \
  --type ndk_symbols --platform android \
  --app com.example.app --version 2.2.7 --build 236 \
  --account my-org
```

Use environment variables instead of flags:

```bash
export SCOUT_ACCOUNT_SLUG=my-org
scout artifacts upload ./Runner.app.dSYM
```

## How It Works

Upload is a three-step flow against the Scout API:

1. **Register** — the CLI sends the artifact metadata (type, platform, build,
   `debug_id`/`arch`, SHA-256 checksum, and size) to `POST /api/v1/artifacts` and
   receives a pre-signed upload URL. Registration is idempotent per account and
   checksum: re-uploading identical bytes reports `already uploaded` and skips the
   transfer.
2. **Upload** — the file is streamed directly to object storage via the signed
   URL, with a live progress bar.
3. **Finalize** — `POST /api/v1/artifacts/{id}/finalize` validates the stored
   object's size against what was declared at registration and marks the artifact
   ready for symbolication. The access token is refreshed just before this step
   so a long upload never fails finalization.

:::warning Permission required
Uploading artifacts requires additional permission on your account. If the upload
is denied, ask an administrator to grant your account upload access, then
re-authenticate with `scout login --account <slug> --force`.
:::

:::note Large uploads
Native engine symbols can be large (a `libflutter.so` is often 150 MB+). Uploads
are streamed rather than buffered, show a progress bar, and abort only if the
transfer stalls — there is no fixed overall timeout. The maximum artifact size is
1 GB.
:::

## See Also

- [login](./login.md) — authenticate before uploading
- [Environment Variables](../reference/environment-variables.md) —
  `SCOUT_API_URL`, `SCOUT_ACCOUNT_SLUG`, and related settings
- [Flutter](../../instrument/mobile/flutter.md) — capturing symbolicated mobile
  crash reports
