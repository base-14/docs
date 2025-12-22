---
title: Configuration Reference
sidebar_label: Configuration
sidebar_position: 11
description:
  Complete pgX configuration reference. Configure data sources, environments,
  RDS settings, and access control for PostgreSQL monitoring.
keywords: [pgx, configuration, settings, rds, environments, grafana plugin]
---

This document provides a complete reference of all pgX configuration options.

![Configuration Page](/img/pgx/12-configuration-page.png)

---

## Accessing Configuration

1. Navigate to **Administration** → **Plugins** in Grafana
2. Search for "pgX"
3. Click on the plugin
4. Select the **Configuration** tab

---

## Configuration Options

### Data Source Settings

#### Datasource UID

| Property     | Value                     |
| ------------ | ------------------------- |
| **Setting**  | `clickhouseDataSourceUid` |
| **Type**     | String                    |
| **Required** | Yes                       |
| **Default**  | —                         |

The UID of your Scout Telemetry Data Lake datasource in Grafana. This datasource
must be configured and working before pgX can display metrics.

**How to find:**

1. Go to **Connections** → **Data Sources**
2. Click on your Scout Telemetry Data Lake datasource
3. The UID is in the URL or datasource settings

#### Database Name

| Property     | Value                    |
| ------------ | ------------------------ |
| **Setting**  | `clickhouseDatabaseName` |
| **Type**     | String                   |
| **Required** | No                       |
| **Default**  | `default`                |

The database containing your PostgreSQL metrics tables.

#### Metrics Table Name

| Property     | Value                |
| ------------ | -------------------- |
| **Setting**  | `metricsTableName`   |
| **Type**     | String               |
| **Required** | No                   |
| **Default**  | `otel_metrics_gauge` |

The name of the table containing PostgreSQL metrics in OpenTelemetry format.

---

### Environment Settings

#### Environments

| Property     | Value                    |
| ------------ | ------------------------ |
| **Setting**  | `environments`           |
| **Type**     | String (comma-separated) |
| **Required** | No                       |
| **Default**  | `staging,production`     |

Comma-separated list of environment names to show in the environment dropdown.

**Examples:**

- `staging,production`
- `dev,staging,prod`
- `us-east,us-west,eu-west`

#### Environment Attribute Key

| Property     | Value                     |
| ------------ | ------------------------- |
| **Setting**  | `environmentAttributeKey` |
| **Type**     | String                    |
| **Required** | No                        |
| **Default**  | `environment`             |

The resource attribute key used to filter metrics by environment. This should
match the attribute used when collecting metrics.

**Common values:**

- `environment`
- `env`
- `deployment.environment`

#### Service Names

| Property     | Value                    |
| ------------ | ------------------------ |
| **Setting**  | `serviceNames`           |
| **Type**     | String (comma-separated) |
| **Required** | No                       |
| **Default**  | `pgdashex`               |

Comma-separated list of service names that identify your PostgreSQL metrics
collector.

---

### Query Settings

#### Max Time Range

| Property     | Value             |
| ------------ | ----------------- |
| **Setting**  | `maxTimeRange`    |
| **Type**     | String (duration) |
| **Required** | No                |
| **Default**  | `1h`              |

Maximum time range allowed for queries. Limits how far back users can query to
prevent expensive queries.

**Format:** Duration string (e.g., `30m`, `1h`, `6h`, `1d`)

**Examples:**

- `30m` — 30 minutes
- `1h` — 1 hour
- `6h` — 6 hours
- `1d` — 1 day

#### Max Variable Options

| Property     | Value                |
| ------------ | -------------------- |
| **Setting**  | `maxVariableOptions` |
| **Type**     | Number               |
| **Required** | No                   |
| **Default**  | `100`                |

Maximum number of options to load in template variable dropdowns. Increase if
you have many databases/tables/indexes.

---

### Access Control

#### Enable RBAC Service Name Filtering

| Property     | Value                            |
| ------------ | -------------------------------- |
| **Setting**  | `enableRBACServiceNameFiltering` |
| **Type**     | Boolean                          |
| **Required** | No                               |
| **Default**  | `false`                          |

When enabled, filters metrics based on service names the user has access to.
Requires Grafana Enterprise RBAC configuration.

---

### Deployment Type

#### PostgreSQL Deployment Type

| Property     | Value                    |
| ------------ | ------------------------ |
| **Setting**  | `postgresDeploymentType` |
| **Type**     | Enum                     |
| **Required** | No                       |
| **Default**  | `self-hosted`            |

The type of PostgreSQL deployment being monitored.

| Value         | Description                           | Features                     |
| ------------- | ------------------------------------- | ---------------------------- |
| `self-hosted` | PostgreSQL on your own infrastructure | All features                 |
| `rds`         | Amazon RDS for PostgreSQL             | Includes Resources dashboard |
| `cloud-sql`   | Google Cloud SQL for PostgreSQL       | Coming soon                  |

**Impact:**

- `self-hosted`: Standard metrics, no cloud resource metrics
- `rds`: Enables AWS CloudWatch metrics in Resources dashboard
- `cloud-sql`: Future support for GCP metrics

---

### RDS Settings

These settings only apply when `postgresDeploymentType` is set to `rds`.

#### RDS Service Name

| Property     | Value                   |
| ------------ | ----------------------- |
| **Setting**  | `rdsServiceName`        |
| **Type**     | String                  |
| **Required** | No (for RDS)            |
| **Default**  | `aws-cloudwatch-stream` |

The service name used for CloudWatch metrics collection.

#### RDS Metrics Prefix

| Property     | Value                    |
| ------------ | ------------------------ |
| **Setting**  | `rdsMetricsPrefix`       |
| **Type**     | String                   |
| **Required** | No (for RDS)             |
| **Default**  | `amazonaws.com/AWS/RDS/` |

The prefix used for CloudWatch RDS metric names.

#### RDS Metrics Table Name

| Property     | Value                  |
| ------------ | ---------------------- |
| **Setting**  | `rdsMetricsTableName`  |
| **Type**     | String                 |
| **Required** | No (for RDS)           |
| **Default**  | `otel_metrics_summary` |

The table containing CloudWatch metrics.

#### RDS Attribute Format

| Property     | Value                |
| ------------ | -------------------- |
| **Setting**  | `rdsAttributeFormat` |
| **Type**     | Enum                 |
| **Required** | No (for RDS)         |
| **Default**  | `nested`             |

How CloudWatch dimension attributes are stored in the data lake.

| Value    | Description                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nested` | Attributes stored as nested JSON objects. Access via `JSONExtract`. Example: `Attributes['Dimensions']` contains `'{"DBInstanceIdentifier": "prod-db"}'` |
| `flat`   | Attributes stored with dot-notation keys. Direct access. Example: `Attributes['Dimensions.DBInstanceIdentifier']` contains `'prod-db'`                   |

---

## Configuration Examples

### Basic Self-Hosted Configuration

```json
{
  "clickhouseDataSourceUid": "your-clickhouse-uid",
  "clickhouseDatabaseName": "default",
  "metricsTableName": "otel_metrics_gauge",
  "environments": "staging,production",
  "postgresDeploymentType": "self-hosted"
}
```

### AWS RDS Configuration

```json
{
  "clickhouseDataSourceUid": "your-clickhouse-uid",
  "clickhouseDatabaseName": "metrics",
  "metricsTableName": "otel_metrics_gauge",
  "environments": "staging,production",
  "postgresDeploymentType": "rds",
  "rdsServiceName": "aws-cloudwatch-stream",
  "rdsMetricsPrefix": "amazonaws.com/AWS/RDS/",
  "rdsMetricsTableName": "otel_metrics_summary",
  "rdsAttributeFormat": "nested"
}
```

### Multi-Region Configuration

```json
{
  "clickhouseDataSourceUid": "your-clickhouse-uid",
  "clickhouseDatabaseName": "default",
  "metricsTableName": "otel_metrics_gauge",
  "environments": "us-east-1,us-west-2,eu-west-1",
  "environmentAttributeKey": "aws.region",
  "maxTimeRange": "6h",
  "maxVariableOptions": 200,
  "postgresDeploymentType": "rds"
}
```

### Enterprise Configuration with RBAC

```json
{
  "clickhouseDataSourceUid": "your-clickhouse-uid",
  "clickhouseDatabaseName": "metrics",
  "metricsTableName": "otel_metrics_gauge",
  "environments": "dev,staging,production",
  "enableRBACServiceNameFiltering": true,
  "serviceNames": "pgdashex-dev,pgdashex-staging,pgdashex-prod",
  "maxTimeRange": "1h",
  "postgresDeploymentType": "self-hosted"
}
```

---

## Default Values Reference

| Setting                          | Default Value            |
| -------------------------------- | ------------------------ |
| `clickhouseDatabaseName`         | `default`                |
| `metricsTableName`               | `otel_metrics_gauge`     |
| `maxVariableOptions`             | `100`                    |
| `environments`                   | `staging,production`     |
| `environmentAttributeKey`        | `environment`            |
| `enableRBACServiceNameFiltering` | `false`                  |
| `maxTimeRange`                   | `1h`                     |
| `serviceNames`                   | `pgdashex`               |
| `postgresDeploymentType`         | `self-hosted`            |
| `rdsServiceName`                 | `aws-cloudwatch-stream`  |
| `rdsMetricsPrefix`               | `amazonaws.com/AWS/RDS/` |
| `rdsMetricsTableName`            | `otel_metrics_summary`   |
| `rdsAttributeFormat`             | `nested`                 |

---

## Troubleshooting

### No Data Appearing

1. **Check datasource**: Verify Scout Telemetry Data Lake datasource is working
2. **Verify table name**: Ensure `metricsTableName` matches your actual table
3. **Check service name**: Ensure `serviceNames` matches your collector
4. **Review time range**: Data may not exist in selected time range

### Environment Dropdown Empty

1. **Check environments setting**: Verify `environments` is set correctly
2. **Check attribute key**: Ensure `environmentAttributeKey` matches your data
3. **Verify data exists**: Check the data lake for the expected attribute values

### RDS Metrics Not Showing

1. **Check deployment type**: Ensure `postgresDeploymentType` is `rds`
2. **Verify RDS table**: Check `rdsMetricsTableName` is correct
3. **Check attribute format**: Ensure `rdsAttributeFormat` matches your data
4. **Verify CloudWatch collection**: Ensure metrics are being collected

### Performance Issues

1. **Reduce time range**: Lower `maxTimeRange` setting
2. **Limit variables**: Reduce `maxVariableOptions`
3. **Check query patterns**: Review query performance in the data lake

---

## Related Guides

- [Getting Started](./quickstart.md) — Initial setup guide
- [Overview](./overview.md) — Start using pgX
- [Metrics Reference](./metrics.md) — Available metrics
