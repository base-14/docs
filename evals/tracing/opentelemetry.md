---
sidebar_position: 3
title: OpenTelemetry and framework integrations
sidebar_label: OpenTelemetry and frameworks
description:
  Send LLM traces to Base14 Evals over OTLP, or from OpenAI Agents, LangChain,
  and LiteLLM through OpenTelemetry instrumentation.
keywords:
  [
    llm opentelemetry,
    otlp llm traces,
    openai agents tracing,
    litellm tracing,
    openinference,
  ]
---

# OpenTelemetry and framework integrations

Evals receives traces over OpenTelemetry. The SDKs are OpenTelemetry tracer
providers, and Evals also accepts OTLP directly, so most frameworks work
without a dedicated integration.

## OTLP endpoint

Any OpenTelemetry exporter can send traces to Evals:

| Setting | Value |
| --- | --- |
| Endpoint | `https://<your-evals-host>/api/public/otel` |
| Traces path | `/api/public/otel/v1/traces` |
| Protocol | OTLP over HTTP, protobuf or JSON (gRPC is not supported) |
| Signal | Traces only |
| Auth | HTTP Basic, public key as username and secret key as password |

```bash
AUTH=$(printf '%s' "pk-lf-...:sk-lf-..." | base64)
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://<your-evals-host>/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Basic ${AUTH},x-langfuse-ingestion-version=4"
```

Evals maps the OpenTelemetry GenAI semantic conventions (`gen_ai.*`
attributes) and OpenInference attributes to its own fields: model, input,
output, token usage, and observation type.

## Python frameworks

Use an OpenInference or OpenLLMetry instrumentor next to the SDK. The SDK's
tracer provider picks up the spans the instrumentor creates.

### OpenAI Agents SDK

```bash
pip install langfuse openinference-instrumentation-openai-agents
```

```python
from langfuse import get_client
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

langfuse = get_client()  # registers the tracer provider
OpenAIAgentsInstrumentor().instrument()
```

Agents, handoffs, tools, guardrails, and model calls then show up as one
trace per run. Pass `ModelSettings(include_usage=True)` to your agents so
token usage is recorded for every model call.

### LangChain and LangGraph

```python
from langfuse.langchain import CallbackHandler

handler = CallbackHandler()
chain.invoke({"question": "..."}, config={"callbacks": [handler]})
```

## LiteLLM

If your application calls models through a LiteLLM proxy or the LiteLLM
SDK, LiteLLM can send one generation per call to Evals, with usage and cost.
Configure the callback with your project keys and Evals URL:

```yaml
# LiteLLM proxy config.yaml
litellm_settings:
  callbacks: ["langfuse"]
```

```bash
# Environment of the LiteLLM proxy (or of your app, for the LiteLLM SDK)
LANGFUSE_PUBLIC_KEY="pk-lf-..."
LANGFUSE_SECRET_KEY="sk-lf-..."
LANGFUSE_HOST="https://<your-evals-host>"
```

With the LiteLLM SDK, set `litellm.success_callback = ["langfuse"]` instead
of the YAML.

The callback is named after the open-source SDK that Evals is compatible
with.

## Sending the same traces to Scout

If you already send traces to Scout through an OpenTelemetry Collector, add
Evals as a second exporter for the LLM spans instead of instrumenting twice.
Use an `otlphttp` exporter with the endpoint and headers above, and filter
the pipeline to spans with `gen_ai.*` attributes so only LLM work reaches
Evals.
