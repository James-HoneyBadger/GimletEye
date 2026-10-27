.PHONY: help build cli ui package-check test typecheck check quiet-period surface gates \
        desktop run smoke doctor clean

NPM ?= npm
UI_DIR := apps/desktop
CLI := node packages/cli/dist/main.js

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: cli ui ## Build the CLI and the UI bundle

cli: ## Build every package and the CLI
	$(NPM) run build

ui: ## Build the desktop UI bundle
	$(NPM) run build:ui -w @gimlet-eye/desktop

package-check: build ## Stage the package and run it the way an install would
	./scripts/check-packaging.sh
	./scripts/check-package-layout.sh

test: ## Run the test suites
	$(NPM) test

typecheck: ## Type-check every TypeScript package
	$(NPM) run typecheck

check: typecheck test ## Everything CI runs before the gates
	./scripts/check-public-surface.sh
	./scripts/check-tool-reference.sh
	./scripts/check-readme-claims.sh

quiet-period: ## Verify no frozen surface moved since the last release
	./scripts/check-quiet-period.sh

surface: ## Verify every command and flag is documented as public API
	./scripts/check-public-surface.sh

gates: ## Report whether 1.0 may be cut: every ADR 0006 gate, verified or open
	./scripts/check-release-gates.sh

desktop: build ## Build the desktop app
	$(NPM) run build -w @gimlet-eye/desktop

run: build ## Launch the desktop app from this checkout
	./run.sh

doctor: ## Report installation state
	$(CLI) doctor

smoke: ## End-to-end check of the CLI
	./scripts/smoke.sh

clean: ## Remove build artifacts
	rm -rf $(UI_DIR)/dist packages/core/dist packages/engine/dist packages/cli/dist node_modules
