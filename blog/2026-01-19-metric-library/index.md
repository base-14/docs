---
slug: metric-registry
date: 2026-01-19
title: "Live Metric Registry: find and understand observability metrics across your stack"
authors: [ranjan-sakalley]
tags: [observability, metrics, opentelemetry, prometheus, open-source]
---

Introducing [Metric Registry](https://metric-registry.base14.io): a live,
searchable catalog of 3,700+ observability (and rapidly growing) metrics
extracted directly from source repositories across the OpenTelemetry,
Prometheus, and Kubernetes ecosystems, including cloud provider metrics.
Metric Registry is open source and built to stay current automatically as
projects evolve.

## What you can do today with Metric Registry

**Search across your entire observability stack.** Find metrics by name,
description, or component, whether you're looking for HTTP-related histograms
or database connection metrics.

**Understand what metrics actually exist.** The registry covers 15 sources
including OpenTelemetry Collector receivers, Prometheus exporters (PostgreSQL,
Redis, MySQL, MongoDB, Kafka), Kubernetes metrics (kube-state-metrics,
cAdvisor), and LLM observability libraries.

**See which metrics follow standards.** Each metric shows whether it complies
with OpenTelemetry Semantic Conventions, helping you understand what's
standardized versus custom.

**Trace back to the source.** Every metric links to its origin: the repository,
file path, and commit hash. When you need to understand a metric's exact
definition, you can go straight to the source.

**Trust the data.** Metrics are extracted automatically from source code and
official metadata files, and the registry refreshes nightly to stay current as
projects evolve.

**Can't find what you're looking for?** Open an issue or better yet, submit a
PR to add new sources or improve existing extractors.

### Sources already indexed

| Category | Sources |
|----------|---------|
| OpenTelemetry | Collector Contrib, Semantic Conventions, Python, Java, JavaScript |
| Prometheus | node_exporter, postgres_exporter, redis_exporter, mysql_exporter, mongodb_exporter, kafka_exporter |
| Kubernetes | kube-state-metrics, cAdvisor |
| LLM Observability | OpenLLMetry, OpenLIT |
| CloudWatch | RDS, ALB, DynamoDB, Lambda, EC2, S3, SQS, API Gateway |

<!--truncate-->

<iframe
  width="100%"
  height="400"
  src="https://www.youtube.com/embed/A7GNbDjTL2s?rel=0"
  title="YouTube video player"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media;
    gyroscope; picture-in-picture; web-share; fullscreen"
  allowfullscreen>
</iframe>

*Watch: Introduction to the Live Metric Registry.*

## What's the need for a Metric Registry?

If you've ever tried to answer "what metrics does my stack actually emit?", you
know the pain. Observability metrics are scattered across hundreds of
repositories, exporters, and instrumentation libraries. The OpenTelemetry
Collector Contrib repo alone has over 100 receivers, each emitting dozens of
metrics. Add Prometheus exporters for PostgreSQL, Redis, MySQL, Kafka. Then
Kubernetes metrics from kube-state-metrics and cAdvisor. Then your application
instrumentation across Go, Java, Python, and JavaScript.

Each source uses different formats:

- OpenTelemetry Collector uses `metadata.yaml` files
- Prometheus exporters define metrics in Go code via `prometheus.NewDesc()`
- Python instrumentation uses decorators and meter APIs
- Some sources just have documentation (if you're lucky)

Different naming conventions compound the problem. Is it
`http_server_request_duration` or `http.server.request.duration`? Underscores
or dots? `_total` suffix or not?

There's no central registry, no single place to search "show me all histogram
metrics related to HTTP requests across my entire observability stack."

## Why not just a static list ?

The obvious solution is to create a curated list. Document all the metrics, put
them in a spreadsheet or wiki, and call it a day.

This fails for several reasons:

**Metrics change constantly.** Every release of every exporter can add, modify,
or deprecate metrics. The OpenTelemetry Collector Contrib repo has hundreds of
commits per month, and a static list becomes outdated quickly.

**Manual curation doesn't scale.** The registry indexes over 3,400 metrics from
just 15 sources. The full observability ecosystem has thousands of exporters
and instrumentation libraries. No team can manually track all of this.

**No provenance.** A static list tells you a metric exists, but not where it's
defined, what version introduced it, or whether the definition you're looking
at is current. When debugging why a metric isn't appearing as expected, you
need to trace back to the source.

**No trust levels.** Some metric definitions come from official metadata files
maintained by the project. Others are inferred from code analysis. A static
list treats them the same, but they're not equally reliable.

## Its not trivial to build a live Metric Registry - why is that?

Building a system that automatically extracts and catalogs metrics from source
repositories sounds straightforward. Clone the repos, parse the files, store
the results. In practice, it's surprisingly complicated.

### Multi-Language Extraction

Metrics are defined in Go, Python, Java, TypeScript, YAML, and more. Each
requires different parsing strategies:

- **Go**: AST parsing to find `prometheus.NewDesc()` calls,
  `prometheus.NewGauge()`, and similar patterns
- **Python**: AST walking to find `meter.create_counter()` and instrument
  decorators
- **TypeScript**: Parsing to extract metric definitions from OpenTelemetry JS
  instrumentation
- **YAML**: Structured parsing for OpenTelemetry metadata files
- **Regex**: Sometimes the cleanest option for semi-structured definitions

A single "parser" doesn't work, since each language and each project has its
own patterns.

### Multiple Definition Patterns

Even within a single language, metrics are defined differently across projects.

In Go alone, the patterns include:

- `prometheus.NewDesc()` with `BuildFQName()` for namespaced metrics
- Direct string literals for metric names
- Map-based definitions where metric metadata is stored in data structures
- Constants defined separately from the metric registration

The redis_exporter defines metrics in maps. The postgres_exporter uses the
standard `NewDesc` pattern. kube-state-metrics generates metrics dynamically
based on Kubernetes resource types. Each required a different extraction
approach.

### Normalization Challenge

Once extracted, metrics need normalization into a canonical schema. This means:

- Consistent naming: converting between `http_server_duration` and
  `http.server.duration`
- Unified types: mapping Prometheus's counter/gauge/histogram/summary to
  OpenTelemetry's instrument types
- Attribute standardization: labels, dimensions, and tags are all the same
  concept with different names

Without normalization, searching across sources becomes difficult.

### Provenance Tracking

Every metric in the registry must link back to:

- The source repository
- The exact file path
- The git commit hash
- The extraction timestamp

This information is essential for debugging and trust. When a user questions
why a metric has a certain description, they need to see the source.

### Trust Levels

Not all metric definitions are equally reliable:

- **Authoritative**: From official metadata files maintained by the project
  (like OTel Collector's `metadata.yaml`)
- **Derived**: Extracted from source code via AST analysis
- **Documented**: Scraped from documentation
- **Vendor-claimed**: From vendor docs without source verification

A registry that doesn't distinguish between these levels can mislead users
about the reliability of metric definitions.

### Semantic Convention Compliance

OpenTelemetry defines semantic conventions, which are standardized metric names
and attributes. A useful registry should indicate which metrics comply with
these conventions:

- **Exact match**: `http.server.request.duration` matches the semantic
  convention exactly
- **Prefix match**: `http.server.request.duration.bucket` starts with a
  convention metric
- **No match**: Custom metric not covered by conventions

This helps teams understand which metrics are "standard" versus custom.

## And so - source-first metric extraction

The Metric Registry extracts metrics directly from source repositories,
normalizes them into a canonical schema, and exposes them via search.

### Design Principles

**Source-first**: Derive metrics from repos. The source code is the ground
truth.

**Pluggable adapters**: Each source gets its own adapter that knows how to
fetch and extract. Adding a new source doesn't require changing core logic.

**Provenance-aware**: Every metric links to its origin. Always know where a
metric came from and how trustworthy it is.

**Search-oriented**: Optimize for discovery. Full-text search, faceted
filtering, semantic convention badges.

## Architecture Deep Dive

```text
┌──────────────────────────────────────────────────────────────────────┐
│                            Sources                                   │
│  otel-contrib │ postgres │ redis │ ksm │ cadvisor │ otel-python │ ...│
└───────┬───────────┬─────────┬───────┬───────┬───────────┬────────────┘
        │           │         │       │       │           │
        ▼           ▼         ▼       ▼       ▼           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                           Adapters                                   │
│     Each adapter: Fetch (git clone) → Extract (parse) → RawMetric    │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Orchestrator                                │
│         RawMetric → CanonicalMetric → Store (SQLite + FTS5)          │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           Enricher                                  │
│      Cross-reference with OTel Semantic Conventions                 │
│      Match types: exact, prefix, none                               │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────┐
│                       REST API + Next.js UI                           │
│   Search, filter by type/source/component, semantic convention badges │
└───────────────────────────────────────────────────────────────────────┘
```

### Adapters

Each adapter implements a common interface:

```go
type Adapter interface {
    Name() string
    SourceCategory() domain.SourceCategory
    Confidence() domain.ConfidenceLevel
    ExtractionMethod() domain.ExtractionMethod
    RepoURL() string
    Fetch(ctx context.Context, opts FetchOptions) (*FetchResult, error)
    Extract(ctx context.Context, result *FetchResult) ([]*RawMetric, error)
}
```

The adapter handles everything source-specific: cloning the repo, finding
metric definitions, parsing them. The orchestrator doesn't need to know whether
it's parsing YAML or walking a Go AST.

### Extraction Methods

**YAML Parsing** (OpenTelemetry Collector Contrib)

The cleanest case. OTel Collector receivers include `metadata.yaml` files with
structured metric definitions:

```yaml
metrics:
  redis.clients.connected:
    description: Number of client connections
    unit: "{connection}"
    gauge:
      value_type: int
```

**Go AST Parsing** (Prometheus Exporters)

Most Prometheus exporters define metrics using `prometheus.NewDesc()`:

```go
prometheus.NewDesc(
    prometheus.BuildFQName(namespace, subsystem, "connections"),
    "Number of active connections",
    []string{"database"},
    nil,
)
```

The extractor walks the AST to find these calls, resolves the string arguments
(including `BuildFQName` concatenation), and extracts metric name, description,
and labels.

**Python AST** (OpenTelemetry Python, OpenLLMetry)

Python instrumentation uses the meter API:

```python
meter.create_histogram(
    name="http.client.duration",
    description="Duration of HTTP client requests",
    unit="ms"
)
```

AST walking finds these calls and extracts the arguments.

### Custom Patterns

Some sources required custom approaches:

- redis_exporter stores metrics in Go maps, so the extractor parses map
  literals
- OpenTelemetry Java uses a mix of constants and method calls, so regex
  extraction worked best
- kube-state-metrics generates metrics dynamically from Kubernetes types

### Storage and Search

SQLite with FTS5 (full-text search) provides:

- Fast text search across metric names, descriptions, components
- Faceted filtering by instrument type, source category, component
- Efficient pagination for browsing

### Enrichment

After extraction, the enricher cross-references each metric against
OpenTelemetry Semantic Conventions:

- **349 semantic convention metrics** parsed from the official repo
- Name normalization (underscores → dots) before matching
- Three match types: exact, prefix, none
- Results stored alongside the metric for filtering and display

## What's next

**More sources**: Cloud provider metrics (AWS CloudWatch, GCP Monitoring), more
language instrumentations (.NET), additional Prometheus exporters.

**Deeper enrichment**: Attribute validation against semantic conventions,
stability level tracking, deprecation warnings.

**Cross-ecosystem mapping**: Identifying equivalent metrics across OpenTelemetry
and Prometheus ecosystems.

---

The observability ecosystem is vast and fragmented. A live metric registry
makes "what metrics exist?" an answerable question, and it stays current
automatically through nightly extraction from source repositories.

The source code is the truth and this Metric Registry makes it searchable.

## Contribute

Metric Registry is open source. We welcome contributions - whether it's adding
new metric sources, improving extraction accuracy, or fixing bugs. Check out
the repo at [github.com/base-14/metric-library](https://github.com/base-14/metric-library)
and join us in building a comprehensive catalog of observability metrics.
