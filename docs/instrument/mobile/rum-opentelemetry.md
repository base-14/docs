---
title: Sending RUM Data to base14 - OpenTelemetry Integration Guide
sidebar_label: Sending RUM Data (OTel)
sidebar_position: 30
description:
  Data-model reference for sending mobile RUM telemetry to base14 Scout over
  OTLP. Documents every span name, its resource and span attributes, units,
  and the RUM views each one powers.
keywords:
  [
    rum opentelemetry,
    otlp mobile,
    rum data model,
    rum span attributes,
    mobile crash reporting,
    native crash otlp,
    anr instrumentation,
    session timeline,
    base14,
    scout,
  ]
---

# Sending RUM Data to base14

This is a data-model reference for sending mobile
[RUM](../../operate/rum/getting-started.md) telemetry to base14 Scout. Use it
when you build your own instrumentation
(rather than using a prebuilt SDK like
[scout_flutter](./flutter.md)) and need to know exactly which spans and
attributes each RUM view expects.

RUM data is plain OpenTelemetry: every value is a standard resource or span
attribute, so it lines up with any traces and logs you already send to Scout.
Each RUM feature is powered by a span with a specific `span.name` and a
specific set of attributes - get the names and attribute placement right and
the corresponding view populates automatically.

---

:::note Running this in production

Storing and querying these sessions at production volume is what base14 Scout
does. [Check out Scout RUM](https://base14.io/scout/rum).

:::

## Transport

| Setting | Value |
| ------- | ----- |
| **Protocol** | OTLP - traces sent to `.../v1/traces` |
| **Endpoint** | The OTLP URL base14 provides for your account, e.g. `https://rum.<region>.base14.io/<ingest-id>/otlp` |
| **Auth** | `Authorization: Bearer <token>` header (base14 provisions the token) |

---

## Identity and Attribute Placement

Read this section before wiring up any spans - most integration problems come
from putting an attribute on the wrong scope, or letting an identity value
drift between builds.

### `service.name` is fixed

`service.name` is a **resource** attribute and is your app's identity in
base14. Agree the value with base14 and keep it **constant** across builds and
environments. Use `service.version` for build axes and `environment` for
deployment axes - never encode those into `service.name`, or your data
fragments into many "apps".

### `[R]` resource vs `[S]` span

Throughout this guide:

- **`[R]`** marks a **resource** attribute - set once per export on the
  OpenTelemetry `Resource`.
- **`[S]`** marks a **span** attribute - set per span.

Putting a span key on the resource (or vice versa) is the most common reason a
view comes up empty.

### Duration units are not uniform

Most durations are in **seconds**, but app startup is in **milliseconds**.

| Attribute | Unit |
| --------- | ---- |
| `screen.load_time` | seconds |
| `view.time_spent` | seconds |
| `long_task.duration` | seconds |
| `anr.duration` | seconds |
| `app_startup.duration` | **milliseconds** |

:::warning
`app_startup.duration` is the one exception - it is in milliseconds. Sending it
in seconds makes every startup look ~1000x too fast.
:::

---

## Shared Attribute Sets

To avoid repeating the same lists on every span, this guide refers to two
shared sets.

### Standard resource set `[R]`

Unless a span says otherwise, it carries these resource attributes:

```text
service.name, service.version, environment,
os.name, os.version,
device.manufacturer, device.model.name,
network.connection.type
```

Crash-related spans (`error`, `native_crash`, `app_crash`) add:

```text
host.arch, app.version, app.build, app.bundle_id
```

### Standard session identity `[S]`

Unless a span says otherwise, it carries this identity block:

```text
session.id, session.start_time, session.sampled,
session.sample_rate, session.type,
user.id, user.anonymous_id,
screen.name
```

- `session.start_time` - ISO-8601; constant for the session's whole life.
- `user.id` / `user.anonymous_id` - send at least one. The crash **Affected
  Users** panel is populated from these, so set them on crash spans too.

---

## Spans

Each span is recognized by its **exact** `span.name`. All RUM spans use
`SpanKind = Internal`.

### `screen_view`

A screen or route was shown.

- **Resource:** standard set
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `view.id` | Unique id for this view instance |
| `view.loading_type` | `initial_load` or `route_change` |
| `view.is_active` | Whether the view is currently active |
| `view.referrer` | The previous screen/route |

**Powers:** screen list and per-screen stats, session screen counts, active
users.

### `screen_load`

Time to display a screen.

- **Resource:** standard set
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `screen.load_time` | Load time in **seconds** (float) |

**Powers:** average and p95 screen-load time per screen.

### `view_session`

Time spent on a screen. Emit when leaving it.

- **Resource:** standard set
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `view.time_spent` | Time on screen in **seconds** (float) |

**Powers:** average time-spent per screen.

### `long_task`

A main-thread block / jank event.

- **Resource:** standard set
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `long_task.duration` | Block duration in **seconds** |
| `long_task.threshold` | Threshold that classified it, in **seconds** |
| `display.scroll.max_depth` | Max scroll depth reached |
| `display.scroll.max_depth_scroll_top` | Scroll-top at max depth |
| `display.scroll.max_scroll_height` | Max scrollable height |
| `display.scroll.max_scroll_height_time_ms` | Time to reach max height (ms) |

**Powers:** long-task counts per screen; session timeline.

### `http.request`

A network request.

:::warning Span name and dual keys
The span name must be exactly `http.request` (not `http`), or no network data
is recorded. Send **both** keys in each pair below with the **same value** -
different views read different names. Request latency is taken from the span's
own start/end time, so set those correctly.
:::

- **Resource:** standard set
- **Span:** standard identity, plus:

| Attribute(s) | Description |
| ------------ | ----------- |
| `url.full` **and** `http.url` | Full URL (same value in both) |
| `http.request.method` **and** `http.method` | Method (same value in both) |
| `http.response.status_code` **and** `http.status_code` | Status (same value in both) |
| `http.duration_ms` | Latency in ms |
| `http.response.body.size` | Response body size |
| `http.error` | Error flag/message, if the request failed |

**Powers:** network dashboard (top endpoints, error rate, latency
p50/p95/p99); session timeline.

### `app_startup`

A cold or warm start.

- **Resource:** standard set
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `app_startup.type` | `cold` or `warm` |
| `app_startup.duration` | Startup time in **milliseconds** (not seconds) |

**Powers:** average cold/warm start, cold/warm counts.

### `error`

A handled or unhandled error (JS / Dart / app-level). `app_crash` is treated as
the same `javascript` kind as `error` and shares this attribute set (grouped by
`error.message`).

- **Resource:** standard set **+ crash additions**
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `error.message` | Title and grouping key - keep it **stable** (no timestamps/ids) |
| `error.type` | Error type/class |
| `error.stack_trace` | Full stack trace |
| `error.handled` | Whether the error was caught |
| `error.library` | Library/framework that raised it |
| `breadcrumbs` | JSON array of `{time, type, message}` |
| `dart.build_id` | Dart build id (for symbol resolution) |

**Powers:** crash list, crash detail, crash-free rate, per-user error counts.

### `native_crash`

A native crash (signal / Mach / exit-info / JVM). Grouped and addressed by
`(crash.type, crash.reason)`.

- **Resource:** standard set **+ crash additions**
- **Span:** standard identity, plus the crash keys and detail below.

**Crash keys (grouping):**

| Attribute | Description |
| --------- | ----------- |
| `crash.type` | Grouping key |
| `crash.reason` | Grouping key / title |
| `crash.stack_trace` | Native stack trace |

**Crash detail** (send what the platform provides):

| Group | Attributes |
| ----- | ---------- |
| Report / identity | `crash.timestamp`, `crash.report_id`, `crash.last_screen`, `crash.previous_session_id`, `crash.started_at`, `crash.status`, `crash.error_type`, `crash.subreason` |
| Signal / Mach (Apple) | `crash.signal`, `crash.signal_code`, `crash.signal_address`, `crash.mach_exception`, `crash.mach_code`, `crash.mach_subcode`, `crash.nsexception_name`, `crash.exception_type`, `crash.exception_code`, `crash.cpp_exception_name`, `crash.fault_address_register`, `crash.exception_syndrome_register`, `crash.os_reason_code`, `crash.os_reason_name` |
| Thread / process | `crash.thread`, `crash.thread_name`, `crash.process_name`, `crash.queue`, `crash.pid`, `crash.tid`, `crash.uid`, `crash.ppid`, `crash.process_uptime_secs`, `crash.importance` |
| Memory | `crash.pss_kb`, `crash.rss_kb`, `crash.hang_duration_ms` |
| Device / OS / build | `crash.cpu_arch`, `crash.machine`, `crash.os_name`, `crash.os_version`, `crash.kernel_version`, `crash.kernel`, `crash.device_model`, `crash.abi`, `crash.build_fingerprint`, `crash.build_type`, `crash.region_format` |
| App version | `crash.app_version`, `crash.application_version`, `crash.application_build_version`, `crash.bundle_id` |
| Android exit-info | `crash.exit_status`, `crash.death_timestamp_ms` |
| Heavy blobs (raw JSON / text) | `crash.tombstone`, `crash.binary_images_json`, `crash.registers_json`, `crash.callstack_tree_json`, `crash.memory_map`, `crash.registers` |
| Breadcrumbs | `breadcrumbs` - JSON array of `{time, type, message}` |

**Powers:** native crash list and detail, crash-free rate, affected
devices/users, frequency over time, top crashing screens, post-crash recovery
flag.

### `app_crash`

An app-level crash. Handled together with `error` (the `javascript` crash
kind), grouped by `error.message`.

- **Resource:** standard set **+ crash additions**
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `error.message` | Title and grouping key - keep it **stable** |
| `crash.type` | Crash type |
| `crash.last_screen` | Screen active when the crash occurred |

### `anr`

Application Not Responding (Android). Grouped and scoped by `screen.name`.

- **Resource:** standard set
- **Span:** standard identity, plus:

| Attribute | Description |
| --------- | ----------- |
| `anr.duration` | ANR duration in **seconds** |
| `anr.threshold` | Threshold that classified it, in **seconds** |
| `anr.main_thread_stack` | Main-thread stack at the freeze |
| `anr.thread_count` | Number of threads captured |
| `anr.threads_json` | All-threads dump (JSON) |

**Powers:** ANR list/detail, ANR duration by app-version/OS/device.

### `user_interaction`

A tap/click, for the session timeline.

- **Resource:** `service.name`, `environment`, `os.name`, `device.model.name`
- **Span:** `session.id`, `session.start_time`, `user.id`,
  `user.anonymous_id`, `screen.name`, plus:

| Attribute | Description |
| --------- | ----------- |
| `user_interaction.target` | Tapped element's label (mobile) |
| `user_interaction.target.type` | Element type |
| `target_element` | Tapped element (web) |
| `target_xpath` | Element xpath (web) |
| `user_interaction.type` | e.g. `tap` |
| `user_interaction.target.name_source` | Source of the target's name |
| `user_interaction.target.permanent_id` | Stable element id |
| `user_interaction.target.x` / `.y` | Tap coordinates |
| `user_interaction.id` | Unique id for the interaction |

**Powers:** session timeline (tap events).

### `app_vital`

FBC / interaction-to-next-view vitals, for the session timeline.

- **Resource:** `service.name`, `environment`, `os.name`
- **Span:** `session.id`, `session.start_time`, `user.id`,
  `user.anonymous_id`, `screen.name`, plus:

| Attribute | Description |
| --------- | ----------- |
| `vital.name` | e.g. `fbc`, `inv` |
| `vital.type` | `startup` or `navigation` |
| `vital.duration_ms` | Duration in ms |
| `vital.from_screen` | Source screen |
| `vital.to_screen` | Destination screen |

**Powers:** session timeline (vitals).

### `frozen_frame`

A frozen frame, for the session timeline.

- **Span:** `session.id`, `session.start_time`, `user.id`,
  `user.anonymous_id`, `screen.name`, plus:

| Attribute | Description |
| --------- | ----------- |
| `frozen_frame.duration` | Frozen-frame duration |

**Powers:** session timeline.

### `web_vital`

Core Web Vitals (web), for the session timeline.

- **Span:** `session.id`, `session.start_time`, `user.id`,
  `user.anonymous_id`, plus:

| Attribute | Description |
| --------- | ----------- |
| `web.vital.name` | Vital name (e.g. LCP, CLS) |
| `web.vital.value` | Measured value |
| `web.vital.rating` | Rating bucket (good / needs-improvement / poor) |

**Powers:** session timeline.

---

## Minimum Viable Payload

To get RUM working with the smallest possible surface:

**On every export (resource):**

```text
service.name, environment, service.version,
os.name, os.version,
device.model.name, device.manufacturer,
network.connection.type
```

**On every span:**

```text
session.id, session.start_time, session.sampled
user.id or user.anonymous_id
```

Mirror the user identity onto crash spans so **Affected Users** counts work.

**Emit at least these spans:**

- `screen_view` - with `screen.name`
- `app_startup` - with `app_startup.type` and `app_startup.duration` (ms)
- `http.request` - with span duration set and the HTTP key pairs from
  [`http.request`](#httprequest)
- `error` and/or `native_crash` - with a stable `error.message` /
  `crash.reason`

Add `screen_load`, `view_session`, `long_task`, and `anr` for full
screen-performance and stability coverage.

---

## Common Mistakes

| Symptom | Cause and fix |
| ------- | ------------- |
| Data fragments into many "apps" | A changing `service.name` per build/env. Keep it fixed; use `environment` / `service.version` for those axes. |
| A view is empty | Resource keys on the span, or span keys on the resource. `service.version` / `os.*` / `device.*` are `[R]`; `session.*` / `user.*` / `screen.name` / per-span fields are `[S]`. |
| Crash **Affected Users** empty | The panel reads `user.id` / `user.anonymous_id`. Set them on crash spans too. |
| Every startup looks ~1000x too fast | `app_startup.duration` sent in seconds - it must be **milliseconds**. |
| No network data / partial network views | Only one HTTP naming convention sent. Send both `url.full` + `http.url`, `http.request.method` + `http.method`, `http.response.status_code` + `http.status_code`, and set the span's own duration. |
| Crashes don't group (one row each) | Unstable `error.message` / `crash.reason` containing timestamps or ids. Keep titles stable. |
| No network data at all | Span named `http` instead of `http.request`. |
| Session never registers | Missing or unparseable `session.start_time`. Send valid ISO-8601. |

---

## Related Guides

- [RUM Overview](../../operate/rum/overview.md) - the product these spans power
- [Instrument a Flutter app](./flutter.md) - a prebuilt SDK that emits all of
  the above
- [Sessions](../../operate/rum/sessions.md) - how session-timeline spans render
- [Crashes](../../operate/rum/crashes.md) - how crash spans render
