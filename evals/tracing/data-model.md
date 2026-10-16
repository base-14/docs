---
sidebar_position: 1
title: Base14 Evals data model
sidebar_label: Data model
description:
  How Base14 Evals represents LLM activity, from traces and observations to
  sessions and scores, and how they relate.
keywords:
  [llm trace data model, llm observations, generation span, llm scores]
---

# Data model

Evals stores four kinds of objects. Knowing how they relate makes the UI,
filters, and API easier to use.

| Object | What it is | Example |
| --- | --- | --- |
| Trace | One request through your application | A user message and the agent's reply |
| Observation | One step inside a trace | A model call, a tool call, a retrieval |
| Session | A group of traces | All turns of one chat |
| Score | An evaluation attached to a trace, observation, or session | `correctness = 0.8` |

## Traces

A trace is the top-level record of one request. It holds the request's input
and output, the user and session it belongs to, tags, metadata, the
environment, and the release. A trace's latency, token usage, and cost add up
the observations inside it.

## Observations

Observations are the steps of a trace. They nest, so a trace reads as a tree:
an agent calls a tool, the tool calls a model, and so on. Each observation
has a type:

| Type | Use it for |
| --- | --- |
| `span` | A generic unit of work with a start and end |
| `generation` | A model call: model name, parameters, prompt, completion, usage, cost |
| `embedding` | An embedding call |
| `agent` | An agent that decides what to do next |
| `tool` | A tool or function call |
| `chain` | A fixed sequence of steps |
| `retriever` | A search or vector-store lookup |
| `evaluator` | A step that scores another step |
| `guardrail` | A check that can block input or output |
| `event` | A point in time with no duration |

Only generations and embeddings carry token usage and cost. The other types
exist so the trace tree and filters read clearly; they behave like spans.

Every observation also has a level (`DEBUG`, `DEFAULT`, `WARNING`, `ERROR`)
and an optional status message. Filter on `ERROR` to find failed steps.

## Sessions

A session groups traces that share a `session_id`, such as every turn of one
conversation. The session view replays them in order. See
[Sessions, users, and other attributes](./trace-attributes.md).

## Scores

Scores record how good something was. A score has a name, a value, and a data
type:

| Data type | Values | Example |
| --- | --- | --- |
| Numeric | Any number | `relevance = 0.75` |
| Categorical | One of a fixed set of strings | `tone = "polite"` |
| Boolean | `0` or `1` | `resolved = 1` |
| Text | Free text | A reviewer's note |

Scores come from LLM-as-a-judge evaluators, human annotation, user feedback
in your app, or your own code through the SDK or API. Score configs (under
**Settings → Scores Configs**) fix a score's type and range so every source
records it the same way. See [Evaluation overview](../evaluation/overview.md).

## Environments and releases

Each trace has an environment, set with `LANGFUSE_TRACING_ENVIRONMENT`
(default `default`). Use it to keep production, staging, and local traffic
apart; most views filter on it.

A release (`LANGFUSE_RELEASE`) tags traces with your application version, so
you can compare quality and cost across deployments.

Traces created by LLM-as-a-judge evaluators use the environment
`langfuse-llm-as-a-judge`. Filter it out to see only your application's
traffic, or filter on it to see what evaluation costs.
