---
title:
  Component Monitoring Overview - OpenTelemetry Collector Setup | base14 Scout
sidebar_label: Overview
sidebar_position: 0
description:
  Monitor databases, caches, message queues, and web servers with
  OpenTelemetry. Collect metrics from PostgreSQL, MySQL, MongoDB, Redis,
  RabbitMQ, Elasticsearch, NGINX, and more using the OTel Collector.
keywords:
  [
    opentelemetry component monitoring,
    database monitoring opentelemetry,
    otel collector receivers,
    infrastructure monitoring,
    redis opentelemetry,
    postgresql opentelemetry,
    nginx opentelemetry,
    base14 scout,
  ]
---

# Component Monitoring

Component monitoring collects **metrics, traces, and logs** from
databases, caches, message queues, and web servers using the
OpenTelemetry Collector. Each guide configures a dedicated receiver or
Prometheus scrape target and ships telemetry to base14 Scout.

## Components by Category

### Databases

| Component            | Guide                                        | Key Metrics                                        |
| -------------------- | -------------------------------------------- | -------------------------------------------------- |
| PostgreSQL Basic     | [PostgreSQL Basic](./collecting-postgres-telemetry)            | Connections, query performance, locks, WAL        |
| PostgreSQL Advanced  | [PostgreSQL Advanced](./collecting-postgres-advanced-telemetry) | Query stats, table/index sizes, replication       |
| MySQL                | [MySQL](./collecting-mysql-telemetry)                          | Connections, queries, InnoDB, replication          |
| MongoDB              | [MongoDB](./collecting-mongodb-telemetry)                      | Operations, connections, document metrics, cursors |
| CouchDB              | [CouchDB](./collecting-couchdb-telemetry)                      | Request rates, document operations, view stats     |
| Elasticsearch        | [Elasticsearch](./collecting-elasticsearch-telemetry)          | Cluster health, node stats, JVM, index operations |

### Caching

| Component  | Guide                      | Key Metrics                                     |
| ---------- | -------------------------- | ----------------------------------------------- |
| Redis      | [Redis](./collecting-redis-telemetry)           | Memory, keyspace, commands, clients, replication |
| Memcached  | [Memcached](./collecting-memcached-telemetry)   | Hit ratio, memory, connections, evictions        |

### Message Queues

| Component | Guide                      | Key Metrics                                       |
| --------- | -------------------------- | ------------------------------------------------- |
| RabbitMQ  | [RabbitMQ](./collecting-rabbitmq-telemetry)     | Queue depth, message rates, node memory, I/O      |

### Web Servers & Proxies

| Component          | Guide                              | Key Metrics                                          |
| ------------------ | ---------------------------------- | ---------------------------------------------------- |
| NGINX              | [NGINX](./collecting-nginx-telemetry)                     | Connections, request rate, worker states              |
| Apache HTTP Server | [Apache HTTP Server](./collecting-apache-httpd-telemetry) | Workers, scoreboard, request rate, bytes transferred |
| HAProxy            | [HAProxy](./collecting-haproxy-telemetry)                 | Sessions, request rate, backend health, queue depth  |

## How Component Monitoring Works

Each component exposes metrics through one of two methods:

1. **Dedicated OTel receiver** — the Collector connects directly to the
   component's stats API (PostgreSQL, MySQL, MongoDB, Redis, RabbitMQ,
   Elasticsearch, CouchDB, Memcached, Apache HTTP Server, HAProxy)
2. **Prometheus scrape** — the component or a sidecar exporter exposes
   a `/metrics` endpoint that the Collector scrapes (NGINX metrics via
   nginx-prometheus-exporter)

NGINX also supports **distributed traces** via `nginx-module-otel` and
**log collection** via the filelog receiver.

## Next Steps

1. **Choose your component** from the tables above
2. **Follow the guide** to configure the OTel Collector receiver
3. **Create dashboards** in Scout — see
   [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
