---
sidebar_position: 9
title: Base14 Evals FAQ
sidebar_label: FAQ
description:
  Answers to common Base14 Evals questions about SDK names, missing data,
  scores, costs, and getting help.
keywords:
  [base14 evals faq, langfuse sdk compatibility, llm tracing troubleshooting]
---

# FAQ

## Why do the SDK and settings say "langfuse"?

Evals is compatible with the open-source Langfuse SDKs, so you install the
`langfuse` package, set `LANGFUSE_*` environment variables, and may see
`langfuse` in header names and integration callbacks. Point those settings at
your Evals URL and they work unchanged. Code you write against Evals also
works with the open-source project, and the reverse.

## Which SDK versions are supported?

Use the current major versions: Python SDK v4 and the JavaScript/TypeScript
SDK v4 packages (`@langfuse/tracing`, `@langfuse/otel`). Older v2 SDKs still
send data through a legacy endpoint, but new features such as observation
types and the v2 APIs need v4. Upgrade by following the SDK's changelog; the
main change is that tracing is built on OpenTelemetry.

## Why are a trace's input and output empty?

A trace takes its input and output from its root observation. They are empty
when the root is a span that records neither, which is common when an
instrumentation library creates the root. Either decorate your entry point
with `@observe()`, so the function's arguments and return value are recorded,
or set them explicitly:

```python
langfuse.set_current_trace_io(input={"question": q}, output={"answer": a})
```

## Why is cost zero for some models?

Evals calculates cost from a model price table. Models it does not know, such
as Bedrock model IDs or self-hosted models, have no price until you add one
under **Settings → Model Definitions**. Token counts are recorded either way.
See [Dashboards, usage, and cost](./dashboards-and-cost.md#model-prices).

## What is a score?

A score is a single evaluation result, such as a number, a category, a
yes/no, or text, attached to a trace, observation, or session. See
[Data model](./tracing/data-model.md#scores).

## How quickly do traces appear?

Usually within a few seconds. The SDKs send data in batches in the
background; call `flush()` at the end of short scripts so nothing is lost
when the process exits.

## Where do I get help?

Contact your base14 support channel. Include the trace ID or the page URL,
which identify the project and the data you are asking about.
