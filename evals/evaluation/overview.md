---
sidebar_position: 1
title: Evaluation in Base14 Evals
sidebar_label: Overview
description:
  The ways Base14 Evals measures LLM output quality, from LLM-as-a-judge and
  human annotation to code evaluators and experiments, and when to use each.
keywords:
  [llm evaluation methods, llm scores, llm as a judge, llm experiments]
---

# Evaluation overview

Every evaluation in Evals produces [scores](../tracing/data-model.md#scores).
The methods differ in who or what produces the score and whether it runs on
live traffic or on a fixed test set.

| Method | Who scores | Runs on | Best for |
| --- | --- | --- | --- |
| [LLM-as-a-judge](./llm-as-a-judge.md) | A model, using your criteria | New traces, or experiment runs | Continuous quality checks at scale |
| [Human annotation](./annotation.md) | Your team, in annotation queues | Selected traces | Ground truth, judging the judge |
| [Custom scores](./annotation.md#send-scores-from-code) | Your code or your users | Anything you choose | User feedback, rule-based checks |
| [Experiments](./datasets-and-experiments.md) | Any of the above | A dataset | Comparing prompts, models, or code before release |

## A typical loop

1. **Trace production traffic** so you can see real inputs and failures.
2. **Run an LLM-as-a-judge evaluator** on a sample of new traces to watch
   quality over time.
3. **Review low-scoring traces by hand** in an annotation queue, and add the
   interesting ones to a dataset.
4. **Run an experiment** on that dataset whenever you change a prompt or
   model, and compare the scores before you ship.

## Where scores show up

- **Scores** lists every score with its source.
- The trace and session views show the scores attached to them.
- Trace filters and dashboards can use any score, for example "traces where
  `correctness` is below 0.5" or "average helpfulness per model".

## Score configs

A score config fixes a score's name, data type, and allowed range or
categories. Create them under **Settings → Scores Configs** and reference them
from evaluators, annotation queues, and the SDK, so the same score means the
same thing wherever it comes from.
