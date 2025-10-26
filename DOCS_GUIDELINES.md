# Documentation Guidelines

## Quick Checklist

- [ ] Create file in appropriate directory (e.g., `docs/instrument/`, `docs/manage/`)
- [ ] Add frontmatter with required fields
- [ ] Use descriptive filename (lowercase-with-hyphens.md)
- [ ] Use H2 headers for sections (no H1, no bold)
- [ ] Add related guides section at the end
- [ ] Keep lines under 80 characters
- [ ] Run `npm run markdownlint` and fix errors
- [ ] Verify locally with `npm start` before committing

## File Structure

```plain
docs/
├── introduction.md              # Homepage (slug: /)
├── instrument/                  # Setup & instrumentation guides
│   ├── _category_.json
│   ├── collector-setup/
│   │   ├── _category_.json
│   │   └── docker-compose-example.md
│   ├── component/              # Component instrumentation
│   ├── infra/                  # Infrastructure monitoring
│   │   └── aws/
│   │       └── elb.md
│   └── apps/                   # Application instrumentation
│       ├── auto-instrumentation/
│       └── custom-instrumentation/
├── manage/                     # Management & configuration
│   ├── _category_.json
│   └── creating-alerts-with-logx.md
└── observe/                    # Observability features
    └── _category_.json
```

## Creating a New Documentation Article

### 1. Choose the Right Location

Place your article in the appropriate category:

- **`docs/instrument/`** - Setup guides, collector configuration, instrumentation
  - `collector-setup/` - Collector installation and configuration
  - `component/` - Monitoring specific components (Redis, PostgreSQL, etc.)
  - `infra/` - Infrastructure monitoring (AWS, GCP, etc.)
  - `apps/` - Application instrumentation (auto/custom)
- **`docs/manage/`** - Data management, dashboards, alerts, filters
- **`docs/observe/`** - Observability features and analytics

### 2. Naming Convention

Use lowercase with hyphens for filenames:

- Good: `docker-compose-example.md`, `creating-alerts-with-logx.md`
- Bad: `DockerComposeExample.md`, `creating_alerts.md`

### 3. Frontmatter Template

All documentation articles must include frontmatter. Here are the common patterns:

#### Standard Article

```yaml
---
title: Article Title Here
sidebar_label: Short Label
description:
  Brief description of what this article covers. Used for SEO and search.
  Can span multiple lines.
keywords:
  [keyword1, keyword2, keyword3, related terms]
sidebar_position: 1
---
```

#### Article with Custom Slug

```yaml
---
slug: /custom-url-path
title: Article Title Here
sidebar_label: Short Label
description: Brief description for SEO
keywords: [keyword1, keyword2]
sidebar_position: 1
---
```

#### Article with Tags and Date

```yaml
---
date: 2025-04-26
id: unique-article-id
title: Article Title Here
sidebar_label: Short Label
description: Brief description for SEO
keywords: [keyword1, keyword2]
tags: [opentelemetry, base14 scout]
sidebar_position: 1
---
```

**Required fields**: `title`, `description`

**Common optional fields**:

- `sidebar_label` - Shorter label for sidebar navigation
- `sidebar_position` - Numeric position in sidebar (lower = higher)
- `keywords` - Array of keywords for SEO
- `tags` - Categorization tags
- `slug` - Custom URL path (defaults to file path)
- `id` - Unique identifier (defaults to filename)
- `date` - Publication/update date (YYYY-MM-DD)

## Content Structure

### Headers

- **No H1** in content (title is auto-generated from frontmatter)
- **Use H2 (`##`)** for main sections
- **Use H3 (`###`)** for subsections
- **No bold** in headers (`## Title` not `## **Title**`)

Example structure:

```markdown
---
title: My Documentation Article
---

Brief introduction paragraph.

## Overview

Description of what this guide covers.

## Prerequisites

- Item 1
- Item 2

## Step 1: First Step

Instructions here.

### Substep Details

Additional details.

## Step 2: Second Step

More instructions.

## Related Guides

- [Link to related doc](./related-doc.md)
```

### Line Length

- **80 characters max** for body text
- Code blocks, tables, and URLs are exempt
- Use prettier to auto-format:

```bash
npx prettier --write --prose-wrap always --print-width 80 "docs/path/to/article.md"
```

### Code Blocks

Use syntax highlighting with language specifiers:

````markdown
```yaml showLineNumbers
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
```
````

Supported languages: `yaml`, `bash`, `python`, `javascript`, `typescript`,
`sql`, `json`

### Images

Store images in `/static/img/` and reference them:

```markdown
![Alt text](/img/otel-scout-base14.svg)
```

### Links

#### Internal Links (Documentation)

Use relative paths:

```markdown
[Docker Compose Setup](./instrument/collector-setup/docker-compose-example.md)
[Scout Exporter](../../instrument/collector-setup/scout-exporter.md)
```

#### Internal Links (Blog)

Use absolute paths from root:

```markdown
[Observability Theatre](/blog/observability-theatre)
```

#### External Links

```markdown
[OpenTelemetry Docs](https://opentelemetry.io/docs/)
```

### Admonitions (Callouts)

Use blockquotes for important notes:

```markdown
> **Note**: CloudWatch Metrics Stream will automatically deliver all metrics.
```

## Category Configuration

When creating a new category (folder), add a `_category_.json` file:

```json
{
  "label": "Category Label",
  "position": 2,
  "link": {
    "type": "generated-index",
    "description": "Brief description of this category's content."
  }
}
```

**Fields**:

- `label` - Display name in sidebar
- `position` - Numeric order (lower = higher in sidebar)
- `link.type` - Usually `"generated-index"`
- `link.description` - Category description

## End Sections

### References (Optional)

Include a "References" section for external documentation and official
resources:

```markdown
## References

- [Official OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Grafana Alerting Guide](https://grafana.com/docs/grafana/latest/alerting/)
```

### Related Guides (Recommended)

Always include a "Related Guides" section for internal documentation links:

```markdown
## Related Guides

- [Docker Compose Setup](./collector-setup/docker-compose-example.md) - Quick
  start guide
- [Kubernetes Helm Setup](./collector-setup/kubernetes-helm-setup.md) -
  Production deployment
- [Scout Exporter](./collector-setup/scout-exporter.md) - Configure
  authentication
```

**Section Ordering**: When both sections are present, "References" should come
first, followed by "Related Guides".

Use relative links for internal guides and add brief descriptions after each
link using `- Description`.

## Quality Checks

### Before Committing

```bash
# Format the article
npx prettier --write --prose-wrap always --print-width 80 "docs/path/to/article.md"

# Check for lint errors
npm run markdownlint

# Run full build and lint
npm run build-lint

# Preview locally
npm start
```

### Common Linting Issues

1. **MD013/line-length** - Lines exceed 80 characters
   - Fix: Use prettier or manually break lines
2. **MD033/no-inline-html** - HTML in markdown
   - Fix: Use markdown alternatives or add disable comments
3. **MD041/first-line-heading** - First line must be H1
   - Fix: Ensure frontmatter is present

## Sidebar Behavior

The sidebar is auto-generated from the file structure by default (configured in `sidebars.ts`):

```typescript
const sidebars: SidebarsConfig = {
  tutorialSidebar: [{type: 'autogenerated', dirName: '.'}],
};
```

### Ordering

1. Files are sorted by `sidebar_position` (if specified)
2. Categories use `position` in `_category_.json`
3. Alphabetically if no position specified

### Customizing Sidebar Labels

Use `sidebar_label` in frontmatter for shorter navigation labels:

```yaml
---
title: AWS Application Load Balancer Monitoring via CloudWatch Metrics Stream
sidebar_label: AWS ALB
---
```

## Example Articles

Reference these well-structured articles:

- `docs/introduction.md` - Homepage with overview
- `docs/instrument/collector-setup/otel-collector-config.md` - Comprehensive guide
- `docs/instrument/infra/aws/elb.md` - Step-by-step tutorial
- `docs/manage/creating-alerts-with-logx.md` - Simple how-to guide

## Best Practices

1. **Be Concise**: Keep instructions clear and focused
2. **Use Examples**: Include code examples and command outputs
3. **Link Extensively**: Reference related documentation
4. **Update Regularly**: Keep content current with product changes
5. **Test Instructions**: Verify all commands and steps work
6. **Use Consistent Formatting**: Follow the patterns in existing docs
7. **SEO-Friendly**: Use descriptive titles, keywords, and descriptions
8. **Progressive Disclosure**: Start simple, add complexity gradually

## Resources

- [Docusaurus Documentation](https://docusaurus.io/docs)
- [Markdown Guide](https://www.markdownguide.org/)
- [Prettier](https://prettier.io/)
