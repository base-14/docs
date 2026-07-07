---
title: RUM Sessions
sidebar_label: Sessions
sidebar_position: 6
description:
  Inspect individual user sessions with RUM in base14 Scout. Review session
  status, device details, and a chronological timeline of screen views, taps,
  network calls, errors, and crashes.
keywords:
  [
    rum,
    sessions,
    session timeline,
    session replay,
    mobile sessions,
    breadcrumbs,
    base14,
    scout,
  ]
---

The **Sessions** tab lists individual user sessions with a status badge —
**Ok**, **Error**, or **Crash**.

![Sessions List](/img/rum/sessions.png)

Each row shows **Session ID**, **User**, **Started At**, **Duration**,
**Screens**, **Errors**, **Crashes**, and **Device**. A badge indicates when a
session reported a native crash carried over from a previous session.

---

## Session Timeline

Click a session to open its timeline — a chronological view of everything that
happened during the session.

![Session Timeline](/img/rum/session-timeline.png)

- **Session Attributes** panel with device, OS, app version, and user details
- **Timeline** of events (screen views, taps, network calls, errors, crashes,
  breadcrumbs)
- Toggle event types on or off to focus the timeline
