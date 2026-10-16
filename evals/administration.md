---
sidebar_position: 8
title: Administration, access, and data handling
sidebar_label: Administration and security
description:
  Manage organizations, projects, members, and roles in Base14 Evals, and
  understand how base14 hosts and processes your data.
keywords:
  [evals rbac, llm observability security, evals data retention, sso]
---

# Administration, access, and data handling

## Organizations and projects

Your instance has one or more organizations, each with projects. A project
holds its own traces, prompts, datasets, evaluators, API keys, and LLM
connections; nothing is shared between projects. Use separate projects for
separate applications, and environments within a project for production,
staging, and local traffic.

base14 creates your first organization and project when it sets up the
instance. Organization owners can create more projects under
**Organization Settings**.

## Members and roles

Invite people under **Settings → Members**. A member's role applies to every
project in the organization:

| Role | Can |
| --- | --- |
| Owner | Everything, including deleting the organization and managing owners |
| Admin | Manage members, API keys, LLM connections, and project settings |
| Member | Create and edit traces, scores, prompts, datasets, and evaluators |
| Viewer | Read everything, change nothing |
| None | Belongs to the organization but sees no project data |

## Single sign-on

base14 connects your instance to its identity service, so people sign in with
the same account they use for other base14 products. New users can be added
to your organization automatically with a default role. Ask your base14
contact to set this up or change the default role.

## Hosting and data location

base14 runs a dedicated Evals instance for your organization on base14
infrastructure. Its databases are separate from those of other customers and
from your Scout telemetry. base14 operates and upgrades the instance; there
is nothing for you to install.

## LLM-as-a-judge and your data

An LLM-as-a-judge evaluator sends the fields you map into its template, such
as trace input and output, to the model provider of the connection it uses.
Review which providers your evaluators use before scoring traces that hold
personal or confidential data, and narrow the evaluator's filter or variable
mapping to send only what the judge needs.

## Data retention

Traces, observations, and scores are kept until you delete them, unless
base14 has set a retention period for your project. Ask your base14 contact
to set or change one. You can delete individual traces from the UI or the
API at any time.

## Differences from the open-source project

Evals is built from open-source code. Some features of that project's
commercial edition are not part of it:

- Organization and project management APIs. base14 provisions organizations
  and projects for you.
- Audit logs and data masking at ingestion.
- Retention settings in the UI. Retention is set by base14 per project.
- Per-organization SSO configuration. SSO is set up by base14 for the whole
  instance.
