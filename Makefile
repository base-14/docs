.PHONY: install start dev build serve clean typecheck lint test check help

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

check:
	npm run build-lint
