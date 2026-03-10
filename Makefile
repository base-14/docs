.PHONY: install start dev build serve clean typecheck lint test check help \
	seo-audit-frontmatter seo-audit-headings seo-audit-links seo-audit-all seo-analyze-gsc

# Default target
help:
	@echo "Available targets:"
	@echo "  install    - Install dependencies"
	@echo "  start      - Start development server"
	@echo "  dev        - Alias for start"
	@echo "  build      - Build static site"
	@echo "  serve      - Serve built site locally"
	@echo "  clean      - Clear Docusaurus cache"
	@echo "  typecheck  - Run TypeScript type checking"
	@echo "  lint       - Run markdown linting"
	@echo "  test       - Run tests"
	@echo "  check      - Run all checks (typecheck, lint, build)"
	@echo ""
	@echo "SEO audit targets:"
	@echo "  seo-audit-frontmatter - Audit frontmatter (title, description, keywords)"
	@echo "  seo-audit-headings    - Audit heading structure (H1/H2/H3 hierarchy)"
	@echo "  seo-audit-links       - Audit internal linking (orphans, cross-links)"
	@echo "  seo-audit-all         - Run all SEO audits"
	@echo "  seo-analyze-gsc       - Analyze Google Search Console CSV exports"

install:
	npm install

start:
	npm start

dev: start

build:
	npm run build

serve:
	npm run serve

clean:
	npm run clear

typecheck:
	npm run typecheck

lint:
	npm run markdownlint

test:
	npm test

check: typecheck lint build

# SEO audit targets
seo-audit-frontmatter:
	npx tsx scripts/seo/audit-frontmatter.ts

seo-audit-headings:
	npx tsx scripts/seo/audit-headings.ts

seo-audit-links:
	npx tsx scripts/seo/audit-internal-links.ts

seo-audit-all: seo-audit-frontmatter seo-audit-headings seo-audit-links

seo-analyze-gsc:
	npx tsx scripts/seo/analyze-gsc.ts
