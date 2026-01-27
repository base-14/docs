---
title: Custom Instrumentation Overview - Manual OpenTelemetry Tracing | base14 Scout
sidebar_label: Overview
sidebar_position: 1
description:
  Manual OpenTelemetry instrumentation for Python, Go, Java, JavaScript, Ruby, PHP, C#, and Rust. Add custom spans, metrics, and attributes for business-critical code paths.
keywords:
  [
    opentelemetry custom instrumentation,
    manual tracing,
    custom spans,
    business metrics,
    opentelemetry sdk,
    distributed tracing,
    custom attributes,
    base14 scout,
  ]
---

# Custom Instrumentation

Custom instrumentation gives you **fine-grained control** over what telemetry
is captured. Use it to track business-specific operations, add custom
attributes, or instrument code that auto-instrumentation doesn't cover.

## When to Use Custom Instrumentation

| Use Case | Recommendation |
|----------|----------------|
| Track business transactions (orders, payments) | ✅ Custom instrumentation |
| Add user/tenant context to spans | ✅ Custom instrumentation |
| Measure custom business metrics | ✅ Custom instrumentation |
| Instrument internal libraries | ✅ Custom instrumentation |
| Quick setup with standard frameworks | ❌ Use [auto-instrumentation](../auto-instrumentation/) first |

## Languages

| Language | Guide | Key APIs |
|----------|-------|----------|
| Python | [Python](./python) | `tracer.start_as_current_span()`, `meter.create_counter()` |
| Go | [Go](./go) | `tracer.Start()`, `meter.Int64Counter()` |
| Java | [Java](./java) | `tracer.spanBuilder()`, `meter.counterBuilder()` |
| JavaScript (Node) | [Node.js](./javascript-node) | `tracer.startActiveSpan()`, `meter.createCounter()` |
| JavaScript (Browser) | [Browser](./javascript-browser) | `tracer.startActiveSpan()`, browser-specific context |
| Ruby | [Ruby](./ruby) | `tracer.in_span()`, `meter.create_counter()` |
| PHP | [PHP](./php) | `$tracer->spanBuilder()`, `$meter->createCounter()` |
| C# / .NET | [C#](./csharp) | `tracer.StartActiveSpan()`, `meter.CreateCounter()` |
| Rust | [Rust](./rust) | `tracer.start()`, `meter.u64_counter()` |

## Common Patterns

### Adding Custom Spans

Wrap business-critical operations to track their duration and success:

```python
# Python example
with tracer.start_as_current_span("process_payment") as span:
    span.set_attribute("payment.amount", amount)
    span.set_attribute("payment.currency", "USD")
    result = payment_gateway.charge(amount)
    span.set_attribute("payment.success", result.success)
```

### Adding Context to Auto-Instrumented Spans

Enrich existing spans with business context:

```python
from opentelemetry import trace

span = trace.get_current_span()
span.set_attribute("user.id", user_id)
span.set_attribute("tenant.id", tenant_id)
span.set_attribute("feature.flag", "new_checkout_v2")
```

### Custom Metrics

Track business KPIs alongside technical metrics:

```python
order_counter = meter.create_counter(
    "orders.completed",
    description="Number of completed orders"
)

order_counter.add(1, {"region": "us-east", "plan": "premium"})
```

## Combining Auto + Custom Instrumentation

The most effective approach combines both:

import ThemedImage from '@theme/ThemedImage';

<ThemedImage
  alt="Auto vs custom instrumentation comparison"
  sources={{
    light: '/img/docs/instrumentation-comparison.png',
    dark: '/img/docs/instrumentation-comparison-dark.png',
  }}
/>

## Best Practices

1. **Start with auto-instrumentation** - Get baseline observability first
2. **Add custom spans for business operations** - Orders, payments, user actions
3. **Use semantic conventions** - Follow
   [OTel semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
   for attribute names
4. **Keep span names static** - Use attributes for dynamic values, not span names
5. **Set appropriate span status** - Mark errors with `span.set_status(StatusCode.ERROR)`

## Next Steps

1. **Set up [auto-instrumentation](../auto-instrumentation/)** if you haven't already
2. **Choose your language** from the table above
3. **Identify key business operations** to instrument
