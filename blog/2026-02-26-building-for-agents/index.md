---
slug: building-for-agents
date: 2026-02-26
title: "Building for Agents"
description: "Designing products for a user that is fast, literal, stateless, and has no eyes. Lessons from building agents that rely on third-party tools."
authors: [ranjan-sakalley]
tags: [agents, api-design, developer-experience, observability, ai]
---

Building agents that rely on third-party tools teaches you, quickly, what works
and what doesn't. Most of these lessons came from things breaking. Here's what
I think matters.

<!--truncate-->

## AX Is Not UX

Agent experience is a different design problem from user experience. A human
navigates windows and portals and dashboards and clicks through menus. An agent
needs structured endpoints, tool schemas, and CLI interfaces. It can't click
your buttons and doesn't read your tooltips.

- MCP server, OpenAPI spec, and CLI are first-class products, not wrappers
  around the real product. For an agent, they are the product.
- Responses should be structured with consistent schemas (JSON, for example).
  Error codes should be machine-readable.
- Every action a human can take through your UI should have a corresponding
  programmatic equivalent.
- Prefer HATEOAS semantics.

## Conciseness as a Feature

Every token in a response costs money, adds latency, and consumes context
window space. A 3x verbose response across a million agent calls adds up fast.

Offer a machine-readable response format by default, keep it minimal, let
verbose human-friendly descriptions be opt-in.

Return `{"status": "rate_limited", "retry_after_seconds": 30}`, not a sentence
explaining what rate limiting means.

## Auth Should Not Assume a Human Caller

OAuth popups, CAPTCHAs, MFA challenges, all of these assume a human is present
at runtime. For an agent operating autonomously, any of these is a hard stop.

An agent setup step is where all of the above should be concentrated.

- Support API keys, service accounts, delegated tokens with scoped permissions,
  long-lived refresh tokens with automatic rotation.
- But, do not abandon security. Scoped permissions and token rotation can be
  more secure than passwords.

## Identity and Attribution

When a single API key is shared across multiple sub-agents, you lose all
traceability. You can see that something made 500 API calls last hour, but you
can't tell the planning agent from the execution agent. This is the agent
equivalent of a shared login.

- Support agent-level identity tokens or metadata fields that allow callers to
  declare which agent is acting.
- Include this identity in audit logs.
- When something goes wrong, the question is always "which agent did this, and
  on behalf of which workflow?" If your platform can't answer that, debugging
  agentic workflows becomes archaeology.

## Docs for Machines

Most docs are written for humans. Tutorials, explanations, conceptual
overviews. An agent will try to scrape your docs site and make sense of it
through an LLM.

An OpenAPI spec is better than a markdown API reference. A tool schema with
typed parameters is better than a tutorial.

Maintain a parallel surface, a spec or schema that agents can reason over
programmatically without parsing natural language.

Docs should be in a format more structured than HTML, markdown at minimum,
with consistent formatting an LLM can reliably parse. All base14 docs for
example have a markdown equivalent, the directory is part of `llms.txt`.
A better approach is to `accept: 'text/markdown'`, available instantly if you
host on Cloudflare. Coming soon for our docs as well.

## Verifiability

When an agent, often coordinating multiple sub-agents, performs a complex task,
a human needs to be able to verify after the fact everything that happened. What
was read. What was written. What decisions were made and on what basis. Which
sub-agent performed which action, and in what order.

- Audit logs with trace IDs that span across sub-agent calls.
- Use the right observability tooling and instrumentation so that you can
  reconstruct the full chain of reasoning.
- Support trace context propagation. Make every agent action attributable and
  inspectable.

It's not enough to know that "the agent completed the task." You need to know
how. Without verifiability, you're asking humans to trust a black box. That
trust takes some time to build. And it's easier to build through telemetry.
It's also easier perhaps for another agent to look up telemetry data to ensure
that work is done.

## Errors Agents Can Act On

A human sees a 500 error and knows to try again later, or checks Twitter to
see if the service is down. An agent needs to decide programmatically what to
do next.

- Every error should include a machine-readable code, a category (transient vs.
  permanent, client vs. server), and where possible, a suggested remediation.
- "retry after N seconds" is actionable. "something went wrong" is not.
- Rate limiting and backpressure need clear structured signals. A 429 with
  `Retry-After` headers and remaining quota is better than a heavy
  human-readable error page.

## Idempotency, Agents Retry

Agents retry. On timeouts, on transient errors, on ambiguous responses. If
your API isn't idempotent, agents will create duplicates, double-charge
customers, or corrupt state.

- Support idempotency keys on any state-mutating endpoint, if you haven't
  done already.
- Track retries and try to reduce. This helps a lot in crafting better
  response messages to an agent.

## Nudges and Affordances

This one is more speculative, perhaps I am influenced by my area of work, but
worth considering. In a UI, buttons and menus guide a user toward the next
action. The agent equivalent is responses that include actionable next steps.

- If a deployment fails, the response can include a link to the relevant logs
  endpoint and a suggested diagnostic query.
- If a resource is created, the response can include endpoints for common
  follow-up actions.
- For observability platforms and auto-remediation workflows, where an agent
  detecting an anomaly needs to know what diagnostic steps are available and
  in what order.

---

Your new user is fast, literal, stateless, and has no eyes. Treating agent
support as a wrapper around a human-first product may work sometimes. But hope
is not a good strategy, long term.
