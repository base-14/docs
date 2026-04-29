---
slug: android-mobile-observability-opentelemetry
title: "Android Mobile Observability with OpenTelemetry"
description: "A deep walkthrough of the OpenTelemetry Android Agent: the production failure modes it catches (ANRs, jank, crashes, network, cold start, funnels), how to wire it up, and how to ship the data to a collector you control."
authors: [ranjan-sakalley]
tags: [android, opentelemetry, mobile, rum, observability, kotlin, scout]
unlisted: false
date: 2026-04-29
---

A user opens a ticket: "the app froze when I tried to upload a photo." They
were on the metro, on cellular, on a Samsung Galaxy A54 running Android 13.
You're on a Pixel 8 on office Wi-Fi and the upload completes in 400 ms every
time you try it. Crashlytics says "no crash logged." Play Console ANR rate
looks normal. Was it the network? A frozen frame that swallowed the tap? A
backend timeout? An OOM kill on a device with 4 GB of RAM and a busy launcher?

You can't tell. None of the tools you have were built to answer that question.

This is the gap OpenTelemetry fills on Android. Backend services have had
distributed tracing for a decade. The mobile app, the thing the user actually
touches, gets crash reports and a five-row Play Console dashboard. We've
spent the last year helping teams close that gap with the OpenTelemetry
Android Agent, and this post is a deep walkthrough of what it solves, how to
wire it up, and how to ship the data to a collector you control.

<!--truncate-->

## What local profiling does and doesn't see

Android Studio Profiler is a great tool. It catches main-thread blocks,
memory leaks, GPU overdraw, and excessive CPU usage on the device sitting on
your desk. If your bug reproduces locally, it's probably the right place to
look.

It does not catch:

- The Galaxy A54 on a degraded LTE cell in Mumbai during peak hours.
- The crash that fires only on Android 13 with a specific OEM's WebView build.
- The image-upload that succeeds at 200 KB and times out at 4 MB on cellular.
- The user who navigates Cart → Checkout → back → Cart → Checkout fifteen
  times in twenty seconds because the "Place Order" button looks disabled
  when it isn't.
- The ANR that fires on cold start because a third-party SDK is doing disk
  I/O in its `Application.attachBaseContext()`.

These problems share two properties: they happen on hardware and networks
you don't have, and they show up in shapes you didn't predict. Production
telemetry is the only way to see them at scale.

## Why mobile observability is different

You can't take a backend tracing setup and bolt it onto an Android app. The
constraints are fundamentally different.

**Battery.** Telemetry export burns power. Every wakeup, every radio cycle,
every gzip pass costs milliamp-hours. A naive instrumentation that exports a
span per UI event will tank your battery review scores faster than any
feature regression. You need batching, compression, and sampling that respect
the device.

**Unreliable connectivity.** A backend service can assume the network is
there. A phone in an elevator cannot. Spans need to buffer locally, retry on
backoff, and survive an offline period that might last hours.

**Background kills.** The OS can SIGKILL your process at any moment to
reclaim memory. If your in-memory span buffer hasn't flushed to disk, those
spans are gone. The instrumentation has to treat process death as a normal
event, not an exception.

**Release cycles.** You can't hot-fix a mobile app. A bad instrumentation
build ships to the Play Store and stays there until the next review cycle.
Anything you wire in needs to fail safely. A broken collector endpoint must
never crash the app or block the UI thread.

These constraints shape the OpenTelemetry Android SDK in ways that are worth
understanding before you start adding code.

## Setting it up

The OpenTelemetry Android Agent (v1.3.0 at the time of writing) is built on
top of the OpenTelemetry Java SDK and packages the mobile-specific
instrumentations as a single artifact. Add the BOM and the agent to your app
module:

```kotlin
// app/build.gradle.kts
dependencies {
    // Only `android-agent`, `agent-api`, and `session` are stable in the
    // 1.3 line; the BOM and instrumentation modules are still alpha.
    implementation(platform("io.opentelemetry.android:opentelemetry-android-bom:1.3.0-alpha"))
    implementation("io.opentelemetry.android:android-agent")

    // Most apps will want OkHttp tracing. It lives under the
    // `instrumentation` group id.
    implementation("io.opentelemetry.android.instrumentation:okhttp3-library")

    // For DEPLOYMENT_ENVIRONMENT_NAME and other incubating semconv constants.
    implementation("io.opentelemetry.semconv:opentelemetry-semconv-incubating")
}
```

Initialize the agent in your `Application.onCreate()`. This is the only
wiring most apps need for the auto-instrumentations to start firing:

```kotlin
class ShopApp : Application() {
    lateinit var rum: OpenTelemetryRum
        private set

    override fun onCreate() {
        super.onCreate()
        rum = OpenTelemetryRumInitializer.initialize(
            context = this,
            configuration = {
                httpExport {
                    // Scout exposes a standard OTLP/HTTP endpoint. Any OTLP-compliant
                    // backend works the same way.
                    baseUrl = BuildConfig.OTLP_ENDPOINT
                    baseHeaders = mapOf(
                        "Authorization" to "Bearer ${BuildConfig.OTLP_TOKEN}"
                    )
                }
                globalAttributes {
                    Attributes.builder()
                        .put(ServiceAttributes.SERVICE_NAME, "shopapp-android")
                        .put(ServiceAttributes.SERVICE_VERSION, BuildConfig.VERSION_NAME)
                        .put(
                            DeploymentIncubatingAttributes.DEPLOYMENT_ENVIRONMENT_NAME,
                            BuildConfig.BUILD_TYPE
                        )
                        .build()
                }
                session {
                    backgroundInactivityTimeout = 15.minutes
                    maxLifetime = 4.hours
                }
                // All instrumentations are enabled by default. Disable selectively if needed:
                // instrumentations { slowRenderingReporter { enabled(false) } }
            }
        )
    }
}
```

A few things worth calling out:

- **You don't need to populate device or OS attributes manually.** The agent
  attaches `device.model.identifier`, `device.model.name`,
  `device.manufacturer`, `os.type`, and `os.version` to every span as
  resource attributes, following the Android semantic conventions. The
  CNCF/Embrace post showed how to do this by hand with `Build.MODEL`, which
  is still valid for the direct-SDK path we'll cover later. With the agent,
  it's automatic.
- **Disk persistence is on by default.** Spans buffer to local storage when
  the network is unavailable and ship on the next successful export. You
  don't lose data when the user goes underground on the train.
- **Batched export is on by default.** Spans accumulate in memory and flush
  in batches over HTTP/protobuf, gzip-compressed. The default settings are
  tuned for mobile battery profiles.
- **The session abstraction matters.** Every span is tagged with a
  `session.id`, which resets after `backgroundInactivityTimeout` of
  inactivity or after `maxLifetime` regardless. This is what lets you
  reconstruct "what did this user do in this app open" rather than just
  "what spans happened around this timestamp."

For local development against an emulator, point `baseUrl` at
`http://10.0.2.2:4318` to reach a collector running on your dev machine. The
OpenTelemetry Collector is the easiest way to inspect what your app is
actually sending before it goes to a real backend.

With this in place, the auto-instrumentations are already running. The next
six sections walk through the production failure modes they catch.

## 1. ANRs and jank

The single most common Android complaint is "the app froze." Two distinct
problems fall under that umbrella.

**ANRs (Application Not Responding)** fire when the main thread is blocked
for five seconds or more. The OS shows the user a "wait or close" dialog.
ANRs are catastrophic. Play Store visibility takes a hit if your ANR rate
crosses 0.47% (Google's "bad behavior" threshold). Most ANRs come from disk
I/O, network calls, or `synchronized` blocks that run on the UI thread under
conditions you didn't test for.

**Jank** is sub-ANR. A frame that takes longer than 16 ms to render misses
the 60 Hz vsync deadline and produces a visible stutter. Frames over 700 ms
are "frozen", and the user perceives the app as unresponsive even though the
OS hasn't fired an ANR yet.

The Android Agent ships built-in instrumentations for both:

- **ANR detection** uses a watchdog that posts a sentinel runnable to the
  main thread every few seconds. If the runnable doesn't execute within the
  timeout, the agent captures the main thread's stack trace and emits a
  **log event** named `device.anr` with `exception.stacktrace`, `thread.id`,
  and `thread.name`.
- **Slow rendering** monitors frame timings via the
  `Window.OnFrameMetricsAvailableListener` API. The agent emits two **spans**
  per activity window, `slowRenders` (frames over 16 ms) and `frozenRenders`
  (frames over 700 ms), each carrying a `count` attribute and the
  `activity.name`. A parallel **log event** named `app.jank` carries the
  same data with `app.jank.frame_count`, `app.jank.period`, and
  `app.jank.threshold` attributes.

Once the agent is initialized, the spans and events appear in your backend,
scoped to the session and activity where they happened. The work that's
left is writing queries (the syntax below is illustrative pseudo-DSL; adapt
it to whatever your backend exposes, whether that's PromQL, LogQL, SQL over
OTLP, or a vendor UI):

```text
# Top activities by ANR count, last 24h
events{name="device.anr"} | by(activity.name) | count

# p99 frozen-frame count, by app version
spans{name="frozenRenders"} | by(service.version) | quantile(0.99, count)

# ANRs correlated to a specific OS version
events{name="device.anr"} | by(os.version) | count
```

The ANR-by-OS-version query is the one that catches third-party SDK
regressions. We've seen teams discover an ANR cluster on Android 13 that
traced back to a payment SDK doing a synchronous network call in its
lifecycle observer, invisible locally on Android 14, deadly on a device that
exercised a different code path.

## 2. Crashes and device-specific bugs

Crash reporting tools have existed forever. What OpenTelemetry gives you
that the typical crash reporter doesn't is **full session context**: every
span the user generated leading up to the crash, in the same data store,
queryable with the same tools you use for everything else.

The agent's crash instrumentation hooks `Thread.UncaughtExceptionHandler`
and emits a **log event** named `device.crash` with `exception.type`,
`exception.message`, `exception.stacktrace`, and `thread.*` attributes
before the process exits. The disk persistence layer ensures the event is
written before the JVM dies, so you don't lose the last twenty seconds of
telemetry on the way out.

Combined with the device entity attributes the agent attaches automatically,
you can answer questions like "is this crash device-specific" without
leaving the trace UI:

```text
# Crashes per million sessions, by device model and OS version
events{name="device.crash"}
  | by(device.model.name, os.version)
  | rate
```

The pattern that surfaces every time we run this on a customer's data is
the same: 80% of crashes come from 20% of devices. Often it's a single OEM
whose Android skin has a quirk in how it handles a deprecated API, or a
specific RAM tier where your app's memory footprint crosses the OS's killer
threshold under load.

To get the **breadcrumb trail** (the last N user actions before the crash),
you don't need a custom processor. Every span and event the agent emits
carries `session.id`. The `device.crash` event carries the same `session.id`
as every span the user generated in that app open. Reconstruct the trail at
query time:

```text
# All spans in the session that crashed, in order
session_id = events{name="device.crash"} | last | get(session.id)
spans{session.id == session_id} | sort(start_time) | select(name, start_time, attributes)
```

The agent already gives you what a hand-rolled breadcrumb buffer would,
without any extra code or processor SPI work. If you want a pre-flattened
breadcrumb attribute on the crash event itself, that's possible via a custom
`LogRecordProcessor`. The agent DSL in v1.3.0 does not expose a hook for
registering one. You'd have to drop down to the internal
`OpenTelemetryRumBuilder` API, which the upstream library documents as
unstable. For most teams, session-id correlation at query time is the
simpler, more durable answer.

## 3. Network latency and failures

Backends test against optimistic networks. Real users are on cellular at the
back of a coffee shop. The variance is enormous: a request that p50s at
200 ms in your tests will p99 at 8 seconds in production, with a long tail
of 30-second timeouts on degraded connections.

Wrap your OkHttp client with `OkHttpTelemetry`:

```kotlin
val baseClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()

val tracedCallFactory = OkHttpTelemetry.builder(rum.openTelemetry)
    .build()
    .createCallFactory(baseClient)

// Use tracedCallFactory wherever you'd use baseClient.newCall(...)
```

Every HTTP request now produces a span with the standard `http.*`
attributes: `http.request.method`, `url.full`, `http.response.status_code`,
`http.request.duration`. The agent's network-change instrumentation
correlates each request with the active connection type at the time, adding
`network.connection.type` (wifi / cellular / unavailable) and
`network.connection.subtype` (lte, nr, etc.).

For the image upload from the opening anecdote, you'd add a parent span
around the upload flow and attach the request size and any business
attributes you care about:

```kotlin
suspend fun uploadProductImage(image: ByteArray, productId: String) {
    val tracer = rum.openTelemetry.getTracer("com.shopapp.uploads")
    val span = tracer.spanBuilder("upload.product_image")
        .setAttribute(HttpAttributes.HTTP_REQUEST_BODY_SIZE, image.size.toLong())
        .setAttribute(stringKey("product.id"), productId)
        .startSpan()

    try {
        span.makeCurrent().use {
            uploadService.upload(image, productId)  // OkHttp call inside, gets a child span
        }
    } catch (e: Exception) {
        span.recordException(e)
        span.setStatus(StatusCode.ERROR, e.message ?: "upload failed")
        throw e
    } finally {
        span.end()
    }
}
```

The trace you get is a parent `upload.product_image` span with the OkHttp
child span nested underneath, both tagged with the device's connection type
and the user's session ID. Now you can answer the question that tickets
like the opening anecdote demand:

```text
# p99 upload latency, by image size bucket and connection type
spans{name="upload.product_image"}
  | bucket(http.request.body.size, [100KB, 500KB, 1MB, 5MB])
  | by(network.connection.type)
  | quantile(0.99, duration)
```

When the answer is "p99 is 22 seconds for >2 MB uploads on cellular," the
fix is a client-side resize before upload, not more retries.

## 4. Backend trace correlation (W3C propagation)

This is the one that unlocks the most engineering value if your backend is
already instrumented, and the one most teams miss when they roll mobile
observability themselves.

A mobile span and the backend span it triggered are two disconnected events
unless you propagate trace context across the network boundary. With
propagation, a single trace shows the user's tap, the OkHttp call, the
backend HTTP handler, the downstream services it called, and the database
query, all stitched together by a shared `trace_id`. Skip propagation and
the two stay disconnected at the trace level, which means no way to join
mobile and backend spans in a debugging session.

`OkHttpTelemetry` injects the W3C `traceparent` header on every outgoing
request automatically, using the standard `W3CTraceContextPropagator`. If
your backend uses OpenTelemetry too (Java agent, Python auto-instrumentation,
Go SDK, anything compliant), the backend service picks up the `traceparent`
header and continues the trace.

There's no code to write here, only a verification step:

1. Trigger a known user action (say, a product fetch) from the app.
2. Find the resulting span in your backend.
3. Find the matching span in your mobile telemetry.
4. Confirm the `trace_id` is identical.

If steps 3 and 4 work, you've connected mobile to backend. The first time
you do this on a real codebase, you'll find traces where the backend p50 is
80 ms and the user-perceived latency is 2.4 seconds. The 2.3-second gap is
yours: TLS handshake, DNS, slow-start, JSON parsing, RecyclerView re-bind.
The backend has no view of any of those phases. The mobile agent captures
them in spans you can join to the same `trace_id`.

For services that aren't yet instrumented with OpenTelemetry, the same
`traceparent` header flows in HTTP request logs. Even without backend
tracing, you can grep for the trace ID in Nginx access logs and tie a user
complaint to a specific upstream request.

## 5. Cold start and startup

Cold start is the time from process creation to the first frame the user
sees. Long cold starts are the most common reason for users to bounce on
the first session, and they're brutally device-dependent. Your Pixel 8
cold-starts in 400 ms; a four-year-old budget device on a cluttered home
screen takes 4 seconds for the same APK.

The agent's activity instrumentation emits an `AppStart` span when the first
activity launches, covering process start through the first drawn frame.
The span carries `start.type` (`cold` / `warm` / `hot`) so you can separate
the three regimes.

This is one of the most useful ratios to watch over time:

```text
# p95 cold-start duration, by device tier and app version
spans{name="AppStart", start.type="cold"}
  | by(service.version, device.model.name)
  | quantile(0.95, duration)
```

Compare a release to its predecessor. A regression of 200 ms in p95 cold
start is invisible to Crashlytics and Play Console, and it lands directly
on Day-1 retention. Catch it before the rollout finishes and you save a
release.

If you want to break cold start down further (Application init,
first-Activity `onCreate`, first frame draw), wrap each phase in its own
child span:

```kotlin
class ShopApp : Application() {
    override fun onCreate() {
        val tracer = rum.openTelemetry.getTracer("com.shopapp.startup")
        val span = tracer.spanBuilder("app.init").startSpan()
        try {
            super.onCreate()
            initializeAnalytics()
            initializeFeatureFlags()
            initializeImageLoader()
        } finally {
            span.end()
        }
    }
}
```

Now you can see which init step is the slow one. We've seen apps where 60%
of cold start was a single feature-flag library doing a synchronous network
call before letting the `Application` constructor return. That kind of
finding takes a debugger session to track down without telemetry. With the
agent in place, a one-line query catches it.

## 6. Unexpected user behavior and funnels

Real users do things you didn't test for. They tap rapidly. They navigate
in circles. They upload 12 MB photos to a form expecting thumbnails. They
background the app mid-checkout and come back forty minutes later expecting
their cart to be intact.

Some of this is captured automatically. The Activity and Fragment lifecycle
instrumentations bundled in `android-agent` emit a span for every screen
entry and exit. Combined with the session ID, you can replay any session as
a sequence of spans without writing per-screen instrumentation. View-click
instrumentation is available as a separate module,
`io.opentelemetry.android.instrumentation:view-click-library`, and adds a
span for every `View.OnClickListener` invocation. It's not bundled in
`android-agent` by default; opt in if you want it.

Where you do want manual instrumentation is at the **business-logic
boundary**: the points in the app where you care about conversion. A
four-step checkout funnel might look like:

```kotlin
class CheckoutTracker(private val tracer: Tracer) {
    private var checkoutSpan: Span? = null

    fun startCheckout(cartTotal: Long, itemCount: Int) {
        checkoutSpan = tracer.spanBuilder("checkout.flow")
            .setAttribute(longKey("cart.total_minor"), cartTotal)
            .setAttribute(longKey("cart.item_count"), itemCount.toLong())
            .startSpan()
    }

    fun completeStep(step: String) {
        checkoutSpan?.addEvent("checkout.step.completed", Attributes.of(
            stringKey("checkout.step"), step
        ))
    }

    fun abandon(reason: String) {
        checkoutSpan?.setAttribute("checkout.outcome", "abandoned")
        checkoutSpan?.setAttribute("checkout.abandon_reason", reason)
        checkoutSpan?.end()
        checkoutSpan = null
    }

    fun complete(orderId: String) {
        checkoutSpan?.setAttribute("checkout.outcome", "completed")
        checkoutSpan?.setAttribute("order.id", orderId)
        checkoutSpan?.end()
        checkoutSpan = null
    }
}
```

The single `checkout.flow` span carries the whole journey, with span events
marking each step. Funnel analysis becomes a query against the events:

```text
# Checkout drop-off, by step
spans{name="checkout.flow"}
  | events
  | by(checkout.step)
  | count

# Abandonment correlated to upstream signals
spans{name="checkout.flow", checkout.outcome="abandoned"}
  | by(network.connection.type, device.model.name)
  | count
```

The second query is the one that catches the long-tail issues. We've seen
abandonment clusters on specific devices that turned out to be a payment-SDK
rendering bug on a non-standard screen aspect ratio. The "Pay" button was
being clipped offscreen on devices with notched displays. It took a funnel
query to surface it, and that took about a day from the first abandonment
cluster on those devices.

## Two paths: agent or direct SDK

Everything above uses the OpenTelemetry Android Agent, the high-level
package that bundles auto-instrumentation, the RUM session model, batched
export, and disk persistence into a single dependency. It's the right
starting point for almost every team.

The alternative is the direct OpenTelemetry Java SDK, which is what the
original CNCF post on this topic used. You manage the `TracerProvider`, the
`Resource`, the exporters, and every span yourself. It's more code, more to
get right, and you give up the auto-instrumentations unless you replicate
them. The trade-off is full control: you decide exactly what's exported,
when, and at what resolution.

| | Android Agent | Direct SDK |
|---|---|---|
| Activity / Fragment lifecycle spans | Automatic | Manual |
| ANR detection | Automatic | Manual (you write the watchdog) |
| Crash reporting | Automatic | Manual (`Thread.UncaughtExceptionHandler`) |
| Slow / frozen frame detection | Automatic | Not included |
| Cold-start measurement | Automatic | Manual |
| Network change detection | Automatic | Manual |
| Device / OS resource attributes | Automatic | Manual (`Build.MODEL`, `Build.VERSION.SDK_INT`) |
| Session management | Automatic | Manual |
| Disk persistence (offline buffer) | Automatic | Manual (you implement the storage) |
| Batched OTLP export | Automatic | Manual |
| W3C trace context propagation | Automatic via OkHttp wrapper | Manual via `W3CTraceContextPropagator` |
| Custom spans and events | Supported | Supported |
| Best for | Production apps that want RUM out of the box | Niche cases: embedded SDKs, custom batching, library authors |

If you're building an SDK that other apps will embed, the direct path makes
sense. You don't want to fight another team's `OpenTelemetryRum` instance.
For everything else, start with the agent and drop down to the direct API
where you need fine control.

## Production considerations

A few things worth getting right before you ship to all users.

**Sampling.** The agent batches and compresses, but high-volume signals
(jank events on a budget phone can fire dozens of times per second) will
still cost bandwidth and ingest. Apply head-based sampling at the SDK level
for high-cardinality signals, and consider tail-based sampling at your
collector for traces. Keep 100% of traces with errors or slow spans, sample
the rest at 1-10%.

**Attribute redaction.** Mobile data is regulated more tightly than backend
telemetry. GDPR, CCPA, and platform store policies all matter. The cleanest
place to redact is in the OpenTelemetry Collector between your app and your
backend: an `attributes` / `transform` processor can scrub query strings,
auth headers, and free-form text fields before the data is persisted. Doing
it on-device is also possible, but the v1.3.0 agent DSL has no public hook
for registering a `SpanProcessor`. You'd have to use the internal
`OpenTelemetryRumBuilder` API, which is documented as unstable.
Collector-side redaction is what we recommend for now.

**Don't put PII in span names.** Span names are high-cardinality identifiers
and end up in indexes and dashboards. `GET /users/12345/orders` becomes a
million distinct names; `GET /users/{id}/orders` becomes one. The OkHttp
wrapper handles this for HTTP routes; for custom spans, parameterize names
yourself.

**Monitor your collector.** If your OTLP endpoint goes down, the agent's
disk buffer will keep filling (that's the safe failure mode), but eventually
it'll hit the buffer cap and start dropping. Alert on collector ingest rate
dropping to zero, and on agent-side export failures (exposed via the SDK's
self-diagnostic logs in debug builds).

**Test cold-start overhead.** The agent adds work to your
`Application.onCreate`. Measure it. On low-end devices, a few hundred
milliseconds matters. The default config is mobile-tuned, but if you wire
in custom processors, benchmark them.

## Start today

Every backend service in your stack gets distributed tracing. Most mobile
apps still ship with crash reports, an analytics SDK, and a vague hope. The
constraints that made mobile observability hard (battery, connectivity,
background kills, release cycles) are no longer unsolved problems. The
OpenTelemetry Android Agent handles them in the default configuration, and
the data it produces is OTLP-standard, which means it works with any
compliant backend.

If you've already invested in OpenTelemetry on the server, adding it to
your Android app is the highest-leverage observability work you can do this
quarter. The traces stitch together into a single picture of the user
experience, and the questions you've been guessing at, like "why does this
user complain about freezes when our metrics look fine", start having
actual answers.

Start with the agent, point it at your collector, and ship. The rest is
queries.

---

*If you're building an android app, the [Scout Android
quickstart](https://docs.base14.io/) walks through the OTLP endpoint and
ingest token setup in detail. If you're sending it somewhere else, the
configuration is the same. Change the `baseUrl` and the auth header, and
you're done.*
