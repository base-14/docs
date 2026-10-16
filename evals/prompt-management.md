---
sidebar_position: 5
title: Prompt management in Base14 Evals
sidebar_label: Prompt management
description:
  Version prompts in Base14 Evals, label the version each environment uses,
  try changes in the playground, and fetch prompts at runtime from the SDK.
keywords:
  [llm prompt management, prompt versioning, prompt playground, prompt labels]
---

# Prompt management

Keep prompts out of your code so you can change them without a deploy, see
which version produced which trace, and roll back in one click.

## Versions and labels

Every save creates a new, immutable version. Labels point at a version:

- `production` is the version your application fetches by default.
- `latest` always points at the newest version.
- Add your own, such as `staging`, to test a version in one environment
  first.

Moving a label is how you release or roll back a prompt. Protect labels such
as `production` under **Settings → Protected Prompt Labels** so only admins
can move them.

## Create a prompt

In **Prompts**, select **New prompt**. A prompt is either text or a list of
chat messages, with variables in double braces:

```text
You are a support agent for {{company}}. Answer in {{language}}.
```

A prompt can also carry a config, such as the model and temperature, which
your code reads along with the text.

## Use a prompt in your code

```python
from langfuse import get_client

langfuse = get_client()

prompt = langfuse.get_prompt("support-system")  # the production version
system = prompt.compile(company="Acme Air", language="English")
model = prompt.config.get("model", "gpt-4o-mini")
```

The SDK caches prompts and refreshes them in the background, so fetching a
prompt does not add a network call to each request. Pass `fallback=` to keep
working if Evals is unreachable on the first fetch.

## Link prompts to traces

Pass the prompt to the generation that uses it. Evals then shows which
version produced each trace, and the prompt's page shows usage, latency,
cost, and scores per version.

```python
with langfuse.start_as_current_observation(
    name="answer", as_type="generation", prompt=prompt, model=model
):
    ...
```

## Playground

**Playground** runs a prompt against any model from your LLM connections.
Change the messages, variables, or model settings, compare outputs side by
side, and save the result as a new prompt version. Open any generation in a
trace with **Open in playground** to start from a real request.

## Scope and Evals

base14 Scope also manages prompts, with promotion between environments built
around Scout's telemetry. If your team already uses Scope for prompts, keep
using it and use Evals for tracing and evaluation.
