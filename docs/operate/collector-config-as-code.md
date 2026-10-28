---
title: Collector Configuration as Code
sidebar_label: Collector Configuration as Code
sidebar_position: 8
description:
  Keep your OpenTelemetry Collector configurations in Git and deliver them
  through Scout. A pull request reports what would change across the fleet; a
  merge applies it.
keywords:
  [
    collector configuration,
    collectors as code,
    opamp,
    configuration drift,
    collector ci,
    scout capo,
  ]
---

# Collector Configuration as Code

Your collectors can be configured from Scout, one at a time, in the Collectors
page. That works well for an experiment and poorly as a record: the next person
to look has no way to tell which collector was changed, by whom, or why.

This page describes the other way round. The configuration lives in your
repository, a pull request shows what it would do to the running fleet, and
merging applies it. Scout becomes how a configuration reaches a collector
rather than where it is decided.

The workflow has three steps:

1. **Propose**: change the configuration in your repository and open a pull
   request.
2. **Review**: a pipeline reports which collectors the change reaches and what
   each would become.
3. **Apply**: merging assigns it to every matching collector.

A configuration edited in Scout is overwritten by the next merge. That is the
point — one authority, kept in review — but it is worth knowing before editing
during an incident.

## Before you start

- [Scout CLI](../scout-cli/installation.md) 0.14.1 or later, which your
  pipeline installs.
- An API key with the **Collectors Write** role, from **API Keys** in Scout.
  Store its client id and secret as secrets in your repository.
- Your collectors report an attribute your pipeline can select on, such as
  `k8s.cluster.name`.

Check the key can reach your fleet:

```bash
export SCOUT_CLIENT_ID=<client-id>
export SCOUT_CLIENT_SECRET=<client-secret>
scout login --client-credentials --account <your-account>

scout capo agents drift --match k8s.cluster.name=<your-cluster>
```

```text
3 collector(s) match, 3 can apply a configuration.
They all run the same configuration.

  fd5850b73d0d  3 collector(s)
    8eaba0ff  prod-eu/production/otel/collector-daemon/daemon
    2c41b9de  prod-eu/production/otel/collector-daemon/daemon
    7f03a1cc  prod-eu/production/otel/collector-daemon/daemon
```

## Choose what to push

Push the configuration you want the collector to run, not the template it is
generated from. If a tool renders your collector configuration, run it in the
pipeline and push its output.

The distinction matters when the renderer does more than substitute values.
A chart that strips an extension, or adds the collector's own identity, produces
something meaningfully different from its input — and the input may not even be
a valid configuration on its own.

## Select what it reaches

A selector is attribute equality, repeated to narrow:

```bash
--match k8s.cluster.name=prod-eu --match collector.role=daemon
```

Any attribute a collector reports can be matched. A selector never names an
account: Scout takes that from your API key, so it cannot reach collectors
belonging to anyone else.

Match one kind of collector per selector. If your agents and daemons run
different configurations, they need a selector and a file each — a selector
spanning both would assign one of them to collectors it was never meant for.

## Review the change

In a pull request, report what the change would do and change nothing:

```bash
scout capo agents drift \
  --match k8s.cluster.name=prod-eu \
  --match collector.role=daemon \
  --markdown > comment.md

scout capo agents apply \
  --match k8s.cluster.name=prod-eu \
  --match collector.role=daemon \
  --file rendered/collector.yaml \
  --dry-run --diff >> comment.md
```

`drift` answers how many collectors the selector reaches and whether they
agree with each other. `apply --dry-run --diff` answers what merging would
make them, which `drift` cannot know because it never reads your file.

Post the result as a pull request comment with whichever action your pipeline
uses. Keep the diff behind a fold: a collector configuration runs to hundreds
of lines, and the summary is what gets read.

## Apply on merge

```bash
scout capo agents apply \
  --match k8s.cluster.name=prod-eu \
  --match collector.role=daemon \
  --file rendered/collector.yaml \
  --acknowledge-drift
```

`--acknowledge-drift` is needed whenever the matched collectors are not all
running the same configuration already. Early on they usually are not; making
them so is what the first few merges do.

To refuse if the fleet changed between the review and the merge, pass the
number you saw:

```bash
  --expected-match 3
```

## What applying does

Scout stores the configuration and offers it to each matching collector.

A supervised collector applies it and restarts. A collector without a
supervisor stores it and keeps running what it has, because applying a
configuration means restarting the collector and nothing is there to do that.
This is why `drift` reports how many collectors match and how many can apply
as two separate numbers.

Nothing is applied to a collector that is not running. A collector that
reconnects later is offered the configuration then.

## Reading the diff

Configurations are compared by structure rather than as text, so indentation
and key order are not differences. The order of a sequence is kept: a
pipeline's processors mean something in the order they are written.

Two things appear in a diff that are not your change:

**Extensions a supervisor owns.** A supervised collector reports the merged
result of what Scout sent and what its supervisor added. Those additions are
left out of the comparison, since no assignment removes them.

**Drift you had not noticed.** If one collector was changed outside Git, the
diff for its group shows that change being undone. That is accurate: merging
replaces it. It is usually the first time anyone sees that the change was made.

## Recovering a collector

A collector that loses its local configuration asks Scout for the last one it
was given, so a restarted or rebuilt collector comes back with the
configuration it had rather than a default.

If a configuration turns out to be wrong, roll one collector back by hash, or
merge a revert to roll back the fleet:

```bash
scout capo agents history 8eaba0ff
scout capo agents rollback 8eaba0ff --hash 83c518d4ab98
```

## See also

- [scout capo](../scout-cli/scout-access/capo.md), for the full command
  reference
- [Recommended Collector Configuration](./recommended-collector-configuration.md)
