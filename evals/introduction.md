---
slug: /
sidebar_position: 1
title: Base14 Evals
sidebar_label: Introduction
description:
  Base14 Evals traces your LLM application, scores its output with
  LLM-as-a-judge and human review, and tracks token usage and cost, on
  infrastructure base14 runs for you.
keywords:
  [
    llm evaluation,
    llm as a judge,
    llm tracing,
    llm observability,
    base14 evals,
  ]
---

# Base14 Evals

Base14 Evals is an LLM engineering platform. It records every call your
application makes to a model, lets you score those calls automatically or by
hand, and shows what each model, user, and feature costs. base14 runs a
dedicated instance for your organization, so your traces stay on base14
infrastructure next to your other telemetry.

## What you can do with it

- **Trace LLM applications.** See each request as a tree of agents, tool
  calls, retrievals, and model generations, with inputs, outputs, latency,
  token usage, and cost. See [Data model](./tracing/data-model.md).
- **Group traces by conversation and user.** Sessions collect the turns of a
  chat; users show what each of your customers did and spent. See
  [Sessions, users, and other attributes](./tracing/trace-attributes.md).
- **Evaluate output automatically.** LLM-as-a-judge evaluators score new
  traces against criteria such as correctness, helpfulness, or toxicity. See
  [LLM-as-a-judge](./evaluation/llm-as-a-judge.md).
- **Review output by hand.** Annotation queues let domain experts label
  traces, and you can send your own scores from code. See
  [Human annotation and custom scores](./evaluation/annotation.md).
- **Test before you ship.** Datasets and experiments compare prompts, models,
  or code versions on the same inputs. See
  [Datasets and experiments](./evaluation/datasets-and-experiments.md).
- **Manage prompts.** Version prompts, label the one in production, and try
  changes in the playground. See [Prompt management](./prompt-management.md).
- **Track usage and cost.** Dashboards and the metrics API break token usage
  and cost down by model, user, environment, and more. See
  [Dashboards, usage, and cost](./dashboards-and-cost.md).

## How it fits with Scout

Scout stores your OpenTelemetry logs, metrics, and traces. Evals focuses on
the LLM part of a request: the prompt, the model's answer, and how good that
answer was. Both accept OpenTelemetry, so an application can send its
infrastructure traces to Scout and its LLM traces to Evals.

## SDK and package names

Evals is compatible with the open-source Langfuse SDKs and APIs. You install
the `langfuse` Python or JavaScript package, set `LANGFUSE_*` environment
variables, and point them at your Evals URL. See
[Get started](./get-started.md).

## Next steps

- [Get started](./get-started.md): create API keys and send your first trace.
- [OpenTelemetry and frameworks](./tracing/opentelemetry.md): instrument an
  existing OpenTelemetry, OpenAI Agents, or LiteLLM setup.
- [FAQ](./faq.md): common questions.
