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

## Deployment

Deployment is handled automatically via GitHub Actions when you push to the
`main` branch. See `.github/workflows/deploy.yml` for details.
