import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const ORDER_PATH = __ENV.ORDER_PATH || '/orders';
const ID_FIELD = __ENV.ID_FIELD || 'id';

export const options = { vus: 1, iterations: 1 };

function tryJson(b){ try{ return JSON.parse(b); } catch(e){ return null; } }

export default function () {
  const payload = JSON.stringify({
    userId: 'u-smoke',
    items: [{ sku: 'SKU-1', qty: 1, price: 129.0 }],
    amount: 129.0, currency: 'USD'
  });

  const res = http.post(`${BASE}${ORDER_PATH}`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  console.log('POST status:', res.status);
  console.log('POST body:', res.body);

  const obj = tryJson(res.body);
  const id = obj && (obj[ID_FIELD] ?? obj.id ?? obj.orderId);
  check(res, { '2xx': r => r.status >= 200 && r.status < 300, 'has id': _ => !!id });

  if (id) {
    const g = http.get(`${BASE}${ORDER_PATH}/${id}`);
    console.log('GET status:', g.status);
    console.log('GET body:', g.body);
    check(g, { 'GET 200': r => r.status === 200 });
  }
  sleep(0.2);
}
