---
title:
  LlamaIndex OpenTelemetry Instrumentation - Complete AI App Monitoring Guide |
  base14 Scout
sidebar_label: LlamaIndex
sidebar_position: 7
description:
  Complete guide to LlamaIndex OpenTelemetry instrumentation for AI application
  monitoring. Trace LLM calls, track tokens and costs, monitor structured output
  with self-correction, evaluate content quality, and scrub PII with base14
  Scout.
keywords:
  [
    llamaindex opentelemetry instrumentation,
    llamaindex monitoring,
    llamaindex apm,
    llamaindex distributed tracing,
    python ai observability,
    llamaindex performance monitoring,
    opentelemetry llamaindex python,
    llamaindex telemetry,
    llamaindex metrics,
    llamaindex traces,
    llm token tracking,
    llm cost monitoring,
    genai semantic conventions,
    llamaindex structured output,
    promptfoo evaluation,
    pii scrubbing telemetry,
    ai content quality,
    llamaindex production monitoring,
    llamaindex instrumentation guide,
    multi-provider llm,
  ]
---

# LlamaIndex

Implement OpenTelemetry instrumentation for LlamaIndex applications to enable
comprehensive AI application monitoring, LLM cost tracking, and quality
evaluation. This guide shows you how to instrument a LlamaIndex-powered
content quality agent with custom GenAI semantic convention spans, multi-provider
LLM support, structured output with self-correction, token and cost metrics,
PII scrubbing, and eval-driven development with Promptfoo.

This guide intentionally uses **custom OpenTelemetry GenAI semantic conventions**
rather than OpenInference or LlamaIndex auto-instrumentation. OpenInference
produces non-standard attributes (`llm.*`, `input.*`, `output.*`) that pollute
telemetry with framework-specific data outside the OTel GenAI semconv. Custom
instrumentation gives you full control over what gets recorded and ensures
your telemetry works with any OpenTelemetry-compatible backend.

Whether you're building AI agents, content analysis pipelines, RAG systems,
or multi-provider LLM applications, this guide provides production-ready
patterns for unified AI observability where LLM spans, token metrics, cost
attribution, and evaluation scores live alongside your standard HTTP and
database telemetry in a single trace.

> **Note:** For general LLM observability patterns applicable to any Python
> framework, see the
> [LLM Observability guide](../../../guides/ai-observability/llm-observability.md).
> This guide focuses specifically on LlamaIndex integration patterns.

## Who This Guide Is For

This documentation is designed for:

- **AI/ML engineers**: building LlamaIndex-powered features and needing
  visibility into model performance, cost, and quality
- **Backend developers**: adding AI capabilities to existing FastAPI
  applications and wanting unified tracing
- **Platform teams**: standardizing observability across AI services and
  traditional microservices
- **Engineering teams**: migrating from LangSmith or other proprietary AI
  observability tools to OpenTelemetry
- **DevOps engineers**: deploying AI applications with production monitoring,
  cost alerting, and quality tracking

## Overview

This guide demonstrates how to:

- Set up unified OpenTelemetry for a LlamaIndex application
  (traces + metrics + logs)
- Create custom LLM spans following OpenTelemetry GenAI semantic conventions
- Support multiple LLM providers (OpenAI, Anthropic, Google) through a single interface
- Implement structured output with JSON self-correction loops
- Track token usage and calculate cost per LLM call with a pricing table
- Record evaluation metrics for content quality tracking
- Scrub PII from prompts and completions before recording in telemetry
- Manage prompts with versioned YAML templates
- Run eval-driven development with Promptfoo
- Deploy with Docker Compose and the OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- **Python 3.12 or later** installed (3.14+ recommended)
- **An LLM API key** from at least one provider (OpenAI, Anthropic, or Google)
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, metrics)

### Compatibility Matrix

| Component               | Minimum Version | Recommended     |
| ----------------------- | --------------- | --------------- |
| Python                  | 3.12            | 3.14+           |
| opentelemetry-sdk       | 1.39.0          | 1.39.1+         |
| opentelemetry-api       | 1.39.0          | 1.39.1+         |
| FastAPI                 | 0.115+          | 0.128+          |
| llama-index-core        | 0.14.0          | 0.14.13+        |
| llama-index-llms-openai | 0.6.0           | 0.6.18+         |
| llama-index-llms-anthropic | 0.10.0       | 0.10.8+         |
| llama-index-llms-google-genai | 0.8.0     | 0.8.7+          |
| Pydantic                | 2.0             | 2.12.5+         |

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="package-manager">
<TabItem value="pip" label="pip" default>
```

```bash showLineNumbers title="Terminal"
pip install \
  opentelemetry-api \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-logging \
  llama-index-core \
  llama-index-llms-openai \
  llama-index-llms-anthropic \
  llama-index-llms-google-genai \
  fastapi uvicorn pydantic-settings \
  tenacity httpx pyyaml
```

```mdx-code-block
</TabItem>
<TabItem value="uv" label="uv">
```

```bash showLineNumbers title="Terminal"
uv add \
  opentelemetry-api \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-logging \
  llama-index-core \
  llama-index-llms-openai \
  llama-index-llms-anthropic \
  llama-index-llms-google-genai \
  fastapi uvicorn pydantic-settings \
  tenacity httpx pyyaml
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuration

```mdx-code-block
<Tabs>
<TabItem value="module" label="Telemetry Module (Recommended)" default>
```

```python showLineNumbers title="src/content_quality/telemetry.py"
import atexit
import logging
import os
from importlib.metadata import version
from typing import Any

from opentelemetry import _logs, metrics, trace
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup_telemetry(
    service_name: str,
    otlp_endpoint: str,
) -> tuple[trace.Tracer, metrics.Meter]:
    """Initialize unified observability for traces, metrics, and logs.

    GenAI telemetry (spans, metrics, events) is handled by custom
    instrumentation in llm.py following OTel GenAI semantic conventions.
    We intentionally do NOT use OpenInference/LlamaIndex auto-instrumentation.
    """
    if os.environ.get("OTEL_SDK_DISABLED") == "true":
        return trace.get_tracer(service_name), metrics.get_meter(service_name)

    resource = Resource.create({
        "service.name": service_name,
        "service.version": version("ai-content-quality"),
        "deployment.environment": os.getenv("SCOUT_ENVIRONMENT", "development"),
    })

    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=f"{otlp_endpoint}/v1/traces")
        )
    )
    trace.set_tracer_provider(trace_provider)

    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{otlp_endpoint}/v1/metrics"),
        export_interval_millis=10000,
    )
    metric_provider = MeterProvider(
        resource=resource, metric_readers=[metric_reader]
    )
    metrics.set_meter_provider(metric_provider)

    log_provider = LoggerProvider(resource=resource)
    log_provider.add_log_record_processor(
        BatchLogRecordProcessor(
            OTLPLogExporter(endpoint=f"{otlp_endpoint}/v1/logs")
        )
    )
    _logs.set_logger_provider(log_provider)
    logging.getLogger().addHandler(
        LoggingHandler(level=logging.INFO, logger_provider=log_provider)
    )

    atexit.register(trace_provider.shutdown)
    atexit.register(metric_provider.shutdown)
    atexit.register(log_provider.shutdown)

    LoggingInstrumentor().instrument(set_logging_format=True)

    return trace.get_tracer(service_name), metrics.get_meter(service_name)


def instrument_fastapi(app: Any) -> None:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(
        app, excluded_urls="health", exclude_spans=["receive", "send"]
    )
```

```mdx-code-block
</TabItem>
<TabItem value="config" label="Pydantic Settings">
```

```python showLineNumbers title="src/content_quality/config.py"
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    service_name: str = "ai-content-quality"
    llm_provider: str = "openai"
    llm_model: str = "gpt-4.1-nano"
    llm_temperature: float = 0.3
    llm_timeout: float = 30.0
    openai_api_key: str = ""
    google_api_key: str = ""
    anthropic_api_key: str = ""
    request_timeout: float = 60.0
    review_prompt_version: str = "v1"
    improve_prompt_version: str = "v1"
    score_prompt_version: str = "v1"
    otlp_endpoint: str = "http://otel-collector:4318"
    otel_sdk_disabled: bool = False
    scout_environment: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

For container deployments where configuration is managed externally:

```bash showLineNumbers title=".env"
# Application
SERVICE_NAME=ai-content-quality
LLM_PROVIDER=openai
LLM_MODEL=gpt-4.1-nano
LLM_TEMPERATURE=0.3
LLM_TIMEOUT=30.0
REQUEST_TIMEOUT=60.0
HOST=0.0.0.0
PORT=8000

# LLM Provider Keys
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=
ANTHROPIC_API_KEY=

# Prompt Versions
REVIEW_PROMPT_VERSION=v1
IMPROVE_PROMPT_VERSION=v1
SCORE_PROMPT_VERSION=v1

# OpenTelemetry
OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SDK_DISABLED=false
SCOUT_ENVIRONMENT=production
```

The Pydantic `Settings` class reads all environment variables
automatically (see the Pydantic Settings tab). No code changes
needed — set the variables and the application picks them up.

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

### OpenTelemetry Collector

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128
  batch:
    timeout: 10s
    send_batch_size: 1024
  attributes:
    actions:
      - key: deployment.environment
        value: ${SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlp_http/b14:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
  debug:
    verbosity: basic

service:
  extensions: [health_check, oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
```

### Docker Compose

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_SDK_DISABLED=false
      - LLM_PROVIDER=${LLM_PROVIDER:-openai}
      - LLM_MODEL=${LLM_MODEL:-gpt-4.1-nano}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY:-}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
    depends_on:
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 60s
      timeout: 5s
      retries: 3

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.144.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    environment:
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID:-}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET:-}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL:-https://auth.base14.io/oauth/token}
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT:-https://collector.base14.io}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
```

### Dockerfile

```dockerfile showLineNumbers title="Dockerfile"
FROM python:3.14-slim
WORKDIR /app

RUN pip install --no-cache-dir uv && \
    apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --no-dev

COPY src/ src/
COPY prompts/ prompts/

ENV PYTHONPATH=/app/src
EXPOSE 8000

CMD ["uv", "run", "uvicorn", "content_quality.main:app", \
     "--host", "0.0.0.0", "--port", "8000"]
```

## Multi-Provider LLM Support

Create a provider-agnostic LLM factory that works with OpenAI, Anthropic,
and Google:

```python showLineNumbers title="src/content_quality/services/llm.py"
from llama_index.core.llms import LLM

PROVIDER_SEMCONV_NAMES = {
    "openai": "openai",
    "google": "gcp.gemini",
    "anthropic": "anthropic",
}

PROVIDER_SERVERS = {
    "openai": "api.openai.com",
    "gcp.gemini": "generativelanguage.googleapis.com",
    "anthropic": "api.anthropic.com",
}


def create_llm(
    provider: str = "openai",
    model: str = "gpt-4.1-nano",
    temperature: float = 0.3,
    api_key: str = "",
    timeout: float = 30.0,
) -> LLM:
    global _provider
    _provider = PROVIDER_SEMCONV_NAMES.get(provider, provider)

    if provider == "openai":
        from llama_index.llms.openai import OpenAI
        return OpenAI(model=model, temperature=temperature,
                      api_key=api_key, timeout=timeout)

    if provider == "google":
        from llama_index.llms.google_genai import GoogleGenAI
        return GoogleGenAI(model=model, temperature=temperature,
                           api_key=api_key)

    if provider == "anthropic":
        from llama_index.llms.anthropic import Anthropic
        return Anthropic(model=model, temperature=temperature,
                         api_key=api_key, timeout=timeout)

    raise ValueError(f"Unknown LLM provider: {provider!r}")
```

## Structured Output with Self-Correction

The `generate_structured` function is the core instrumented LLM call. It
requests JSON output matching a Pydantic schema and retries with self-correction
if validation fails:

```python showLineNumbers title="src/content_quality/services/llm.py"
import json
import re
import time
from llama_index.core import PromptTemplate
from llama_index.core.llms import ChatMessage
from opentelemetry import metrics, trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ValidationError
from tenacity import (
    retry, retry_if_exception_type,
    stop_after_attempt, wait_exponential,
)
import httpx

from content_quality.pii import scrub_pii

MAX_PARSE_RETRIES = 2

_MARKDOWN_JSON_RE = re.compile(
    r"^```(?:json)?\s*\n?(.*?)\n?\s*```$", re.DOTALL
)


def _strip_markdown_json(text: str) -> str:
    text = text.strip()
    m = _MARKDOWN_JSON_RE.match(text)
    return m.group(1).strip() if m else text


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type(
        (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError)
    ),
    before_sleep=_on_retry,
    reraise=True,
)
async def generate_structured(
    llm: LLM,
    prompt_template: PromptTemplate,
    output_cls: type[BaseModel],
    content: str,
    content_type: str = "general",
    endpoint: str = "",
    system_prompt: str = "",
) -> BaseModel:
    tracer = trace.get_tracer("gen_ai.client")
    model_name = llm.metadata.model_name
    server_address = PROVIDER_SERVERS.get(_provider, "")

    with tracer.start_as_current_span(f"chat {model_name}") as span:
        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.request.model", model_name)
        span.set_attribute("gen_ai.provider.name", _provider)
        if server_address:
            span.set_attribute("server.address", server_address)
        span.set_attribute("gen_ai.output.type", "json")
        span.set_attribute("content.type", content_type)
        span.set_attribute("content.length", len(content))

        start = time.perf_counter()

        try:
            formatted_prompt = prompt_template.format(content=content)
            schema_json = json.dumps(
                output_cls.model_json_schema(), indent=2
            )
            json_instruction = (
                f"Respond ONLY with valid JSON matching this "
                f"schema:\n{schema_json}"
            )
            full_system = (
                f"{system_prompt}\n\n{json_instruction}"
                if system_prompt else json_instruction
            )

            messages = [
                ChatMessage(role="system", content=full_system),
                ChatMessage(role="user", content=formatted_prompt),
            ]

            chat_response = await llm.achat(messages)
            duration = time.perf_counter() - start

            # Record response attributes
            _set_response_attrs(chat_response, span, model_name)

            # Record token and cost metrics
            _record_token_metrics(
                chat_response, model_name, content_type, endpoint, span
            )

            # Optional: record prompt/completion events with PII scrubbing
            if _is_content_capture_enabled():
                _record_span_event(
                    span, system_prompt, formatted_prompt,
                    str(chat_response.message.content),
                )

            # Parse with self-correction loop
            raw = _strip_markdown_json(str(chat_response.message.content))
            for attempt in range(MAX_PARSE_RETRIES + 1):
                try:
                    return output_cls.model_validate_json(raw)
                except ValidationError as ve:
                    if attempt < MAX_PARSE_RETRIES:
                        messages.append(
                            ChatMessage(role="assistant", content=raw)
                        )
                        messages.append(ChatMessage(
                            role="user",
                            content=(
                                f"Your response did not match the schema. "
                                f"Error: {ve}\n"
                                "Please try again with valid JSON."
                            ),
                        ))
                        correction = await llm.achat(messages)
                        raw = _strip_markdown_json(
                            str(correction.message.content)
                        )
                        continue
                    raise

        except Exception as e:
            span.record_exception(e)
            span.set_status(StatusCode.ERROR, str(e))
            span.set_attribute("error.type", type(e).__name__)
            error_counter.add(1, {
                "gen_ai.request.model": model_name,
                "gen_ai.provider.name": _provider,
                "error.type": type(e).__name__,
            })
            raise
```

## Custom GenAI Metrics

Define five metrics following OpenTelemetry GenAI semantic conventions:

```python showLineNumbers title="src/content_quality/services/llm.py"
from opentelemetry import metrics

meter = metrics.get_meter("gen_ai.client")

token_usage = meter.create_histogram(
    name="gen_ai.client.token.usage",
    description="Number of tokens used",
    unit="{token}",
)

operation_duration = meter.create_histogram(
    name="gen_ai.client.operation.duration",
    description="GenAI operation duration",
    unit="s",
)

cost_counter = meter.create_counter(
    name="gen_ai.client.cost",
    description="Cost of GenAI operations",
    unit="usd",
)

error_counter = meter.create_counter(
    name="gen_ai.client.error.count",
    description="GenAI operation errors",
    unit="1",
)

retry_counter = meter.create_counter(
    name="gen_ai.client.retry.count",
    description="GenAI operation retries",
    unit="1",
)
```

## Cost Calculation with Pricing Table

```python showLineNumbers title="src/content_quality/services/llm.py"
PRICING: dict[str, dict[str, float]] = {
    # OpenAI (per million tokens)
    "gpt-5.2": {"input": 1.75, "output": 14.0},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
    # Google Gemini
    "gemini-3.0-flash-preview": {"input": 0.50, "output": 3.0},
    "gemini-2.5-flash": {"input": 0.30, "output": 2.50},
    # Anthropic
    "claude-opus-4-6": {"input": 5.0, "output": 25.0},
    "claude-sonnet-4-5-20250929": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5-20251001": {"input": 1.0, "output": 5.0},
}


def _calculate_cost(
    model: str, input_tokens: int, output_tokens: int
) -> float:
    pricing = PRICING.get(model, {"input": 0.0, "output": 0.0})
    return (
        input_tokens * pricing["input"]
        + output_tokens * pricing["output"]
    ) / 1_000_000
```

## Evaluation and Quality Metrics

Track content quality scores as OpenTelemetry metrics and span events:

```python showLineNumbers title="src/content_quality/services/analyzer.py"
from opentelemetry import metrics, trace
from content_quality.services.llm import generate_structured
from content_quality.services.prompts import load_prompt

evaluation_score = metrics.get_meter("gen_ai.client").create_histogram(
    name="gen_ai.evaluation.score",
    description="Content quality evaluation score",
    unit="1",
)


class ContentAnalyzer:
    def __init__(self, llm):
        self.llm = llm
        settings = get_settings()
        self._review_prompt = load_prompt(
            f"review_{settings.review_prompt_version}"
        )
        self._score_prompt = load_prompt(
            f"score_{settings.score_prompt_version}"
        )

    async def review(self, content, content_type="general"):
        result = await generate_structured(
            self.llm, PromptTemplate(self._review_prompt.user),
            ReviewResult, content,
            content_type=content_type, endpoint="/review",
            system_prompt=self._review_prompt.system,
        )

        span = trace.get_current_span()
        issue_score = max(
            0,
            100 - sum(
                {"high": 3, "medium": 2, "low": 1}.get(i.severity, 1) * 10
                for i in result.issues
            ),
        )
        span.add_event(
            "gen_ai.evaluation.result",
            {
                "gen_ai.evaluation.name": "content_review",
                "gen_ai.evaluation.score.value": issue_score,
                "gen_ai.evaluation.score.label": (
                    "passed" if issue_score >= 60 else "failed"
                ),
                "gen_ai.evaluation.explanation": result.summary,
            },
        )
        evaluation_score.record(issue_score, {
            "gen_ai.evaluation.name": "content_review",
            "content.type": content_type,
        })

        return result

    async def score(self, content, content_type="general"):
        result = await generate_structured(
            self.llm, PromptTemplate(self._score_prompt.user),
            ScoreResult, content,
            content_type=content_type, endpoint="/score",
            system_prompt=self._score_prompt.system,
        )

        span = trace.get_current_span()
        span.add_event(
            "gen_ai.evaluation.result",
            {
                "gen_ai.evaluation.name": "content_quality",
                "gen_ai.evaluation.score.value": result.score,
                "gen_ai.evaluation.score.label": (
                    "passed" if result.score >= 60 else "failed"
                ),
                "gen_ai.evaluation.explanation": result.summary,
            },
        )
        evaluation_score.record(result.score, {
            "gen_ai.evaluation.name": "content_quality",
            "content.type": content_type,
        })

        return result
```

## YAML Prompt Management

Manage prompts as versioned YAML files for easy iteration:

```python showLineNumbers title="src/content_quality/services/prompts.py"
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import yaml

PROMPTS_DIR = Path(__file__).resolve().parents[3] / "prompts"


@dataclass(frozen=True)
class PromptPair:
    system: str
    user: str


@lru_cache
def load_prompt(name: str) -> PromptPair:
    path = PROMPTS_DIR / f"{name}.yaml"
    with path.open() as f:
        messages = yaml.safe_load(f)

    system = ""
    user = ""
    for msg in messages:
        text = msg["content"].replace("{{", "{").replace("}}", "}")
        if msg["role"] == "system":
            system = text
        elif msg["role"] == "user":
            user = text

    return PromptPair(system=system, user=user)
```

## PII Scrubbing

Scrub PII from all content before recording in span events:

```python showLineNumbers title="src/content_quality/pii.py"
import re

_PII_PATTERNS = [
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[EMAIL]"),
    (re.compile(r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b"), "[PHONE]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b"), "[CARD]"),
    (re.compile(
        r"https?://(?:www\.)?linkedin\.com/in/[\w-]+"
    ), "[LINKEDIN]"),
]


def scrub_pii(text: str) -> str:
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text
```

### Content Capture Toggle

Content capture is opt-in via environment variable. When enabled, prompts
and completions are scrubbed and truncated before recording:

```python showLineNumbers title="src/content_quality/services/llm.py"
def _is_content_capture_enabled() -> bool:
    return (
        os.environ.get(
            "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", ""
        ).lower() == "true"
    )


def _record_span_event(span, system_prompt, user_prompt, assistant_content):
    attrs = {}
    if system_prompt:
        attrs["gen_ai.system_instructions"] = json.dumps(
            [{"type": "text", "content": scrub_pii(system_prompt)[:500]}]
        )
    attrs["gen_ai.input.messages"] = json.dumps(
        [{"role": "user", "parts": [
            {"type": "text", "content": scrub_pii(user_prompt)[:500]}
        ]}]
    )
    attrs["gen_ai.output.messages"] = json.dumps(
        [{"role": "assistant", "parts": [
            {"type": "text", "content": scrub_pii(assistant_content)[:500]}
        ]}]
    )
    span.add_event("gen_ai.client.inference.operation.details", attrs)
```

## Eval-Driven Development with Promptfoo

Use Promptfoo to systematically test prompt quality and prevent regressions:

```yaml showLineNumbers title="promptfooconfig.yaml"
providers:
  - id: python:evals/provider.py:review_provider
    label: "Review Endpoint"
  - id: python:evals/provider.py:improve_provider
    label: "Improve Endpoint"
  - id: python:evals/provider.py:score_provider
    label: "Score Endpoint"

tests:
  - vars:
      content: "Our REVOLUTIONARY product is the BEST in the market!"
      content_type: marketing
    assert:
      - type: is-json
      - type: javascript
        value: "file://evals/assertions/review.js"

  - vars:
      content: "PostgreSQL uses MVCC for concurrent transaction isolation."
      content_type: technical
    assert:
      - type: is-json
      - type: javascript
        value: "file://evals/assertions/score.js"
```

Run evaluations:

```bash showLineNumbers title="Terminal"
npx promptfoo eval
npx promptfoo view
```

## FastAPI Application

```python showLineNumbers title="src/content_quality/main.py"
import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from opentelemetry import trace
from opentelemetry.trace import StatusCode

from content_quality.config import get_settings
from content_quality.middleware import MetricsMiddleware
from content_quality.models.requests import ContentRequest
from content_quality.services.analyzer import ContentAnalyzer
from content_quality.services.llm import create_llm
from content_quality.telemetry import instrument_fastapi, setup_telemetry

settings = get_settings()
setup_telemetry(
    service_name=settings.service_name,
    otlp_endpoint=settings.otlp_endpoint,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    app.state.llm = create_llm(
        provider=settings.llm_provider,
        model=settings.llm_model,
        temperature=settings.llm_temperature,
        api_key={
            "openai": settings.openai_api_key,
            "google": settings.google_api_key,
            "anthropic": settings.anthropic_api_key,
        }.get(settings.llm_provider, ""),
        timeout=settings.llm_timeout,
    )
    app.state.analyzer = ContentAnalyzer(app.state.llm)
    yield


app = FastAPI(title="AI Content Quality Agent", lifespan=lifespan)
app.add_middleware(MetricsMiddleware)
instrument_fastapi(app)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": settings.service_name}


@app.post("/review")
async def review_content(request: ContentRequest):
    try:
        return await asyncio.wait_for(
            app.state.analyzer.review(request.content, request.content_type),
            timeout=settings.request_timeout,
        )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Analysis timed out")
    except Exception:
        raise HTTPException(status_code=502, detail="Analysis failed")


@app.post("/improve")
async def improve_content(request: ContentRequest):
    try:
        return await asyncio.wait_for(
            app.state.analyzer.improve(request.content, request.content_type),
            timeout=settings.request_timeout,
        )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Analysis timed out")
    except Exception:
        raise HTTPException(status_code=502, detail="Analysis failed")


@app.post("/score")
async def score_content(request: ContentRequest):
    try:
        return await asyncio.wait_for(
            app.state.analyzer.score(request.content, request.content_type),
            timeout=settings.request_timeout,
        )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Analysis timed out")
    except Exception:
        raise HTTPException(status_code=502, detail="Analysis failed")
```

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

```bash showLineNumbers
uv run uvicorn content_quality.main:app --reload --host 0.0.0.0 --port 8000
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

```bash showLineNumbers
OTEL_SDK_DISABLED=false \
LLM_PROVIDER=anthropic \
LLM_MODEL=claude-sonnet-4-5-20250929 \
OTLP_ENDPOINT=http://collector:4318 \
uv run uvicorn content_quality.main:app --host 0.0.0.0 --port 8000
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

```bash showLineNumbers
docker compose up --build

curl http://localhost:8000/health

docker compose down
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verify Telemetry Is Working

```bash showLineNumbers
curl http://localhost:13133
# Open http://localhost:55679/debug/tracez for zpages
```

### Enable Debug Mode

```python showLineNumbers
import logging
logging.getLogger("opentelemetry").setLevel(logging.DEBUG)
```

### Common Issues

#### Issue: Token counts are zero

**Solutions:**

1. Check your LLM SDK version — older versions may not expose `usage`
2. Verify the provider response has `input_tokens` and `output_tokens`
3. For Google GenAI, check `response.usage_metadata` instead of `response.usage`

#### Issue: Cost metrics not accurate

**Solutions:**

1. Verify your `PRICING` dictionary contains the exact model ID string
   returned by the provider (e.g., `gpt-4.1-nano`, not `gpt-4.1`)
2. Check that cost is calculated with `/1_000_000` (pricing is per million tokens)

#### Issue: Structured output validation fails repeatedly

**Solutions:**

1. Verify your Pydantic model has proper `Field` descriptions
2. Check that `MAX_PARSE_RETRIES` is set to at least 2
3. Try adding `response_mime_type: "application/json"` for Google models

#### Issue: Spans not exported to Scout

**Solutions:**

1. Confirm collector: `curl http://localhost:13133`
2. Check collector logs: `docker compose logs otel-collector`
3. Verify `OTLP_ENDPOINT` points to the collector, not directly to Scout

## Security Considerations

### Protecting Sensitive Data

- **Never record raw prompts** that may contain user data, API keys,
  or credentials in span attributes or events
- **Truncate content** to 500 characters to avoid oversized spans
- **Disable content capture** in production if compliance requires
  it — set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`
- **Scrub PII** before recording any content in telemetry (see
  [PII Scrubbing](#pii-scrubbing) for the regex patterns used)

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Use opt-in content capture — disabled by default in this guide
- Record only token counts and model metadata, not prompt content
- Audit span attributes regularly for sensitive data leaks
- Use the OTel Collector `attributes` processor to redact fields
  before export if additional filtering is needed

## Performance Considerations

OpenTelemetry overhead is negligible relative to LLM API latency. A typical
LLM call takes 1-5 seconds; span creation adds microseconds.

### Optimization Strategies

#### 1. Use BatchSpanProcessor

```python showLineNumbers
trace_provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(endpoint=endpoint),
        max_queue_size=2048,
        max_export_batch_size=512,
    )
)
```

#### 2. Truncate Content Events

Always truncate prompts and completions to keep span sizes reasonable:

```python showLineNumbers
scrub_pii(prompt)[:500]  # 500 chars max
```

#### 3. Disable Content Capture in High-Volume Scenarios

```bash showLineNumbers
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

## FAQ

### Why use custom instrumentation instead of OpenInference?

OpenInference produces non-standard attributes (`llm.*`, `input.*`,
`output.*`) that are specific to LlamaIndex and don't follow the
OpenTelemetry GenAI semantic conventions. Custom instrumentation gives you
standard attributes (`gen_ai.*`) that work with any OTel-compatible backend.

### Does OpenTelemetry add latency to LLM calls?

No. Span creation takes microseconds. LLM API calls take seconds. The
overhead is unmeasurable. `BatchSpanProcessor` exports in a background thread.

### How do I track cost across multiple LLM providers?

Use the `gen_ai.client.cost` counter metric with `gen_ai.provider.name` and
`gen_ai.request.model` attributes. Define pricing per model and calculate
from token counts.

### How does structured output self-correction work?

When the LLM returns invalid JSON, the system appends the validation error
to the conversation and asks the LLM to retry. This happens up to
`MAX_PARSE_RETRIES` times (default 2) before raising an error.

### Can I see prompts and completions in traces?

Yes, if `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`. Content
is PII-scrubbed and truncated to 500 characters. Disable in production for
compliance.

### How do I add a new LLM provider?

Add the provider to `create_llm()`, add its server address to
`PROVIDER_SERVERS`, and add its model pricing to the `PRICING` dictionary.

### How do I version prompts?

Prompts are stored as YAML files in the `prompts/` directory with version
suffixes (e.g., `review_v1.yaml`, `review_v2.yaml`). The active version is
configured via `REVIEW_PROMPT_VERSION` environment variable.

### How do I run Promptfoo evaluations?

Install Promptfoo (`npm install -g promptfoo`), then run `npx promptfoo eval`
from the project root. Results can be viewed with `npx promptfoo view`.

### How does PII scrubbing work?

Regex patterns detect and replace emails, phone numbers, SSNs, credit card
numbers, and LinkedIn URLs with safe placeholders before any content is
recorded in span events.

### Can I use this with RAG systems?

Yes. The patterns here (GenAI spans, token tracking, cost metrics) apply to
any LlamaIndex application. For RAG, add spans around your retrieval step
with attributes like `retrieval.document_count` and `retrieval.strategy`.

## What's Next?

### Advanced Topics

- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  Comprehensive GenAI observability patterns
- [FastAPI Auto-Instrumentation](./fast-api.md) - FastAPI-specific setup
- [Python Custom Instrumentation](../custom-instrumentation/python.md) -
  Manual tracing fundamentals

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) -
  Alert on cost spikes, error rates, or quality degradation
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) -
  Build dashboards for token usage, cost attribution, and evaluation scores

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with the OTel Collector

## Complete Example

### Project Structure

```text
ai-content-quality/
├── src/content_quality/
│   ├── main.py              # FastAPI app with lifespan
│   ├── config.py            # Pydantic Settings
│   ├── telemetry.py         # OTel initialization
│   ├── pii.py               # PII scrubbing
│   ├── models/
│   │   ├── requests.py      # ContentRequest schema
│   │   └── responses.py     # ReviewResult, ImproveResult, ScoreResult
│   ├── services/
│   │   ├── llm.py           # GenAI spans, metrics, structured output
│   │   ├── analyzer.py      # Content analysis with evaluation metrics
│   │   └── prompts.py       # YAML prompt loader
│   └── middleware/
│       └── metrics.py       # HTTP metrics middleware
├── prompts/
│   ├── review_v1.yaml       # Review prompt v1
│   ├── review_v2.yaml       # Review prompt v2
│   ├── improve_v1.yaml      # Improve prompt
│   └── score_v1.yaml        # Score prompt
├── evals/
│   ├── assertions/          # Promptfoo assertion scripts
│   └── datasets/            # Test case datasets
├── promptfooconfig.yaml     # Promptfoo eval configuration
├── otel-collector-config.yaml
├── compose.yml
├── Dockerfile
└── pyproject.toml
```

### Key Files

| File           | Demonstrates                                      |
| -------------- | ------------------------------------------------- |
| `telemetry.py` | OTel setup (traces + metrics + logs)               |
| `llm.py`       | GenAI spans, token/cost metrics, structured output |
| `analyzer.py`  | Evaluation events and quality metrics              |
| `prompts.py`   | YAML prompt management with versioning             |
| `pii.py`       | PII scrubbing before telemetry recording           |
| `config.py`    | Multi-provider settings with Pydantic              |
| `compose.yml`  | Docker deployment with OTel Collector              |

### GitHub Repository

For a complete working example, see the
[AI Content Quality Agent](https://github.com/base-14/examples/tree/main/python/ai-content-quality)
repository.

## References

- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)
- [LlamaIndex Documentation](https://docs.llamaindex.ai/)
- [Promptfoo Documentation](https://promptfoo.dev/docs/)

## Related Guides

- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  Comprehensive GenAI observability guide
- [FastAPI Auto-Instrumentation](./fast-api.md) - FastAPI-specific setup
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local collector deployment
