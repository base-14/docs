---
slug: cloud-native-foundation-layer
title:
  "The Cloud-Native Foundation Layer: A Portable, Vendor-Neutral Base for Modern
  Systems"
description: "Avoid cloud lock-in with a portable foundation layer. Use composable infrastructure, open protocols, and unified observability to stay free across AWS, GCP, and beyond."
authors: [irfan-shah]
tags: [cloud-native, portability, vendor-neutral, architecture, multi-cloud, kubernetes]
image: ./cover.png
---

<!-- markdownlint-disable MD033 -->
<div className="blog-cover">
  <img
    src={require('./cover.png').default}
    alt="Cloud-Native Foundation Layer" />
</div>
<!-- markdownlint-enable MD033 -->

Cloud-native began with containers and Kubernetes. Since then, it has become a
set of open standards and protocols that let systems run anywhere with minimal
friction.

Today's engineering landscape spans public clouds, private clouds, on-prem
clusters, and edge environments - far beyond the old single-cloud model. Teams
work this way because it's the only practical response to cost, regulation,
latency, hardware availability, and outages.

If you expect change, you need an architecture that can handle it.

<!--truncate-->

## Deploying on One Cloud Isn't Lock-In. Designing for One Cloud Is

Two recent outages show how risky this is:

### Cloudflare — 18 Nov 2025

A routing bug took down large parts of the internet for hours. Many companies
broke even if they weren't Cloudflare customers. Their DNS, CDN, or WAF traffic
still flowed through Cloudflare somewhere.

### AWS us-east-1 — 20 Oct 2025

Cascading control-plane failures halted services across the industry. Anyone
tied to us-east-1 had no alternatives.

These failures weren't unusual. They were predictable outcomes of stacking
critical workloads in one place.

**If your whole system sits on one provider, their failures become your
failures.**

## Cloud Costs Make Lock-In Expensive

DHH's _"We Have Left the Cloud"_ is a clear example. Basecamp/HEY left AWS after
realizing the cost no longer made sense. Doing so saved them millions.

Their situation was unusual, but the point is general:

**You cannot control cost if you cannot move.**

If all your workloads sit on one cloud, you lose the ability to:

- Shift workloads to cheaper regions
- Compare GPU pricing across clouds
- Escape sudden egress spikes
- Negotiate pricing at all

The problem isn't being on one cloud. It's **losing the option to leave**. With
portable designs, you can sidestep outages like Cloudflare's or AWS's by running
elsewhere, and you regain leverage on price. Freedom comes from reversibility.

## Most Lock-In Doesn't Come From Vendors. It Comes From Your Code

The trap usually starts small:

- An SDK call deep in your business logic
- A dependency on a proprietary database
- A CI pipeline that only works in one cloud
- An IAM model you can't reproduce anywhere else
- A networking or eventing pattern that has no equivalent outside your vendor

None of these feel like lock-in at the time. They become lock-in when you try to
change something and can't.

## What the Foundation Layer Really Is

A _Cloud-Native Foundation Layer_ isn't extra architecture. It's the minimum
structure you need to stay free:

### 1. Composable Infrastructure

Use components that behave the same everywhere: containers, GitOps, Terraform.

### 2. Open Interfaces and Protocols

Choose interfaces that don't care where they run: HTTP/JSON, gRPC, SQL, OTel,
S3-compatible storage.

### 3. Unified Observability

Instrument with OpenTelemetry so your telemetry can go to any backend without
changes.

If you do these three things, you get:

- Portability
- Better uptime
- Lower cost volatility
- Easier compliance
- Freedom to adopt new technology

None of this is abstraction for its own sake. It's the cheapest way to avoid
expensive mistakes later.

## A Foundation Layer: The Ability to Change Your Mind

Outages will happen. Pricing will change. AI hardware will appear in one cloud
before another. Data residency rules will tighten.

A foundation layer gives you space to respond. Without it, every change is
painful.

## What's Next

In **Post 2**, we'll cover how to structure your code so your domain logic
doesn't depend on any one cloud — the core of true portability.

Meanwhile you can read about what we wrote about [the learnings](https://www.linkedin.com/pulse/my-learnings-from-cloudflare-nov-18-incident-ranjan-sakalley-bxwbc)
from the recent cloudflare outage.

## References

- Cloudflare Outage (18 Nov 2025):
  [https://blog.cloudflare.com/18-november-2025-outage/](https://blog.cloudflare.com/18-november-2025-outage/)
- Learnings from Cloudflare Outage:
  [https://www.linkedin.com/pulse/my-learnings-from-cloudflare-nov-18-incident-ranjan-sakalley-bxwbc](https://www.linkedin.com/pulse/my-learnings-from-cloudflare-nov-18-incident-ranjan-sakalley-bxwbc)
- AWS us-east-1 Outage (20 Oct 2025):
  [https://www.thousandeyes.com/blog/aws-outage-analysis-october-20-2025](https://www.thousandeyes.com/blog/aws-outage-analysis-october-20-2025)
- DHH — _We Have Left the Cloud_:
  [https://world.hey.com/dhh/we-have-left-the-cloud-251760fb](https://world.hey.com/dhh/we-have-left-the-cloud-251760fb)
