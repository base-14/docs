---
draft: true
slug: observability-cost-optimization
date: 2026-04-01
title: "Observability cost optimization: why the pricing model matters more than your data volume"
description: "Cost is the #1 observability selection criterion. The fix isn't sampling - it's signal-based pricing: $250/mo + $0.10/M metrics + $0.25/M logs & traces."
authors: [nilakanta-mallick]
tags: [observability, cost optimization, pricing, OpenTelemetry, signal-based pricing, observability TCO, tool consolidation]
keywords:
  - observability cost optimization
  - reduce observability costs
  - observability pricing comparison
  - observability cost reduction
  - observability TCO
  - signal-based observability pricing
  - observability without sampling
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How much can teams realistically save on observability costs?","acceptedAnswer":{"@type":"Answer","text":"It depends on your current stack. A 100-host Kubernetes team moving from GB-based to signal-based pricing can save ~$220,000/year. The savings come from eliminating per-host fees, dual-cost logging, and per-metric charges."}},{"@type":"Question","name":"Does reducing observability costs mean losing visibility?","acceptedAnswer":{"@type":"Answer","text":"With the usual approaches (sampling, filtering, shorter retention), yes. But signal-based pricing with a zero-sampling friendly architecture and 30-day retention gives you more visibility at lower cost. The goal shifts from send less data to pick the right pricing model."}},{"@type":"Question","name":"How does signal-based pricing handle large log lines or traces?","acceptedAnswer":{"@type":"Answer","text":"Every signal counts equally regardless of size. A 100-byte log line and a 50KB log line with full stack trace are both one signal. This removes the incentive to strip context from your telemetry."}},{"@type":"Question","name":"Is it worth migrating if we've already optimized our current setup?","acceptedAnswer":{"@type":"Answer","text":"Ask whether you've optimized within a broken model. If your team spends real hours on cost management (tuning logs, managing sampling, building filtering pipelines), that time is a cost migration removes."}},{"@type":"Question","name":"Can we migrate incrementally or is it all-or-nothing?","acceptedAnswer":{"@type":"Answer","text":"Go incremental. OTel-based platforms support dual-shipping during evaluation, so you can move one service at a time and compare results before committing fully."}},{"@type":"Question","name":"What is signal-based pricing for observability?","acceptedAnswer":{"@type":"Answer","text":"You pay per event (log line, trace span, metric data point), not per byte. Adding rich context like stack traces doesn't raise the bill. base14 Scout: $250/month platform fee + $0.10 per million metrics + $0.25 per million logs and traces. Unlimited seats and 30-day default retention included."}},{"@type":"Question","name":"How do I calculate my observability TCO?","acceptedAnswer":{"@type":"Answer","text":"Start with direct vendor costs. Then add hidden costs: hours spent on pipeline building, log tuning, and cardinality management. Add extra incident time from sampled or expired data. Add lost output from limited seat access. Most teams find hidden costs add significantly on top of direct fees."}}]}
---

> **TL;DR:** Cost is the #1 observability tool selection criterion
> for the third year running (65% of teams). But the biggest lever
> isn't data volume - it's the pricing model. GB-based pricing
> penalizes rich telemetry and forces teams to sample, filter, and
> shorten retention. Signal-based pricing ($250/mo platform fee +
> $0.10/M metrics + $0.25/M logs & traces) removes those constraints.
> A 100-host K8s team paying ~$23,690/month on GB-based pricing
> drops to ~$5,375/month, with a zero-sampling friendly
> architecture, 30-day default retention, and unlimited seats.

A platform engineering team spent weeks building a custom pipeline to
filter debug logs before they hit their observability vendor. The
pipeline worked. It cut monthly ingestion by 35%.

Then an intermittent memory leak took down their payment service. The
debug logs they needed had been filtered out weeks earlier. The time
spent reconstructing the failure from fragmentary data - plus
customer credits and the executive review - exceeded their entire
quarterly savings.

<!--truncate-->

This is the paradox at the center of observability cost optimization.
Teams spend more time managing observability costs than actually using
observability. And the strategies they reach for first, filtering,
sampling, and cutting retention, often make incidents more expensive
to resolve.

Here's what most guides won't tell you: the biggest cost lever isn't
your data volume. It's your pricing model.

If you're paying per gigabyte, every stack trace, every metadata
attribute, every detailed log line carries a tax. You end up
incentivized to send less data. That's the opposite of what
observability is supposed to do.

This article breaks down where observability dollars actually go, why
conventional optimization advice is incomplete, and what changes when
you stop paying for bytes and start paying for signals.

## The state of observability spending in 2026

Cost is the number one selection criterion for observability tools —
for the third year running. 65% of teams rank it first, ahead of ease
of use (49%), according to Grafana's
[2026 Observability Survey](https://grafana.com/observability-survey/)
(1,363 respondents across 76 countries). And 50% expect spending to
increase next year, driven primarily by broader adoption across teams.

The response is consolidation. The same Grafana survey found 77% of
organizations that centralized observability report saving time or
money. But only 14% call their consolidation efforts "very
successful."

Meanwhile, 84% are pursuing or considering tool consolidation
(LogicMonitor 2026 Outlook, 100 VP+ IT decision-makers). The intent is
there. The execution isn't.

Where does the money go? For most teams working on observability cost
optimization, the breakdown looks like this:

| Cost category | Share of spend | Driver |
| :--- | :--- | :--- |
| Log ingestion and storage | 50-60% | GB-based pricing penalizes verbose logs |
| APM and tracing | 20-25% | Per-host pricing scales with infrastructure |
| Metrics and custom dashboards | 10-15% | Cardinality charges, per-metric pricing |
| Additional seats and features | 5-10% | Per-user pricing, feature gating |

The pattern is clear. Most observability spend goes to
[log management](https://base14.io/scout/logs). And most of that cost
isn't driven by how much you log. It's driven by how you're charged
for it.

## Why observability costs spiral: the four cost traps

### The GB-based pricing trap

GB-based pricing creates a broken incentive. More context means a
higher bill.

A log line with full request context (user ID, session ID, trace ID,
custom attributes) might be 10x larger than a stripped-down entry.
That rich log line? It costs 10x more.

So teams strip context - removing stack traces from non-error logs,
truncating metadata, sending skeletal telemetry that's cheap to
ingest but useless to debug with.

This is the core dysfunction: **GB-based pricing punishes the behavior
that makes observability valuable.**

### The sampling compromise

Every article about reducing observability costs recommends sampling as
a primary strategy. "Sample 10% of your traces and you'll cut costs by
90%." The math is clean. The logic is dangerous.

Think about what 10% sampling means during a P1. Your payment service
handles 100 million transactions per day. A rare race condition hits
0.1% of requests - 100,000 affected transactions. Plenty to trigger
alerts.

But with 10% sampling, you've kept traces for only 10,000 of those
transactions. The specific trace showing two database writes colliding
at the wrong millisecond? No guarantee it survived.

Teams hit this regularly. With aggressive sampling on
[distributed traces](https://base14.io/scout/traces), the root
cause trace often gets thrown away. The postmortem becomes hours of
piecing together the failure from logs alone - time that zero
sampling eliminates entirely.

Sampling isn't cost optimization. It's a bet that you won't need the
data you threw away.

### The retention squeeze

The default retention for most observability platforms is 15 days.
Enterprise tiers stretch to 30. If you want 90 days, you're paying a
premium, often 3-5x the base rate.

But infrastructure problems don't follow retention windows. Slow-burn
memory leaks, gradual performance decay, and seasonal traffic patterns
all need weeks or months of data to diagnose. If your window is 15
days, you're blind to anything that started on day 16.

### The hidden "observability tax"

Beyond the direct costs, there's a tax that never appears on any
invoice. It's the engineering time spent managing observability costs:

- Hours tuning log levels to stay under ingestion limits
- Weeks building custom pipelines to filter, route, and archive
  telemetry
- Days fighting cardinality explosions that trigger overage charges
- Meetings debating which teams get access to which features

This observability tax is real overhead. For mid-size teams, it
consumes a meaningful share of a platform engineer's time —
engineering capacity diverted from building product to managing a
billing model.

Any serious observability cost optimization effort needs to account
for this hidden spend.

## The conventional playbook (and why it's incomplete)

Search for "reduce observability costs" and you'll find the same
playbook everywhere. It's not wrong. It's just not enough.

### Filter at the source

The standard advice: move log levels from DEBUG to INFO. Cut the noise
before ingestion. This can trim log volume by 70-80%.

Works well for genuinely noisy services. But the debug data you
filtered? That's often what you need most during an incident.

### Reduce cardinality

Drop high-cardinality dimensions (user IDs, request IDs, session
tokens) from metrics. This avoids cardinality explosion charges. But
you lose the ability to drill into specific user sessions. You're
trading granularity for affordability.

### Shorten retention

Keep 7 days instead of 30. Archive to S3 for long-term. This saves
storage costs but creates a two-tier system: fast-query recent data and
slow-query archived data. During cross-period investigations, engineers
bounce between systems and lose context.

### Consolidate tools

Replace your separate logging, metrics, tracing, and APM tools with
one platform. This is solid advice. It's one of the most impactful
changes a team can make. The problem: most "consolidation" guides
don't show the savings math or cover the migration path.

### What's missing from this playbook

Every strategy above accepts the pricing model as a given. They're all
variations of "send less data" or "keep it for less time." None of them
ask the fundamental question: **what if you could send all your data,
keep it for 30 days with affordable extended retention, and still
pay less?**

That question only works if you're willing to rethink the pricing model.
And that's where real observability cost optimization starts.

## A different approach: signal-based pricing

### What signal-based pricing means

Signal-based pricing charges per event, not per byte. A 200-byte log
entry and a 20KB entry with full stack trace cost the same. Five spans
or 500 spans? Same price.

This flips the incentive. Instead of stripping context to save money,
you add as much as your engineers need. Rich telemetry that makes
debugging fast is no longer a cost problem.

### What changes when size doesn't matter

Under GB-based pricing, every telemetry decision becomes a billing
decision. Should this service log at INFO or DEBUG? Include the request
body in traces? Is this metric dimension worth the cardinality charge?

These aren't engineering questions. They're accounting questions wearing
engineering clothes.

With signal-based pricing, they go away. Send everything. Include
full context. Add custom attributes without reaching for a
calculator.

You get data shaped by what helps during incidents, not data shaped
by what's cheap to store.

### The math: GB-based vs signal-based pricing

Let's work through a concrete scenario.

> **Scenario:** 100 hosts running Kubernetes (30 pods/host),
> 430 GB logs/day, 7.5B trace spans/month, 7.5B metric data
> points/month, 20 engineers, annual billing.
>
> Signal volume ratio: 40% logs, 30% metrics, 30% traces
> (~25B total signals/month).

#### GB-based pricing (typical mid-market vendor)

| Line item | Calculation | Monthly cost |
| :--- | :--- | :--- |
| Infrastructure (Enterprise) | 100 hosts × $23/host | $2,300 |
| APM | 100 hosts × $31/host | $3,100 |
| Log ingestion | 12,900 GB × $0.10/GB | $1,290 |
| Log indexing (15-day retention) | 10,000M events × $1.70/M | $17,000 |
| Custom metrics | Within included (100 × 200 = 20K) | $0 |
| **Total** | | **~$23,690/month** |

*Pricing as of March 2026. Based on publicly listed rates,
annual billing. Rates based on
[Datadog Enterprise pricing](https://www.datadoghq.com/pricing/).
Actual costs vary based on contract terms and volume.*

**How we calculated:** 430 GB/day ÷ 1.3 KB average = ~333M log
lines/day × 30 = ~10,000M indexed events/month. Monthly ingestion:
430 × 30 = 12,900 GB. Datadog bundles infrastructure metrics into
the per-host fee; only custom metrics beyond 200/host are extra.

This estimate excludes RUM, synthetics, security monitoring, and
integration-generated custom metrics beyond the included allotment.

#### Signal-based pricing (base14 Scout)

With signal-based pricing, you pay per signal regardless of size.
On Scout, every telemetry signal is metered - including
infrastructure metrics that GB-based vendors bundle into host fees.

- **Logs**: 430 GB/day at ~1.3 KB avg = ~333M/day = ~10B/month
- **Metrics**: ~1,185 time series/host at blended 60s/30s scrape
  = ~7.5B data points/month
- **Traces**: 7.5B trace spans/month

| Line item | Calculation | Monthly cost |
| :--- | :--- | :--- |
| Platform fee | Flat rate | $250 |
| Metrics | 7,500M × $0.10/M | $750 |
| Logs | 10,000M × $0.25/M | $2,500 |
| Traces | 7,500M × $0.25/M | $1,875 |
| All features ([APM](https://base14.io/scout/apm), logs, traces, metrics) | | Included |
| Unlimited seats (20 engineers) | | Included |
| 30-day full-resolution retention | | Included |
| **Total** | | **~$5,375/month** |

The difference for this team profile: ~$18,315/month, or
**~$220,000/year** in observability cost reduction. And that's
before counting the engineering hours reclaimed from cost
optimization busywork.

[See the full pricing breakdown](https://base14.io/pricing) to model
your own infrastructure.

## Beyond pricing: architectural cost levers

Signal-based pricing is the biggest lever, but it's not the only one.
Architecture decisions compound the savings.

### Zero-sampling friendly architecture saves debugging time

Keep every trace and you cut out a whole category of incident cost:
hunting for data that was thrown away. The root cause trace is always
there. The logs are correlated. Teams go straight to root cause
instead of spending hours reconstructing what happened from
fragments.

The time savings compound. Faster investigations across every
incident add up to significant engineering hours reclaimed - on
top of the direct pricing savings.

### 30-day retention included

Most platforms charge extra for extended retention. base14 Scout
includes 30 days of full-resolution data by default - double what
most competitors offer.

Extended retention is available at minimal extra cost. No tiered
storage. No cold archives.

This matters because shortened retention creates hidden costs. Teams
can't look back more than 15 days. Slow-burn issues go undiagnosed.

Performance baselines become guesswork. Capacity planning suffers.

These aren't theoretical. They lead to over-provisioning, reactive
firefighting, and - ironically - higher infrastructure costs.

### Purpose-built storage

Scout's zero-sampling friendly architecture uses purpose-built
storage designed for
[observability workloads](/blog/observability-theatre). The
principle is simple: design storage for the query pattern, not the
other way around. This is what makes keeping everything affordable
— no cost penalty forcing you to sample.

### Unified platform eliminates tool sprawl

Running separate tools for logs, metrics, traces, and APM creates
compounding costs:

- **Licensing overlap**: You're paying 3-4 vendors for features that
  overlap significantly
- **Integration maintenance**: Custom pipelines connecting tools
  require ongoing engineering
- **Training costs**: Each tool has its own query language, UI patterns,
  and alert configuration
- **Context-switching during incidents**: Engineers jump between 3-4
  tabs, correlating timestamps manually

The consolidation math is straightforward. When teams run separate
tools for APM, log management, metrics, and incident management,
the overlapping licensing alone can run into thousands per month —
before you count the engineering overhead of keeping them
connected.

During audits, teams often find significant unused capacity in their
observability stack. That's not waste from poor discipline. It's
what happens when you run fragmented tools.

## The organizational side of observability cost optimization

Observability cost optimization isn't purely technical. Some of the
biggest cost drivers are organizational.

### Unlimited seats: no per-user pricing

When platforms charge per seat, organizations limit access. Only senior
engineers get full dashboards. Junior developers request access through
tickets. Product managers can't see performance data at all.

This creates information asymmetry. The people closest to the code can't
see how it behaves in production. Those making architectural decisions
lack direct access to performance trends.

Knowledge concentrates in a few individuals, increasing
[bus factor](/blog/reducing-bus-factor-in-observability)
and slowing incident response.

Unlimited seats change the dynamic. When everyone can explore
production telemetry, debugging gets faster and bottlenecks shrink.
Per-seat charges seem small in isolation, but the organizational
friction of gating access is not.

### The support gap nobody budgets for

Most observability platforms sell you a tool and leave you to figure
it out - configuration mistakes, alert fatigue from poorly tuned
thresholds, and dashboards nobody looks at.

base14's [SRE partnership](https://base14.io/services) works
differently. Every customer gets assisted onboarding, fortnightly
reliability reviews, and 24/7 support with sub-15-minute response
times. Not a ticket queue. A working relationship with someone who
knows your stack.

This is included - not an upsell. Compare that to hiring a dedicated
SRE ($180,000+/year) or paying for consulting ($250-400/hour).

### OpenTelemetry: cost insurance for the future

Vendor lock-in is a cost multiplier you don't feel until you try
to leave. Proprietary agents, custom SDKs, and non-standard data
formats each add a chain that keeps teams on expensive platforms
long after they've outgrown them.

[OpenTelemetry](https://opentelemetry.io/docs/) eliminates this
lock-in. Your instrumentation follows open standards. Your telemetry
pipeline becomes portable. You're building on a
[vendor-neutral architecture](/blog/cloud-native-foundation-layer)
by design.

Evaluate alternatives without touching your code. That portability is
the ultimate cost lever: permanent negotiating power over every vendor
you'll ever work with.

base14 Scout is built on OpenTelemetry - no proprietary agents, no
custom SDKs. Your code works with any OTel-compatible backend, and
if you ever leave, your data and instrumentation go with you.

## Building an observability cost optimization framework

Here's a practical framework for evaluating and reducing your
observability TCO.

### Step 1: audit current spend (direct and hidden)

Start simple: what do you pay each vendor monthly? Then add the hidden
costs:

- Engineering hours spent on cost optimization activities (pipeline
  building, log level tuning, cardinality management)
- Time spent during incidents that extended investigation beyond what
  full-data access would require
- Productivity loss from limited seat access
- Opportunity cost of features gated behind higher tiers

Most teams find that hidden costs add significantly on top of direct
licensing fees.

### Step 2: evaluate pricing model fit

Ask these questions about your current vendor:

1. Do you pay more when you add context to your telemetry?
2. Are you sampling to control costs rather than for technical reasons?
3. Does extending retention require a pricing tier upgrade?
4. Are you limiting team access because of per-seat charges?
5. Have you built custom tooling specifically to manage observability
   costs?

If you answered "yes" to three or more, your pricing model is the
primary cost driver, not your data volume.

### Step 3: assess retention and sampling tradeoffs

Calculate the actual cost of data you're discarding:

- How many incidents in the last year required data that had been
  sampled away or aged out of retention?
- What was the average extended investigation time per incident?
- What was the business cost of slower resolution (customer impact, SLA
  credits, engineering overtime)?

This often shows that "savings" from sampling and short retention are
net negative once you count incident costs.

### Step 4: consolidate and migrate

If the audit points to a pricing model problem, the migration path
matters. Look for platforms that let you adopt step by step:

1. [Deploy OTel collectors](/blog/production-ready-otel-collector)
   alongside existing agents
2. Dual-ship telemetry to both platforms during evaluation
3. Compare investigation workflows, query performance, and total cost
4. Migrate service by service, not all at once

With [OpenTelemetry-native platforms](https://base14.io/scout), you
don't re-instrument anything. Point your OTel collectors at the new
backend. Data flows.

## Observability cost optimization at a glance

| Approach | What it does | Risk |
| :--- | :--- | :--- |
| Filter at source | Cuts log volume 70-80% | Loses debug data needed in incidents |
| Reduce cardinality | Lowers metric costs | Loses per-user drill-down |
| Shorten retention | Saves storage costs | Blinds you to slow-burn issues |
| Consolidate tools | Cuts overlapping licenses | Migration effort required |
| **Switch pricing model** | **Significant cost reduction (see math above)** | **None: keep all data, all access** |

## FAQ

### How much can teams realistically save on observability costs?

It depends on your current stack. The example above shows
~$220,000/year for a 100-host K8s team moving from GB-based to
signal-based pricing. The savings come from eliminating per-host
fees, dual-cost logging, and per-metric charges.

### Does reducing observability costs mean losing visibility?

With the usual approaches (sampling, filtering, shorter retention),
yes. That's the tradeoff. But signal-based pricing with a
zero-sampling friendly architecture and 30-day retention gives you
more visibility at lower cost. The goal
shifts from "send less data" to "pick the right pricing model."

### How does signal-based pricing handle large log lines or traces?

Every signal counts equally regardless of size. A 100-byte log line and
a 50KB log line with full stack trace are both one signal. This removes
the incentive to strip context from your telemetry.

### Is it worth migrating if we've already optimized our current setup?

Ask whether you've optimized within a broken model. If your team spends
real hours on cost management (tuning logs, managing sampling, building
filtering pipelines), that time is a cost migration removes. Run the
Step 1 audit to find out.

### Can we migrate incrementally, or is it all-or-nothing?

Go incremental. OTel-based platforms support dual-shipping during
evaluation, so you can move one service at a time and compare
results before committing fully.

### What is signal-based pricing for observability?

You pay per event (log line, trace span, metric data point), not per
byte. Adding rich context like stack traces doesn't raise the bill.
base14 Scout: $250/month platform fee + $0.10 per million metrics +
$0.25 per million logs and traces. Unlimited seats and 30-day
default retention included.

### How do I calculate my observability TCO?

Start with direct vendor costs. Then add hidden costs: hours spent
on pipeline building, log tuning, and cardinality management.

Add extra incident time from sampled or expired data. Add lost
output from limited seat access. Most teams find hidden costs add
significantly on top of direct fees.

## The pricing model is the optimization

Every conventional guide to observability cost optimization teaches
you to work around your pricing model - filter harder, sample more
aggressively, retain less data, limit seats. These strategies accept
a broken incentive structure and ask you to absorb its costs.

The alternative is to fix the incentive structure itself.

Signal-based pricing, zero-sampling friendly architecture, 30-day
default retention, and unlimited seats aren't premium features
behind an enterprise paywall. They're what happens when the pricing
model stops fighting what observability is supposed to do.

Three things worth remembering:

1. If your team spends engineering time on observability cost
   management, the pricing model is the problem
2. The total cost of observability includes the hidden tax of sampling,
   short retention, and limited access; not just the invoice
3. OpenTelemetry-native platforms give you permanent negotiating power,
   the ability to switch without re-instrumenting

**Ready to see what your observability costs look like on signal-based
pricing?** [Book a demo](https://base14.io/contact) and bring your
current invoice. We'll build a side-by-side comparison for your
specific infrastructure.

- No long-term contracts. Month-to-month.
- [SOC 2 Type II and ISO 27001 compliant](https://base14.io/security).
- Assisted onboarding included at no extra cost.
- OpenTelemetry-native. Keep your instrumentation if you leave.

---

## Related reading

- [The Datadog alternative that doesn't charge per host](/blog/datadog-alternative)
- [New Relic alternative: observability without the seat tax](/blog/new-relic-alternative)
- [CloudWatch alternative: unified observability beyond AWS](/blog/cloudwatch-alternative)
- [Observability Theatre](/blog/observability-theatre)
- [Understanding what increases and reduces MTTR](/blog/factors-influencing-mttr)
