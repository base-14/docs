---
slug: make-certificate-expiry-boring
date: 2025-11-20
title: Making Certificate Expiry Boring
authors: [ranjan-sakalley]
tags: [security, certificates, automation, observability]
---

## Making Certificate Expiry Boring

<!-- markdownlint-disable MD033 -->
<div className="blog-cover">
  <img src={require('./cover.png').default}
    alt="Certificate expiry issues are entirely preventable" />
</div>
<!-- markdownlint-enable MD033 -->

On 18 November 2025, GitHub had an hour-long outage that affected the
heart of their product: Git operations. The post-incident
[summary](https://www.githubstatus.com/incidents/5q7nmlxz30sk) was brief
and honest - the outage was triggered by an internal TLS certificate that
had quietly expired, blocking service-to-service communication inside
their platform. It's the kind of issue every engineering team knows _can_
happen, yet it still slips through because certificates live in odd
corners of a system, often far from where we normally look.

What struck me about this incident wasn't that GitHub "missed something."
If anything, it reminded me how easy it is, even for well-run, highly
mature engineering orgs, to overlook certificate expiry in their
observability and alerting posture. We monitor CPU, memory, latency,
error rates, queue depth, request volume - but a certificate that's about
to expire rarely shows up as a first-class signal. It doesn't scream. It
doesn't gradually degrade. It just keeps working… until it doesn't.

And that's why these failures feel unfair. They're fully preventable, but
only if you treat certificates as operational assets, not just security
artefacts. This article is about building that mindset: how to surface
certificate expiry as a real reliability concern, how to detect issues
early, and how to ensure a single date on a single file never brings down
an entire system.

### Why certificate-expiry outages happen

Most outages have a shape: a graph that starts bending the wrong way, an
error budget that begins to evaporate, a queue that grows faster than it
drains. Teams get early signals. They get a chance to react.

Certificate expiry is different. It behaves more like a trapdoor.
Everything works perfectly… until the moment it doesn't.

And because certificates sit at the intersection of security and
infrastructure, ownership is often ambiguous. One team issues them,
another deploys them, a third operates the service that depends on them.
Over time, as systems evolve, certificates accumulate in places no one
remembers - a legacy load balancer here, a forgotten internal endpoint
there, an old mutual-TLS handshake powering a background job that hasn't
been touched in years. Each one quietly counts down to a date that may
not exist anywhere in your dashboards.

It's not that engineering teams are careless. It's that distributed
systems create _distributed responsibilities_. And unless expiry is
treated as an operational metric - something you can alert on, page on,
and practice recovering from - it becomes a blind spot.

The GitHub incident is just a recent reminder of a pattern most of us
have seen in some form: the system isn't failing, but our visibility into
its prerequisites is.

That's what we'll fix next.

### Where certificates actually live in a modern system

Before we talk about detection and automation, it helps to map the
terrain. Certificates don't sit in one place; they're spread across a
system the same way responsibilities do. And when teams are busy shipping
features, it's easy to forget how many places depend on a valid chain of
trust.

A few common patterns:

**1. Public entry points**
These are the obvious ones - the certificates on your API gateway, load
balancers, reverse proxies, or CDN. They're usually tracked because
they're customer-facing. But even here, expiry can slip through if
ownership rotates or if the renewal mechanism silently fails.

**2. Internal service-to-service communication**
Modern systems often use mTLS internally. That means each service,
sidecar, or pod may hold its own certificate, usually short-lived and
automatically rotated. The catch: these automation pipelines need
monitoring too. When they fail, the failure is often invisible until the
cert expires.

**3. Databases, message brokers, and internal control planes**
Many teams enable TLS for PostgreSQL, MongoDB, Kafka, Redis, or internal
admin endpoints - and then forget about those certs entirely. These can
be some of the hardest outages to debug because the components are not
exposed externally and failures manifest as connection resets or
handshake errors deep inside a dependency chain.

**4. Cloud-managed infrastructure**
AWS ALBs, GCP Certificate Manager, Azure Key Vault, CloudFront, IoT
gateways - each keeps its own certificate store. These systems usually
help with automation, but they don't always alert when renewal fails, and
they certainly don't alert when your _usage_ patterns change.

**5. Legacy or security-adjacent components**
Some of the most outage-prone certificates sit in places we rarely
revisit:

- VPN servers
- old NGINX or HAProxy nodes
- staging environments
- batch jobs calling external APIs
- IoT devices or firmware-level certs
- integrations with third-party partners

If even one of these expires, the blast radius can be surprisingly wide.

What all of this shows is that certificate expiry isn't a single-problem
problem - it's an inventory problem. You can't secure or monitor what you
don't know exists. And you can't rely on tribal memory to keep track of
everything.

The next step, naturally, is stitching visibility back into the system:
turning this scattered landscape into something observable, alertable,
and resilient.

### Detecting certificate expiry across different environments

Once you understand where certificates tend to hide, the next question
becomes: _how do we surface their expiry in a way that fits naturally
into our observability stack?_
The good news is that we don't need anything exotic. We just need a
reliable way to extract expiry information and feed it into whatever
monitoring and alerting system we already trust.

The exact approach varies by environment, but the principle stays the
same: **expiry should show up as a first-class metric** - just like
latency, errors, or disk space.

Let’s break this down across the most common setups.

#### **1. Kubernetes (with cert-manager)**

If you're using cert-manager, you already have expiry information
available - it's just a matter of surfacing it.

Cert-manager stores certificate metadata in the Kubernetes API, including
`status.notAfter`. Expose that through:

- cert-manager’s built-in metrics
- a Kubernetes metadata exporter
- or a lightweight custom controller if you prefer tighter control

Once the metric is flowing into your observability stack, you can build
straightforward alerts:

- 30 days → warning
- 14 days → urgent
- 7 days → critical

This handles most cluster-level certificates, especially ingress TLS and
ACME-issued certs.

#### **2. Kubernetes (without cert-manager)**

Many clusters use:

- TLS secrets created manually
- certificates provisioned by CI/CD
- certificates embedded inside service mesh CA infrastructure
- or certificates uploaded to cloud load balancers

In these cases, you can extract expiry from:

- the `tls.crt` in Kubernetes Secrets
- mesh control plane metrics (e.g., Istio’s CA exposes rotation details)
- endpoint probes from blackbox exporters
- cloud provider API calls that list certificate metadata

The pattern stays the same: gather expiry → convert to a metric → alert early.

#### **3. Virtual machines, bare metal, or traditional workloads**

This is where certificate expiry issues happen the most, often because
the monitoring setup predates the current system complexity.

Your options here are simple and effective:

- Run a small cron job that calls `openssl` against known endpoints
- Parse certificates from local files or keystores
- Use a Prometheus blackbox exporter to probe TLS endpoints
- Query cloud APIs for LB or certificate manager expiry
- Forward results as metrics or events into your observability system

Nearly every major outage caused by certificate expiry outside Kubernetes
happens in these environments - mostly because there's no single place
where certificates live, so no single tool naturally monitors them. A
tiny script with a 30-second probe loop can save hours of downtime.

#### **4. Cloud-managed ecosystems**

AWS, GCP, and Azure all provide mature certificate stores:

- **AWS ACM**, **CloudFront**, **API Gateway**
- **GCP Certificate Manager**, **Load Balancing**
- **Azure Key Vault**, **App Gateway**

They usually renew automatically, but renewals can fail silently for reasons like:

- unnecessary domain validation retries
- DNS misconfigurations
- permissions regressions
- quota limits
- or expired upstream intermediates

The fix: poll these APIs on a schedule and compare expiry timestamps
with your policy thresholds. Treat those just like metrics from a node or
pod.

#### **5. The hard-to-see corners**

No matter how modern your architecture is, you’ll find certificates in:

- internal admin endpoints
- Kafka, RabbitMQ, or PostgreSQL TLS configs
- legacy VPN boxes
- IoT gateways
- partner API integrations
- staging environments that don’t receive the same scrutiny

These deserve monitoring too, and the process is no different: probe, parse, publish.

#### Focus on expiry as a metric

When certificate expiry becomes just another number that your dashboards
understand - a timestamp that can be plotted, queried, alerted on - the
problem changes shape. It stops being a last-minute surprise and becomes
part of your normal operational rhythm.

The next question, then, is how to automate renewals and rotations so
that even when alerts happen, they're nothing more than a nudge.

### Automating certificate renewal and rotation

Detecting certificates before they expire is necessary, but it's not the
end goal. The real win is when expiry becomes uninteresting - when
certificates rotate quietly in the background, without paging anyone, and
without becoming a stress point before every major release.

Most organisations get stuck on renewals for one of two reasons:

1. They assume automation is risky.
2. Their infrastructure is too fragmented for a single renewal flow.

But automation doesn't have to be fragile. It just has to be explicit.

Here are the most reliable patterns that work across environments.

#### **1. ACME-based automation (Let’s Encrypt and internal ACME servers)**

If your certificates can be issued via ACME, life becomes dramatically
simpler. ACME clients - whether cert-manager inside Kubernetes or
acme.sh / lego on a traditional VM - handle the full cycle:

- request
- validation
- issuance
- renewal
- rotation

And because ACME certificates are intentionally short-lived, your system
gets frequent practice, making renewal failures visible long before a
real expiry.

For internal systems, tools like **Smallstep**, **HashiCorp Vault** (ACME
mode), or **Pebble** can act as internal ACME CAs, giving you automatic
rotation without public DNS hoops.

#### **2. Renewal via internal CA (Vault PKI, Venafi, Active Directory CA)**

Some environments need tighter control than ACME allows. In those cases:

- Vault's PKI engine can issue short-lived certs on demand
- Venafi integrates with enterprise workflows and HSM-backed keys
- Active Directory Certificate Services can automate internal certs for
  Windows-heavy stacks

The trick is to treat issuance and renewal as API-driven processes - not
as manual handoffs.

The pipeline should be able to:

- generate or reuse keys
- request a new certificate
- store it securely
- trigger a reload or rotation
- validate that clients accept the new chain

Once this flow exists, adding observability around it is straightforward.

#### **3. Automating the _distribution_ step**

Most certificate outages happen _after_ renewal succeeds - when the new
certificate exists but hasn't been rolled out cleanly.

To make rotation safe and predictable:

- Upload the new certificate _alongside_ the old one
- Switch your service or load balancer to the new certificate atomically
- Gracefully reload instead of restarting
- Keep the old cert around for a short overlap window
- Validate that clients, proxies, and edge layers all trust the new
  chain

This overlap pattern avoids the "everything broke because we reloaded too
aggressively" class of outages, which is surprisingly common.

#### **4. Cloud-managed rotation**

Cloud providers do a decent job of renewing certificates automatically,
but they won't validate your whole deployment chain. That's on you.

The safe pattern:

- Let the cloud provider renew
- Poll for renewal events
- Verify that listeners, API gateways, and CDN distributions have
  _updated attachments_
- Validate downstream systems that import or pin certificates
- Raise alerts if anything gets stuck on an older version

This closes the gap between "cert renewed" and "cert in use."

#### **5. Rotation in service meshes and sidecar-based systems**

Istio, Linkerd, Consul Connect, and similar meshes issue short-lived
certificates to workloads and rotate them frequently. This is excellent
for security - but only if rotation stays healthy.

You want to monitor:

- workload certificate rotation age
- control-plane CA expiry
- sidecar rotation errors
- issuance backoff or throttling

If rotation falls behind, it should be alerted on long before expiry.

#### The goal is predictability, not cleverness

A good renewal system doesn't try to be "smart."
It tries to be **boring** - predictable, transparent, observable, and
easy to test.

The next step is tying this predictability into your alerting strategy:
you want enough signal to catch problems early, but not so much noise
that expiry becomes background static.

### Alerting strategies that actually prevent downtime

Once certificates are visible in your monitoring system, the next
challenge is deciding _when_ to alert and _how loudly_. Expiry isn't
like latency or saturation - it doesn't fluctuate minute-to-minute. It
moves slowly, predictably, and without drama. That means your alerts
should feel the same: calm, early, and useful.

A good alert for certificate expiry does two things:

1. It tells you early enough that the fix is routine.
2. It doesn't page the team unless the system is genuinely at risk.

Taking the risk and being prescriptive, here's how to design that
balance.

#### **1. Use long, staggered alert windows**

A 90-day certificate doesn't need a red alert at day 89.
But it also shouldn't wait until day 3.

A common, reliable pattern is:

- **30 days** → warning (non-paging)
- **14 days** → urgent (may page depending on environment)
- **7 days** → critical (should page)

This staggered approach ensures:

- your team has multiple chances to notice
- you can distinguish "renewal hasn't happened yet" from "renewal
  failed"
- you avoid last-minute firefighting, especially around holidays or
  weekends

The goal is to turn expiry into a background piece of operational hygiene
\- not an adrenaline spike.

#### **2. Alert on renewal failures, not just expiry**

A certificate expiring is usually a _symptom_.
The real problem is that the renewal automation stopped working.

So your monitoring should include:

- ACME failures (DNS, HTTP-01/ALPN-01 challenges failing)
- mesh-sidecar rotation failures
- Vault or CA issuance errors
- permissions regressions (role can no longer request or upload certs)
- cloud-provider renewal stuck in "pending validation"

These alerts often matter more than the expiry date itself.

#### **3. Detect chain issues and intermediate expiries**

Sometimes the leaf certificate is fine - but an intermediate in the chain
is not. Many teams miss this, because they only check the surface-level
cert.

Your probes should validate the _full_ chain:

- intermediate expiry
- missing intermediates
- mismatched issuer
- unexpected CA
- weak algorithms

Broken chains can create outages that look like TLS handshake mysteries,
even when the leaf cert is fresh.

#### **4. Surface expiry as a metric your dashboards understand**

A certificate's expiry date is just a timestamp. Expose it like any other
metric:

- `ssl_not_after_seconds`
- `cert_expiry_timestamp`
- `x509_validity_seconds`

Once it’s a metric:

- you can plot trends
- you can compare environments
- you can find components with unusually short or long TTLs
- you can build SLOs around the rotation process

It becomes part of your observability ecosystem, not an afterthought.

#### **5. Don't rely on humans to remember edge cases**

If your alerts depend on tribal knowledge - someone remembering that
"there's an old VPN gateway in staging with a cert that expires in March"
\- then you don't have an alerting strategy, you have a memory test that
your team **will** fail.

Every certificate, in every environment, should be:

- discoverable
- monitored
- alertable

The moment monitoring depends on someone remembering "that one place we
keep certs," you're back to hoping instead of observing.

#### Alerting should create confidence, not anxiety

Good alerts help teams sleep better. They remove uncertainty and allow
engineers to trust that the system will tell them when something
important is off. Certificate expiry should fall squarely into this camp
\- predictable, early, and boring.

With detection and alerting covered, the next piece is ensuring the
system behaves safely when certificates actually rotate: how to design
zero-downtime deployment patterns so rotation never becomes an outage
event.

### Zero-downtime rotation patterns

Even with good monitoring and robust automation, certificate renewals can
still cause trouble if the rotation process itself is fragile. A
surprising number of certificate-related outages happen _after_ a new
certificate has already been issued - during the switch-over phase where
services, load balancers, or sidecars pick up the new credentials.

Zero-downtime rotation isn't complicated, but it does require deliberate
patterns. Most of these boil down to one principle:

| **Never replace a certificate in a way that surprises the system.**

Here are the patterns that make rotation predictable and safe.

#### **1. Overlap the old and new certificates**

A simple but powerful rule:
**Always have a window where both the old and new certificates are valid
and deployed.**

This overlap ensures:

- long-lived clients can finish their sessions
- short-lived clients pick up the new cert seamlessly
- you avoid "half the system has the new cert, half has the old one"
  situations

In practice, this can mean:

- adding the new certificate as a second chain in a load balancer
- rotating the private key but temporarily supporting both versions
- waiting for a full deployment cycle before removing the old cert

Overlap is your safety net.

#### **2. Use atomic attachment for load balancers and gateways**

Cloud load balancers usually support:

- uploading a new certificate
- switching the listener to the new certificate in a single update

This is vastly safer than:

- deleting and re-adding
- reloading configuration mid-traffic
- relying on an external script to get timing right

Atomic attachment ensures that the traffic shift is instantaneous and consistent.

#### **3. Prefer graceful reloads over restarts**

Some services pick up new certificates on reload, others need restarts.
Where you can, choose the reload path.

Graceful reloads:

- avoid dropping connections
- preserve in-flight requests
- avoid spikes in error rates and latency
- allow blue-green or rolling processes inside Kubernetes, Nomad, or VMs

If a service truly cannot reload (rare today), wrap rotation in a:

- rolling restart
- node-by-node drain
- health-checked deployment sequence

The idea is the same: no hard cuts.

#### **4. Validate after rotation - not just before**

Many teams validate certificates before they rotate:

- subject, issuer
- SAN list
- expiry date
- chain
- signature

All good - but not enough.

You also need **post-rotation validation**:

- do clients still trust the chain?
- is OCSP/CRL working?
- did any pinned-certificate clients break?
- did any intermediate certificates unexpectedly change?
- did the system propagate the new certificate everywhere?

Treat rotation as a deployment, not a file update.

#### **5. Treat service meshes as first-class rotation systems**

Sidecar-based meshes like Istio or Linkerd already rotate certificates
frequently. But the control-plane CA certificates still need careful
handling.

When rotating a CA certificate in a mesh:

- introduce the new root or intermediate
- allow both chains temporarily
- ensure workloads are receiving new leaf certs under the new CA
- only retire the old CA when no workload depends on it

Skipping these steps can break mTLS cluster-wide.

#### **6. Keep rotation logs - they're your only breadcrumb trail**

Certificate rotation has a habit of failing silently.
Most debugging sessions start with, "Did the certificate get picked up?"
and end in grepping logs or diffing secrets.

A good rotation system records:

- when certificates were requested
- when they were issued
- where they were distributed
- when services reloaded/restarted
- which version is currently active

This is invaluable during an incident, and equally helpful for audits or
compliance. Drop it into the #release or #deployment slack channel so
others can debug faster when things go bad.

#### Rotation should feel like any other deploy

The most reliable teams treat certificate rotation exactly like they
treat code deployment:

- staged
- observable
- reversible
- tested
- boring

When a certificate rotation feels as uninteresting as a config push or a
canary rollout, you've reached operational maturity in this area.

### Building organisation-wide guardrails around certificate management

Everything we've covered so far - inventory, monitoring, renewal,
rotation - solves the _technical_ side of certificate expiry. But
outages rarely happen because of a missing script or exporter. They
happen because systems grow, responsibilities shift, and operational
assumptions slowly drift out of sync with reality.

Preventing certificate-expiry outages at scale requires more than good
automation. It needs **guardrails**: lightweight, durable structures that
support engineers without slowing them down. This isn't governance, and
it isn't process for process' sake. It's giving teams the clarity and
safety they need so certificates don't become an invisible failure mode.

Some if not all of these guardrails aren't needed if you have a single
well known and automated way of dealing with certificates. Sometimes
that's not the case, and that's where you need guardrails. Here are
guardrails that have helped me manage the complexity of manual
certificate lifecycle.

#### **1. Make ownership explicit - for every certificate**

Every certificate in your system should have:

- an owner
- a renewal mechanism
- a rotation mechanism
- a monitoring hook
- an escalation path

This sounds formal, but it can be as simple as three fields in an internal inventory:

- _Service name_
- _Team_
- _Contact channel_

When ownership is clear, expiry becomes a maintenance task, not a detective story.

#### **2. Set policy, but keep it lightweight**

Certificate policies often fail because they become too rigid or too
verbose. A practical policy should answer only the essentials:

- What is the recommended TTL?
- Which CAs are approved?
- How should private keys be stored?
- What is the expected rotation pattern?

#### **3. Use the same observability channels you use for everything else**

A certificate expiring should appear in:

- the same dashboard
- the same alerting system
- the same on-call rotation
- the same incident workflow

If you need a separate tool or a second inbox to monitor certificates,
you've already created inefficiencies and you are going to add more to
the confusion. The best guardrail is simply: "This is part of our normal
operational metrics."

#### **4. Run periodic "expiry audits" without blame**

Once or twice a year, do a small audit:

- list certificates expiring within N days
- identify certificates with missing owners
- catch stray certs on forgotten hosts
- verify mesh CA rotations
- clean up unused secrets

The best option is to automate this audit.

#### **5. Practice a certificate-rotation drill**

Just like fire drills, rotation drills can build confidence by exposing
vulnerabilities and gaps.
Pick a non-critical service once a quarter:

- issue a new certificate
- rotate it using your recommended method
- validate behaviour
- document any rough edges

This helps teams become comfortable with rotations, and uncovers issues
that only show up during real renewals - mismatched trust stores, pinned
clients, stale intermediates, or forgotten nodes. Better still, do it in
production for a service.

#### **6. Encourage teams to prefer automation over manual fixes**

When a certificate is close to expiring, the fastest fix is often manual:
generate a cert, upload it, restart a service - thank your sir.

It works in the moment, but creates a hidden cost: the automation is
bypassed, and the system drifts.

Guardrails help by making the automated path the default:

- CI pipelines that issue certs consistently
- templates that enforce expiry monitoring
- runbooks that always reference the automated flow
- dashboards that show rotation health

#### Guardrails keep engineering energy focused where it matters

Good guardrails don't feel heavy. They feel like support structures - the
kind that keep important details visible even when everyone is moving
fast. They reduce cognitive load, eliminate invisible traps, and give
teams a shared mental model for how certificates behave in their
environment.

When these guardrails are in place, certificate expiry stops being a
background anxiety. It becomes just another part of the system that's
well understood, continuously monitored, and quietly maintained.

### Bringing it all together - from trapdoor failures to predictable operations

Certificate-expiry outages feel disproportionate. They don't arise from a
complex scaling limit or an unexpected dependency interaction. They come
from a single date embedded in a file - a detail that quietly counts down
while everything else appears healthy. And when that date finally
arrives, the failure is abrupt. No slow burn, no early symptoms. Just a
trapdoor.

But it doesn't need to be this way.
Expiry is one of the few reliability risks that is both entirely
predictable and entirely preventable.

When we treat certificates as operational assets - things we can
inventory, observe, rotate, and practice with - the problem changes
shape. Instead of scrambling during an incident, teams build a steady
rhythm around expiry:

- certificates are visible as metrics
- renewals happen automatically
- rotations are safe and boring
- alerts arrive early and calmly
- ownership is clear
- guardrails carry the organisational weight

And the result is a system that behaves the way resilient systems should:
not because people remembered every corner, but because the structure
makes forgetting impossible.

The GitHub outage was a reminder, not a criticism. It showed that even
the most sophisticated engineering organisations can be caught off-guard
by something small and silent. But it also demonstrated why it's worth
building a culture - and a set of practices - where small and silent
things are surfaced early.

If your team can get certificate expiry out of the class of "we hope this
doesn't bite us" and into the class of "this is a well-managed part of
our infrastructure," you've eliminated an entire category of avoidable
outages.

That's the goal. Not perfect governance. Just clear guardrails, steady
habits, and a system you can trust - even on the days when nothing looks
wrong.
