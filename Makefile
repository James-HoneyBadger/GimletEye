.PHONY: help build engine cli ui package-check test test-rust test-ts fmt fmt-check clippy check \
        typecheck msrv quiet-period surface gates fuzz-nights desktop run smoke doctor clean

CARGO ?= cargo
NPM ?= npm
UI_DIR := apps/desktop
CLI := node packages/cli/dist/main.js

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: engine cli ui ## Build the engine, the CLI, and the UI bundle

engine: ## Build the verified engine
	$(CARGO) build --release -p gimlet-eye-sidecar

cli: ## Build the CLI
	$(NPM) run build

ui: ## Build the desktop UI bundle
	$(NPM) run build:ui -w @gimlet-eye/desktop

package-check: build ## Stage the package and run it the way an install would
	./scripts/check-packaging.sh
	./scripts/check-package-layout.sh

test: test-rust test-ts ## Everything: engine, CLI, and UI

test-rust: ## Run the engine's test suite
	$(CARGO) test -p gimlet-eye-core -p gimlet-eye-crypto -p gimlet-eye-scrub -p gimlet-eye-sidecar

test-ts: ## Run the TypeScript test suites
	$(NPM) test

fmt: ## Format Rust sources
	$(CARGO) fmt --all

fmt-check: ## Verify formatting (what CI runs)
	$(CARGO) fmt --all -- --check

clippy: ## Lint the engine with clippy, warnings as errors
	$(CARGO) clippy -p gimlet-eye-core -p gimlet-eye-crypto -p gimlet-eye-scrub -p gimlet-eye-sidecar --all-targets -- -D warnings

typecheck: ## Type-check every TypeScript package
	$(NPM) run typecheck

check: fmt-check clippy typecheck test ## Everything CI runs

msrv: ## Build every crate on the declared MSRV (what CI's msrv job runs)
	./scripts/check-msrv.sh "$${MSRV:-1.85}"
	$(CARGO) +"$${MSRV:-1.85}" check --workspace --all-targets --locked

quiet-period: ## Verify no frozen surface moved since the last release
	./scripts/check-quiet-period.sh

surface: ## Verify every command and flag is documented as public API
	./scripts/check-public-surface.sh

gates: ## Report whether 1.0 may be cut: every ADR 0006 gate, verified or open
	./scripts/check-release-gates.sh

fuzz-nights: ## Prove the fuzz soak has been green for seven scheduled nights
	./scripts/check-fuzz-nights.sh

desktop: build ## Build the desktop app, engine included
	$(NPM) run build -w @gimlet-eye/desktop

run: build ## Launch the desktop app from this checkout
	./run.sh

doctor: ## Report installation state, including the engine
	$(CLI) doctor

smoke: ## End-to-end check of the CLI against the real engine
	./scripts/smoke.sh

clean: ## Remove build artifacts
	$(CARGO) clean
	rm -rf $(UI_DIR)/dist packages/core/dist packages/cli/dist node_modules
