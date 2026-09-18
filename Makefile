# Common tasks. Run `make` or `make help` for the list.
#
# Development runs the host with tsx straight from source (`make start`);
# production uses the built CLI under launchd (`make install`).

SHELL := /bin/bash
.DEFAULT_GOAL := help

HOST      := pnpm --filter @codex-pocket/host --silent
WEB       := pnpm --filter @codex-pocket/web --silent
CLI       := node packages/host/dist/cli.js
PORT      ?= 7333
POCKET    := $(HOME)/.codex-pocket
LOG       := $(POCKET)/host.log
# pid of whatever is listening on $(PORT)
LISTENER   = $$(lsof -nP -t -iTCP:$(PORT) -sTCP:LISTEN 2>/dev/null | head -1)

.PHONY: help deps build web test typecheck start stop restart status logs \
        pair devices revoke threads info desktop link-desktop unlink-desktop \
        install uninstall tls-status tls-issue protocol

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

deps: ## Install dependencies
	pnpm install

build: ## Build every package (host CLI + web PWA)
	pnpm -s build

web: ## Rebuild only the web PWA (serve picks it up on next page load)
	$(WEB) build

test: ## Run all tests
	pnpm -s test

typecheck: ## Type-check all packages
	pnpm -s typecheck

# --- running the host (development, from source) ---------------------------

start: web ## Start the host in the background on $(PORT) (dev mode, from source)
	@if [ -n "$(LISTENER)" ]; then echo "port $(PORT) already in use (pid $(LISTENER)); use make restart"; exit 1; fi
	@mkdir -p $(POCKET)
	@cd packages/host && { nohup pnpm -s dev serve --port $(PORT) > $(LOG) 2>&1 < /dev/null & }
	@sleep 4; grep -v '^\[47m\|^$$' $(LOG) | tail -5

stop: ## Stop the background host
	@if pkill -f "dev serve --port $(PORT)" 2>/dev/null; then echo "stopped"; else echo "host not running"; fi
	@sleep 1

restart: stop start ## Restart the background host

status: ## Show host, shared app-server and desktop link status
	@echo "host:      $$( [ -n "$(LISTENER)" ] && echo "running on $(PORT) (pid $(LISTENER))" || echo "not running" )"
	@echo "url:       $$(python3 -c 'import json;print(json.load(open("$(POCKET)/runtime.json"))["publicUrl"])' 2>/dev/null || echo "-")"
	@echo "app-server clients on 7355: $$(lsof -nP -iTCP:7355 2>/dev/null | awk '$$9 ~ /->127.0.0.1:7355/ {print $$1}' | sort | uniq -c | tr '\n' ' ')"
	@$(HOST) dev desktop

logs: ## Follow the host log
	tail -f $(LOG)

# --- phones -----------------------------------------------------------------

pair: ## Print a QR code to pair a new phone
	@$(HOST) dev pair

devices: ## List paired phones
	@$(HOST) dev devices

revoke: ## Revoke a phone: make revoke ID=<device id>
	@test -n "$(ID)" || { echo "usage: make revoke ID=<device id>"; exit 1; }
	@$(HOST) dev revoke $(ID)

# --- codex ------------------------------------------------------------------

threads: ## List recent Codex threads
	@$(HOST) dev threads

info: ## Show app-server connection details
	@$(HOST) dev info

desktop: ## Show whether the ChatGPT desktop app is linked to the shared app-server
	@$(HOST) dev desktop

link-desktop: ## Point the ChatGPT desktop app at the shared app-server (restart ChatGPT after)
	@$(HOST) dev link-desktop

unlink-desktop: ## Revert the desktop app to its private app-server (restart ChatGPT after)
	@$(HOST) dev unlink-desktop

# --- production / launchd -----------------------------------------------------

install: build ## Build and install the launchd agent (host runs at login)
	$(CLI) install

uninstall: ## Remove the launchd agent
	$(CLI) uninstall

tls-status: ## Show certificate status
	@$(HOST) dev tls status

tls-issue: ## Request or renew the certificate now
	@$(HOST) dev tls issue

protocol: ## Regenerate protocol types from the installed codex CLI
	pnpm --filter @codex-pocket/protocol generate
