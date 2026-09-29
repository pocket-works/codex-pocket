# Common tasks. Run `make` or `make help` for the list.
#
# Day to day the Codex Pocket menu bar app owns the host (`make app`, then
# open it); `make start` runs the host from source instead. In both modes,
# the Codex app-server is the official daemon, owned by Codex itself.

SHELL := /bin/bash
.DEFAULT_GOAL := help

HOST      := pnpm --filter @codex-pocket/host --silent
WEB       := pnpm --filter @codex-pocket/web --silent
DESKTOP   := pnpm --filter @codex-pocket/desktop --silent
APP       := packages/desktop/release/mac-arm64/Codex Pocket.app
PORT      ?= 7333
POCKET    := $(HOME)/.codex-pocket
LOG       := $(POCKET)/host.log
# pid of whatever is listening on $(PORT)
LISTENER   = $$(lsof -nP -t -iTCP:$(PORT) -sTCP:LISTEN 2>/dev/null | head -1)

.PHONY: help deps build web test typecheck app release-dmg open-app start stop restart \
        status logs pair devices revoke threads info desktop link-desktop \
        unlink-desktop protocol

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

# --- menu bar app ------------------------------------------------------------

app: web ## Build the Codex Pocket menu bar app into packages/desktop/release
	$(DESKTOP) app

release-dmg: web ## Sign, notarize, and verify an Apple silicon DMG locally
	$(DESKTOP) release:dmg

open-app: ## Launch the built menu bar app (it starts the host; quit it to stop)
	open "$(APP)"

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

status: ## Show host, desktop bridge and desktop link status
	@echo "host:      $$( [ -n "$(LISTENER)" ] && echo "running on $(PORT) (pid $(LISTENER))" || echo "not running" )"
	@echo "url:       $$(python3 -c 'import json;print(json.load(open("$(POCKET)/runtime.json"))["publicUrl"])' 2>/dev/null || echo "-")"
	@echo "desktop bridge clients on 7355: $$(lsof -nP -iTCP:7355 2>/dev/null | awk '$$9 ~ /->127.0.0.1:7355/ {print $$1}' | sort | uniq -c | tr '\n' ' ')"
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

desktop: ## Show whether the ChatGPT desktop app is linked, and whether the daemon is ready for it
	@$(HOST) dev desktop

link-desktop: ## Start the independent desktop bridge and share Codex threads (restart ChatGPT after)
	@$(HOST) dev link-desktop

unlink-desktop: ## Revert the desktop app to its private app-server (restart ChatGPT after)
	@$(HOST) dev unlink-desktop

protocol: ## Regenerate protocol types from the installed codex CLI
	pnpm --filter @codex-pocket/protocol generate
