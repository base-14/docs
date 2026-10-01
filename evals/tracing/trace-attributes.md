---
sidebar_position: 2
title: Sessions, users, and other trace attributes
sidebar_label: Sessions, users, and attributes
description:
  Add session IDs, user IDs, tags, metadata, and versions to Base14 Evals
  traces so you can filter, group, and compare them.
keywords:
  [llm sessions, llm user tracking, trace tags, trace metadata, langfuse sdk]
---

# Sessions, users, and other trace attributes

Attributes make traces findable. Set them once per request and every
observation in the trace inherits them.

| Attribute | Use it for | Where it shows up |
| --- | --- | --- |
| `session_id` | Grouping the turns of a conversation | **Sessions** |
| `user_id` | Per-customer activity, usage, and cost | **Users** |
| `tags` | Labels you filter on, such as a feature name | Trace filters |
| `metadata` | Any other key-value context | Trace detail, filters |
| `version` | The version of the code or prompt that produced the trace | Filters, dashboards |
| `trace_name` | A readable name for the request type | Trace list, dashboards |

## Set attributes in Python

Wrap the request in `propagate_attributes`. Everything created inside the
block, including spans from instrumented libraries, gets the attributes.

```python
from langfuse import get_client, propagate_attributes

langfuse = get_client()


def handle_message(thread_id: str, customer_id: str, text: str) -> str:
    with propagate_attributes(
        session_id=thread_id,
        user_id=customer_id,
        tags=["support-chat"],
        metadata={"plan": "pro"},
        version="2026-10-01",
    ):
        return run_agent(text)
```

Use stable, non-secret identifiers. A database ID is a good `user_id`; an
email address is not.

## Add context to the current step

Inside an observed function, update the current observation with extra
detail:

```python
from langfuse import get_client, observe


@observe(as_type="tool")
def lookup_faq(question: str) -> str:
    answer = search(question)
    get_client().update_current_span(
        metadata={"hit": answer is not None},
        level="WARNING" if answer is None else "DEFAULT",
    )
    return answer or "No match"
```

## Sessions

The **Sessions** page lists every session with its trace count, duration,
and cost. Open one to replay the conversation in order. Scores can attach to
a whole session, for example a "conversation resolved" rating.

## Users

The **Users** page lists every `user_id` with its trace count, token usage,
and cost. Use it to find your heaviest users or to see what a customer who
reported a problem actually did.

## Search and filter

The trace list filters on any attribute above, plus environment, name,
latency, cost, level, and scores. Full-text search looks in trace and
observation input and output. Save a filter combination as a view to reuse
it.
