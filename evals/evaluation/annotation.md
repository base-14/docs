---
sidebar_position: 3
title: Human annotation and custom scores
sidebar_label: Annotation and custom scores
description:
  Score traces by hand in Base14 Evals annotation queues, collect user
  feedback, and send scores from your own code through the SDK or API.
keywords:
  [llm annotation queue, human evaluation llm, llm user feedback, custom scores]
---

# Human annotation and custom scores

Not every judgement can be automated. Evals lets your team score traces by
hand, and lets your application record scores of its own.

## Annotate a single trace

Open any trace or observation and select **Annotate**. Pick a score config
and enter a value and an optional comment. The score is saved with your name
as its author.

## Annotation queues

Queues organize review work for a team.

1. Go to **Human Annotation** and create a queue. Choose the score configs
   reviewers fill in.
2. Add items: select traces or observations in any table and choose
   **Add to Annotation Queue**, or add them through the API.
3. Reviewers open the queue and work through the items one at a time. Each
   item shows the trace, the fields to score, and a button to move on.

Use queues to build ground truth, to check what an
[LLM-as-a-judge](./llm-as-a-judge.md) evaluator decided, or to label
examples before adding them to a dataset.

## Send scores from code

Your application can record scores directly. Common sources are user
feedback (a thumbs up or down in your UI), rule-based checks (valid JSON,
answer length), and evaluations you run elsewhere.

```python
from langfuse import get_client

langfuse = get_client()

# Score a specific trace, for example from a feedback endpoint
langfuse.create_score(
    trace_id=trace_id,
    name="user-feedback",
    value=1,
    data_type="BOOLEAN",
    comment="Thumbs up",
)
```

Inside an observed function, score the trace or step that is running:

```python
langfuse.score_current_trace(name="valid-json", value=1, data_type="BOOLEAN")
```

Scores can also attach to an observation (`observation_id`) or a whole
session (`session_id`). To capture the trace ID for later feedback, read it
from the current context with `langfuse.get_current_trace_id()` and return it
to your frontend.

## Scores API

Without an SDK, create scores with the public API:

```bash
curl -u "pk-lf-...:sk-lf-..." \
  -H "Content-Type: application/json" \
  -X POST "https://<your-evals-host>/api/public/scores" \
  -d '{"traceId": "<trace-id>", "name": "user-feedback", "value": 1, "dataType": "BOOLEAN"}'
```

See [API](../api.md) for authentication and the other endpoints.
