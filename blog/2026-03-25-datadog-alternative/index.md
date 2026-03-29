---
draft: true
slug: datadog-alternative
date: 2026-03-25
title: "The Datadog Alternative That Doesn't Charge Per Host"
description: "Compare Datadog vs base14 Scout with real pricing math for 100 K8s hosts. Signal-based pricing, zero sampling, OTel-native. No per-host fees."
authors: [nilakanta-mallick]
tags: [datadog alternative, observability, signal-based pricing, OpenTelemetry, cost comparison]
keywords:
  - datadog alternative
  - datadog replacement
  - cheaper than datadog
  - switch from datadog to opentelemetry
  - datadog cost reduction
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How long does migration from Datadog take?","acceptedAnswer":{"@type":"Answer","text":"4-6 weeks for a typical mid-size team. base14's onboarding team handles the heavy lifting during the first month (free)."}},{"@type":"Question","name":"Can I run base14 and Datadog in parallel?","acceptedAnswer":{"@type":"Answer","text":"Yes. OTel Collectors support multiple exporters. Run both platforms simultaneously until your team is confident in Scout."}},{"@type":"Question","name":"What about Datadog's 600+ integrations?","acceptedAnswer":{"@type":"Answer","text":"Most modern infrastructure and application frameworks support OpenTelemetry natively. For services that don't, the OTel Collector has receivers for common data sources."}},{"@type":"Question","name":"Is base14 enterprise-ready?","acceptedAnswer":{"@type":"Answer","text":"Yes. SOC 2 Type II and ISO 27001 compliant. BYOC (Bring Your Own Cloud) deployment available on AWS, GCP, and Azure. Data residency options included."}},{"@type":"Question","name":"How does Scout pricing work?","acceptedAnswer":{"@type":"Answer","text":"You pay a $250/month platform fee plus usage: $0.10 per million metrics and $0.25 per million logs and traces. No throttling, no sampling, no surprise tier changes. The pricing is linear and predictable."}},{"@type":"Question","name":"Does Scout support alerting and dashboards?","acceptedAnswer":{"@type":"Answer","text":"Yes. Custom dashboards, alerting rules, and SLO tracking are included for all customers. No feature gating based on plan tier."}},{"@type":"Question","name":"What is the best Datadog alternative for mid-size teams?","acceptedAnswer":{"@type":"Answer","text":"base14 Scout is built for mid-size engineering teams (50-200 engineers) who need full observability without per-host pricing. Signal-based pricing keeps costs predictable as you scale."}},{"@type":"Question","name":"How much cheaper is base14 Scout than Datadog?","acceptedAnswer":{"@type":"Answer","text":"For a 100-host Kubernetes team with 430GB/day of logs, 7.5B metrics, and 7.5B trace spans/month, Scout costs ~$5,375/month. Datadog's published list pricing for the same profile comes to ~$23,700/month, though actual costs vary with contract terms."}}]}
---

> **TL;DR:** base14 Scout is an OpenTelemetry-native observability
> platform with signal-based pricing ($250/month platform fee +
> $0.10/M metrics + $0.25/M logs and traces). No per-host fees,
> zero sampling, 30-day default retention with affordable extended
> retention. A 100-host Kubernetes team paying ~$23,700/month on
> Datadog (published pricing) typically pays ~$5,375/month on Scout.

Your Datadog bill just doubled. Nobody changed anything. No new
services, no new team members, no spike in traffic. But somewhere
between custom metrics from an integration you forgot you installed
and high-water mark billing that counted last Tuesday's load test
as your "sustained peak," your observability budget quietly became
your second-largest infrastructure cost.

<!--truncate-->

If Datadog pricing feels too expensive for what you actually use,
you're not imagining things. You're not the first team to stare at
a Datadog invoice and wonder what to use instead. You won't be the
last.

## Why teams look for a Datadog alternative

Datadog is a good product. Teams don't start searching for a
Datadog alternative because the dashboards are ugly or the APM
doesn't work. They leave because of three structural problems that
get worse as you scale.

### Cost escalation you can't predict

Datadog's pricing has more moving parts than most teams realize.
Here's how the bill compounds:

| Component | Cost |
| :--- | :--- |
| Infrastructure monitoring | [$15-27/host/month](https://www.datadoghq.com/pricing/) |
| APM | $31/host/month |
| Log ingestion | $0.10/GB |
| Log indexing | $1.70/million events (15-day retention) |
| Custom metrics | $1/100 metrics/month (beyond included) |
| Synthetics | $5-12/1000 test runs |

*Pricing as of March 2026. Based on publicly listed rates, annual
billing. Verify at
[datadoghq.com/pricing](https://www.datadoghq.com/pricing/).
Actual costs vary based on contract terms and volume.*

The total cost of logging runs approximately $1.41/GB when you
account for both ingestion and indexing (assuming ~770K events/GB,
i.e. average log line ~1.3 KB). Smaller logs increase the
events-per-GB ratio and the effective rate. But the real surprises
come from three billing mechanics that aren't obvious until you get
the invoice:

#### High-water mark billing

Datadog charges per-host pricing based on your peak sustained
usage, not your average. That load test you ran on a Tuesday
afternoon? It set your billing floor for the month.

#### Auto-generated custom metrics

Every integration Datadog installs can generate custom metrics
automatically. A single Kubernetes integration can produce hundreds
of metric time series. At $1 per 100 metrics beyond your included
allotment, this adds up fast.

#### Dual-cost logging

You pay once to ingest logs and again to index them. Many teams
don't realize this until the bill arrives with two line items for
what feels like the same data.

When a mid-stage fintech team hit 80 hosts and 300GB of daily
logs, their Datadog bill crossed $18,000/month. They'd budgeted
$8,000. The gap wasn't caused by growth; it was caused by billing
mechanics they hadn't modeled. The dual-cost logging (ingestion +
indexing) on 300GB/day alone was responsible for the bulk of the
overage they never anticipated.

### Vendor lock-in through proprietary agents

Datadog's agent is proprietary. Your instrumentation, your
dashboards, your alert definitions, your runbooks that reference
specific Datadog query syntax: all of it is locked to one vendor.
Switching costs compound over time.

This isn't just a philosophical concern. When your contract comes
up for renewal and Datadog raises prices, your leverage depends on
how portable your telemetry pipeline is. If switching means
re-instrumenting every service, you don't really have a choice.

[OpenTelemetry](https://opentelemetry.io/docs/) changes this
equation. It's a
[CNCF project](https://www.cncf.io/projects/opentelemetry/) that
standardizes how applications generate and export telemetry. With
OTel instrumentation, your code produces vendor-neutral signals.
You can point them at any compatible backend, including Datadog
itself, without changing a line of application code.

As we explained in our
[multi-cloud design](/blog/multi-cloud-design)
post: you don't need to move often, or at all. You just need to
know the door isn't locked from the outside.

### Feature overload you're paying for

Datadog offers 600+ integrations, security monitoring, SIEM, CI
visibility, workflow automation, and more. It's impressive breadth.
But if your team uses APM, logs, and infrastructure monitoring
(which is most teams), you're paying for a platform whose
complexity serves someone else's use case.

Every additional Datadog feature is another line item. RUM,
synthetics, security monitoring, database monitoring; each one has
its own per-unit pricing. The platform grows horizontally, and so
does your bill, whether or not your team uses half of it.

**Already know you want to switch?**
[Book a cost comparison call](https://base14.io/contact) and we'll
model your actual Datadog usage against Scout pricing.

## base14 Scout at a glance

Scout is a
[unified observability platform](https://base14.io/scout) built on
OpenTelemetry. Logs, metrics, traces, APM, and LLM telemetry go
into a single data lake with one query surface.

Here's what makes it structurally different:

- **[Signal-based pricing](https://base14.io/pricing)**: $250/month
  platform fee, $0.10 per million metrics, $0.25 per million logs
  and traces. No per-host pricing. No dual-cost logging.
- **OpenTelemetry-native**: No proprietary agents. Your
  instrumentation is portable from day one.
- **Zero sampling**: Every trace, every metric, every log line is
  stored and queryable. 0% sampling.
- **30-day default retention**: Full-resolution data for 30 days
  out of the box. Extended retention available at minimal extra cost.
- **Lightning-fast queries**: Purpose-built data lake for fast
  queries over terabytes of data.
- **All features included**:
  [APM](https://base14.io/scout/apm), logs, metrics,
  [traces](https://base14.io/scout/traces), LLM observability,
  custom dashboards, alerts. No feature gating.

## Side-by-side: Datadog vs base14 Scout

| Factor | Datadog | base14 Scout |
| :--- | :--- | :--- |
| Pricing model | GB + per-host + per-metric | Signal-based ($0.10/M metrics, $0.25/M logs & traces) |
| Base cost | Varies widely | $250/month platform fee |
| Per-seat pricing | Only for On-Call/Incident add-ons | No |
| Default retention | 15 days | 30 days (extended retention available) |
| Sampling | Aggressive at scale | Zero |
| Custom metrics | $1/100 extra | Included |
| LLM observability | Add-on | Native |
| Support | Tiered tickets | SRE partnership |
| Lock-in | Proprietary agents | OpenTelemetry-native |

Numbers tell part of the story. Here's why each difference matters
when you're actually debugging at midnight.

### Pricing: the wrong incentive

Datadog charges based on data volume (GB), host count, and metric
count. This creates a broken incentive: the more context you add
to your telemetry, the more it costs.

Stack traces. Request metadata. User IDs. All make your bill
bigger. So teams strip context to save money, which makes their
observability less useful exactly when they need it most.

[Signal-based pricing](/blog/observability-cost-optimization) works
differently. A signal is one telemetry event: a log line, a metric
data point, a trace span. You pay $0.10 per million metrics and
$0.25 per million logs and traces, regardless of size.

Add a full stack trace to every error span? It doesn't cost more.
Attach request headers and user context to every log line? Same
price. This removes the tension between "good observability" and
"affordable observability."

### Data retention: 15 days vs 30 days

Datadog's default log retention is 15 days. You can pay more for
longer retention, but most teams don't.

That memory leak developing over three weeks? Invisible. The
gradual performance degradation that started 18 days ago? Gone.
The intermittent failure that happens every 20 days? You'll never
correlate it.

Scout retains 30 days of full-resolution data by default - double
Datadog's window. Need longer? Extended retention is available at
minimal extra cost, without the archive-and-rehydrate workflow
that Datadog requires.

### Sampling: aggressive vs zero

At scale, Datadog samples traces. The logic makes sense: storing
every trace at petabyte scale is expensive with traditional storage.

But the trace you need during a production incident is often the
one that got discarded. Say 1 in 1,000 requests fails. You're
sampling at 10%. There's a real chance the failing request's trace
simply doesn't exist.

When a logistics platform team investigated a payment bug affecting
0.3% of transactions, they couldn't find the traces in Datadog
APM. Sampling had discarded them. They spent four hours reproducing
the issue in staging just to generate new traces. With zero
sampling, those traces would have been in Scout, queryable
immediately.

Scout's zero-sampling friendly architecture is possible because of
purpose-built storage that achieves significantly better efficiency
than legacy platforms. Keeping everything costs less than
competitors spend keeping a fraction.

### Lock-in: proprietary vs OpenTelemetry

Datadog's agent collects and ships data in Datadog's format. Your
instrumentation is coupled to their ecosystem.

With Scout, you instrument your applications using
[OpenTelemetry SDKs and collectors](https://opentelemetry.io/docs/).
If you ever want to switch backends, add a second backend, or
split workloads across platforms, you change collector
configuration. Your application code stays untouched.

This is the difference between renting and owning your
[observability architecture](/blog/observability-theatre).
OpenTelemetry instrumentation is an investment that appreciates
over time. Proprietary instrumentation is a cost that compounds.

### Support: ticket queue vs SRE partnership

Datadog's support is tiered. You submit tickets. Someone responds
based on your plan level. It's standard SaaS support.

base14 operates differently. Every customer gets an
[SRE partnership](https://base14.io/services): assisted onboarding
(first month free), fortnightly reliability reviews with a senior
SRE, custom training for your team, and 24/7 on-call support with
response times under 15 minutes via Slack. This is how Zinc
Learning Labs went from "installing a tool" to "building an
observability culture."

This isn't an upsell. It's how we think observability should work.
A platform is only as useful as your team's ability to use it.

### LLM observability: add-on vs native

If your applications call LLM APIs (OpenAI, Anthropic, Bedrock,
or any of 50+ providers), you need visibility into token usage,
costs, latency, and output quality.

Datadog offers LLM observability as a separate add-on. Scout
includes
[LLM observability](https://base14.io/scout/llm-observability)
natively. Token tracking, cost analysis, and prompt performance
live in the same data lake as your infrastructure metrics and
application traces. Correlate a spike in LLM costs with the
deployment that changed prompt templates, using a single query
surface.

## The real cost comparison

Let's do the math that no other Datadog alternative page shows you.

> **Scenario:** 100 hosts running Kubernetes (30 pods/host),
> 430 GB logs/day, 7.5B trace spans/month, 7.5B metric data
> points/month, 20 engineers, annual billing.
>
> Signal volume ratio: 40% logs, 30% metrics, 30% traces
> (~25B total signals/month).

### Datadog estimate

| Line item | Calculation | Monthly cost |
| :--- | :--- | :--- |
| Infrastructure (Enterprise) | 100 hosts × $23/host | $2,300 |
| APM | 100 hosts × $31/host | $3,100 |
| Log ingestion | 12,900 GB × $0.10 | $1,290 |
| Log indexing (15-day) | 10,000M events × $1.70/M | $17,000 |
| Custom metrics | Within included (100 × 200 = 20K) | $0 |
| **Monthly total** | | **~$23,700** |
| **Annual total** | | **~$284,280** |

*Pricing as of March 2026. Based on
[Datadog published pricing](https://www.datadoghq.com/pricing/),
annual billing. Actual costs vary based on contract terms and
volume.*

**How we calculated log events:** 430 GB/day ÷ 1.3 KB average =
~333M log lines/day × 30 = ~10,000M indexed events/month.
Monthly ingestion: 430 × 30 = 12,900 GB.

**How we calculated metrics:** Datadog bundles infrastructure and
Kubernetes metrics into the per-host fee. Only custom metrics
beyond 200/host are charged separately. With 100 Enterprise hosts,
20,000 custom metrics are included. Standard infrastructure
metrics from integrations are not counted as custom.

This estimate excludes RUM, synthetics, security monitoring, and
integration-generated custom metrics beyond the included allotment.

### base14 Scout estimate

On Scout, every telemetry signal is metered - including
infrastructure metrics that Datadog bundles into host fees. Here's
the signal math for the same 100-host profile:

- **Logs**: 430 GB/day at ~1.3 KB average = ~333M logs/day =
  ~10B log signals/month
- **Metrics**: ~1,185 time series per host (host, K8s, app,
  custom) at blended 60s/30s scrape = ~7.5B data points/month
- **Traces**: 7.5B trace spans/month

| Line item | Calculation | Monthly cost |
| :--- | :--- | :--- |
| Platform fee | Flat rate | $250 |
| Metrics | 7,500M × $0.10/M | $750 |
| Logs | 10,000M × $0.25/M | $2,500 |
| Traces | 7,500M × $0.25/M | $1,875 |
| 30-day retention | Included | $0 |
| LLM observability | Included | $0 |
| SRE partnership | Included | $0 |
| **Monthly total** | | **~$5,375** |
| **Annual total** | | **~$64,500** |

That's transparent math you can verify. No per-host multipliers
and no dual-cost logging. For this profile based on published list
pricing, the annual difference is ~$220,000. Actual Datadog costs
vary based on contract terms, committed spend, and negotiated
agreements - but the structural pricing difference remains: Scout
charges per signal regardless of type, while Datadog layers host
fees, ingestion fees, and indexing fees separately.

### Estimating your signal count from a Datadog bill

If you're coming from Datadog, here's how to translate your
usage into Scout's signal-based pricing:

- **Logs**: Take your daily GB ingestion, divide by your average
  log line size (typically 1.0-2.0 KB). That gives you signals/day.
  Multiply by 30 for monthly signals.
- **Traces**: Your indexed span count in Datadog maps 1:1 to Scout
  trace signals. Check APM > Usage in the Datadog console.
- **Metrics**: On Scout, all metric data points are signals —
  including infrastructure metrics that Datadog bundles into host
  fees. Estimate your time series count (host metrics + K8s
  metrics + app metrics) and multiply by data points per month
  based on your scrape interval (43,200 for 1/min, 86,400 for
  1/30s).

Most teams find that the math takes 15 minutes and the result is
immediately clear.

#### Ready to see the numbers for your specific infrastructure?

[Talk to our team](https://base14.io/contact) and we'll build a
comparison using your actual usage data.

## How to switch from Datadog to OpenTelemetry

Finding a Datadog alternative is one thing. Actually migrating is
another. The good news: it doesn't have to be a flag day. Here's
how teams actually make the transition:

### Step 1: Adopt OpenTelemetry instrumentation

Install OTel SDKs and auto-instrumentation libraries alongside
your existing Datadog agents. Both can run at the same time. Your
applications emit telemetry in OTel format while Datadog continues
collecting its own data. Nothing changes operationally.

For a detailed walkthrough, see our guide to
[building a production-ready OTel Collector](/blog/production-ready-otel-collector).

### Step 2: Point the OTel collector at Scout

Configure an
[OpenTelemetry Collector](/instrument/collector-setup/otel-collector-config)
to export data to Scout. You can also keep a copy flowing to
Datadog during the transition. The collector supports multiple
exporters.

### Step 3: Run parallel for validation

Run both platforms side by side for 2-4 weeks. Compare dashboards,
verify alert parity, and validate that your team can answer the
same questions in Scout that they currently answer in Datadog.
This is where our SRE partnership helps most. base14's onboarding
team works with your engineers to rebuild dashboards, set up
alerts, and ensure nothing falls through the cracks.

### Step 4: Decommission Datadog agents

Once your team is confident in Scout, you can fully replace Datadog
without touching application code. Remove the Datadog agents and
cancel your subscription. Your OTel instrumentation stays. If you
ever want to evaluate another backend, you change configuration,
not code.

The entire process takes 4-6 weeks for a mid-size team (~100
services). base14's onboarding team handles the migration hands-on
during your first month, at no cost.

## Who should switch (and who shouldn't)

Not every Datadog alternative fits every team. Here's our honest
assessment.

### Switch to base14 Scout if

- **Cost predictability matters.** Your Datadog bills have
  surprised you more than once. Signal-based pricing eliminates
  the guessing.
- **You want open standards.** You're already using or planning to
  adopt OpenTelemetry. Scout is built for OTel-native teams.
- **You need full cardinality.** Your debugging workflow depends on
  finding specific traces or querying high-cardinality dimensions.
  Zero sampling means the data is always there.
- **Longer retention matters.** 15 days isn't enough for trend
  analysis, capacity planning, or compliance. Scout's 30-day
  default with affordable extended retention gives you more room.
- **You value hands-on support.** You want an SRE partner, not a
  ticket queue.
- **You're a startup running lean.** Scout's $250/month base makes
  it a practical Datadog alternative for startups that need
  production-grade observability without six-figure annual contracts.

### Stay on Datadog if

- **You rely on Datadog's security/SIEM products.** Datadog has
  invested heavily in cloud security monitoring. If SIEM is a core
  requirement, their security product may be the right choice.
- **You need 600+ integrations breadth.** Datadog's integration
  library is enormous. If you depend on niche integrations that
  don't emit OTel-native telemetry, verify coverage before
  switching.
- **You're heavily invested in Datadog's collaboration workflows.**
  If your team relies on Datadog Notebooks for incident
  collaboration or Watchdog for anomaly detection, those features
  don't have direct equivalents. Factor the retraining cost in.

### Consider running both during transition

Many teams run Datadog and Scout in parallel for a month or two.
OTel instrumentation makes this straightforward. You're not
choosing a cliff; you're choosing a gradient.

## What customers say

> "Improved reliability without increasing cost."
> -- **Glomo**
>
> "Unified visibility across our stack, with faster MTTR and cost
> reductions."
> -- **DPDZero**
>
> "Our engineers are excited to improve reliability. We're building
> an observability culture, not just installing a tool."
> -- **Zinc Learning Labs**

These outcomes reflect what happens after the migration, not just
during the evaluation. Understanding
[what factors actually influence MTTR](/blog/factors-influencing-mttr)
helps set realistic expectations. Observability isn't a dashboard
you buy. It's a
[practice you build](/blog/unified-observability).

## FAQ

### How long does migration take?

4-6 weeks for a typical mid-size team. base14's onboarding team
handles the heavy lifting during the first month (free).

### Can I run base14 and Datadog in parallel?

Yes. OTel Collectors support multiple exporters. Run both platforms
simultaneously until your team is confident in Scout.

### What about Datadog's 600+ integrations?

Most modern infrastructure and application frameworks support
OpenTelemetry natively. For services that don't, the OTel Collector
has receivers for common data sources. Check
[OpenTelemetry's registry](https://opentelemetry.io/ecosystem/registry/)
for specific integrations.

### Is base14 enterprise-ready?

Yes. [SOC 2 Type II and ISO 27001 compliant](https://base14.io/security). BYOC
(Bring Your Own Cloud) deployment available on AWS, GCP, and Azure.
Data residency options included.

### How does Scout pricing work?

You pay a $250/month platform fee plus usage: $0.10 per million
metrics and $0.25 per million logs and traces. No throttling, no
sampling, no surprise tier changes. The pricing is linear and
predictable.

### Does Scout support alerting and dashboards?

Yes. Custom dashboards, alerting rules, and SLO tracking are
included for all customers. No feature gating based on plan tier.

### What is the best Datadog alternative for mid-size teams?

base14 Scout is built for mid-size engineering teams (50-200
engineers) who need full observability without per-host pricing.
Signal-based pricing keeps costs predictable as you scale,
and the included SRE partnership provides hands-on support that
enterprise vendors charge extra for.

### How much cheaper is base14 Scout than Datadog?

For a 100-host Kubernetes team with 430GB/day of logs, 7.5B
metrics, and 7.5B trace spans/month, Scout costs ~$5,375/month.
Datadog's published list pricing for the same profile comes to
~$23,700/month, though actual costs vary with contract terms. The
structural difference comes from Scout's flat per-signal pricing
versus Datadog's layered host fees, ingestion fees, and indexing
fees.

## Start evaluating your Datadog alternative

If you're looking for a Datadog alternative that doesn't sacrifice
capability for cost savings, here's what to do next:

1. **[Book a demo](https://base14.io/contact)** to see Scout with
   your team's use case. No commitment, no sales pitch.
2. **Get a cost comparison** using your actual Datadog usage data.
   We'll show you the signal math for your infrastructure.
3. **Start a parallel evaluation** with OTel instrumentation. Keep
   Datadog running while you validate. Zero risk.

Your observability platform should help you understand your
systems. Not become another system you have to manage.
[See how Scout works](https://base14.io/scout).

- No long-term contracts. Month-to-month.
- Assisted onboarding included at no extra cost.
- OpenTelemetry-native. Keep your instrumentation if you leave.

---

## Related reading

- [New Relic alternative: observability without the seat tax](/blog/new-relic-alternative)
- [CloudWatch alternative: unified observability beyond AWS](/blog/cloudwatch-alternative)
- [Observability cost optimization: why the pricing model matters more than your data volume](/blog/observability-cost-optimization)
- [The problem with observability theatre](/blog/observability-theatre)
- [Multi-cloud design and vendor neutrality](/blog/multi-cloud-design)
