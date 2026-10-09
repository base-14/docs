---
date: 2026-10-09
id: streaming-auth0-logs
title: Stream Auth0 Logs to base14 Scout with a Custom Webhook Log Stream
sidebar_label: Auth0
description:
  Stream Auth0 tenant logs into base14 Scout with an Auth0 Custom Webhook log
  stream. No collector or code changes. Setup, attributes, severity mapping,
  verification, and troubleshooting.
keywords:
  [
    auth0 logs,
    auth0 log streams,
    auth0 custom webhook,
    auth0 opentelemetry,
    auth0 monitoring,
    auth0 login failures,
    auth0 observability,
    stream auth0 logs to scout,
  ]
---

## Overview

Auth0 [Log Streams](https://auth0.com/docs/customize/log-streams/custom-log-streams)
push your tenant's log events to base14 Scout over HTTPS as they happen. You
configure one Custom Webhook stream in Auth0 and Scout does the rest. You run
no collector or agent, and your applications need no code changes.

Events land in [logX](../../operate/logx/index.md) under the service `auth0`.
Scout keeps each event's original JSON as the log body and promotes the most
useful fields to attributes you can filter on: event type, application, user,
IP address, location, and more.

:::info Enabled by base14

base14 turns on Auth0 log streaming for your Scout account. To get started,
[contact the base14 team](mailto:support@base14.io).

:::

## How it works

```text
Auth0 tenant --- Custom Webhook log stream (HTTPS, JSON Lines) --> Scout
                                                                    |
                                      parse, set severity + attributes
                                                                    |
                                                                    v
                                                     logX: service auth0
```

## Prerequisites

- An Auth0 tenant for each environment you want to monitor (see
  [One Auth0 tenant per environment](#one-auth0-tenant-per-environment)).
- Permission to create log streams in the Auth0 Dashboard.
- An endpoint URL and ingest token from base14 (see Step 1).

### One Auth0 tenant per environment

A log stream receives every event of its Auth0 tenant. Auth0 lets you filter a
stream by event category only, not by application or domain. In Scout, the
endpoint a stream posts to decides which environment the events belong to. To
keep environments such as dev and production apart in Scout, use a separate
Auth0 tenant for each and point each tenant's stream at that environment's
endpoint.

## Step 1: Get your endpoint and token from base14

[Contact the base14 team](mailto:support@base14.io) and tell us which
environments you want to stream, for example dev and production. base14 sends
you:

- **One endpoint URL per environment.** Each URL tags the events it receives
  with that environment's name.
- **An ingest token.** The token is long-lived but has an expiry date. Ask for
  the expiry date when you receive it and add it to your calendar, because
  Auth0 cannot renew the token for you (see
  [The ingest token expired](#the-ingest-token-expired)).

## Step 2: Create the log stream in Auth0

Repeat this step in each Auth0 tenant, using that environment's endpoint URL.

1. In the Auth0 Dashboard, go to **Monitoring > Streams**.
2. Select **Create Stream**, then **Custom Webhook**.
3. Fill in the settings:

   | Setting | Value |
   | --- | --- |
   | Name | Any name, for example `base14-scout` |
   | Payload URL | `<endpoint URL from base14>` for this environment |
   | Authorization Token | `Bearer <token>`, including the word `Bearer` and the space |
   | Content Type | `application/json` |
   | Content Format | **JSON Lines** |
   | Filter by Event Category | Optional. Leave empty to stream all categories |
   | Starting Cursor | Optional. Leave empty to start from now |

4. Save the stream.

:::warning Use JSON Lines

Scout treats each line of a delivery as one event. **JSON Array** and
**JSON Object** do not put one event on each line, so Scout stores the
delivery unparsed and you lose per-event timestamps, severity, and attributes.

:::

## Step 3: Verify the stream

1. In Auth0, open the stream and select the **Health** tab. Confirm the stream
   status is **Active** and no errors are listed.
2. Trigger an event, for example log in to one of your applications or call
   the Management API.
3. In Scout, open logX, select the service `auth0` and your environment. The
   event appears within about a minute, with the attributes listed below.

## What you get in Scout

### Resource attributes

| Attribute | Value |
| --- | --- |
| `service.name` | `auth0` |
| `environment` | Set by the endpoint, for example `dev` or `production` |

Use the environment picker in logX to switch between environments.

### Timestamp and body

- Timestamp: the event's own `date` field from Auth0, not the time Scout
  received it.
- Body: the original JSON from Auth0. Each event arrives wrapped in an
  envelope, with the event fields under `data`:

  ```json
  {
    "log_id": "90020240101000000000000000000000000000000000000000000000",
    "data": {
      "date": "2026-10-09T08:15:42.123Z",
      "type": "fp",
      "description": "Wrong email or password.",
      "client_name": "My App",
      "ip": "203.0.113.10",
      "user_name": "jane@example.com",
      "details": { "...": "..." }
    }
  }
  ```

  Fields that are not promoted to attributes, such as `details` and
  `security_context`, stay in the body and are still searchable there.

### Severity

Scout sets severity from the Auth0
[event type code](https://auth0.com/docs/deploy-monitor/logs/log-event-type-codes):

| Type codes | Severity | Examples |
| --- | --- | --- |
| Starting with `f` | ERROR | `f` failed login, `fp` incorrect password, `fu` invalid email or username |
| Starting with `w` or `limit_`, plus `pwd_leak`, `signup_pwd_leak`, and `reset_pwd_leak` | WARN | `limit_wc` blocked account, `pwd_leak` breached password |
| Everything else | INFO | `s` successful login, `slo` successful logout, `sapi` Management API operation |

### Log attributes

`auth0.log_id` and `auth0.type` are always set. The other attributes are set
only when the event carries a non-empty value. Auth0 sends many fields as an
empty string, and Scout skips those.

| Attribute | Auth0 field | Notes |
| --- | --- | --- |
| `auth0.log_id` | `log_id` | Unique event ID |
| `auth0.type` | `type` | Event type code |
| `auth0.description` | `description` | Human-readable message |
| `auth0.tenant` | `tenant_name` | Auth0 tenant |
| `auth0.hostname` | `hostname` | Domain that served the request (custom domain or `*.auth0.com`). Absent on Management API and some MFA events |
| `auth0.client_id` | `client_id` | Application ID |
| `auth0.client_name` | `client_name` | Application name |
| `auth0.connection` | `connection`, or `connection_name` on MFA (`gd_*`) events | |
| `auth0.connection_id` | `connection_id` | |
| `auth0.strategy`, `auth0.strategy_type` | `strategy`, `strategy_type` | For example `auth0` and `database` |
| `auth0.audience`, `auth0.scope` | `audience`, `scope` | Token exchanges |
| `auth0.organization_id`, `auth0.organization_name` | `organization_id`, `organization_name` | Organization logins |
| `client.address` | `ip` | |
| `user.id` | `user_id` | |
| `user.name` | `user_name` | Often an email address |
| `user_agent.original` | `user_agent` | |
| `geo.country.iso_code` | `location_info.country_code` | |
| `geo.region.iso_code` | `location_info.subdivision_code` | |
| `geo.locality.name` | `location_info.city_name` | |

## Troubleshooting

Delivery errors show on the stream's **Health** tab in Auth0, not in Scout.
Auth0 attempts each delivery up to three times. If all three fail, it logs an
error on the Health tab and starts the process again for the failed events
until the problem is resolved.

### The Health tab shows 401 errors

**Cause**: the token is missing the `Bearer` prefix, was mistyped, or has
expired.

**Fix**: re-enter the Authorization Token as `Bearer <token>`. If the token has
expired, [contact the base14 team](mailto:support@base14.io) for a new one and
update the stream.

### The Health tab shows 404 errors

**Cause**: the Payload URL is wrong.

**Fix**: copy the endpoint URL from base14 again and update the stream.

### Events arrive but are not parsed

**Symptoms**: no `auth0.*` attributes, every record is INFO, and timestamps are
the arrival time rather than the event time.

**Cause**: the stream is not sending JSON Lines.

**Fix**: set **Content Format** to **JSON Lines**.

### The stream is paused

**Cause**: Auth0 pauses a stream after 7 consecutive days of failed
deliveries.

**Fix**: fix the cause shown on the Health tab, then resume the stream in
Auth0.

### The ingest token expired

**Cause**: the ingest token has a fixed expiry date and Auth0 cannot renew it.
After it expires, every delivery fails with a 401, and the failure shows only
on the Auth0 Health tab.

**Fix**: before the expiry date, ask base14 for a new token and update the
Authorization Token on each stream. If it has already expired, do the same,
then resume the stream if Auth0 paused it.

## FAQ

### Do I need to run an OpenTelemetry Collector to get Auth0 logs into Scout?

No, Auth0 pushes its logs straight to Scout, so you run no collector, agent, or
code. You only create a Custom Webhook log stream in the Auth0 Dashboard with
the endpoint URL and token that base14 provides.

### How do I keep dev and production Auth0 logs separate in Scout?

Use a separate Auth0 tenant for each environment and point each tenant's log
stream at the endpoint base14 gives you for that environment. The endpoint
sets the `environment` attribute, and the environment picker in logX separates
them. One tenant cannot be split across environments, because a log stream
receives every event of its tenant.

### Which Auth0 events are sent to Scout?

Scout receives every event category unless you filter the stream in Auth0. To
send fewer events, set **Filter by Event Category** on the log stream in the
Auth0 Dashboard.

### How is log severity decided for Auth0 events?

Scout sets severity from the Auth0 event type code. Codes starting with `f`
(failures) are ERROR. Warnings, rate limits, and breached-password detections
are WARN. Everything else, such as successful logins, is INFO.

### What happens if the ingest token expires?

Auth0 deliveries start failing with 401 errors, which show only on the
stream's Health tab in Auth0. Ask base14 for a new token before the expiry
date and update the stream. Auth0 pauses a stream after 7 consecutive days of
failed deliveries, so resume it in Auth0 if it was paused.

## Related guides

- [logX](../../operate/logx/index.md) - search and filter the Auth0 logs in
  Scout.
- [Auth0 custom log streams][auth0-streams] - Auth0's reference for Custom
  Webhook streams.
- [Auth0 log event type codes][auth0-codes] - the full list of `type` codes.

[auth0-streams]: https://auth0.com/docs/customize/log-streams/custom-log-streams
[auth0-codes]: https://auth0.com/docs/deploy-monitor/logs/log-event-type-codes
