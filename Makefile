.PHONY: help build test fmt fmt-check clippy check msrv quiet-period surface gates fuzz-nights ui-install ui ui-test ui-dev desktop-install desktop pack-check doctor smoke clean

CARGO ?= cargo
UI_DIR := packages/ui
CLI := $(CARGO) run -q -p mellivora-cli --

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the workspace in release mode
	$(CARGO) build --release --workspace

test: ## Run the Rust test suite
	$(CARGO) test --workspace

fmt: ## Format Rust sources
	$(CARGO) fmt --all

fmt-check: ## Verify formatting (what CI runs)
	$(CARGO) fmt --all -- --check

clippy: ## Lint with clippy, warnings as errors
	$(CARGO) clippy --workspace --all-targets -- -D warnings

check: fmt-check clippy test ## Everything CI runs for Rust

msrv: ## Build every target on the declared MSRV (what CI's msrv job runs)
	./scripts/check-msrv.sh "$${MSRV:-1.85}"
	$(CARGO) +"$${MSRV:-1.85}" check --workspace --all-targets --locked

quiet-period: ## Verify no frozen surface moved since the last release
	./scripts/check-quiet-period.sh

surface: ## Verify every command, flag, and route is documented as public API
	./scripts/check-public-surface.sh

gates: ## Report whether 1.0 may be cut: every ADR 0006 gate, verified or open
	./scripts/check-release-gates.sh

fuzz-nights: ## Prove the fuzz soak has been green for seven scheduled nights
	./scripts/check-fuzz-nights.sh

ui-install: ## Install UI dependencies
	cd $(UI_DIR) && npm install

ui: ## Type-check and build the shared UI
	cd $(UI_DIR) && npm run build

ui-test: ## Run the UI unit tests
	cd $(UI_DIR) && npm test

bench: ## Measure scan, strip, and encrypt at 10 MiB and 1 GiB
	$(CARGO) run --release -p mellivora-toolkit --example bench

e2e: ## Drive the UI against a real engine (needs a built bundle)
	cd $(UI_DIR) && npm run e2e

ui-dev: ## Run the UI dev server (needs `make serve` in another terminal)
	cd $(UI_DIR) && npm run dev

desktop-install: ## Install desktop shell dependencies
	cd apps/desktop && npm install

desktop: ui ## Build the desktop app, engine included
	cd apps/desktop && npm run build

pack-check: ## Syntax-check the Perl pack
	perl -c plugins/perlden-pack/pack.pl

doctor: ## Report installation state, including packs
	$(CLI) doctor

serve: ## Serve the API and the built UI on loopback
	$(CLI) serve --ui-dir $(UI_DIR)/dist

claims: ## Run the README examples as written (ADR 0006 Gate 5)
	./scripts/check-readme-claims.sh

smoke: ## End-to-end check of CLI, API, and the Perl pack
	./scripts/smoke.sh

clean: ## Remove build artifacts
	$(CARGO) clean
	rm -rf $(UI_DIR)/dist $(UI_DIR)/node_modules
