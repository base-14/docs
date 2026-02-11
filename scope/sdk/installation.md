---
title: Installation
sidebar_position: 2
---

# Installation

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

## Requirements

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

- **Python 3.9+**
- [httpx](https://www.python-httpx.org/) (installed automatically as a dependency)

</TabItem>
<TabItem value="ruby" label="Ruby">

- **Ruby 2.7+**
- [faraday](https://lostisland.github.io/faraday/)
  (installed automatically as a dependency)

</TabItem>
</Tabs>

## Install the SDK

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```bash
pip install git+https://github.com/base14/scope-sdk.git#subdirectory=sdks/python
```

</TabItem>
<TabItem value="ruby" label="Ruby">

Add the following to your `Gemfile`:

```ruby
gem 'scope-client', git: 'https://github.com/base14/scope-sdk.git', glob: 'sdks/ruby/*.gemspec'
```

Then run:

```bash
bundle install
```

</TabItem>
</Tabs>

## Verify the Installation

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```bash
python -c "from scope_client import ScopeClient; print('scope-client installed successfully')"
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```bash
ruby -e "require 'scope_client'; puts 'scope-client installed successfully'"
```

</TabItem>
</Tabs>

## Next Steps

Once the SDK is installed, head to the
[Quickstart](./quickstart.md) to make your first API call.
