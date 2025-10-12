# Blog Post Guidelines

## Quick Checklist

- [ ] Create folder: `blog/YYYY-MM-DD-slug-name/`
- [ ] Add `index.md` with proper frontmatter
- [ ] Add cover image as `cover.png` (or `.jpg`)
- [ ] Use H2 headers (no bold)
- [ ] Add cover image with HTML wrapper
- [ ] Include `<!--truncate-->` marker
- [ ] Format with prettier (80 char limit)
- [ ] Run `npm run markdownlint` and fix errors
- [ ] Verify locally before committing

## File Structure

```plain
blog/
└── YYYY-MM-DD-slug-name/
    ├── index.md
    └── cover.png
```

**Date format**: `YYYY-MM-DD` (publication date)
**Slug**: Short, hyphenated, descriptive URL slug

## Frontmatter Template

```yaml
---
slug: article-slug
title: Article Title Here
authors: [ranjan-sakalley]
tags: [observability, engineering, best-practices]
image: ./cover.png
---
```

**Required fields**: `slug`, `title`, `authors`, `tags`, `image`
**Author**: Use `ranjan-sakalley` or `base14team` from `blog/authors.yml`

## Cover Image

1. **Add HTML wrapper** (required for styling):

```markdown
<!-- markdownlint-disable MD033 -->
<div className="blog-cover">
  <img src={require('./cover.png').default} alt="Article Title" />
</div>
<!-- markdownlint-enable MD033 -->
```

1. **Image specs**:
   - Format: PNG or JPEG
   - Name: `cover.png` or `cover.jpg`
   - Alt text: Match article title

## Content Structure

### Headers

- **Use H2 (`##`)** for main sections
- **No bold** in headers (`## Title` not `## **Title**`)
- **No H1** in content (title is auto-generated from frontmatter)

### Truncate Marker

Add `<!--truncate-->` after the first 1-2 paragraphs for blog listing preview:

```markdown
First paragraph introducing the topic.

<!--truncate-->

Rest of the article continues here...
```

### Line Length

- **80 characters max** for body text
- Tables and code blocks are exempt
- Run prettier to auto-format:

```bash
npx prettier --write --prose-wrap always --print-width 80 "blog/YYYY-MM-DD-slug/index.md"
```

## Quality Checks

### Before Committing

```bash
# Format the article
npx prettier --write --prose-wrap always --print-width 80 "blog/YYYY-MM-DD-slug/index.md"

# Check for lint errors
npm run markdownlint
```

## Example Article

See reference articles:

- `blog/2025-08-12-observability-theatre/index.md`
- `blog/2025-08-18-unified-observability/index.md`

## Authors Configuration

Edit `blog/authors.yml` to add new authors:

```yaml
author-slug:
  name: Full Name
  title: Role at base14
  url: https://base14.io/about
  image_url: /img/blog/authors/author-slug.jpeg
```

Place author images in `/static/img/blog/authors/`
