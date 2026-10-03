---
sidebar_position: 4
title: Datasets and experiments
sidebar_label: Datasets and experiments
description:
  Build test datasets in Base14 Evals and run experiments that compare
  prompts, models, or code versions on the same inputs before you ship.
keywords:
  [llm datasets, llm experiments, llm regression testing, prompt comparison]
---

# Datasets and experiments

A dataset is a fixed set of inputs, each with an optional expected output.
An experiment runs your application, or a prompt, over every item and scores
the results. Run one whenever you change a prompt, model, or retrieval step,
and compare it with the previous run before you ship.

## Create a dataset

In the UI, go to **Datasets → New dataset**, then add items by hand, upload a
CSV, or select traces and choose **Add to dataset**. Adding production
traces is the quickest way to cover the cases your users actually hit.

From code:

```python
from langfuse import get_client

langfuse = get_client()

langfuse.create_dataset(name="support-faq", description="Top FAQ questions")
langfuse.create_dataset_item(
    dataset_name="support-faq",
    input={"question": "How many bags can I check?"},
    expected_output={"answer": "Two bags up to 23 kg each"},
)
```

Datasets are versioned. Editing items creates a new version, and an
experiment records the version it ran against.

## Run an experiment from code

`run_experiment` calls your task for every item, runs your evaluators on
each result, and records everything as one run.

```python
from langfuse import Evaluation, get_client

langfuse = get_client()
dataset = langfuse.get_dataset("support-faq")


def task(*, item, **kwargs):
    return my_app.answer(item.input["question"])


def exact_match(*, input, output, expected_output, **kwargs):
    return Evaluation(
        name="exact_match",
        value=1 if output == expected_output["answer"] else 0,
    )


result = dataset.run_experiment(
    name="faq-prompt-v2",
    task=task,
    evaluators=[exact_match],
)
print(result.format())
```

Each item's execution is traced, so you can open any result and see the full
call tree. Evaluators can be plain code, as above, or an LLM-as-a-judge
evaluator that targets experiment runs.

## Run an experiment from the UI

To compare prompts without writing code, open a dataset, select
**Run experiment**, and choose a prompt version from
[Prompt management](./../prompt-management.md) and a model from your LLM
connections. Evals fills the prompt's variables from each item's input and
records the run.

## Compare runs

The dataset's **Experiments** tab lists every run with its average scores,
cost, and latency. Select two or more runs to compare them item by item and
find the inputs where a change made things better or worse.
