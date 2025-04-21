---
sidebar_position: 4
---


# Otel Collector Binary Example

## Install the collector binary

The collector binary can be downloaded from
the [releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

An example of how to download and extract the collector binary is shown below
for macos arm64.

```bash

curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.119.0/otelcol_0.119.0_darwin_arm64.tar.gz
tar -xvf otelcol_0.119.0_darwin_arm64.tar.gz
```

## Example configuration

An example config can be seen to collect logs from a file to export to Scout

```yaml

extensions:
  oauth2client:
    client_id: demo
    client_secret: 01JM94R5DPSZXBGK5QA4D329N5
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/playground/protocol/openid-connect/token

exporters:
  debug:
  otlphttp/auth:
    endpoint: https://otel.play.b14.dev/01jm94npk4h8ys63x1kzw2bjes/otlp
    auth:
      authenticator: oauth2client

processors:
  batch:
    redaction:
      blocked_values:
        - "(5[1-5][0-9]{14})"       ## MasterCard number
        summary: debug

receivers:
  # Data sources: traces, metrics, logs
  filelog:
    include: [ "app.log" ]

service:
  extensions: [ oauth2client ]
  pipelines:
    logs:
      receivers: [ filelog ]
      processors: [ batch ]
      exporters: [ otlphttp/auth, debug ]
```

## Running the collector

```bash

./otelcol --config ./config.yaml
```

## Run an app

Run the app and redirect the output to a file app.log which is being watched by
the collector.

As an example we can use the following node app.

install structured logging library

```bash
npm install pino
```

use the logger to log some messages

```js, main.js

const logger = require('pino')()

logger.info('hello world')

const child = logger.child({ a: 'property' })
child.info('hello child!')
```

run the app and redirect the output to a file app.log

```bash
node main.js > app.log
```

## View logs in Scout

Open the Scout UI and navigate to the Logs tab. You should see the logs from the
app.
