---
title: RUM Users
sidebar_label: Users
sidebar_position: 9
description:
  Explore identified users and their activity with RUM in base14 Scout. View
  per-user sessions, errors, devices, screen performance, and session history.
keywords:
  [
    rum,
    users,
    user monitoring,
    session history,
    per-user performance,
    mobile users,
    base14,
    scout,
  ]
---

The **Users** tab lists identified users and their activity, so you can start
from a known user (a support ticket, an account ID) and drill into exactly
what they experienced.

![User list with Identifier, Sessions, Errors, and Devices columns](/img/rum/users/list.png)

---

## User List

### Table Columns

| Column | Description |
| ------ | ----------- |
| **Identifier** | The user's identifier |
| **Sessions** | Number of sessions in the range |
| **Errors** | Non-fatal errors across all their sessions |
| **Devices** | Device model(s) they used |

Users with a non-zero error count are highlighted so you can spot who is
hitting problems.

The shared [Filters](./getting-started.md#filters) sidebar applies here, with
a richer set of User attributes than elsewhere: `user.id`,
`user.anonymous_id`, `user.email`, `user.name`, `user.phone`, `user.plan`,
`user.session_seq`, and `user.tenant`.

---

## User Details

Select a user to open their detail view, which brings together everything
that user has done in the app.

![Identifier, Devices, OS, App Versions header and Crashes/Errors/UI Freezes/Sessions stat cards](/img/rum/users/header-stats.png)

The header identifies the user and the **Devices**, **OS**, and **App
Versions** they used, followed by **Crashes**, **Errors**, **UI Freezes**,
and **Sessions** stat cards summarizing their experience. **UI Freezes**
counts the same frozen-UI events the [ANR](./anr.md) tab groups, so a high
count there is worth following up on.

### Screen Performance

![Screen Performance table with Screen, Views, Avg Load, and Avg Time Spent columns](/img/rum/users/screen-performance.png)

Per-screen **Views**, **Avg Load**, and **Avg Time Spent** for this user, so
you can see which screens are slow or failing for them specifically -
useful for confirming whether a reported issue is app-wide or unique to this
user's device or usage pattern.

### Session History

![Session History table with Session ID, Started At, Duration, Screens, Errors, and Crashes columns](/img/rum/users/session-history.png)

The user's sessions with **Session ID**, **Started At**, **Duration**,
**Screens**, **Errors**, and **Crashes**, each linking through to its full
[session timeline](./sessions.md). Sessions with crashes are highlighted, and
**Load more** pages through additional sessions.

---

## Use Cases

### Investigating a Support Ticket

1. Search for the user's identifier in the **User List**
2. Check the **Crashes**/**Errors**/**UI Freezes** stat cards for a quick
   read on whether they're having a bad time generally
3. Open **Session History** and jump into the session around when they
   reported the issue

### Checking if an Issue Is User-Specific

1. Open the affected user's detail view
2. Compare their **Screen Performance** numbers against the app-wide numbers
   on [Screens](./screens.md) for the same screen
3. A large gap points at something specific to this user's device, network,
   or account state rather than a general regression

---

## Related Guides

- [Getting Started](./getting-started.md) - Interface layout and shared filters
- [Sessions](./sessions.md) - Full session timeline and event details
- [Crashes](./crashes.md) - Crash groups, filterable by affected user
- [ANR](./anr.md) - Frozen-UI events behind the UI Freezes count
- [traceX](../tracex/index.md) - Distributed tracing explorer
- [logX](../logx/index.md) - Log explorer with trace correlation
- [Instrument a Flutter app](../../instrument/mobile/flutter.md)
