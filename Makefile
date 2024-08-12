# Simple DX for OrderStream
SHELL := /bin/bash
COMPOSE ?= docker compose
BASE_URL ?= http://localhost:3000

.PHONY: dev up down logs ps clean restart
dev up:
	$(COMPOSE) up --build -d
down:
	$(COMPOSE) down -v
restart:
	$(COMPOSE) down && $(COMPOSE) up --build -d
logs:
	$(COMPOSE) logs -f --tail=200
ps:
	$(COMPOSE) ps
clean:
	$(COMPOSE) down -v --remove-orphans

# Observability (requires docker-compose.observability.yml)
.PHONY: ob-up ob-down
ob-up:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.observability.yml up -d otel-collector jaeger
ob-down:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.observability.yml down -v otel-collector jaeger

# k6 load tests
.PHONY: k6 k6-quick
k6:
	k6 run k6/orderstream.js --env BASE_URL=$(BASE_URL)
k6-quick:
	k6 run k6/orderstream.js --vus 5 --duration 30s --env BASE_URL=$(BASE_URL)
