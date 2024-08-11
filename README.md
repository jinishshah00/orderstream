# OrderStream — Event-Driven Order Processing (Kafka + Node + Postgres + Redis)

A minimal, production-style demo of an **event-driven** backend:
- REST API to create/get orders
- Kafka topics orchestrate workflow
- Postgres persistence; Redis read-through cache
- Backoff **retries + DLQ**
- All dockerized with **Docker Compose**

## Architecture
```mermaid
flowchart LR
  A[API Gateway] -->|order.created| K[(Kafka)]
  K --> P[payment-worker]
  P -->|payment.authorized / payment.failed| K
  K --> I[inventory-worker]
  I -->|inventory.reserved / inventory.failed| K
  K --> O[order-service]
  O -->|update| DB[(Postgres)]
  A -- GET /orders --> R[(Redis)] & DB
