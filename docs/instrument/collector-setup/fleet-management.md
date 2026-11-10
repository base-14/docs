---
title: Enable fleet management for your collectors
sidebar_label: Fleet Management
description:
  Connect OpenTelemetry Collectors on Linux hosts, Docker, or Kubernetes to
  Scout fleet management over OpAMP, so they appear in Scout and can be
  configured from it, without Scout Operator.
keywords:
  [
    fleet management,
    opamp,
    opamp supervisor,
    remote collector configuration,
    collector management,
    opentelemetry collector,
    scout capo,
  ]
tags: [opentelemetry, opamp, base14 scout]
sidebar_position: 5.5
---

# Fleet management

Scout fleet management keeps a list of your OpenTelemetry Collectors and what
each one is running, and can send them a new configuration without a redeploy.
Collectors connect to it over OpAMP, the OpenTelemetry protocol for managing
agents.

There are two levels:

| Level | What you get | What you change |
| --- | --- | --- |
| Reporting | Collectors appear in Scout with their health and running configuration | Add the `opamp` extension to your Collector configuration |
| Remote configuration | Everything above, plus changing a collector's configuration from Scout | Run the Collector under the OpAMP Supervisor |

On Kubernetes, [Scout Operator](./scout-operator/index.md) sets all of this
up for you. This page is for collectors you run yourself.

## Before you start

- **Fleet management enabled for your organization.** Ask base14 support to
  turn it on. Until then, collectors are refused when they connect. They keep
  retrying and send telemetry normally, but nothing appears in Scout.
- **Your Scout client ID and secret**: the ones your collector already uses
  with the [Scout exporter](./scout-exporter.md).
- **otelcol-contrib 0.161.0 or later.**

The examples use these values. Replace the placeholders with your own:

| Setting | Value |
| --- | --- |
| Fleet management endpoint | `wss://capo.base14.io/v1/connect` |
| Token URL | `https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token` |
| Token audience | `b14collector` |

## Reporting only

Add the `opamp` extension next to your existing `oauth2client`, and list it
under `service.extensions`. Nothing else in your configuration changes:

```yaml showLineNumbers title="config.yaml"
extensions:
  oauth2client:
    client_id: __YOUR_CLIENT_ID__
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
    endpoint_params:
      audience: b14collector
  opamp:
    server:
      ws:
        endpoint: wss://capo.base14.io/v1/connect
        auth: oauth2client
    instance_uid: __A_UUIDV7__
    capabilities:
      reports_effective_config: true
      reports_health: true
    reports_raw_config: true
    agent_description:
      non_identifying_attributes:
        host.name: web-01
        environment: production
        collector.role: gateway

service:
  extensions: [oauth2client, opamp]
```

- `instance_uid` keeps the collector's identity across restarts. Generate a
  UUIDv7 per collector, for example with
  `python3 -c 'import uuid; print(uuid.uuid7())'` on Python 3.14 or later.
  Without it, each restart appears in Scout as a new collector.
  Leave it out for collectors that run as several copies of one
  configuration, such as replicas behind a load balancer.
- `non_identifying_attributes` are how you find and select collectors in
  Scout. Use attributes that describe where the collector runs. You choose
  the names and values.
- `reports_raw_config` sends your configuration as written, with references
  such as `${env:SCOUT_CLIENT_SECRET}` left as they are, so secrets are not
  sent and Scout can show the configuration you wrote.

Restart the collector, then [check it appears](#check-that-it-works).

## Remote configuration

The OpAMP Supervisor is a small program from the OpenTelemetry project. It
starts your Collector, connects to Scout, and restarts the Collector on the
new configuration when Scout sends one.

Your configuration file stays as it is, without the `opamp` extension: the
Supervisor adds its own. The Collector starts on that file, and any
configuration sent from Scout is merged over it.

Both setups below use two files.

`supervisor.yaml` configures the Supervisor:

```yaml showLineNumbers title="supervisor.yaml"
server:
  endpoint: wss://capo.base14.io/v1/connect
  auth: oauth2client

extensions:
  oauth2client:
    client_id: __YOUR_CLIENT_ID__
    client_secret_file: /etc/opampsupervisor/client-secret
    token_url: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
    endpoint_params:
      audience: b14collector

capabilities:
  accepts_remote_config: true
  reports_effective_config: true
  reports_health: true

agent:
  executable: /usr/local/bin/otelcol-contrib
  config_files:
    - /etc/opampsupervisor/collector.yaml
  description:
    non_identifying_attributes:
      host.name: web-01
      environment: production
      collector.role: gateway

storage:
  directory: /home/opampsupervisor/storage
```

`collector.yaml` is your Collector configuration. Add these lines to its
`extensions` so Scout receives it as written, without listing `opamp` under
`service.extensions`:

```yaml title="collector.yaml"
extensions:
  opamp:
    reports_raw_config: true
```

The Supervisor keeps the collector's identity and last configuration in its
storage directory, so keep that directory across restarts.

### Docker

The Supervisor image does not include a Collector, so build one that has both:

```dockerfile title="Dockerfile"
FROM otel/opentelemetry-collector-contrib:0.161.0 AS collector

FROM ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-opampsupervisor:0.161.0
COPY --from=collector /otelcol-contrib /usr/local/bin/otelcol-contrib
ENTRYPOINT ["opampsupervisor", "--config=/etc/opampsupervisor/supervisor.yaml", "--feature-gates=+opampsupervisor.Extensions"]
```

The `opampsupervisor.Extensions` feature gate lets the Supervisor use the
`oauth2client` extension to authenticate.

Put `supervisor.yaml`, `collector.yaml`, and a file named `client-secret`
holding only your client secret in a `conf` directory, then run:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  otel-collector:
    build: .
    volumes:
      - ./conf:/etc/opampsupervisor:ro
      - supervisor-home:/home/opampsupervisor
    ports:
      - "4317:4317"
      - "4318:4318"
    restart: unless-stopped

volumes:
  supervisor-home: {}
```

The `supervisor-home` volume holds the storage directory.

### Linux host

Install the Collector and the Supervisor from the OpenTelemetry release
packages. For amd64 hosts:

```bash
VERSION=0.161.0
BASE=https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download
curl -LO "$BASE/v$VERSION/otelcol-contrib_${VERSION}_linux_amd64.deb"
curl -LO "$BASE/cmd%2Fopampsupervisor%2Fv$VERSION/opampsupervisor_${VERSION}_linux_amd64.deb"
sudo dpkg -i otelcol-contrib_${VERSION}_linux_amd64.deb opampsupervisor_${VERSION}_linux_amd64.deb
```

The Supervisor runs the Collector from now on, so stop the Collector's own
service:

```bash
sudo systemctl disable --now otelcol-contrib
```

Use the `supervisor.yaml` above with two paths changed for the packages:

```yaml
agent:
  executable: /usr/bin/otelcol-contrib
storage:
  directory: /var/lib/opampsupervisor
```

Then put the files in place and start the Supervisor:

```bash
sudo install -m 0640 -g opampsupervisor supervisor.yaml /etc/opampsupervisor/config.yaml
sudo install -m 0640 -g opampsupervisor collector.yaml /etc/opampsupervisor/collector.yaml
printf '%s' '__YOUR_CLIENT_SECRET__' | sudo tee /etc/opampsupervisor/client-secret >/dev/null
sudo chown root:opampsupervisor /etc/opampsupervisor/client-secret
sudo chmod 0640 /etc/opampsupervisor/client-secret

sudo sed -i 's|^OPAMP_OPTIONS=.*|OPAMP_OPTIONS="--config=/etc/opampsupervisor/config.yaml --feature-gates=+opampsupervisor.Extensions"|' \
  /etc/opampsupervisor/opampsupervisor.conf
sudo systemctl restart opampsupervisor
```

The Collector now runs as the `opampsupervisor` user. If your configuration
reads files that user cannot, such as system logs, add it to the group that
owns them. The Collector's own log is in `/var/lib/opampsupervisor/agent.log`.

## Kubernetes without Scout Operator

The [scout-collector Helm chart](./kubernetes-helm-setup.md) uses the
credentials it already has for the exporter. For reporting only, add to your
values:

```yaml title="values.yaml"
scout:
  opamp:
    enabled: true
    # A UUIDv7 for the single-replica agent, so restarts keep its identity.
    agentInstanceUid: __A_UUIDV7__
```

For remote configuration, the chart can run its collectors under the
Supervisor:

```yaml title="values.yaml"
scout:
  agent:
    enabled: false
  supervisor:
    agent:
      enabled: true
      instanceId: __A_UUIDV7__
```

For full Kubernetes coverage managed from Scout, use
[ScoutInstallation](./scout-operator/scoutinstallation.md) instead.

## Check that it works

Within a minute of starting, the collector appears on the **Collectors** page
in Scout with the attributes you set. With the
[Scout CLI](../../scout-cli/scout-access/capo.md):

```bash
scout capo agents list --environment production
```

To send a configuration to every supervised collector matching an attribute:

```bash
scout capo agents apply \
  --match host.name=web-01 \
  --file collector.yaml
```

To keep configurations in Git and apply them from a pipeline, see
[Collector Configuration as Code](../../operate/collector-config-as-code.md).

## Troubleshooting

### The collector does not appear in Scout

Check the Collector or Supervisor log for the connection result:

| Log message | Cause |
| --- | --- |
| `Server responded with status=401 Unauthorized` | Fleet management is not yet enabled for your organization, or the client ID or secret is wrong |
| `failed to get security token` | Wrong token URL, client ID, or client secret |
| `connection refused` or a DNS error | The host cannot reach `capo.base14.io` on port 443 |

Telemetry keeps flowing while the collector cannot connect.

### Each restart shows up as a new collector

Set `instance_uid` for a collector using the `opamp` extension. Under the
Supervisor, keep its storage directory across restarts.

### A configuration sent from Scout is not applied

Collectors using only the `opamp` extension report but cannot be configured.
Run them under the Supervisor, and check `accepts_remote_config: true` in
`supervisor.yaml`.

## FAQ

### Does fleet management send my telemetry anywhere new?

No, fleet management only receives each collector's identity, health, and
configuration. Telemetry still goes to the exporters in your configuration.

### What happens to my collectors if Scout fleet management is unreachable?

Your collectors keep running on the configuration they have. A supervised
collector restarts on the last configuration it received, and both kinds
reconnect on their own once fleet management is reachable.

### Do I need Scout Operator for fleet management?

No, any OpenTelemetry Collector can connect as shown on this page. Scout
Operator sets the same thing up automatically on Kubernetes.

## Related guides

- [Scout exporter](./scout-exporter.md): the credentials collectors use
- [scout capo](../../scout-cli/scout-access/capo.md): list and configure
  collectors from the command line
- [Collector Configuration as Code](../../operate/collector-config-as-code.md):
  manage configurations from Git
- [Scout Operator](./scout-operator/index.md): fleet management on Kubernetes
