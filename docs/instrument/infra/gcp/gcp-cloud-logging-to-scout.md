---
date: 2026-05-27
id: gcp-cloud-logging-to-scout
title: Sending Google Cloud Logging Logs to Scout via Pub/Sub and OpenTelemetry
sidebar_label: GCP Cloud Logging
description: >
  Stream Google Cloud Logging logs to base14 Scout using Pub/Sub and
  the OpenTelemetry googlecloudpubsub receiver. Covers Log Router
  sinks, service account authentication, and collector configuration.
keywords:
  - gcp cloud logging
  - google cloud logging
  - pubsub opentelemetry
  - cloud logging to scout
  - gcp log router sink
  - gcp observability
  - google cloud pubsub receiver
  - opentelemetry gcp logs
  - cloud logging opentelemetry
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I send Google Cloud Logging logs to OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Route logs from Cloud Logging into a Pub/Sub topic using a Log Router sink, then consume the topic with the OpenTelemetry googlecloudpubsub receiver in your Scout collector."}},{"@type":"Question","name":"How does the collector authenticate to Pub/Sub?","acceptedAnswer":{"@type":"Answer","text":"The collector uses Google Application Default Credentials. Set the GOOGLE_APPLICATION_CREDENTIALS environment variable to the path of a service account key file, or use GKE Workload Identity to avoid managing key files."}},{"@type":"Question","name":"Can I stream logs from multiple GCP projects into one Scout collector?","acceptedAnswer":{"@type":"Answer","text":"Yes. Create the service account in the collector's project, grant it Pub/Sub Subscriber on the subscription in the logs project, and point the receiver at the cross-project subscription."}},{"@type":"Question","name":"What encoding should I use for the googlecloudpubsub receiver?","acceptedAnswer":{"@type":"Answer","text":"For collector versions below 0.132, use the built-in cloud_logging encoding. For 0.132 and above, use the googlecloudlogentry_encoding extension, which also parses structured attributes on 0.142+."}},{"@type":"Question","name":"Why are my Cloud Logging logs not appearing in Scout?","acceptedAnswer":{"@type":"Answer","text":"Check in order: messages exist in the Pub/Sub subscription, the collector has valid GCP credentials, collector logs show no permission errors, and the receiver is referenced in a logs pipeline."}}]}
---

This guide shows you how to stream logs from
**Google Cloud Logging** into your Scout collector using a
Pub/Sub subscription and the OpenTelemetry
`googlecloudpubsub` receiver.

The same pattern works for **any** Cloud Logging log
source — you just change one filter. Throughout this guide
we use **Load Balancer access logs** as the worked example.

## How it works

Cloud Logging doesn't push to OpenTelemetry directly.
Instead you route the logs you care about into a Pub/Sub
topic with a **Log Router sink**, and your Scout collector
consumes that topic:

```text
Log source (e.g. Load Balancer)
        │
        ▼
  Cloud Logging ──▶ Log Router sink ──▶ Pub/Sub topic
                                            │
                                            ▼
                                      subscription
                                            │
                                            ▼
                          Scout collector (pubsub receiver)
                                            │
                                            ▼
                                          Scout
```

Pub/Sub retains undelivered messages (7 days by default),
so the collector picks up a backlog on startup as well as
new logs.

## Prerequisites

- A Scout collector deployed and exporting to Scout
  (the `otlphttp/base14` exporter). See the
  [collector setup guides](../../collector-setup/otel-collector-config.md)
  for deployment options.
- Permission to manage Cloud Logging, Pub/Sub, and IAM
  in your GCP project.
- `gcloud` and/or Google Cloud console access.

Replace these placeholders as you go:

| Placeholder | Meaning |
|---|---|
| `PROJECT_ID` | Your GCP project **ID** (not the display name or number) |

:::note
This guide assumes the logs and the collector are in the
**same** GCP project. If they're in different projects,
see [Variant: cross-project](#variant-cross-project)
at the end.
:::

---

## Step 1 — Decide what to export, and make sure it's being logged

A Log Router sink selects logs with an **inclusion filter**
based on `resource.type`. For the Load Balancer example,
the resource type depends on the LB type:

| Load balancer type | `resource.type` |
|---|---|
| Global external / classic Application LB (HTTP/S) | `http_load_balancer` |
| Regional external Application LB | `http_external_regional_lb_rule` |
| Internal Application LB | `internal_http_lb_rule` |
| Regional/internal proxy Network LB | `l4_proxy_rule` |
| Global external / classic proxy Network LB | `tcp_ssl_proxy_rule` |

**Load balancer logs must be enabled first**, and logging
is **per backend service**. Enable it on every backend
service behind the LB (logging is not retroactive — only
requests served *after* you enable it are logged):

```bash showLineNumbers
gcloud compute backend-services update BACKEND_SERVICE \
  --global \
  --enable-logging \
  --logging-sample-rate=1.0
```

Use `--region=REGION` instead of `--global` for a
regional LB.

:::tip
**Not sure which resource type your source uses?** In
**Logs Explorer**, set a wide time range, generate some
activity, and expand **Resource type** in the
**Log fields** panel — it lists every resource type that
has actually produced logs. Use that value as your filter.
(For other log sources, just pick the appropriate
`resource.type` the same way.)
:::

---

## Step 2 — Create the Pub/Sub topic and subscription

### CLI

```bash showLineNumbers
gcloud pubsub topics create scout-logs

gcloud pubsub subscriptions create scout-logs-sub \
  --topic=scout-logs \
  --ack-deadline=30
```

### Console

1. **Pub/Sub → Topics → Create topic**, ID `scout-logs`.
2. Leave **Add a default subscription** checked — this
   creates a Pull subscription named `scout-logs-sub`
   automatically.
3. **Create**.

The subscription **must be Pull** (the default) — the
receiver does not create it.

---

## Step 3 — Create the Log Router sink

### CLI

```bash showLineNumbers
gcloud logging sinks create scout-logs-sink \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='resource.type="http_load_balancer"'
```

### Console

1. **Logging → Log Router → Create sink**. Name
   `scout-logs-sink`. **Next**.
2. **Sink service = Cloud Pub/Sub topic**, select
   `scout-logs`. **Next**.
3. Inclusion filter:
   `resource.type="http_load_balancer"`.
   **Next** → **Create sink**.

Then grant the sink's **writer identity** permission to
publish to the topic:

### CLI — grant publish permission

```bash showLineNumbers
WRITER=$(gcloud logging sinks describe scout-logs-sink \
  --format='value(writerIdentity)')

gcloud pubsub topics add-iam-policy-binding scout-logs \
  --member="$WRITER" \
  --role="roles/pubsub.publisher"
```

### Console — grant publish permission

Log Router → sink's 3-dot menu → **View sink details** →
copy the writer identity → Pub/Sub → Topics →
`scout-logs` → permissions panel → **Add principal** →
paste it (drop the `serviceAccount:` prefix) → role
**Pub/Sub Publisher**.

---

## Step 4 — Authenticate the collector to Pub/Sub

The collector needs a Google service account (GSA) with
**Pub/Sub Subscriber** on the subscription. It discovers
credentials via
[Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials),
so how you provide them depends on your deployment.

### a. Create the GSA

```bash showLineNumbers
gcloud iam service-accounts create scout-logs-reader \
  --display-name="Scout collector - Cloud Logging reader"
```

### b. Grant Subscriber on the subscription

```bash showLineNumbers
gcloud pubsub subscriptions add-iam-policy-binding scout-logs-sub \
  --member="serviceAccount:scout-logs-reader@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber"
```

### c. Provide credentials to the collector

#### Service account key file (any environment)

Create a key, place it on the host running the collector,
and set the `GOOGLE_APPLICATION_CREDENTIALS` environment
variable to its path:

```bash showLineNumbers
gcloud iam service-accounts keys create \
  scout-logs-reader-key.json \
  --iam-account=scout-logs-reader@PROJECT_ID.iam.gserviceaccount.com
```

```bash showLineNumbers title=".env"
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-logs-reader-key.json
```

The receiver picks this up automatically via Application
Default Credentials.

:::tip GKE Workload Identity
On GKE with Workload Identity enabled, you can skip the
key file entirely. Instead, bind the collector's
Kubernetes ServiceAccount (KSA) to the GSA:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  scout-logs-reader@PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:PROJECT_ID.svc.id.goog[NAMESPACE/COLLECTOR_SERVICE_ACCOUNT]"
```

Then annotate the KSA:

```yaml
serviceAccount:
  annotations:
    iam.gke.io/gcp-service-account: "scout-logs-reader@PROJECT_ID.iam.gserviceaccount.com"
```

No key file needed — the collector authenticates
automatically.
:::

---

## Step 5 — Configure the collector

Add the `googlecloudpubsub` receiver and a logs pipeline
to your collector config:

```yaml showLineNumbers title="cloud-logging-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudpubsub/cloud_logging:
    project: ${env:GCP_PROJECT_ID}
    subscription: projects/${env:GCP_PROJECT_ID}/subscriptions/scout-logs-sub
    encoding: cloud_logging        # see "Choosing the encoding" below

processors:
  memory_limiter:
    limit_mib: 512
    spike_limit_mib: 128
    check_interval: 5s

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    # ...your existing pipelines...
    logs/cloud_logging:
      receivers: [googlecloudpubsub/cloud_logging]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/base14]
```

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity (see Step 4c)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-logs-reader-key.json
```

### Choosing the encoding

Depending on your collector version, you may need to add
an extension explicitly for the receiver to decode Cloud
Logging entries:

| Collector version | Encoding | Notes |
|---|---|---|
| **below 0.132** | `encoding: cloud_logging` | Built-in. No extension needed. |
| **0.132 and above** | `googlecloudlogentry_encoding` extension | The built-in `cloud_logging` was removed at 0.132. |
| **0.142 and above** | `googlecloudlogentry_encoding` extension | Also parses Application LB logs into structured `gcp.load_balancing.*` attributes. |

If your collector version is above 0.132, here is how you
add the extension:

```yaml showLineNumbers title="cloud-logging-config.yaml"
extensions:
  # ...existing extensions...
  googlecloudlogentry_encoding:
    handle_json_payload_as: "json"
    handle_proto_payload_as: "json"

receivers:
  googlecloudpubsub/cloud_logging:
    project: ${env:GCP_PROJECT_ID}
    subscription: projects/${env:GCP_PROJECT_ID}/subscriptions/scout-logs-sub
    encoding: googlecloudlogentry_encoding

service:
  extensions: [googlecloudlogentry_encoding]
  pipelines:
    logs/cloud_logging:
      receivers: [googlecloudpubsub/cloud_logging]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/base14]
```

On versions below 0.142 (with either encoding), the log
record arrives as **JSON in the log body** rather than
structured attributes. That's fine to ingest — see
[Promoting JSON fields to attributes](#optional-promoting-json-fields-to-attributes)
to break it out without upgrading.

---

## Step 6 — Verify

1. **Messages are in the subscription** (peek without
   consuming):

   ```bash showLineNumbers
   gcloud pubsub subscriptions pull scout-logs-sub --limit=5
   ```

   Empty? The problem is upstream (logging not enabled /
   sink filter / publisher grant).

2. **The collector has valid credentials.** Check the
   collector logs for authentication errors:

   ```bash showLineNumbers
   # Look for permission or credential errors
   # The exact command depends on your deployment:
   #   Docker:     docker logs <container>
   #   systemd:    journalctl -u otelcol
   #   Kubernetes: kubectl logs deploy/<name> -n <ns>
   ```

   Look for `PermissionDenied` or
   `could not find default credentials` messages.

3. **The collector is consuming.** Once running, the
   subscription's **unacked message count drops** (the
   collector acks messages as it exports them). In the
   GCP console, check
   **Pub/Sub → Subscriptions → scout-logs-sub →
   Monitoring** for the unacked message graph.

4. **Logs appear in Scout.** Allow a short lag (seconds
   to a minute) end to end.

---

## Optional: Promoting JSON fields to attributes

To turn the JSON body into queryable log attributes —
without changing the collector image — add a `transform`
processor to the logs pipeline. Inspect a sample message
first (Step 6.1) to confirm the field paths, then:

```yaml showLineNumbers title="cloud-logging-config.yaml"
processors:
  transform/cloud_logging:
    log_statements:
      - context: log
        statements:
          - set(attributes["http.status_code"], body["httpRequest"]["status"])
          - set(attributes["http.request.method"], body["httpRequest"]["requestMethod"])
          - set(attributes["url.full"], body["httpRequest"]["requestUrl"])
          # ...add the fields you need...
```

Add `transform/cloud_logging` to the pipeline's
`processors` list (after `memory_limiter`, before `batch`).

---

## Variant: cross-project

If the logs/Pub/Sub live in one project (`LOGS_PROJECT`)
and the collector in another (`COLLECTOR_PROJECT`):

- **Create the GSA in `COLLECTOR_PROJECT`** (Step 4a,
  add `--project=COLLECTOR_PROJECT`).
- **Grant Subscriber across projects** (Step 4b): member
  is the `COLLECTOR_PROJECT` GSA, but the subscription
  resource is in `LOGS_PROJECT`
  (`--project=LOGS_PROJECT`).
- **The receiver points at `LOGS_PROJECT`** — `project:`
  and `subscription:` both reference `LOGS_PROJECT`,
  even though the GSA lives in the collector project.

If using GKE Workload Identity, the WI binding uses the
collector project's pool:
`COLLECTOR_PROJECT.svc.id.goog[NAMESPACE/COLLECTOR_SERVICE_ACCOUNT]`.

---

## Troubleshooting

**`http_load_balancer` (or your resource type) doesn't
appear in Logs Explorer.**
The resource-type picker only lists types that have logged
something in the time window. Either no logs have been
produced yet (logging not enabled, no traffic since
enabling, or sampling at 0), or your source uses a
different `resource.type` (see the table in Step 1).

**Logs in the subscription but not in Scout.**
Check, in order: the collector has valid credentials,
collector logs show no auth errors, and that you added
the **pipeline** — a receiver not referenced by any
pipeline is loaded but never consumes. Also confirm the
receiver's `subscription:` path is correct.

**`PermissionDenied` on the subscription.** The Subscriber
grant (Step 4b) hasn't propagated yet (allow a few
minutes), or was granted in the wrong project for
cross-project setups.

**"could not find default credentials".**
`GOOGLE_APPLICATION_CREDENTIALS` is not set or points to
a missing file. On GKE, this means the Workload Identity
binding or ServiceAccount annotation is missing.

**Backlog never drains.** The collector isn't consuming —
almost always auth (above) or a missing pipeline. A
draining backlog is the success signal: acking is how
Pub/Sub confirms delivery; the data has gone to Scout,
not been lost.
