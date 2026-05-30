---
title: >
  IIS OpenTelemetry Monitoring - Request Rates, W3C Access Logs,
  and HTTP Semantic Conventions
sidebar_label: IIS (Windows)
id: collecting-iis-telemetry
sidebar_position: 45
description: >
  Collect IIS metrics, W3C access logs, and Windows Event Log entries
  with the OpenTelemetry Collector. Map W3C fields to OTel HTTP
  semantic conventions and export to base14 Scout.
keywords:
  - iis opentelemetry
  - iis otel collector
  - iis metrics monitoring
  - iis w3c access logs
  - iis http semantic conventions
  - opentelemetry iis receiver
  - iis observability
  - windows web server monitoring
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Why are IIS W3C log fields staged under a w3c_ prefix in the OpenTelemetry config?","acceptedAnswer":{"@type":"Answer","text":"Go regex, which the OpenTelemetry filelog regex_parser operator uses, disallows the . character in named capture groups, so capturing directly into keys like http.request.method is not possible. Capture into a w3c_ staging prefix first, then rename to OTel HTTP semantic conventions with a transform processor."}},{"@type":"Question","name":"Why is there an iis. namespace alongside the standard OTel HTTP attributes?","acceptedAnswer":{"@type":"Answer","text":"Three IIS fields - sub-status, win32-status, and time-taken - have no OTel semantic-convention equivalent. They go under an iis. vendor namespace so Scout queries can opt into them without polluting the standard HTTP attribute set."}},{"@type":"Question","name":"Does the OpenTelemetry iisreceiver work for IIS running in Windows Server Containers?","acceptedAnswer":{"@type":"Answer","text":"Yes. Run the OpenTelemetry Collector for Windows alongside IIS in the same container or as a sidecar; the log path and receiver config are unchanged. The collection_interval may need to drop to 10-20s for short-lived containers so the metrics pipeline emits at least one datapoint before the container exits."}},{"@type":"Question","name":"How do I monitor multiple IIS sites on one host with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"The filelog/iis include glob covers every site directory under the IIS log root by default. The log.file.path attribute carries the per-site log path, so site-level filtering in Scout is a query on log.file.path. The iisreceiver reports a single global metric set per IIS instance, not per-site."}},{"@type":"Question","name":"Does the OpenTelemetry iisreceiver work with IIS Express?","acceptedAnswer":{"@type":"Answer","text":"IIS Express does not surface the W3SVC performance counters that iisreceiver reads from, so metrics will be empty. W3C logging still works if IIS Express is configured to write logs; point the filelog/iis include glob at the IIS Express log directory under the user profile."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# IIS (Windows)

The OpenTelemetry Collector's `iisreceiver` collects 12 metrics from
IIS 10+ on Windows Server 2016+, including request counts, connection
state, queue depth, and uptime. Paired with the `filelog` receiver
this guide also parses IIS W3C access logs into OTel HTTP semantic
conventions (`http.request.method`, `http.response.status_code`,
`url.path`, etc.) so per-status and per-method queries work in Scout
without log-side regex.

## Prerequisites

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| Windows Server | 2016 (IIS 10.0) | 2022 (IIS 10.0) |
| OTel Collector Contrib | 0.90.0 | 0.152+ |
| base14 Scout | Any | - |

Before starting:

- IIS installed and a site bound (default `Default Web Site` is fine).
- Per-site W3C logging enabled (the default for fresh installs).
- OTel Collector Contrib for Windows installed as a service - see
  [Windows Setup](../collector-setup/windows-setup.md).

## What You'll Monitor

- **Requests**: per-method request counters, rejected requests at the
  W3SVC layer, request queue depth and oldest-request age.
- **Connections**: active TCP connections, attempts, anonymous
  connections.
- **Workers**: active worker threads.
- **Traffic**: bytes sent and received, file operations.
- **Uptime**: IIS service uptime.
- **W3C access logs**: every HTTP request line mapped to OTel HTTP
  semantic conventions (method, status, body sizes, URL, server,
  client, user-agent, referer, user).
- **Windows Event Log**: Application-channel events from
  `IIS-W3SVC`, `IIS-W3SVC-PerfCounters`, `IIS-W3SVC-WP`, `WAS`, and
  other IIS-related providers.

Full metric reference:
[OTel IIS Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/iisreceiver).

## Access Setup

### Enable W3C logging

W3C logging is the default for fresh installs but verify it explicitly
because some hardened images switch to IIS-format or disable logging.
Open an elevated PowerShell:

```powershell showLineNumbers
# Confirm logFormat is W3C for every site.
Get-WebConfigurationProperty `
  -PSPath 'IIS:\' -Filter 'system.applicationHost/sites/siteDefaults/logFile' `
  -Name logFormat
```

Expected output: `W3C`. If it shows `IIS` or `NCSA`, set it to W3C:

```powershell showLineNumbers
Set-WebConfigurationProperty `
  -PSPath 'IIS:\' -Filter 'system.applicationHost/sites/siteDefaults/logFile' `
  -Name logFormat -Value W3C
```

### Pin the W3C field set

The receiver and the in-collector regex below assume the IIS default
17-field W3C schema:

```text
date time s-ip cs-method cs-uri-stem cs-uri-query s-port
cs-username c-ip cs(User-Agent) cs(Referer) sc-status sc-substatus
sc-win32-status sc-bytes cs-bytes time-taken
```

Custom fields appended to the schema will not break the parser (the
regex anchors to the first 17 columns), but reordering the default
fields will. Leave the site-level `Selected W3C Fields` at defaults
unless you have a specific reason to change them.

The log files land at
`C:\inetpub\logs\LogFiles\W3SVC<site-id>\u_ex<date>.log` by default;
IIS rolls them daily, and the `filelog` receiver tails by inode so
the roll does not lose lines.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  iis:
    collection_interval: 60s

  # W3C access logs. Per-site files under
  # C:\inetpub\logs\LogFiles\W3SVC<id>\, rolled daily.
  filelog/iis:
    include:
      - 'C:\inetpub\logs\LogFiles\**\*.log'
    start_at: end
    include_file_name: true
    include_file_path: true
    operators:
      # Drop W3C header / comment lines.
      - type: filter
        expr: 'body matches "^#"'
      # Capture the 17 W3C fields into a w3c_ staging namespace; see FAQ.
      - type: regex_parser
        regex: '^(?P<w3c_timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (?P<w3c_s_ip>\S+) (?P<w3c_method>\S+) (?P<w3c_uri_stem>\S+) (?P<w3c_uri_query>\S+) (?P<w3c_s_port>\d+) (?P<w3c_username>\S+) (?P<w3c_c_ip>\S+) (?P<w3c_user_agent>\S+) (?P<w3c_referer>\S+) (?P<w3c_status>\d+) (?P<w3c_substatus>\d+) (?P<w3c_win32_status>\d+) (?P<w3c_sc_bytes>\d+) (?P<w3c_cs_bytes>\d+) (?P<w3c_time_taken>\d+)$'
        timestamp:
          parse_from: attributes.w3c_timestamp
          layout: '%Y-%m-%d %H:%M:%S'
          location: UTC
        on_error: send

  # Application-channel Windows events (app-pool start/stop, WP crashes, etc.).
  windowseventlog/iis:
    channel: Application
    start_at: end
    raw: true

processors:
  # Stamp service.name + environment on every record.
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  # Map staged W3C fields to OTel HTTP semconv; see FAQ for rationale.
  transform/iis_w3c:
    error_mode: ignore
    log_statements:
      - context: log
        conditions:
          - 'attributes["w3c_method"] != nil'
        statements:
          # HTTP request
          - 'set(attributes["http.request.method"], attributes["w3c_method"])'
          - 'set(attributes["http.request.body.size"], Int(attributes["w3c_cs_bytes"]))'
          # HTTP response
          - 'set(attributes["http.response.status_code"], Int(attributes["w3c_status"]))'
          - 'set(attributes["http.response.body.size"], Int(attributes["w3c_sc_bytes"]))'
          # URL
          - 'set(attributes["url.path"], attributes["w3c_uri_stem"])'
          - 'set(attributes["url.query"], attributes["w3c_uri_query"]) where attributes["w3c_uri_query"] != "-"'
          - 'set(attributes["url.scheme"], "https") where attributes["w3c_s_port"] == "443"'
          - 'set(attributes["url.scheme"], "http") where attributes["w3c_s_port"] != "443"'
          # Server / client
          - 'set(attributes["server.address"], attributes["w3c_s_ip"])'
          - 'set(attributes["server.port"], Int(attributes["w3c_s_port"]))'
          - 'set(attributes["client.address"], attributes["w3c_c_ip"])'
          # User agent (W3C encodes whitespace as `+`).
          - 'set(attributes["user_agent.original"], attributes["w3c_user_agent"]) where attributes["w3c_user_agent"] != "-"'
          - 'replace_pattern(attributes["user_agent.original"], "\\+", " ") where attributes["user_agent.original"] != nil'
          # Referer header.
          - 'set(attributes["http.request.header.referer"], attributes["w3c_referer"]) where attributes["w3c_referer"] != "-"'
          # Authenticated user.
          - 'set(attributes["user.name"], attributes["w3c_username"]) where attributes["w3c_username"] != "-"'
          # IIS-specific (no OTel semconv equivalent).
          - 'set(attributes["iis.sc_substatus"], Int(attributes["w3c_substatus"]))'
          - 'set(attributes["iis.sc_win32_status"], Int(attributes["w3c_win32_status"]))'
          - 'set(attributes["iis.time_taken_ms"], Int(attributes["w3c_time_taken"]))'
          # Drop the staging keys.
          - 'delete_key(attributes, "w3c_timestamp")'
          - 'delete_key(attributes, "w3c_s_ip")'
          - 'delete_key(attributes, "w3c_method")'
          - 'delete_key(attributes, "w3c_uri_stem")'
          - 'delete_key(attributes, "w3c_uri_query")'
          - 'delete_key(attributes, "w3c_s_port")'
          - 'delete_key(attributes, "w3c_username")'
          - 'delete_key(attributes, "w3c_c_ip")'
          - 'delete_key(attributes, "w3c_user_agent")'
          - 'delete_key(attributes, "w3c_referer")'
          - 'delete_key(attributes, "w3c_status")'
          - 'delete_key(attributes, "w3c_substatus")'
          - 'delete_key(attributes, "w3c_win32_status")'
          - 'delete_key(attributes, "w3c_sc_bytes")'
          - 'delete_key(attributes, "w3c_cs_bytes")'
          - 'delete_key(attributes, "w3c_time_taken")'

  batch:
    timeout: 10s
    send_batch_size: 200

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [iis]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
    logs:
      receivers: [filelog/iis, windowseventlog/iis]
      processors: [resource, transform/iis_w3c, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Restart the Collector service after writing the config:

```powershell showLineNumbers
Restart-Service OtelCollector
```

Generate at least one request so IIS writes a log line, then check
the local self-telemetry endpoint for non-zero export counters:

```powershell showLineNumbers
# Drive a request through IIS.
Invoke-WebRequest -UseBasicParsing http://localhost/ | Out-Null

# Self-telemetry endpoint; default port 8888.
(Invoke-WebRequest -UseBasicParsing http://localhost:8888/metrics).Content |
  Select-String 'otelcol_exporter_sent_(metric_points|log_records)'
```

Both `otelcol_exporter_sent_metric_points` and
`otelcol_exporter_sent_log_records` should report non-zero and
increasing values across two consecutive scrapes.

In Scout, scope to the value you set as `SERVICE_NAME` and verify:

- `iis.request.count` reports with the `request` dimension set
  (`GET`, `POST`, etc.) and is non-zero.
- Log records show `http.request.method`, `http.response.status_code`,
  and `url.path` as first-class attributes (not embedded in Body).
- The record timestamp matches the W3C `date time` columns, not the
  collector read time.

## Troubleshooting

### No log records appearing

**Cause**: IIS buffers W3C writes (default 60s flush, or buffer-full).
Under low traffic the first records may not surface until the next
flush boundary.

**Fix**:

1. Drive enough traffic to fill the buffer
   (`Invoke-WebRequest http://localhost/` in a loop), or
2. Force a flush in tests via
   `appcmd stop site 'Default Web Site' && appcmd start site 'Default Web Site'`,
   or
3. Wait at least 60s after the first request before reading from
   Scout.

### `http.response.status_code` arrives as a string

**Cause**: The OTel HTTP semantic conventions require `int` for
`http.response.status_code`, `http.request.body.size`,
`http.response.body.size`, and `server.port`. Direct
`set(attributes["http.response.status_code"], attributes["w3c_status"])`
without an `Int(...)` cast forwards the regex capture as a string.

**Fix**:

1. Wrap each numeric `set(...)` with `Int(...)` as the configuration
   above does.
2. Use Scout-side type assertions to spot any missed cast - a query
   like `http.response.status_code >= 500` returns zero results when
   the attribute is a string.

### User-agent shows literal `+` characters

**Cause**: IIS encodes whitespace in W3C user-agent and referer
fields as `+` (and other non-printable bytes as `%xx`). Without
decoding, downstream parsers see
`Mozilla/5.0+(Windows+NT;...)` instead of the human-readable form.

**Fix**:

1. Keep the `replace_pattern(attributes["user_agent.original"],
   "\\+", " ")` statement in the `transform/iis_w3c` block.
2. If you also want `%xx` decoding, add a Lua extension; OTTL does
   not have a built-in URL-decode function as of `0.152.0`.

### Windows Event Log filter rejected at service start

**Cause**: The `windowseventlog` receiver validates the XPath
predicate during service start. Multi-clause provider predicates
(e.g. `*[System/Provider[@Name='IIS-W3SVC' or
@Name='IIS-W3SVC-WP']]`) are rejected with an SCM error
("An exception occurred in the service when handling the control
request") and no actionable diagnostic in the Application channel.

**Fix**:

1. Start without an XPath filter, as the configuration above does,
   and rely on Scout-side filtering by provider name; or
2. Use a single-clause predicate (one provider at a time) and add
   one receiver block per provider; or
3. Pin a working multi-clause dialect against your specific
   `otelcol-contrib` version - the surface changes between minor
   releases.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check the Collector log for export errors -
   `Get-WinEvent -ProviderName OtelCollector -MaxEvents 20`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly and the
   Collector service has the env var
   (`Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\OtelCollector'`).
3. Confirm both `metrics` and `logs` pipelines list `otlphttp/b14`
   in `exporters:`.

## FAQ

**Why are W3C fields staged under a `w3c_` prefix instead of mapped
directly?**

Go regex (the engine the OTel `regex_parser` operator uses)
disallows `.` in named capture groups, so capturing directly into
e.g. `http.request.method` is not possible. The two-stage shape
(regex into `w3c_*`, transform processor into OTel semconv) is the
canonical workaround.

**Why is there an `iis.` namespace alongside the OTel attributes?**

`sc-substatus`, `sc-win32-status`, and `time-taken` are IIS-specific
and have no OTel semantic-convention equivalent. They go under an
`iis.` vendor namespace so Scout queries can opt into them without
polluting the standard HTTP attribute set.

**Does this work for IIS in Windows Server Containers?**

Yes. Run the OTel Collector for Windows alongside IIS in the same
container or as a sidecar; the log path and receiver config above
are unchanged. The collection_interval may need to drop to 10-20s
for short-lived containers so the metrics pipeline emits at least
one datapoint before the container exits.

**How do I monitor multiple IIS sites on one host?**

The `filelog/iis` glob (`C:\inetpub\logs\LogFiles\**\*.log`)
already covers every site (`W3SVC1`, `W3SVC2`, etc.). The
`log.file.path` attribute carries the per-site log path, so
site-level filtering in Scout is a query on
`log.file.path contains 'W3SVC2'`. The `iisreceiver` reports a
single global metric set per IIS instance, not per-site.

**What about IIS Express?**

IIS Express does not surface the W3SVC performance counters that
`iisreceiver` reads from, so metrics will be empty. W3C logging
still works if IIS Express is configured to write logs; point the
`filelog/iis` glob at its log directory
(typically `%USERPROFILE%\Documents\IISExpress\Logs\`).

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your
  own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [SQL Server](./sqlserver.md), [Apache HTTP Server](./apache-httpd.md),
  and other components.
- **Fine-tune Collection**: Drop `collection_interval` below 60s if
  you need faster metric resolution, at the cost of higher
  collector CPU on the host.

## Related Guides

- [Windows Setup](../collector-setup/windows-setup.md) -
  Install OTel Collector Contrib as a Windows service.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Apache HTTP Server Monitoring](./apache-httpd.md) - Alternative
  web server monitoring.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on IIS request and status metrics.
