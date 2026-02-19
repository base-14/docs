# base14 Scout Documentation

This website is built using [Docusaurus](https://docusaurus.io/), a modern
static website generator.

## Prerequisites

- Node.js >= 24.0
- npm (comes with Node.js)
- make (optional, for convenience commands)

## Quick Start

```bash
make install   # Install dependencies
make start     # Start development server
```

Or using npm directly:

```bash
npm install
npm start
```

## Available Commands

| Make Command    | npm Equivalent        | Description                          |
|-----------------|-----------------------|--------------------------------------|
| `make install`  | `npm install`         | Install dependencies                 |
| `make start`    | `npm start`           | Start development server             |
| `make dev`      | `npm start`           | Alias for start                      |
| `make build`    | `npm run build`       | Build static site                    |
| `make serve`    | `npm run serve`       | Serve built site locally             |
| `make clean`    | `npm run clear`       | Clear Docusaurus cache               |
| `make typecheck`| `npm run typecheck`   | Run TypeScript type checking         |
| `make lint`     | `npm run markdownlint`| Run markdown linting                 |
| `make test`     | `npm test`            | Run tests                            |
| `make check`    | `npm run build-lint`  | Run all checks (typecheck, lint, build) |

Run `make help` to see all available targets.

## Setup

Install the required packages:

```bash
make install
```

Install pre-commit hooks (optional):

```bash
# First install pre-commit tool: https://pre-commit.com/
pre-commit install
```

## Development

Start the local development server:

```bash
make start
```

This command starts a local development server and opens a browser window.
Most changes are reflected live without having to restart the server.

## Testing & Linting

Run TypeScript type checking:

```bash
make typecheck
```

Run markdown linting:

```bash
make lint
```

Run all checks and build:

```bash
make check
```

Run tests:

```bash
make test
```

## Build

Build the static site:

```bash
make build
```

This generates static content into the `build` directory.

Serve the build locally:

```bash
make serve
```

## Contributing

### Adding Documentation

See [DOCS_GUIDELINES.md](./DOCS_GUIDELINES.md) for comprehensive guidelines on
adding documentation articles.

### Adding Blog Posts

See [BLOG_GUIDELINES.md](./BLOG_GUIDELINES.md) for guidelines on adding blog
posts.

## LLM-Friendly Markdown Output

The build generates individual markdown files for each doc page alongside the
HTML output, using `docusaurus-plugin-llms`. These are discoverable via
`/llms.txt` following the [llmstxt.org](https://llmstxt.org) standard.

### Patch: docusaurus-plugin-llms

We patch `docusaurus-plugin-llms@0.3.0` via `patch-package` to fix two bugs:

1. `preserveDirectoryStructure` option was not passed to the plugin context,
   so setting it to `false` had no effect.
2. `siteUrl` construction produced a double slash (`//`) when `baseUrl` is `/`.

The patch is at `patches/docusaurus-plugin-llms+0.3.0.patch` and is applied
automatically on `npm install` via the `postinstall` script. Remove this patch
once these fixes land upstream.

## Deployment

Deployment is handled automatically via GitHub Actions when you push to the
`main` branch. See `.github/workflows/deploy.yml` for details.
