#!/usr/bin/env bash
set -e
OID=$(curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","items":[{"sku":"A","qty":1,"price":5.5}]}' | jq -r .orderId)
echo "orderId=$OID"
sleep 2
docker exec -it order-system-postgres-1 psql -U app -d orders -c \
"select id,status,failure_reason,amount from orders where id='$OID';"
