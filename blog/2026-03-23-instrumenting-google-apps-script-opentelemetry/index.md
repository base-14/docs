---
slug: instrumenting-google-apps-script-opentelemetry
date: 2026-03-23
title: "Instrumenting Google Apps Script with OpenTelemetry"
description: "Google Apps Script has no native observability. Here's how we built a lightweight OTLP SDK to export traces, logs, and metrics from serverless Apps Script functions — without npm, modules, or async."
authors: [nimisha-gj]
tags: [observability, opentelemetry, google-apps-script, instrumentation, serverless, otlp, google-workspace, traces, metrics, logs]
unlisted: true
---

Google Apps Script powers a surprising amount of business infrastructure.
Approval workflows, hiring pipelines, invoice generators, CRM integrations
— all running as serverless functions triggered by form submissions, chat
messages, or time-based triggers. When something breaks, you get a
stacktrace in the Apps Script logs and nothing else. No traces, no
metrics, no correlation between the email that failed and the spreadsheet
write that succeeded two seconds earlier. You're debugging with
`Logger.log` and guesswork.

We run a hiring automation bot on Apps Script that touches Gmail, Sheets,
Drive, Calendar, GitHub, and Google Chat in a single command invocation.
When a candidate's assignment email silently failed to send, we had no
way to tell whether the issue was the template fetch, the Gmail API, or
the spreadsheet update that stores the thread ID. The execution log just
said "success." This is the story of how we instrumented it with
OpenTelemetry.

<!--truncate-->

## The Problem with Apps Script Observability

Apps Script's built-in logging is `Logger.log` — a flat text stream that
disappears after execution. There's Stackdriver logging if you enable it,
but it gives you unstructured output with no request correlation. When
your script calls six Google APIs in sequence, you can't tell which one
took 4 seconds and which one threw a transient error that was silently
caught.

The standard OpenTelemetry JS SDK won't help either. It assumes a Node.js
or browser environment with ES modules, async I/O, and a persistent
process. Apps Script has none of that:

| Constraint | Impact |
|-----------|--------|
| No ES modules | Can't `import` the OTel SDK. Must use IIFE pattern with `var`. |
| No async/await | Strictly synchronous. No Promises, no event loop. |
| No npm | Can't install packages. SDK must be written from scratch. |
| No persistent process | Each invocation starts fresh. No background batching. |
| 6-minute execution limit | Long-running retries will kill your function. |

The protocol, however, is just HTTP + JSON. If you can construct the
right payload and make an HTTP POST, you can speak OTLP.

## How We Built It

### The Lifecycle: Init, Collect, Flush

Every time someone sends a command to our bot, Apps Script spins up,
runs the function, and shuts down. There's no long-running server keeping
state in memory. So the telemetry SDK follows the same lifecycle:

1. **Init** — at the start of each invocation, generate a fresh trace ID
   and clear any leftover state. Think of it as opening a new blank page
   in a logbook.
2. **Collect** — as the bot does its work (looking up a candidate in
   Sheets, fetching an email template, sending a Gmail), each step
   records a "span" — a named block with a start time, end time, and
   metadata like who the email was sent to. Logs are also collected and
   tagged with which span produced them.
3. **Flush** — once the bot is done, everything collected gets sent to
   the observability backend in one shot. Three HTTP requests fired in
   parallel: one for traces, one for logs, one for metrics.

That's it. No background threads, no periodic batching, no queues. The
entire SDK is under 300 lines.

### Tracking Parent-Child Relationships

When our bot handles a "send assignment" command, it does several things
in sequence: look up the candidate, fetch the email template, fill in
placeholders, send the email, update the spreadsheet. Each of these is
a span, and they all happen inside the main "handle command" span.

In most programming environments, keeping track of which span is the
"parent" of which is surprisingly tricky — you need special libraries
to pass context through async code. Apps Script sidesteps this entirely
because everything runs one step at a time, in order. We use a simple
list as a stack: when a new span starts, it looks at the top of the
stack to find its parent. When it ends, it gets removed. Because
nothing runs in parallel, the stack always tells the truth.

The result in your observability dashboard is a clean tree:

```text
bot.on_message (3200ms)
├── sheet.find_by_name (45ms)
├── template.get (120ms)
├── email.send (890ms)         ← this is why it was slow
└── sheet.update_candidate (60ms)
```

You can immediately see that the email send took 890ms while everything
else was fast. No digging through logs.

### Sending Data Without Breaking Things

The most important rule: **telemetry must never break the application.**
If the observability backend is down, if the auth token expired, if the
payload is malformed — the bot should still send the email and update
the spreadsheet. The user doesn't care about traces.

We enforce this with two safeguards:

- Every HTTP request to the backend is configured to swallow errors
  silently. A failed export is dropped, not retried.
- The entire flush step is wrapped in a catch-all. Any exception —
  serialization failure, network timeout, anything — is silently
  consumed.

For performance, we use `UrlFetchApp.fetchAll` to fire all three
requests (traces, logs, metrics) in parallel. This keeps the overhead
to roughly one network round-trip, typically under 200ms.

### Authentication

Our OTLP endpoint requires an OAuth2 token. Fetching a new token on
every invocation would add 200-400ms of latency.

Apps Script has a built-in `CacheService` that persists data across
invocations for up to 6 hours. We cache the token there with a TTL
slightly shorter than its actual expiry. Most invocations hit the cache
and skip the token fetch entirely. If the cache is evicted, the next
invocation re-authenticates automatically — one extra HTTP call, not a
failure.

## What Instrumentation Looks Like in Practice

Adding observability to a service is straightforward. Wrap the operation,
record what happened, and mark success or failure:

```javascript
function sendEmail(to, subject, body) {
  var span = Telemetry.startSpan('email.send', {
    'email.to': to, 'email.subject': subject
  });
  try {
    GmailApp.sendEmail(to, subject, body);
    Telemetry.endSpan(span);
    return { success: true };
  } catch (e) {
    Telemetry.endSpan(span, e.message);
    return { success: false, message: e.message };
  }
}
```

The entry point wraps the entire invocation and flushes at the end:

```javascript
function onMessage(event) {
  Telemetry.init();
  var rootSpan = Telemetry.startSpan('bot.on_message');
  try {
    var response = CommandRouter.route(text);
    Telemetry.endSpan(rootSpan);
    return createReply(response);
  } catch (e) {
    Telemetry.endSpan(rootSpan, e.message);
    return createReply('Error: ' + e.message);
  } finally {
    Telemetry.flush();
  }
}
```

Every span created during `CommandRouter.route()` automatically becomes
a child of the root span. No context argument threaded through function
calls.

## What You Get

With this in place, every bot invocation produces:

- **A full trace** — a visual timeline of every service call, how long
  it took, and whether it succeeded. When the Gmail API takes 3 seconds,
  you see it immediately instead of wondering why the bot felt slow.
- **Correlated logs** — each log entry is tagged with the trace and span
  that produced it. Search by trace ID and you get the complete story of
  one command, across all services, in order.
- **Metrics** — command duration and count, broken down by command type.
  You can alert when error rates spike or p95 latency crosses a
  threshold.
- **Error attribution** — when something fails three layers deep (say,
  a Sheets lookup inside a Calendar invite flow), the trace shows
  exactly which step failed and why. No more guessing from a generic
  error message.

All of this exports over standard OTLP — compatible with Grafana,
Datadog, Honeycomb, or any backend that speaks the protocol.

## Trade-offs

| Aspect | Trade-off |
|--------|-----------|
| **No sampling** | Every invocation exports a trace. Fine for low-throughput bots, but add sampling for high-frequency triggers. |
| **No retry** | Failed exports are silently dropped. Acceptable for observability; not for guaranteed delivery. |
| **Cold start cost** | First invocation after cache expiry adds ~300ms for token fetch. Subsequent calls are free. |

## Conclusion

Apps Script's constraints — synchronous execution, no modules, no
persistent process — sound like dealbreakers for instrumentation. In
practice, they simplify it. The OTLP protocol doesn't care what
runtime produced the JSON. A 300-line SDK gives you the same traces,
logs, and metrics that a full Node.js application would produce.

If you have Apps Script running production workflows — and most
organizations do, whether they realize it or not — it deserves the
same observability as the rest of your stack. The payoff is immediate
the first time you open a trace instead of reading a flat log.

---

**Related Reading:**

- [Production-Ready OpenTelemetry: Configure, Harden, and Debug Your Collector][1]
  — set up the collector that receives your Apps Script exports
- [Zero-Code Instrumentation for Go with eBPF and OpenTelemetry][2]
  — auto-instrumentation for Go services using eBPF
- [Why Unified Observability Matters for Growing Engineering Teams][3]
  — bringing all your signals into one place
- [Flutter Mobile Observability with OpenTelemetry][4]
  — another non-standard runtime instrumented with OTel

[1]: /blog/production-ready-otel-collector
[2]: /blog/ebpf-instrumentation-go
[3]: /blog/unified-observability
[4]: /blog/flutter-mobile-observability
