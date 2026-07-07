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

The **Users** tab lists identified users and their activity.

![Users](/img/rum/users.png)

The user table shows **Identifier**, **Sessions**, **Errors**, and **Devices**.
Users with a non-zero error count are highlighted so you can spot who is hitting
problems.

---

## User Details

Select a user to open their detail view, which brings together everything that
user has done in the app.

![User Details](/img/rum/user-details.png)

The header identifies the user and the **Devices**, **OS**, and **App Versions**
they used, followed by **Crashes**, **Errors**, **UI Freezes**, and **Sessions**
stat cards summarizing their experience.

- **Screen Performance** — per-screen **Views**, **Avg Load**, and
  **Avg Time Spent** for this user, so you can see which screens are slow or
  failing for them specifically
- **Session History** — the user's sessions with **Started At**, **Duration**,
  **Screens**, **Errors**, and **Crashes**, each linking through to its
  [session timeline](./sessions.md)

This makes the Users tab the starting point for support and debugging workflows:
begin from a known user identifier and drill into the exact sessions, screens,
and errors they experienced.

---

## Related Guides

- [traceX](../tracex/index.md) - Distributed tracing explorer
- [logX](../logx/index.md) - Log explorer with trace correlation
- [Instrument a Flutter app](../../instrument/mobile/flutter.md)
