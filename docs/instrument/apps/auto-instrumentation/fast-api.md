---
title: FastAPI OpenTelemetry - Native Telemetry Setup for Traces and Metrics
sidebar_label: FastAPI
sidebar_position: 4
description:
  Trace FastAPI with its native OpenTelemetry support in 0.142+. Route-named
  spans and HTTP metrics with no FastAPI instrumentation package.
keywords:
  [
    fastapi opentelemetry,
    fastapi native opentelemetry,
    fastapi telemetry config,
    fastapi opentelemetry without instrumentation,
    fastapi opentelemetry instrumentation,
    fastapi distributed tracing,
    fastapi monitoring,
    fastapi apm,
    fastapi observability,
    fastapi metrics,
    fastapi traces,
    fastapi operation spans,
    fastapi exclude health check tracing,
    fastapiinstrumentor,
    fastapi sqlalchemy tracing,
    opentelemetry python fastapi,
    fastapi otlp exporter,
    fastapi http server request duration,
  ]
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

FastAPI 0.142 and later include OpenTelemetry support in the framework. Once
your application registers a tracer provider and a meter provider, FastAPI
creates a server span for every request, names it after the matched route,
records the HTTP server metrics, and logs unhandled exceptions. There is no
FastAPI instrumentation package to install and nothing to call on the app.
This guide sets that up, adds SQLAlchemy and outbound HTTP spans, and exports
everything over OTLP to an OpenTelemetry Collector.

FastAPI is an async-first Python framework in the same ASGI space as
[Litestar](./litestar.md). [Flask](./flask.md) and [Django](./django.md) are the
established synchronous options. FastAPI's telemetry sits inside the
application, so it sees things an outer ASGI middleware does not: the route
template, dependency resolution, the endpoint call, response serialization and
background tasks. Each of those can become its own span.

Applications on FastAPI 0.141 and earlier use `FastAPIInstrumentor` from
`opentelemetry-instrumentation-fastapi`. That setup is covered in
[FastAPI 0.141 and earlier](#fastapi-0141-and-earlier), along with request
hooks and header capture, which only the instrumentor provides. The rest of the
page describes the native setup, using the
[fastapi-postgres example](https://github.com/base-14/examples/tree/main/python/fastapi-postgres)
as the reference application.

:::tip TL;DR

On FastAPI 0.142 or later, configure an OpenTelemetry tracer provider and meter
provider before requests arrive, and FastAPI traces itself: route-named server
spans from the `fastapi` scope, plus `http.server.request.duration` and
`http.server.active_requests`. Tune it with `FastAPI(telemetry={...})`, for
example `exclude` to skip health checks and `operation_spans` to control the
internal spans. On FastAPI 0.141 and earlier, install
`opentelemetry-instrumentation-fastapi` and call
`FastAPIInstrumentor.instrument_app(app)`.

:::

:::note Running this in production

Storing and querying this data at production volume is what base14 Scout does.
[Check out Scout APM](https://base14.io/scout/apm).

:::

## Overview

This guide shows how to:

- Configure tracer and meter providers so FastAPI's native telemetry turns on.
- Tune it with the `telemetry=` options: `exclude`, `operation_spans`,
  explicit providers and `auto_configure`.
- Add SQLAlchemy query spans and outbound `requests` spans.
- Add a custom metric and manual spans next to FastAPI's own.
- Run FastAPI 0.141 and earlier with `FastAPIInstrumentor`, and move off it.
- Export to base14 Scout through an OpenTelemetry Collector.
- Troubleshoot missing spans, misplaced attributes and duplicate setups.

## Who This Guide Is For

- **FastAPI developers** adding tracing and metrics to an async Python service
  for the first time.
- **Teams upgrading FastAPI** who already run `FastAPIInstrumentor` and want to
  know what changes on 0.142 and later.
- **Platform teams** standardizing telemetry setup across several FastAPI
  services.
- **Backend developers** chasing slow endpoints, slow dependencies or slow
  database queries.
- **DevOps engineers** deploying FastAPI in containers with a Collector
  alongside.

## Prerequisites

- **Python 3.10 or later** for FastAPI 0.142. FastAPI 0.163.1 requires 3.11;
  the example runs on Python 3.15.
- **FastAPI 0.142.0 or later** for native telemetry. Older versions follow
  [FastAPI 0.141 and earlier](#fastapi-0141-and-earlier).
- **An OpenTelemetry Collector** reachable from the application:
  - [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development.
  - [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) for
    production.
- **Basic OpenTelemetry concepts**: traces, spans, attributes and providers.

### Compatibility Matrix

| Component                                 | Minimum | Recommended | Notes                                                              |
| ----------------------------------------- | ------- | ----------- | ------------------------------------------------------------------ |
| **Python**                                | 3.10    | 3.15        | FastAPI 0.163.1 requires 3.11 or later                             |
| **FastAPI**                               | 0.142.0 | 0.163.1     | Native telemetry from 0.142.0; `auto_configure` is opt-in from 0.143.0 |
| **OpenTelemetry API and SDK**             | 1.44.0  | 1.45.2      | FastAPI 0.163.1 depends on `opentelemetry-api` 1.44.0 or later     |
| **OTLP exporter**                         | 1.44.0  | 1.45.2      | `opentelemetry-exporter-otlp`                                      |
| **SQLAlchemy and requests instrumentation** | 0.65b0 | 0.66b2     | `opentelemetry-instrumentation-sqlalchemy`, `-requests`            |
| **SQLAlchemy**                            | 2.0.47  | 2.0.58      | Below 2.1: the 0.66b2 instrumentation supports `sqlalchemy < 2.1.0` |
| **Pydantic**                              | 2.12.5  | 2.14.3      | Installed with FastAPI                                             |
| **OpenTelemetry Collector Contrib**       | 0.165.0 | 0.165.0     | Version used by the example                                        |
| **opentelemetry-instrumentation-fastapi** | 0.66b2  | 0.66b2      | FastAPI 0.141 and earlier only; declares support for `fastapi ~= 0.92` |

Verified on 2026-11-17 with the fastapi-postgres example: FastAPI 0.163.1,
OpenTelemetry SDK 1.45.2, Python 3.15 and Collector Contrib 0.165.0.
Route-named server spans from the `fastapi` scope,
`http.server.request.duration` and `http.server.active_requests` reached the
Collector, all nine verify checks passed, and no spans came from the
`opentelemetry.instrumentation.fastapi` scope.

### What Gets Instrumented

| Source                                   | What it produces                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| FastAPI native telemetry                 | Server span per request, operation spans, HTTP server metrics, exception logs    |
| `opentelemetry-instrumentation-sqlalchemy` | A client span per SQL statement                                                |
| `opentelemetry-instrumentation-requests` | A client span per outbound `requests` call, with trace context injected          |
| Your code                                | Manual spans and application metrics, such as the example's `http_requests_total` |

Other libraries (httpx, Redis, Celery, asyncpg) have their own
`opentelemetry-instrumentation-*` packages and work alongside FastAPI's
telemetry the same way.

## Installation

FastAPI depends on `opentelemetry-api` directly. The `fastapi[all]`,
`fastapi[standard]` and `fastapi[opentelemetry]` extras also install
`opentelemetry-sdk` and `opentelemetry-exporter-otlp-proto-http`. You still add
the SDK and exporter explicitly so their versions are pinned, plus an
instrumentation package for each library you want spans from. There is no
FastAPI instrumentation package on 0.142 and later.

```mdx-code-block
<Tabs>
<TabItem value="pip" label="pip (requirements.txt)" default>
```

The example's `requirements.txt`:

```text title="requirements.txt" showLineNumbers
fastapi[all]==0.163.1
pydantic==2.14.3
psycopg2-binary==2.9.13
SQLAlchemy==2.0.58
email-validator==2.4.0
pwdlib[bcrypt]==0.4.2
bcrypt==5.0.0
PyJWT==2.15.1
python-multipart==0.0.33
alembic==1.20.1
pydantic_settings==2.16.3
opentelemetry-instrumentation-sqlalchemy>=0.61b0
opentelemetry-sdk==1.45.2
opentelemetry-instrumentation-requests>=0.61b0
requests==2.34.2
opentelemetry-exporter-otlp==1.45.2
opentelemetry-api==1.45.2
```

```bash
pip install -r requirements.txt
```

```mdx-code-block
</TabItem>
<TabItem value="uv" label="uv (pyproject.toml)">
```

The dependency list from the example's `pyproject.toml`:

```toml title="pyproject.toml" showLineNumbers
dependencies = [
    "fastapi[all]>=0.142",
    "pydantic>=2.12.5",
    "pydantic-settings>=2.14.2",
    "psycopg2-binary>=2.9.11",
    "SQLAlchemy>=2.0.47,<2.1",
    "email-validator>=2.3",
    "pwdlib[bcrypt]>=0.3",
    "bcrypt>=5.0",
    "PyJWT>=2.13.0",
    "python-multipart>=0.0.31",
    "alembic>=1.18",
    "requests>=2.34.2",
    "opentelemetry-sdk>=1.44",
    "opentelemetry-exporter-otlp>=1.44",
    "opentelemetry-api>=1.44",
    "opentelemetry-instrumentation-sqlalchemy>=0.65b0",
    "opentelemetry-instrumentation-requests>=0.65b0",
]
```

```bash
uv sync
```

```mdx-code-block
</TabItem>
<TabItem value="poetry" label="Poetry">
```

```bash
poetry add "fastapi[all]>=0.142" \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-requests
```

```mdx-code-block
</TabItem>
</Tabs>
```

If an older setup left `opentelemetry-instrumentation-fastapi` in your
dependencies, remove it. It is harmless while unused, but `opentelemetry-instrument`
picks it up automatically (see
[Troubleshooting](#spans-come-from-opentelemetryinstrumentationfastapi-instead-of-fastapi)).

## Configuration

FastAPI's telemetry is on by default and does nothing until a provider exists.
For each request it checks whether a tracer, meter or logger provider is
configured, either globally or through `telemetry=`, and records only the
signals that have one. Because the check runs per request, the providers can be
registered before or after the `FastAPI()` object is created.

### Setup Approaches

```mdx-code-block
<Tabs>
<TabItem value="global" label="Global Providers (Recommended)" default>
```

Register global providers in a telemetry module and call it at startup. This
is the example's `app/telemetry.py`:

```python title="app/telemetry.py" showLineNumbers
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup_telemetry():
    resource = Resource.create()

    trace.set_tracer_provider(TracerProvider(resource=resource))
    trace.get_tracer_provider().add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))

    metric_reader = PeriodicExportingMetricReader(OTLPMetricExporter())
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[metric_reader]))
```

`Resource.create()` reads `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`,
and the OTLP exporters read `OTEL_EXPORTER_OTLP_ENDPOINT`, so the module has no
hard-coded names or URLs.

`app/main.py` calls `setup_telemetry()` and then creates the app with no
telemetry arguments:

```python title="app/main.py" showLineNumbers
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from opentelemetry.instrumentation.requests import RequestsInstrumentor

from .MetricsMiddleware import MetricsMiddleware
from .routers import auth, post, user, vote
from .telemetry import setup_telemetry

setup_telemetry()

app = FastAPI()

app.add_middleware(MetricsMiddleware)
RequestsInstrumentor().instrument()

origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(post.router)
app.include_router(user.router)
app.include_router(auth.router)
app.include_router(vote.router)


@app.get("/")
def root():
    return {"message": "Hello World"}
```

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

The provider code above stays the same across environments. The service name,
resource attributes and Collector endpoint come from the environment. These are
the OpenTelemetry lines in the example's `.env.example`:

```bash title=".env.example" showLineNumbers
# OpenTelemetry Configuration (Optional)
OTEL_SERVICE_NAME=fastapi-postgres-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=development,environment=development,service.version=1.0.0
```

`OTEL_EXPORTER_OTLP_ENDPOINT` is the base URL. The HTTP exporters append
`/v1/traces` and `/v1/metrics` themselves.

FastAPI reads one more variable of its own:
`OTEL_INSTRUMENTATION_HTTP_KNOWN_METHODS`, a comma-separated list that replaces
the set of HTTP methods it reports by name.

```mdx-code-block
</TabItem>
<TabItem value="auto" label="auto_configure">
```

FastAPI can attach OTLP exporters from the `OTEL_*` variables itself. This is
off by default. Turn it on in code:

```python title="main.py"
from fastapi import FastAPI

app = FastAPI(telemetry={"auto_configure": True})
```

or with an environment variable, which an explicit `auto_configure` value
overrides:

```bash
export FASTAPI_OTEL_AUTO_CONFIGURE=true
export OTEL_SERVICE_NAME=fastapi-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

At ASGI lifespan startup, FastAPI adds a batch span processor, a periodic metric
reader and a batch log processor with OTLP HTTP exporters for each signal that
has an endpoint. If a global provider already exists it adds the exporter to
it; if none exists it creates one. Limits to know about:

- It needs `opentelemetry-sdk` and `opentelemetry-exporter-otlp-proto-http`,
  which the `opentelemetry`, `standard` and `all` extras install.
- It supports only `OTEL_{SIGNAL}_EXPORTER=otlp` or `none`, and only the
  `http/protobuf` protocol. Anything else logs a warning
  ("FastAPI automatic telemetry configuration failed") and the app starts
  without the exporters.
- It respects `OTEL_SDK_DISABLED=true`.

Use it for quick setups. For production, configure providers yourself as in
the first tab, so the resource, processors and exporters are explicit.

```mdx-code-block
</TabItem>
<TabItem value="explicit" label="Explicit Providers">
```

When the application does not set global providers, for example when a library
or test harness owns them, pass providers to FastAPI directly. A minimal sketch:

```python title="main.py"
from fastapi import FastAPI
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.trace import TracerProvider

tracer_provider = TracerProvider()
meter_provider = MeterProvider()

app = FastAPI(
    telemetry={
        "tracer_provider": tracer_provider,
        "meter_provider": meter_provider,
    }
)
```

FastAPI uses these instead of the global providers. It never shuts down
providers your application supplies, so flush and shut them down on exit
yourself. Other instrumentations (SQLAlchemy, requests) still read the global
providers unless you pass `tracer_provider=` to them too.

```mdx-code-block
</TabItem>
</Tabs>
```

### Telemetry Options

`telemetry=` takes a `TelemetryConfig` dictionary from `fastapi.telemetry`.
Omitted keys keep their defaults.

| Key               | Default | Effect                                                                                                |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `tracer_provider` | `None`  | Use this provider instead of the global tracer provider                                               |
| `meter_provider`  | `None`  | Use this provider instead of the global meter provider                                                |
| `logger_provider` | `None`  | Use this provider instead of the global logger provider                                               |
| `tracing`         | `True`  | Server spans for HTTP requests and WebSocket connections                                              |
| `metrics`         | `True`  | `http.server.request.duration` and `http.server.active_requests`                                      |
| `logs`            | `True`  | Log records for validation failures and unhandled exceptions                                          |
| `operation_spans` | `True`  | Internal spans for dependencies, endpoint, serialization and background tasks                         |
| `auto_configure`  | `False` | Add OTLP exporters from `OTEL_*` variables; `FASTAPI_OTEL_AUTO_CONFIGURE=true` changes the default     |
| `exclude`         | `None`  | A function that receives the ASGI scope; return `True` to skip telemetry for that request             |

To turn a signal off, set its key to `False`:

```python title="main.py"
app = FastAPI(telemetry={"logs": False})
```

### Excluding Health Checks

`exclude` receives the ASGI scope and returns `True` for requests FastAPI
should not observe. An excluded request gets no server span, no operation
spans, no metric points and no logs from FastAPI. The
[ai-sales-intelligence example](https://github.com/base-14/examples/tree/main/python/ai-sales-intelligence)
keeps its health check out this way:

```python title="src/sales_intelligence/telemetry.py" showLineNumbers
def skip_health_check(scope: MutableMapping[str, Any]) -> bool:
    """Keep the health check out of FastAPI's request spans and metrics."""
    return bool(scope.get("path") == "/health")


# Routes, and the spans they start, run directly under the server span rather than
# under FastAPI's operation spans, so trace.get_current_span() in a route is the request span.
FASTAPI_TELEMETRY: TelemetryConfig = {"exclude": skip_health_check, "operation_spans": False}
```

and passes the config when it creates the app:

```python title="src/sales_intelligence/main.py" showLineNumbers
app = FastAPI(
    title="AI Sales Intelligence",
    description="AI-powered sales prospecting and outreach automation",
    version="2.0.0",
    lifespan=lifespan,
    telemetry=FASTAPI_TELEMETRY,
)
```

The scope carries `path`, `method`, `headers`, `type` and the rest of the ASGI
connection data, so the function can match on any of them. Spans from other
instrumentations, such as a SQLAlchemy query run during an excluded request,
are still recorded and have no FastAPI server span as their parent.

The fastapi-postgres example has no health route and leaves `exclude` unset.
Its Collector drops health spans with a `filter` processor instead, which also
works for services you cannot change.

### Operation Spans

With `operation_spans` on (the default), FastAPI adds internal spans under the
server span:

| Span                     | Covers                                                         |
| ------------------------ | -------------------------------------------------------------- |
| `fastapi.dependencies`   | Resolving the route's dependencies, including nested ones      |
| `fastapi.endpoint`       | Calling the route function                                     |
| `fastapi.serialization`  | Validating and serializing the response model                  |
| `fastapi.background_task` | Each background task, run after the response is sent          |

Each carries `code.function.name`, the module and qualified name of the route
function or task. When the wrapped code raises an exception other than
`HTTPException` or a validation error, the operation span gets status ERROR
and `error.type`. Background task spans record any exception.

The consequence for application code: inside a route function,
`trace.get_current_span()` returns `fastapi.endpoint`, not the server span. An
attribute set on it lands on the endpoint span, and a server-span query in
Scout (by `http.route`, for example) does not see it. Applications that tag the
request span from route code set `operation_spans` to `False`, as the
ai-sales-intelligence example does above. With operation spans off, the
current span inside a route is the server span.

Middleware is not affected. It runs inside the server span but outside the
operation spans, so `trace.get_current_span()` in a middleware is always the
server span.

### Reading Request Data in Processors

`fastapi.telemetry.get_telemetry_data()` returns a `TelemetryData` object for
the request being handled, or `None` outside one. It is meant for synchronous
span or log processors that need request details FastAPI does not put on spans:

| Field       | Available                                           |
| ----------- | --------------------------------------------------- |
| `request`   | When the route handler starts                       |
| `websocket` | When a WebSocket handler starts                     |
| `body`      | The body FastAPI read, before validation            |
| `values`    | The parsed arguments, after dependency resolution   |
| `errors`    | Validation errors, including the original input     |

Treat the data as read-only and redact it before any of it reaches an
exporter. It is cleared when the request finishes, so read it synchronously
inside the processor callback, not from a background thread.

```python
from fastapi.telemetry import get_telemetry_data
```

## FastAPI 0.141 and earlier

FastAPI before 0.142 has no built-in telemetry. Use `FastAPIInstrumentor`,
which wraps the app in the ASGI `OpenTelemetryMiddleware`. It also works on
any later version, and it is the only way to get request and response hooks
or header capture, which the native support does not offer.

### Install the Instrumentor

```bash
pip install opentelemetry-instrumentation-fastapi
```

### Instrument the App

Set up providers as in [Configuration](#configuration), then instrument the
app after creating it. A minimal sketch:

```python title="app/main.py"
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from .telemetry import setup_telemetry

setup_telemetry()

app = FastAPI()

FastAPIInstrumentor.instrument_app(
    app,
    excluded_urls="/health,/metrics",
    exclude_spans=["receive", "send"],
)
```

`excluded_urls` is a comma-separated list of regular expressions matched
against the URL. `OTEL_PYTHON_FASTAPI_EXCLUDED_URLS` sets the same list from
the environment. `exclude_spans=["receive", "send"]` drops the internal spans
the ASGI middleware creates for each `receive` and `send` call, which are
usually noise.

The instrumentor emits the older HTTP semantic conventions by default, so its
duration metric is `http.server.duration` in milliseconds. Set
`OTEL_SEMCONV_STABILITY_OPT_IN=http` to get `http.server.request.duration` in
seconds, the name FastAPI's native telemetry uses.

### Request and Response Hooks

Hooks run on every request and let you add attributes from the ASGI scope or
messages. Their signatures:

- `server_request_hook(span, scope)` runs for the server span.
- `client_request_hook(span, scope, message)` runs for each `receive` call.
- `client_response_hook(span, scope, message)` runs for each `send` call.

A minimal sketch:

```python title="app/main.py"
from typing import Any

from opentelemetry.trace import Span


def server_request_hook(span: Span, scope: dict[str, Any]) -> None:
    if span and span.is_recording():
        span.set_attribute("app.root_path", scope.get("root_path", ""))


FastAPIInstrumentor.instrument_app(app, server_request_hook=server_request_hook)
```

The client hooks run on the `receive` and `send` spans, so they have nothing to
attach to if you exclude those spans.

### HTTP Header Capture

The instrumentor can record selected request and response headers as span
attributes:

```python title="app/main.py"
FastAPIInstrumentor.instrument_app(
    app,
    http_capture_headers_server_request=["content-type", "user-agent", "x-request-id"],
    http_capture_headers_server_response=["content-type", "content-length"],
    http_capture_headers_sanitize_fields=["authorization", "cookie", "set-cookie"],
)
```

Captured headers appear as `http.request.header.<name>` and
`http.response.header.<name>`, lowercased with dashes turned into underscores
(`http.request.header.user_agent`). Headers listed in the sanitize fields are
recorded with a redacted value. The environment equivalents are
`OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST`,
`OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE` and
`OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SANITIZE_FIELDS`.

### Moving to FastAPI 0.142 or Later

Upgrade FastAPI, then remove the `FastAPIInstrumentor.instrument_app` call and
the `opentelemetry-instrumentation-fastapi` dependency. FastAPI's own
telemetry takes over with the providers you already configure. Until you
remove the instrumentor, FastAPI detects its `OpenTelemetryMiddleware` in the
middleware stack and keeps its own tracing, metrics and logs off, so nothing
is recorded twice. Move `excluded_urls` to an `exclude` function. If you rely
on hooks or header capture, keep the instrumentor; that is a supported setup
on any FastAPI version.

## Traces

FastAPI creates one server span per HTTP request and per WebSocket connection,
from the instrumentation scope `fastapi`.

### Server Span

The span starts as soon as the request enters the app and is renamed once the
router resolves a route:

| Request                         | Span name           |
| ------------------------------- | ------------------- |
| `GET /posts/42`                 | `GET /posts/{id}`   |
| WebSocket on `/ws`              | `WS /ws`            |
| Unknown method on a route       | `HTTP /posts/{id}`  |
| No route matched (404)          | `GET`               |

Attributes on the server span:

| Attribute                      | Example or note                                                         |
| ------------------------------ | ----------------------------------------------------------------------- |
| `http.request.method`          | `GET`; unknown methods become `_OTHER`                                  |
| `http.request.method_original` | Set only when the method is reported as `_OTHER`                        |
| `http.route`                   | `/posts/{id}`, including mount prefixes                                 |
| `http.response.status_code`    | `200`                                                                   |
| `url.scheme`                   | `http`                                                                  |
| `url.path`                     | `/posts/42`                                                             |
| `url.query`                    | Query string, with signed-URL parameters redacted                       |
| `server.address`, `server.port` | From the `Host` header                                                 |
| `network.protocol.version`     | `1.1`                                                                   |
| `error.type`                   | Exception type, or the status code, on failed requests                  |

The status is ERROR for 5xx responses and unhandled exceptions. Client errors
(4xx) leave it UNSET, following the HTTP semantic conventions for server spans.

FastAPI extracts the incoming trace context with the global propagator, which
is W3C Trace Context and Baggage unless you change it. A request that carries a
`traceparent` header continues the caller's trace.

### Span Hierarchy

A `GET /posts/{id}` request in the example, which resolves the current user
through a dependency and then queries the post, produces this shape:

```text
GET /posts/{id}                          SERVER    scope: fastapi
├── fastapi.dependencies                 INTERNAL  (get_current_user queries the user)
│   └── SELECT python-fastapi-dev        CLIENT    scope: opentelemetry.instrumentation.sqlalchemy
├── fastapi.endpoint                     INTERNAL  (get_post)
│   └── SELECT python-fastapi-dev        CLIENT    scope: opentelemetry.instrumentation.sqlalchemy
└── fastapi.serialization                INTERNAL  (response_model=PostOut)
```

With `operation_spans` off, the SQL spans sit directly under the server span.

### Reference

[OpenTelemetry Traces](https://opentelemetry.io/docs/concepts/signals/traces/)
and the
[HTTP span conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/).

## Metrics

FastAPI records two HTTP server metrics from the meter `fastapi`. WebSocket
connections are not measured.

| Metric                         | Type          | Unit        | Attributes                                                                                       |
| ------------------------------ | ------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `http.server.request.duration` | Histogram     | `s`         | `http.request.method`, `url.scheme`, `network.protocol.version`, `http.route`, `http.response.status_code`, `error.type` |
| `http.server.active_requests`  | UpDownCounter | `{request}` | `http.request.method`, `url.scheme`                                                              |

The duration histogram uses the semantic-convention bucket boundaries from
5 ms to 10 s. Because it is labelled with `http.route` rather than the raw
path, its cardinality stays bounded by the number of routes.

### Application Metrics

Everything beyond those two is yours to add. The example keeps a small
middleware that counts requests per path, under its own metric name:

```python title="app/MetricsMiddleware.py" showLineNumbers
import os

from opentelemetry.metrics import get_meter
from starlette.middleware.base import BaseHTTPMiddleware


class MetricsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        service_name = os.getenv("OTEL_SERVICE_NAME", "fastapi-postgres-app")
        self.meter = get_meter(service_name)
        self.http_requests_counter = self.meter.create_counter(
            name="http_requests_total", unit="1", description="Number of HTTP requests per route"
        )

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        self.http_requests_counter.add(
            1,
            {
                "method": request.method,
                "path": request.url.path,
                "status_code": str(response.status_code),
            },
        )
        return response
```

This counter is labelled with `request.url.path`, so `/posts/1` and `/posts/2`
are separate series. For request counts by route, use the count of
`http.server.request.duration` instead; a custom middleware is worth keeping
for business dimensions FastAPI does not know about.

## Logs

When a logger provider is configured, FastAPI emits log records from the
`fastapi` scope:

| Event name                       | Severity | When                                                       |
| -------------------------------- | -------- | ---------------------------------------------------------- |
| `http.server.request.exception`  | ERROR    | An unhandled exception in a request, with the stack trace  |
| `fastapi.validation.failed`      | WARN     | Request validation fails; attributes `fastapi.validation.error_count` and `http.route` |
| `fastapi.websocket.exception`    | ERROR    | An unhandled exception in a WebSocket connection           |

The fastapi-postgres example does not configure a logger provider, so it emits
none of these. To add one, register a provider next to the trace and metric
providers. A minimal sketch:

```python title="app/telemetry.py"
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

logger_provider = LoggerProvider(resource=resource)
logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
set_logger_provider(logger_provider)
```

## Production Configuration

### Batch Span Processor

`BatchSpanProcessor` takes its limits as arguments or from
`OTEL_BSP_*` variables. The example uses the defaults. To set them in code:

```python title="app/telemetry.py"
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor

processor = BatchSpanProcessor(
    OTLPSpanExporter(),
    max_queue_size=2048,
    schedule_delay_millis=5000,
    max_export_batch_size=512,
    export_timeout_millis=30000,
)
```

Or from the environment:

```bash
export OTEL_BSP_MAX_QUEUE_SIZE=2048
export OTEL_BSP_SCHEDULE_DELAY=5000
export OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
```

`PeriodicExportingMetricReader` exports every 60 seconds by default;
`export_interval_millis` or `OTEL_METRIC_EXPORT_INTERVAL` changes that.

### Compression and the Collector

Set `OTEL_EXPORTER_OTLP_COMPRESSION=gzip` to compress the app's OTLP requests.
Between the Collector and Scout, the example's Collector exporter compresses
and retries:

```yaml title="config/otel-config.yaml" showLineNumbers
exporters:
  otlp_http/b14:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s
```

### Resource Attributes

Keep identity in the environment so one image runs everywhere. The example's
`compose.yaml` sets the service name and resource attributes on the app
container:

```yaml title="compose.yaml" showLineNumbers
      - OTEL_SERVICE_NAME=fastapi-postgres-app
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_RESOURCE_ATTRIBUTES=${OTEL_RESOURCE_ATTRIBUTES:-deployment.environment.name=development,environment=development,service.version=1.0.0}
```

In Kubernetes, add `k8s.*` attributes through the Collector's
`k8sattributes` processor rather than from application code.

### Dockerfile

The example's multi-stage Dockerfile. No `opentelemetry-instrument` wrapper is
needed; telemetry is configured in code.

```dockerfile title="Dockerfile" showLineNumbers
# Build stage
FROM python:3.15-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Runtime stage
FROM python:3.15-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos '' --uid 1000 appuser

# Copy Python packages from builder
COPY --from=builder /root/.local /home/appuser/.local

# Copy application code
COPY --chown=appuser:appuser . .

# Make sure scripts are in PATH
ENV PATH=/home/appuser/.local/bin:$PATH

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/ || exit 1

# Run the application
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

### Multiple Workers

Each Uvicorn or Gunicorn worker is a separate process with its own providers.
Call `setup_telemetry()` at module import, as the example does, so every worker
configures its own providers when it loads `app.main`.

### Multi-Service Tracing

FastAPI continues incoming traces from the `traceparent` header.
`RequestsInstrumentor` injects the current context into outbound `requests`
calls, and `opentelemetry-instrumentation-httpx` does the same for httpx. With
both sides instrumented, a call from one FastAPI service to another appears as
one trace in Scout.

## Framework-Specific Features

### SQLAlchemy

The example instruments its engine where it creates it:

```python title="app/database.py" showLineNumbers
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from .config import settings

SQLALCHEMY_DATABASE_URL = (
    f"postgresql+psycopg2://"
    f"{settings.db_username}:{settings.db_password}"
    f"@{settings.db_hostname}:{settings.db_port}"
    f"/{settings.db_name}"
)

engine = create_engine(SQLALCHEMY_DATABASE_URL)

# Instrument SQLAlchemy for automatic query tracing
SQLAlchemyInstrumentor().instrument(engine=engine)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

Every statement becomes a client span with the SQL text and database
attributes. For an async engine, pass its `sync_engine`:

```python
SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
```

Queries made while resolving a dependency, like `get_current_user` in the
example, appear under `fastapi.dependencies`; queries in the route body appear
under `fastapi.endpoint`.

### Outbound HTTP

`RequestsInstrumentor().instrument()` in `app/main.py` traces every `requests`
call. For httpx, install `opentelemetry-instrumentation-httpx`:

```python
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

HTTPXClientInstrumentor().instrument()
```

### Dependencies and Background Tasks

Dependency resolution and background tasks are traced by FastAPI itself
through the operation spans. A background task added with
`BackgroundTasks.add_task` gets a `fastapi.background_task` span in the same
trace as the request, starting after the response has been sent. No manual
span is needed to see that a task ran or how long it took.

### Mounted Applications

When a FastAPI app is mounted inside another, only the outer app records the
request, and `http.route` includes the mount prefix: an `/items/{id}` route in
an app mounted at `/api` produces `GET /api/items/{id}`.

### WebSockets

WebSocket connections get a `WS /route` server span covering the connection,
with `network.protocol.name` set to `websocket`. Normal closes (codes 1000 and
1001) are not errors. The HTTP server metrics do not include WebSocket
connections.

## Custom Instrumentation

### Manual Spans

Create a tracer and wrap the work you want to see. A minimal sketch:

```python title="app/routers/orders.py"
from opentelemetry import trace

tracer = trace.get_tracer(__name__)


@router.post("/orders")
def create_order(order: OrderCreate):
    with tracer.start_as_current_span("check_inventory") as span:
        span.set_attribute("order.product_id", order.product_id)
        ...
```

With operation spans on, `check_inventory` is a child of `fastapi.endpoint`.

### Tagging the Request Span

To put a business attribute on the server span, so it can be filtered next to
`http.route` and `http.response.status_code`, either turn operation spans off
and use the current span:

```python title="main.py"
app = FastAPI(telemetry={"operation_spans": False})


@app.get("/accounts/{account_id}")
def get_account(account_id: str):
    trace.get_current_span().set_attribute("app.account_id", account_id)
    ...
```

or keep operation spans and set the attribute from a middleware, where the
current span is always the server span.

### Marking Client Errors as Failures

FastAPI leaves 4xx server spans UNSET. The ai-sales-intelligence example treats
client errors as failures with a middleware:

```python title="src/sales_intelligence/middleware/span_status.py" showLineNumbers
"""Marks the HTTP server span as failed for error responses.

FastAPI's telemetry sets ERROR only from status 500 up. Client errors are
failures of the request too, so this middleware sets ERROR from 400 up on the
server span, which is the current span while the middleware runs.
"""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from starlette.middleware.base import BaseHTTPMiddleware


class SpanStatusMiddleware(BaseHTTPMiddleware):
    """Sets ERROR on the server span for responses with status 400 and above."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)

        if response.status_code >= 400:
            span = trace.get_current_span()
            span.set_attribute("error.type", str(response.status_code))
            span.set_status(Status(StatusCode.ERROR, f"HTTP {response.status_code}"))

        return response
```

It is registered with `app.add_middleware(SpanStatusMiddleware)`.

### Custom Metrics

Get a meter and create instruments once, at import time. A minimal sketch:

```python title="app/metrics.py"
from opentelemetry import metrics

meter = metrics.get_meter(__name__)

orders_created = meter.create_counter(
    "app.orders.created", unit="{order}", description="Orders created"
)
```

```python
orders_created.add(1, {"order.type": order.order_type})
```

Keep attribute values to small, fixed sets; IDs and paths make a series per
value.

### Trace ID in Responses

Returning the trace ID lets a client or support ticket point at the exact
trace. A minimal sketch of a middleware that adds it as a header:

```python title="app/main.py"
from opentelemetry import trace


@app.middleware("http")
async def add_trace_id(request, call_next):
    response = await call_next(request)
    context = trace.get_current_span().get_span_context()
    if context.is_valid:
        response.headers["x-trace-id"] = format(context.trace_id, "032x")
    return response
```

## Running Your Application

### Local Development

From the example directory, with a Collector listening on `localhost:4318`:

```bash
export OTEL_SERVICE_NAME=fastapi-postgres-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
make dev
```

`make dev` runs:

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Docker Compose

The example's `compose.yaml` starts the app, PostgreSQL 18 and Collector
Contrib 0.165.0:

```bash
cp .env.example .env
docker compose up -d --build
```

Set `DB_PASSWORD`, `SECRET_KEY` and the `SCOUT_*` values in `.env` first.

### Verify

Send a few requests:

```bash
curl -s http://localhost:8000/
curl -s -X POST http://localhost:8000/users/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"securepass123"}'
```

Then run the example's checks, which exercise the API and look for spans and
`service.name` in the Collector's debug output:

```bash
make test-api
make verify-scout
```

In the Collector logs, server spans show `InstrumentationScope fastapi` with
names like `POST /users/` and `GET /posts/{id}`, and the metrics include
`http.server.request.duration` and `http.server.active_requests`:

```bash
docker compose logs otel-collector | grep -E "InstrumentationScope|http.server"
```

## Troubleshooting

### No spans because no provider is set

FastAPI's telemetry is a no-op until a tracer provider exists. If the app runs
but nothing from the `fastapi` scope reaches the Collector:

1. Confirm `setup_telemetry()` (or your equivalent) runs in the process that
   serves requests, including every worker.
2. Confirm it calls `trace.set_tracer_provider(...)` and
   `metrics.set_meter_provider(...)`. An SDK provider that is neither
   registered globally nor passed to `telemetry=` is invisible to FastAPI,
   which then sees only the default proxy provider.
3. Print spans locally to separate "not created" from "not exported":

   ```python
   from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

   trace.get_tracer_provider().add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
   ```

4. Check `OTEL_EXPORTER_OTLP_ENDPOINT` points at the Collector's HTTP port
   (4318) and that `OTEL_SDK_DISABLED` is not `true`.

### Attributes set in a route land on fastapi.endpoint

With operation spans on, `trace.get_current_span()` inside a route returns
`fastapi.endpoint`. Attributes set there do not appear on the server span, so
queries by `http.route` miss them. Set `operation_spans` to `False`, or set the
attribute from a middleware (see
[Tagging the Request Span](#tagging-the-request-span)).

### Spans come from opentelemetry.instrumentation.fastapi instead of fastapi

FastAPI turns its own telemetry off when the contrib `OpenTelemetryMiddleware`
is in its middleware stack. That happens when:

- The code still calls `FastAPIInstrumentor.instrument_app(app)` or
  `FastAPIInstrumentor().instrument()`. Remove the call.
- The app runs under `opentelemetry-instrument` with
  `opentelemetry-instrumentation-fastapi` installed, for example after
  `opentelemetry-bootstrap -a install`. Uninstall the package or set
  `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=fastapi`.

Nothing is duplicated in either case; you get the instrumentor's spans
and metric names instead of FastAPI's.

### Server spans named GET with no http.route

The span is renamed when a route matches. Requests that match no route (404s)
keep the bare method name and have no `http.route`. A request missing a
trailing slash is named after the matching route (`POST /users/`) with status
307, followed by a second span for the redirected request. Spans named `HTTP`
are requests with a method outside the known set; set
`OTEL_INSTRUMENTATION_HTTP_KNOWN_METHODS` if your API uses custom methods.

### 4xx responses do not show as errors

This follows the HTTP semantic conventions: a server span is ERROR only for 5xx
responses and unhandled exceptions. Operation spans also skip `HTTPException`
and validation errors. If your dashboards should count client errors as
failures, add a middleware like
[the one above](#marking-client-errors-as-failures), or filter on
`http.response.status_code` in Scout.

### Database queries not traced

`SQLAlchemyInstrumentor().instrument(engine=engine)` must receive the engine
the sessions use. For async engines pass `engine.sync_engine`.
`opentelemetry-instrumentation-sqlalchemy` 0.66b2 supports `sqlalchemy < 2.1.0`
and instruments nothing on 2.1, with only a log warning; keep SQLAlchemy on 2.0
until the instrumentation supports 2.1. Check the package is installed:

```bash
pip show opentelemetry-instrumentation-sqlalchemy
```

## Security Considerations

### What FastAPI Records

- **Query strings**: `url.query` holds the full query string. Only the
  signed-URL parameters `X-Amz-Signature`, `X-Amz-Credential`,
  `X-Amz-Security-Token`, `sig` and `X-Goog-Signature` are replaced with
  `REDACTED`. Other parameters, such as `token` or `api_key`, are recorded as
  sent. Keep secrets out of query strings, or remove the attribute in the
  Collector.
- **Headers**: native telemetry records none.
- **Exception logs**: `http.server.request.exception` records carry the
  exception message and stack trace. Set `logs` to `False` if exception
  messages can contain user data.
- **Request data for processors**: `get_telemetry_data()` exposes the body and
  validation errors with the original input. Redact before exporting anything
  derived from them.

To drop the query string for every service, delete the attribute in the
Collector:

```yaml title="otel-collector-config.yaml"
processors:
  attributes/drop-query:
    actions:
      - key: url.query
        action: delete
```

Add `attributes/drop-query` to the traces pipeline's processors.

### Sensitive Data in Custom Attributes

Record references, not values:

```python
span.set_attribute("user.id", user.id)
span.set_attribute("payment.method", "card")
```

Never set passwords, tokens, card numbers or personal identifiers as span or
metric attributes.

### SQL Statements

The SQLAlchemy instrumentation records the statement text it sends. ORM queries
use bind parameters, so values do not appear in the text; raw SQL with values
written into the string does. Use bound parameters for raw SQL.

### Header Capture on the Instrumentor

If you run `FastAPIInstrumentor` for header capture, list only the headers you
need and put `authorization`, `cookie` and `set-cookie` in
`http_capture_headers_sanitize_fields`.

### Credentials

The example keeps `SCOUT_CLIENT_ID` and `SCOUT_CLIENT_SECRET` in `.env`, read
only by the Collector container. The application needs no Scout credentials;
it sends to the Collector. In production, load these from your secrets manager.

## Performance Considerations

### Span Volume

Each request produces one server span plus up to four operation spans
(dependencies, endpoint, serialization, background task), plus a span per SQL
statement and outbound call. If you do not need the operation spans, setting
`operation_spans` to `False` removes them and leaves the server span and the
library spans.

### Health Checks and Probes

Kubernetes probes and load balancer checks can outnumber real traffic. Exclude
them with `exclude` so they create no spans and no metric points, or drop them
in the Collector as the example does:

```yaml title="config/otel-config.yaml" showLineNumbers
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*/health.*")'
```

The Collector filter removes the spans but not the metric points, which are
recorded in the app. `exclude` stops both.

### Batching

Use `BatchSpanProcessor` outside local debugging; `SimpleSpanProcessor`
exports each span synchronously on the request path. Tune the queue and batch
size as in [Batch Span Processor](#batch-span-processor).

### Metric Cardinality

FastAPI's metrics are labelled by `http.route`, so the number of series grows
with routes and status codes, not with URLs. Custom metrics labelled with raw
paths or IDs, like the example's `http_requests_total`, grow with traffic.

## FAQ

### Does FastAPI have built-in OpenTelemetry support?

Yes, FastAPI 0.142.0 and later trace requests and record HTTP server metrics
on their own once an OpenTelemetry tracer provider and meter provider are
configured. You configure the providers and exporters; FastAPI creates the
spans, metrics and exception logs. Configuration goes through
`FastAPI(telemetry={...})`.

### Do I need opentelemetry-instrumentation-fastapi on FastAPI 0.142+?

No, not for request spans and HTTP metrics. Keep it only if you need request
and response hooks or header capture, which FastAPI's native support does not
provide. On FastAPI 0.141 and earlier it is still required.

### Does FastAPIInstrumentor duplicate FastAPI's native spans?

No, FastAPI turns its own tracing, metrics and logs off when it finds the
instrumentor's `OpenTelemetryMiddleware` in the middleware stack. You get the
instrumentor's telemetry only. Remove the instrumentor to switch to FastAPI's.

### Why does trace.get_current_span() in a FastAPI route return fastapi.endpoint?

Because operation spans are on by default, and the route function runs inside
the `fastapi.endpoint` span. Set `FastAPI(telemetry={"operation_spans": False})`
to make the server span current inside routes, or set request-level attributes
from a middleware.

### How do I exclude health checks from FastAPI tracing?

Pass an `exclude` function that returns `True` for the health check path, for
example `FastAPI(telemetry={"exclude": lambda scope: scope.get("path") == "/health"})`.
Excluded requests get no FastAPI spans, metrics or logs.

### Which metrics does FastAPI's native OpenTelemetry support emit?

FastAPI emits `http.server.request.duration`, a histogram in seconds, and
`http.server.active_requests`, an up-down counter, both from the meter
`fastapi`. Duration carries `http.route`, method, status code and
`error.type`. WebSocket connections are not measured.

### Why are 4xx responses not marked as errors in FastAPI traces?

FastAPI follows the OpenTelemetry HTTP conventions, which mark a server span as
an error only for 5xx responses and unhandled exceptions. A 404 or 422 keeps
status UNSET with `http.response.status_code` set. Add a middleware that sets
ERROR from 400 up if you want client errors counted as failures.

### Can FastAPI export telemetry without provider setup code?

Yes, with `auto_configure`: set `FASTAPI_OTEL_AUTO_CONFIGURE=true` or pass
`telemetry={"auto_configure": True}`, and FastAPI adds OTLP HTTP exporters from
the `OTEL_*` variables at startup. It is off by default and supports only the
`http/protobuf` protocol. Explicit providers give you control over the
resource and processors.

### How do I capture request headers on FastAPI spans?

Use `FastAPIInstrumentor` with `http_capture_headers_server_request`, because
FastAPI's native telemetry does not record headers. Sanitize `authorization`
and cookies with `http_capture_headers_sanitize_fields`. See
[HTTP Header Capture](#http-header-capture).

### Does FastAPI's native telemetry work with async routes and background tasks?

Yes, async and sync routes are both traced, and each background task gets a
`fastapi.background_task` span in the request's trace. Context propagates
through `await`, so spans from async database or HTTP clients nest under the
right parent.

### How do I trace SQLAlchemy queries in a FastAPI app?

Install `opentelemetry-instrumentation-sqlalchemy` and call
`SQLAlchemyInstrumentor().instrument(engine=engine)` where the engine is
created. Each statement becomes a client span under the FastAPI operation or
server span that issued it.

## What's Next?

### Advanced Topics

- [Python Custom Instrumentation](../custom-instrumentation/python.md) - Manual
  spans, metrics, and advanced patterns.
- [OpenTelemetry Collector Configuration](../../collector-setup/otel-collector-config.md)
  \- Advanced collector features.

### base14 Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts based on traces and metrics.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards.

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment.
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production Kubernetes deployment.
- [Scout Exporter Configuration](../../collector-setup/scout-exporter.md) -
  Configure authentication and endpoints.

## Complete Example

The [fastapi-postgres example](https://github.com/base-14/examples/tree/main/python/fastapi-postgres)
is a FastAPI posts-and-votes API on PostgreSQL with native FastAPI telemetry,
SQLAlchemy and `requests` instrumentation, a custom request counter, and a
Collector that exports to Scout.

### Project Structure

```text
fastapi-postgres/
├── app/
│   ├── main.py               # setup_telemetry(), FastAPI(), middleware, routers
│   ├── telemetry.py          # tracer and meter providers with OTLP exporters
│   ├── database.py           # engine and SQLAlchemyInstrumentor
│   ├── MetricsMiddleware.py  # http_requests_total counter
│   ├── oauth2.py             # get_current_user dependency
│   └── routers/              # auth, post, user, vote
├── config/
│   └── otel-config.yaml      # Collector: OTLP in, Scout and debug out
├── scripts/
│   ├── test-api.sh
│   └── verify-scout.sh
├── compose.yaml
├── Dockerfile
├── pyproject.toml
├── requirements.txt
└── uv.lock
```

### How the Pieces Fit

1. `app/main.py` calls `setup_telemetry()`, which registers global tracer and
   meter providers with OTLP HTTP exporters.
2. `FastAPI()` is created with no telemetry config. FastAPI finds the global
   providers and traces every request.
3. `app/database.py` instruments the SQLAlchemy engine, and `app/main.py`
   instruments `requests`.
4. `MetricsMiddleware` adds the `http_requests_total` counter.
5. The Collector receives OTLP on 4318, drops health spans, and exports to
   Scout and the debug exporter.

The full files are in [Configuration](#setup-approaches),
[SQLAlchemy](#sqlalchemy) and [Application Metrics](#application-metrics).

### Run It

```bash
git clone https://github.com/base-14/examples.git
cd examples/python/fastapi-postgres
cp .env.example .env
docker compose up -d --build
make test-api
make verify-scout
```

Once telemetry is flowing, you can
[track FastAPI route latency and errors in Scout APM](https://base14.io/scout/apm)
alongside the SQL spans behind each endpoint.

## References

- [OpenTelemetry Python Documentation](https://opentelemetry.io/docs/languages/python/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [HTTP Span Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [HTTP Metric Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
- [OpenTelemetry Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [OpenTelemetry Traces](https://opentelemetry.io/docs/concepts/signals/traces/)

## Related Guides

- [Django Instrumentation](./django.md) - Full-featured Python framework with
  ORM.
- [Flask Instrumentation](./flask.md) - Lightweight Python web framework.
- [Litestar Instrumentation](./litestar.md) - Another ASGI framework.
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up the Collector for local development.
- [Python Custom Instrumentation](../custom-instrumentation/python.md) - Manual
  spans and advanced patterns.
- [All framework guides](/instrument/apps/auto-instrumentation/) -
  Auto-instrumentation overview for every language.
