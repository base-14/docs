---
title: Caching
sidebar_position: 7
---

# Caching

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

The SDK includes a thread-safe, in-memory TTL cache that reduces
API calls by storing prompt versions locally. Caching is
**enabled by default** with a **300-second (5-minute) TTL**.

## Default Behavior

When caching is enabled, `get_prompt_version` stores the result
keyed by prompt name and label/version. Subsequent calls with the
same arguments return the cached value until the TTL expires.

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
# First call hits the API
version = client.get_prompt_version("greeting")

# Second call returns cached result (no API call)
version = client.get_prompt_version("greeting")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
# First call hits the API
version = client.get_prompt_version("greeting")

# Second call returns cached result (no API call)
version = client.get_prompt_version("greeting")
```

</TabItem>
</Tabs>

## Setting a Custom TTL

Change the default TTL when creating the client:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
client = ScopeClient(
    credentials=credentials,
    cache_ttl=600,  # 10 minutes
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
client = ScopeClient::Client.new(
  credentials: credentials,
  cache_ttl: 600,  # 10 minutes
)
```

</TabItem>
</Tabs>

## Per-Request Cache Control

### Skip the cache for a single request

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
# Bypass cache and fetch fresh data
version = client.get_prompt_version("greeting", cache=False)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
# Bypass cache and fetch fresh data
version = client.get_prompt_version("greeting", cache: false)
```

</TabItem>
</Tabs>

### Override TTL for a single request

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
# Cache this result for 60 seconds instead of the default
version = client.get_prompt_version("greeting", cache_ttl=60)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
# Cache this result for 60 seconds instead of the default
version = client.get_prompt_version("greeting", cache_ttl: 60)
```

</TabItem>
</Tabs>

## Clearing the Cache

Remove all cached entries programmatically:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
client.clear_cache()
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
client.clear_cache
```

</TabItem>
</Tabs>

## Disabling Caching Globally

Turn off caching entirely for a client:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
client = ScopeClient(
    credentials=credentials,
    cache_enabled=False,
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
client = ScopeClient::Client.new(
  credentials: credentials,
  cache_enabled: false,
)
```

</TabItem>
</Tabs>

## How Caching Works

- Cache keys are derived from the prompt name plus the label
  or version ID (e.g., `prompt:greeting:production`)
- Entries expire lazily — they are evicted when accessed after TTL expiration
- The cache is **thread-safe** (uses locks/monitors internally)
- Each client instance has its own independent cache
