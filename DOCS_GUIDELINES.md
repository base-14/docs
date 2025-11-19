# Documentation Guidelines

## Document Type Decision Tree

**Choose your documentation type:**

``` plain
Are you documenting framework/language OpenTelemetry instrumentation?
├─ YES → Follow "Content Strategy for Instrumentation Guides" (see below)
│         Examples: Rails, Spring Boot, Express, Django, FastAPI
│         Target: 800+ lines, 20+ code examples, SEO-optimized
│
└─ NO → Follow "Standard Documentation Guidelines" (see below)
          Examples: Collector setup, alerts, dashboards, infrastructure
          Target: Clear, concise, practical
```

## Quick Checklist

### For All Documentation

- [ ] Create file in appropriate directory (see File Structure below)
- [ ] Add frontmatter with required fields (`title`, `description`)
- [ ] Use descriptive filename (lowercase-with-hyphens.md)
- [ ] Use H2 (`##`) for sections, H3 (`###`) for subsections (no H1, no bold in headers)
- [ ] Keep lines under 80 characters (use prettier for auto-format)
- [ ] Run `npm run build-lint` and fix errors
- [ ] Verify locally with `npm start` before committing

### Additional for Instrumentation Guides

- [ ] Include 15-20 SEO keywords in frontmatter
- [ ] Write 300-400 word introduction with 3 paragraphs
- [ ] Add "Who This Guide Is For" section (4-5 personas)
- [ ] Include compatibility matrix table in Prerequisites
- [ ] Show 3+ configuration approaches
- [ ] Add Production Configuration section (5-7 code examples)
- [ ] Include Troubleshooting section (4+ common issues)
- [ ] Add FAQ section (8-12 questions)
- [ ] Add Security and Performance sections
- [ ] Target 800+ lines total length
- [ ] See detailed checklist in "Content Strategy" section below

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

### 3. Frontmatter Templates

All documentation articles must include frontmatter.

#### Standard Documentation Article

For general docs (collector setup, alerts, dashboards, infrastructure):

```yaml
---
title: Article Title Here
sidebar_label: Short Label  # Optional: shorter sidebar name
description: Brief description for SEO and search. Keep under 160 characters.
keywords: [keyword1, keyword2, keyword3]  # 3-8 keywords
sidebar_position: 1  # Optional: lower number = higher in sidebar
---
```

#### Instrumentation Guide Article

For framework/language instrumentation (Rails, Spring Boot, etc.):

```yaml
---
title: [Framework] OpenTelemetry Instrumentation - Complete APM Setup Guide | Base14 Scout
sidebar_label: [Framework Name]
description:
  Complete guide to [Framework] OpenTelemetry instrumentation for application
  performance monitoring. Set up auto-instrumentation for traces, metrics, and
  production deployments with Base14 Scout in minutes.
keywords:
  [
    [framework] opentelemetry instrumentation,  # Primary keyword
    [framework] monitoring,
    [framework] apm,
    [framework] distributed tracing,
    # ... 15-20 total keywords (see "Content Strategy" section)
  ]
sidebar_position: 1
---
```

**Required fields**: `title`, `description`

**Field guidelines**:

- `title` - For instrumentation guides, include primary keyword + value prop + brand
- `description` - 150-160 chars for SEO; can span multiple lines
- `sidebar_label` - Use shorter name for sidebar (e.g., "Ruby on Rails" → "Rails")
- `keywords` - Standard docs: 3-8 keywords; Instrumentation guides: 15-20 keywords
- `sidebar_position` - Lower number appears higher in sidebar
- `slug` - Custom URL path (optional, defaults to file path)
- `date` - Publication date in YYYY-MM-DD format (optional)

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

### Line Length & Formatting

- **80 characters max** for body text (code blocks, tables, URLs exempt)
- Auto-format with prettier:
`npx prettier --write --prose-wrap always --print-width 80 "docs/**/*.md"`
- Long lines are acceptable in instrumentation guides for SEO optimization

### Code Blocks

Always use syntax highlighting with language specifiers and `showLineNumbers`:

````markdown
```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
```
````

**Supported languages**: `yaml`, `bash`, `python`, `javascript`, `typescript`,
`ruby`, `java`, `go`, `sql`, `json`, `dockerfile`

**Best practices**:

- Add `title="path/to/file"` for configuration files
- Use realistic examples (not toy code)
- Include comments for complex sections
- Show error handling in code examples

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

---

## Content Strategy for Instrumentation Guides

This section provides content marketing and SEO guidelines specifically for
framework/language OpenTelemetry instrumentation documentation (e.g., Rails,
Spring Boot, Express, Django).

### Quick Reference Summary

**When to use**: Auto-instrumentation docs for frameworks/languages (Rails,
Spring Boot, Express, Django, FastAPI, etc.)

**Structure** (14 required sections):

1. Introduction (300-400 words)
2. Who This Guide Is For
3. Prerequisites + Compatibility Matrix
4. Configuration (3+ approaches)
5. Production Configuration
6. Framework-Specific Features
7. Custom Instrumentation
8. Running Your App
9. Troubleshooting
10. Security
11. Performance
12. FAQ (8-12 questions)
13. What's Next
14. Complete Example

**Targets**: 800+ lines | 20+ code examples | 15-20 keywords | 3,000+ words

**Reference**: See `docs/instrument/apps/auto-instrumentation/rails.md`

### Goals

1. **SEO Rankings**: Rank in top 5 for `[framework] opentelemetry instrumentation`
and related queries
2. **User Success**: Enable users to successfully deploy to production without
external resources
3. **Completeness**: Provide comprehensive coverage exceeding competitor documentation

### Content Volume Targets

| Metric | Minimum | Competitive | Market Leader |
|--------|---------|-------------|---------------|
| Total lines | 400 | 600 | 800-1000 |
| Word count | 1,500 | 2,500 | 3,000-3,500 |
| Code examples | 12 | 18 | 20-25 |
| H2 sections | 10 | 14 | 16-18 |

### SEO Optimization for Instrumentation Guides

**Title formula**: `[Framework] OpenTelemetry Instrumentation - Complete APM Setup
Guide | Base14 Scout`

- Primary keyword + Value proposition + Brand

**Meta description** (150-160 chars): Benefit-focused summary mentioning
framework, features, and brand

**Keywords**: 15-20 variations following this pattern:

- Primary: `[framework] opentelemetry instrumentation`
- Variations: `[framework] monitoring`, `[framework] apm`, `[framework]
distributed tracing`
- Specific: `[framework-feature] monitoring` (e.g., "activerecord query monitoring")
- Libraries: `[popular-library] monitoring` (e.g., "sidekiq monitoring")

See frontmatter template above for complete example.

### Required Content Structure

#### 1. Introduction (300-400 words)

**Paragraph 1**: Value proposition and overview

```markdown
Implement OpenTelemetry instrumentation for [Framework] applications to enable
comprehensive application performance monitoring (APM), distributed tracing,
and observability. This guide shows you how to auto-instrument your [Framework]
application to collect traces and metrics from [key components] using the
OpenTelemetry [Language] SDK.
```

**Paragraph 2**: Framework-specific benefits

```markdown
[Framework] applications benefit from automatic instrumentation of popular
frameworks and libraries including [Library1], [Library2], [Library3], and
dozens of commonly used components. With OpenTelemetry, you can monitor
production performance, debug slow requests, trace distributed transactions
across microservices, and identify [framework-specific issues] without
significant code changes.
```

**Paragraph 3**: Target audience pain points

```markdown
Whether you're implementing observability for the first time, migrating from
commercial APM solutions, or troubleshooting performance issues in production,
this guide provides production-ready configurations and best practices for
[Framework] OpenTelemetry instrumentation.
```

#### 2. Who This Guide Is For

Target 4-5 specific personas:

```markdown
## Who This Guide Is For

This documentation is designed for:

- **[Framework] developers**: implementing observability and distributed tracing for the first time
- **DevOps engineers**: deploying [Framework] applications with production monitoring requirements
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial APM solutions
- **Developers**: debugging performance issues, [framework-specific problems]
- **Platform teams**: standardizing observability across multiple [Framework] services
```

#### 3. Prerequisites

Must include:

- Version compatibility (minimum and recommended)
- Compatibility matrix table
- Scout Collector setup link
- Basic concept understanding

```markdown
## Prerequisites

Before starting, ensure you have:

- **[Runtime] X.X or later** with version specifics
- **[Framework] Y.Y or later** installed
- **Scout Collector** configured and accessible
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component | Minimum Version | Recommended Version |
|-----------|----------------|---------------------|
| [Runtime] | X.X.X | Y.Y.Y+ |
| [Framework] | A.A.A | B.B.B+ |
```

#### 4. Configuration Section (REQUIRED)

Show **3+ configuration approaches**:

1. **Recommended approach** (framework-native)
2. **Alternative approach** (environment/bootstrap)
3. **Environment variables only** (container-friendly)
4. **Selective instrumentation**
5. **Scout Collector integration**

**Minimum**: 4-6 code examples in this section

#### 5. Production Configuration Section (REQUIRED)

Must include:

- BatchSpanProcessor setup with parameters
- Resource attributes (environment, version, instance ID)
- Environment-based configuration
- Production environment variables template
- Docker/container deployment examples

**Minimum**: 5-7 code examples in this section

#### 6. Framework-Specific Instrumentation (REQUIRED)

Deep dive into the framework's primary features:

- **Rails**: ActiveRecord, background jobs (Sidekiq)
- **Spring Boot**: REST controllers, JPA repositories
- **Express**: Middleware, route handlers
- **Django**: ORM, views, middleware

**Minimum**: 3-4 code examples showing automatic instrumentation

#### 7. Custom Manual Instrumentation (REQUIRED)

Framework-specific patterns:

- Controller/handler instrumentation
- Business logic spans
- External API calls with error handling
- Semantic conventions

**Minimum**: 4-5 comprehensive code examples

#### 8. Running Your Application (REQUIRED)

Three deployment scenarios:

1. Development mode (console output)
2. Production mode (environment variables)
3. Docker deployment (docker run + compose)

#### 9. Troubleshooting (REQUIRED)

Must include:

- Verification test (console/REPL example)
- Health check endpoint (full implementation)
- Debug mode setup
- 4-5 common issues with solutions

Format:

```markdown
#### Issue: [Problem description]

**Solutions:**
1. [Solution step 1]
2. [Solution step 2]
```

#### 10. Security Considerations (REQUIRED)

Cover:

- Sensitive data protection (bad vs good examples)
- SQL/query obfuscation
- HTTP header filtering
- Compliance considerations (GDPR, HIPAA, PCI-DSS)

**Minimum**: 3-4 code examples

#### 11. Performance Considerations (REQUIRED)

Include:

- Expected impact metrics (latency, CPU, memory with numbers)
- Impact factors (bullet list)
- 5 optimization best practices with code examples

Use numbered subheadings:

```markdown
#### 1. Use BatchSpanProcessor in Production
#### 2. Skip Non-Critical Endpoints
#### 3. Conditional Span Recording
#### 4. Limit Attribute Sizes
```

#### 12. FAQ Section (REQUIRED)

8-12 questions optimized for voice search:

**Required questions**:

1. Performance impact question
2. Version compatibility
3. Framework-specific integration (popular libraries)
4. Trace volume reduction
5. Multi-tenancy handling
6. Traces vs metrics explanation
7. Framework-specific debugging (N+1 queries, etc.)

#### 13. What's Next Section (REQUIRED)

Organize into categories:

```markdown
## What's Next?

### Advanced Topics
- [Link 1 to related instrumentation]
- [Link 2 to language-specific deep dive]

### Scout Platform Features
- [Creating Alerts](../../../guides/creating-alerts-with-logx.md)
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md)

### Deployment and Operations
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
```

#### 14. Complete Example (REQUIRED)

Full working application:

- Dependency file (package.json, Gemfile, pom.xml, etc.)
- Initializer/configuration file
- Instrumented code example
- Environment variables template
- GitHub repository link (placeholder)

### Code Example Guidelines

**Quantity targets**:

- Configuration: 4-6 examples
- Production config: 5-7 examples
- Framework-specific: 3-4 examples
- Custom instrumentation: 4-5 examples
- Troubleshooting: 3-4 examples
- Security: 3-4 examples
- Performance: 5 examples

**Quality guidelines**:

- Use realistic examples (not toy code)
- Show progressive complexity (basic → advanced)
- Include comments explaining key points
- Provide before/after comparisons for optimizations
- Use proper semantic conventions
- Show error handling patterns
- Always use `showLineNumbers` and `title="path/to/file"` attributes
  (see Code Blocks section)

### Scout Integration Strategy

**Balance**: 80% generic OpenTelemetry + 20% Scout-specific

**Scout integration points**:

1. Configuration section: Scout Collector endpoint example
2. Production config: Scout API key handling (optional)
3. Dashboard callouts: 2-3 callout boxes mentioning Scout Dashboard features
4. What's Next: Links to Scout platform features

**Avoid**:

- Heavy vendor lock-in language
- Scout-only configurations
- Marketing speak over technical accuracy

### Content Checklist

Before publishing instrumentation documentation:

- [ ] Title includes primary keyword + value prop + brand
- [ ] Meta description 150-160 chars with benefits
- [ ] 15-20 keyword variations included
- [ ] 20+ code examples minimum
- [ ] 3+ configuration approaches shown
- [ ] Production deployment covered (Docker)
- [ ] Troubleshooting section with 4+ issues
- [ ] FAQ section with 8+ questions
- [ ] Security considerations included
- [ ] Performance impact quantified (ms, %, MB)
- [ ] All internal links verified
- [ ] Build passes (`npm run build-lint`)
- [ ] 800+ lines total length (for competitive ranking)

### Implementation Priority

For rapid iteration, implement sections in this order:

**Phase 1 - Essential** (Week 1): Introduction + Prerequisites + Configuration
(3 approaches) + Production Config + Troubleshooting
→ _Goal: Production-ready documentation (~400-500 lines)_

**Phase 2 - Competitive** (Week 2): Framework features + FAQ + Security +
Performance + Custom instrumentation
→ _Goal: Match competitor depth (~600-700 lines)_

**Phase 3 - Market Leader** (Week 3): Complete example + What's Next +
Additional examples + Optimization
→ _Goal: Market-leading documentation (~800-1000 lines)_

### Example Reference

See `docs/instrument/apps/auto-instrumentation/rails.md` as the reference
implementation of these guidelines.

---

## Resources

- [Docusaurus Documentation](https://docusaurus.io/docs)
- [Markdown Guide](https://www.markdownguide.org/)
- [Prettier](https://prettier.io/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
