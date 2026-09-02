---
title: Errors
sidebar_label: Errors
sidebar_position: 4
description:
  Triage exceptions with the APM Errors tab in base14 Scout. Group errors into
  issues, follow occurrence trends, and jump to failing traces.
keywords:
  [
    apm,
    errors,
    exceptions,
    error tracking,
    error inbox,
    issues,
    base14,
    scout,
  ]
---

The Errors tab groups exceptions from your traces into issues — one row per
distinct error type and location — so a noisy failure shows up as a single
issue with a count, not thousands of scattered events.

![Errors Tab](/img/apm/errors/errors-issues.png)

---

## The Issues List

Each issue shows:

| Column | Meaning |
| ------ | ------- |
| **Issue** | Exception type and message |
| **Service / endpoint** | Where the error occurs |
| **Occurrences** | How many times it fired in the window |
| **Trend** | Occurrence sparkline over time |
| **Last seen** | Most recent occurrence |

- Search filters issues by exception type, message, or endpoint
- Sort by occurrences to find the noisiest problems
- Use **Load more** to page through long lists

---

## Issue Detail

Click an issue to open its detail view:

![Error Detail](/img/apm/errors/errors-detail.png)

The detail view includes:

- **Occurrence chart** — when the error fires, with annotations overlaid
- **Stack trace** — the full stack for the exception, with a copy button
- **Summary** — exception type, message, service, and endpoint
- **Recent occurrences** — individual events with timestamps and trace links

### From Error to Trace

Every occurrence links to its trace. Click one to open the Traces tab focused
on that exact request, where you can see what the request was doing when it
failed — the queries it ran, the services it called, and the timing of each
step.
