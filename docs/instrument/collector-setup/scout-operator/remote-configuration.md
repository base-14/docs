---
title: Remote configuration with Supervised mode
sidebar_label: Remote configuration
description:
  Run ScoutCollector in Supervised mode so Scout fleet management configures collectors over
  OpAMP at runtime, with a recovery cache that lets pods restart during a
  Scout fleet management outage.
keywords:
  [
    scout operator supervised mode,
    opamp supervisor,
    remote collector configuration,
    collector fleet management,
    scoutcollector,
  ]
tags: [kubernetes, opentelemetry, opamp, base14 scout]
sidebar_position: 3
---

# Remote configuration

In Supervised mode, each collector pod runs the upstream OpAMP Supervisor,
which starts the Collector and connects to Scout fleet management. You can then change a
running collector's configuration with
[`scout capo`](../../../scout-cli/scout-access/capo.md), with no redeploy and
no change to the `ScoutCollector`.

Direct mode, used in the [ScoutCollector](./scoutcollector.md) examples, has
none of this. Its configuration changes only when you edit the ConfigMap and
restart the pods.

## How a supervised pod starts

Each pod runs two init containers before the Supervisor:

1. `install-otelcol` downloads the pinned `otelcol-contrib` release and checks
   its SHA-256 checksum. The pod stops here if the checksum does not match.
2. `config-bootstrap` chooses the configuration the Collector starts with, and
   writes it to a volume shared with the Supervisor.
3. `supervisor` runs `opampsupervisor`, which starts the Collector from that
   file, connects to Scout, and applies any configuration it sends.

`config-bootstrap` picks the startup configuration in this order:

| Situation | Starts with |
| --- | --- |
| Scout returns a configuration newer than the cache | That configuration, which also refreshes the cache |
| Scout is unreachable and the cache holds a configuration | The cached configuration |
| Scout confirms the collector has never been configured | The fallback configuration |
| Scout is unreachable on a first boot, or the cache was lost | Nothing. The init container fails and Kubernetes retries it |

The fallback configuration is only for a collector's very first start. Once a
configuration has been applied, the pod never silently falls back to it, even
during an outage.

## The recovery cache

The operator creates a ConfigMap named `<name>-config-cache` for each
supervised collector. It holds the last configuration reported as applied, so
pods can restart and scale while fleet management is unavailable. All replicas
of a collector share it.

The operator refreshes the cache every 30 seconds by default. A pod restarted
between a change and the next refresh may start on the previous
configuration, then picks up the new one once it reconnects.

Leave the cache to the operator:

- Do not create, edit, or delete it, and keep it out of Helm charts and
  Argo CD applications.
- If it is deleted after Scout fleet management has configured the collector, the operator
  recreates it marked as requiring recovery. Pods then start only once Scout fleet management
  is reachable again.

If configurations sent from Scout fleet management can contain literal credentials, store the
cache in a Secret instead:

```yaml
spec:
  supervisor:
    cache:
      kind: Secret
```

A ConfigMap cache is for configurations that reference secrets, for example
`${env:SCOUT_CLIENT_SECRET}`, rather than containing them.

## Credentials

A supervised collector uses two OAuth2 clients, each in its own Secret:

- the **bootstrap** client, used only by `config-bootstrap` to read the
  collector's last applied configuration when the pod starts.
- the **OpAMP** client, used by the Supervisor for its own connection.

Create both on the **API Keys** page in the Scout console, then store each
one in its own Secret.

Each container mounts only its own Secret. Neither process can read the
other's credential.

```bash
kubectl create secret generic gateway-bootstrap \
  --namespace observability \
  --from-literal=client-secret=__YOUR_BOOTSTRAP_CLIENT_SECRET__

kubectl create secret generic gateway-opamp \
  --namespace observability \
  --from-literal=client-secret=__YOUR_OPAMP_CLIENT_SECRET__
```

## Example

This turns the Gateway from the [ScoutCollector](./scoutcollector.md) page
into a supervised collector. Its ConfigMap becomes the fallback
configuration.

```yaml showLineNumbers
apiVersion: telemetry.scout.base14.io/v1alpha1
kind: ScoutCollector
metadata:
  name: gateway
  namespace: observability
spec:
  managementMode: Supervised
  identity:
    cluster: prod-eu
    environment: production
    role: gateway
  collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    fallbackConfig:
      name: gateway-config
      key: collector.yaml
    healthCheck:
      port: 13134
    env:
      - name: SCOUT_CLIENT_SECRET
        valueFrom:
          secretKeyRef:
            name: scout-credentials
            key: client-secret
    resources:
      requests:
        cpu: 200m
        memory: 256Mi
      limits:
        memory: 1Gi
  supervisor:
    image: ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-opampsupervisor:0.161.0
    collectorInstall:
      version: "0.161.0"
      checksums:
        amd64: "__SHA256_OF_LINUX_AMD64_TARBALL__"
        arm64: "__SHA256_OF_LINUX_ARM64_TARBALL__"
    opamp:
      endpoint: __YOUR_OPAMP_ENDPOINT__
      auth:
        tokenURL: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
        clientID: __YOUR_OPAMP_CLIENT_ID__
        secretKeyRef:
          name: gateway-opamp
          key: client-secret
    bootstrap:
      endpoint: __YOUR_FLEET_ENDPOINT__
      auth:
        tokenURL: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
        clientID: __YOUR_BOOTSTRAP_CLIENT_ID__
        secretKeyRef:
          name: gateway-bootstrap
          key: client-secret
  service: {}
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
```

Take the checksums from the `opentelemetry-collector-releases` release page
for the version you pin. Both architectures are required, so the same
resource works on mixed amd64 and arm64 nodes.

The fallback configuration must be complete and runnable on its own. Do not
put the OpAMP extension in it: the Supervisor adds that itself.

## Health checks

The Supervisor serves its own health endpoint on port 13133. The liveness
probe uses it, so a hung Supervisor is restarted.

Readiness should follow the Collector, which is what actually moves
telemetry. Enable the Collector's `health_check` extension on another port
and point `collector.healthCheck` at it, as the example does with 13134.
Without `healthCheck`, a pod reports ready whenever the Supervisor is up,
even if the Collector has exited.

Because Scout fleet management can replace the whole configuration, a configuration sent from
Scout fleet management that drops `health_check` makes every pod fail readiness. Keep
`health_check` in every configuration you send, or supply it as a config
layer (below).

If the Collector configuration itself must use port 13133, move the
Supervisor with `supervisor.healthCheckPort`.

## How collectors appear in Scout

Each supervised pod reports these attributes to Scout fleet management, which you can match
with `scout capo agents drift` and `apply`:

| Attribute | Value |
| --- | --- |
| `k8s.cluster.name` | `spec.identity.cluster` |
| `environment` | `spec.identity.environment` |
| `collector.role` | `spec.identity.role` |
| `k8s.namespace.name` | the `ScoutCollector` namespace |
| `service.name` | the `ScoutCollector` name |
| `scout.collector.key` | `cluster/environment/namespace/name/role` |

`spec.identity.labels` adds your own attributes. For example, to send a new
configuration to every gateway in a cluster:

```bash
scout capo agents apply \
  --match k8s.cluster.name=prod-eu \
  --match collector.role=gateway \
  --file gateway.yaml
```

Each pod is a separate agent in Scout fleet management, and a restarted pod appears as a new
one. `scout.collector.key` stays the same across restarts and identifies the
collector as a whole.

## Other Supervisor settings

| Field | Default | Description |
| --- | --- | --- |
| `supervisor.automaticConfigRollback` | `true` | Return to the previous configuration when a new one fails to start |
| `supervisor.passthroughLogs` | `false` | Show the Collector's own output in `kubectl logs`. Leave it off on collectors that read pod logs from their own node, or they read their own output back |
| `supervisor.configLayers` | none | Extra ConfigMap keys merged after the main configuration, for settings that must survive any configuration from Scout fleet management |
| `supervisor.capabilities` | remote config, restart, effective config, available components | OpAMP capabilities to advertise |
| `supervisor.collectorInstall.baseUrl` | GitHub releases | Download mirror for clusters without access to GitHub |
| `supervisor.bootstrap.timeout` | `30s` | How long `config-bootstrap` waits for Scout |

## Troubleshooting

### `config-bootstrap` keeps failing

Read its log:

```bash
kubectl logs -n observability <pod> -c config-bootstrap
```

| Message contains | Cause |
| --- | --- |
| `no valid committed cache is available` | First boot and Scout is unreachable. Check `bootstrap.endpoint` and network access to it |
| `no committed revision for a previously initialized collector` | The cache was deleted or reset. Restore access, or assign a configuration in Scout fleet management |
| `does not match` on the collector key | The cache belongs to another collector. Check `supervisor.cache.name` |
| `bootstrap token endpoint returned HTTP`, or a 401 from the recovery request | Wrong bootstrap client ID, secret, or token URL |

### `install-otelcol` fails

The download failed or the checksum did not match. Check that
`collectorInstall.version` and both checksums belong to the same release,
and that the pod can reach the download URL.

### `CacheSynchronized` is `False`

The operator could not reach Scout fleet management on its last refresh. The existing cache is
kept, and running collectors are unaffected, because they receive
configuration from Scout fleet management directly. The condition clears on the next
successful refresh.

## FAQ

### What happens to running collectors when Scout fleet management is down?

They keep running on the configuration they have. Scout fleet management is needed only to
change configuration. Pods that restart during the outage start from the
recovery cache.

### Can I switch a collector between Direct and Supervised mode?

Yes, change `managementMode` and apply. The operator rebuilds the pods for
the new mode and keeps the same Service name and address, so senders are
unaffected.

### Does the fallback configuration change after the first boot?

No, it is used only when Scout fleet management confirms the collector has never had an
applied configuration. Editing it later has no effect on a collector that
Scout has already configured. Send changes through Scout instead.

## Related guides

- [ScoutCollector resource](./scoutcollector.md): fields shared by both modes
- [scout capo](../../../scout-cli/scout-access/capo.md): inspect and
  configure collectors from the CLI
- [Collector configuration as code](../../../operate/collector-config-as-code.md)
