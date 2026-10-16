---
sidebar_position: 2
title: Get started with Base14 Evals
sidebar_label: Get started
description:
  Sign in to Base14 Evals, create API keys for a project, and send your first
  LLM trace from Python or JavaScript.
keywords:
  [
    base14 evals setup,
    llm tracing quickstart,
    langfuse sdk,
    llm observability python,
  ]
---

# Get started

This guide takes you from a new project to your first trace in a few minutes.

## Before you start

You need:

- Your Evals URL. base14 gives you this when your instance is set up. The
  examples below write it as `https://<your-evals-host>`.
- A sign-in. Use your organization's single sign-on, or the account base14
  created for you.
- Python 3.10+ or Node.js 20+.

## 1. Create API keys

1. Sign in and open your project.
2. Go to **Settings → API Keys** and select **Create new API keys**.
3. Copy the public key (`pk-lf-...`) and the secret key (`sk-lf-...`). The
   secret key is shown only once.

Keys belong to one project. Traces sent with them land in that project.

## 2. Configure the SDK

Set these environment variables in the application you want to trace:

```bash
LANGFUSE_BASE_URL="https://<your-evals-host>"
LANGFUSE_PUBLIC_KEY="pk-lf-..."
LANGFUSE_SECRET_KEY="sk-lf-..."
# Optional: separates production, staging, and local traces
LANGFUSE_TRACING_ENVIRONMENT="production"
```

The variable names come from the open-source SDK that Evals is compatible
with. They are the same for Python and JavaScript.

## 3. Send a trace

### Python

```bash
pip install langfuse openai
```

```python
from langfuse import get_client, observe
from langfuse.openai import openai  # drop-in wrapper that records each call

langfuse = get_client()


@observe()
def answer(question: str) -> str:
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": question}],
    )
    return response.choices[0].message.content


print(answer("What is OpenTelemetry?"))
langfuse.flush()  # short scripts: send buffered data before exit
```

`@observe()` creates a trace for the function call. The OpenAI wrapper adds a
generation inside it, with the model, prompt, answer, and token usage.

### JavaScript / TypeScript

```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startActiveObservation } from "@langfuse/tracing";

const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
sdk.start();

await startActiveObservation("answer", async (span) => {
  span.update({ input: { question: "What is OpenTelemetry?" } });
  // call your model here
  span.update({ output: { answer: "..." } });
});

await sdk.shutdown(); // flushes before exit
```

## 4. See it in Evals

Open **Tracing** in your project. The trace appears within a few seconds.
Select it to see the call tree, inputs and outputs, latency, and token usage.

If nothing appears:

- Call `langfuse.auth_check()` (Python). `False` means the URL or keys are
  wrong.
- Make sure short-lived scripts call `flush()` or `shutdown()` before they
  exit.
- Check that your network allows outbound HTTPS to your Evals URL.

## Next steps

- [Data model](./tracing/data-model.md): traces, observations, and scores.
- [Sessions, users, and other attributes](./tracing/trace-attributes.md):
  group traces by conversation and customer.
- [LLM-as-a-judge](./evaluation/llm-as-a-judge.md): score traces
  automatically.
