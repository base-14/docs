---
sidebar_position: 2
title: LLM-as-a-judge evaluators
sidebar_label: LLM-as-a-judge
description:
  Set up LLM-as-a-judge in Base14 Evals - add an LLM connection, pick or write
  an evaluation template, choose which traces to score, and read the results.
keywords:
  [
    llm as a judge,
    llm evaluator,
    automated llm evaluation,
    llm hallucination detection,
    evaluation template,
  ]
---

# LLM-as-a-judge

An LLM-as-a-judge evaluator asks a model to grade your application's output
against criteria you define, such as correctness, relevance, or tone. It
runs on new traces as they arrive, or on experiment runs, and writes the
result as a score with the judge's reasoning as the comment.

## 1. Add an LLM connection

The judge needs a model to call. Go to **Settings → LLM Connections** and
add one. Supported providers:

| Provider | Notes |
| --- | --- |
| OpenAI | Also any OpenAI-compatible API: set a custom base URL |
| Anthropic | |
| Azure OpenAI | |
| AWS Bedrock | |
| Google Vertex AI | |
| Google AI Studio | |

Keys are stored encrypted and are used only by your project's evaluators
and playground. Evals sends a test request when you save the connection,
so a wrong key or model name shows up right away.

:::note[Managed judge models]

base14 can provide judge models for your instance so you don't need your own
provider keys. If it has, the connections already appear under
**LLM Connections**. Ask your base14 contact which models are available.

:::

The judge must return a structured score, so choose a model that supports
tool calling or JSON-schema output. Most current OpenAI, Anthropic, and
Bedrock models do.

## 2. Choose a template

Go to **Evaluators** and select **Set up evaluator**. Start from a managed
template, such as hallucination, helpfulness, relevance, toxicity, or
correctness, or write your own.

A template is a prompt with variables in double braces:

```text
Evaluate whether the answer is supported by the context.

Context: {{context}}
Question: {{query}}
Answer: {{generation}}

Score 1 if every claim is supported, 0 otherwise.
```

The template also defines the score's name and how the model should explain
its reasoning.

## 3. Choose what to evaluate

- **Target.** Score live observations or traces, or score experiment runs
  on a dataset.
- **Filter.** Limit the evaluator to the traffic it applies to, for example
  `name = "support-chat"` and `environment = "production"`.
- **Sampling.** Score a percentage of matching traces. Start low, such as
  10%; every evaluation is a model call with its own cost.
- **Variable mapping.** Map each template variable to a field: the input,
  output, or metadata of the trace or of a specific observation in it.
- **Delay.** Wait a short time after the trace arrives so all of its
  observations are in before the judge runs.

Save the evaluator. From then on, matching traces are scored in the
background.

## 4. Read the results

- Scores appear on each trace, on the **Scores** page, and in dashboards.
- Every judge call is traced in your project with the environment
  `langfuse-llm-as-a-judge`. Open one to see exactly what the judge was
  sent and what it answered, including token usage and cost.
- The evaluator's log on the **Evaluators** page lists each execution and
  any errors, such as a missing variable or a provider timeout.

## Check the judge

A judge can be wrong. Before relying on one, send a sample of its scored
traces to an [annotation queue](./annotation.md), have a person score the
same traces, and compare. Refine the template until the two agree on the
cases that matter.
