---
title: Installation
sidebar_label: Installation
sidebar_position: 2
description:
  Install the Scout CLI on macOS or Linux via Homebrew.
keywords:
  - scout cli install
  - scout cli setup
  - scout cli download
  - homebrew scout
  - opentelemetry cli install
---

# Installation

## Prerequisites

- **macOS**, **Linux**, or **Windows**
- A terminal with shell access

## Install with Homebrew (macOS / Linux)

```bash
brew tap base14/tap
brew install scout
```

## Verify

```bash
scout --version
```

## Next Steps

- **Platform users** — [Authenticate with Scout](./platform/login.md) to start
  querying telemetry data
- **Open-source users** — [Generate an OTel Collector config](./open-source/config-init.md)
  to get started without a backend
