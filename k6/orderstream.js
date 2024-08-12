import http from 'k6/http';
import { check, sleep } from 'k6';

// ---- Config ----
const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const ORDER_PATH = __ENV.ORDER_PATH || '/orders';
const ID_FIELD = __ENV.ID_FIELD || 'orderId';   // your POST returns orderId

export let options = {
  scenarios: {
    steady_orders: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 20, duration: '1m' },
        { target: 40, duration: '2m' },
        { target: 0,  duration: '30s' },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<400'],
  },
};

// ---- Helpers (no external libs) ----
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function tryJson(body) { try { return JSON.parse(body); } catch (e) { return null; } }
function getId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return obj[ID_FIELD] != null ? obj[ID_FIELD] : (obj.id != null ? obj.id : obj.orderId);
}

// ---- Flow ----
function createOrder() {
  const payload = {
    userId: `u-${uuid()}`,
    items: [{ sku: 'SKU-1', qty: (Math.floor(Math.random()*3)+1), price: 129.0 }], // <-- include price
    amount: 129.0,
    currency: 'USD',
  };

  const res = http.post(`${BASE}${ORDER_PATH}`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });

  const body = tryJson(res.body);
  const id = getId(body);

  check(res, {
    'POST is 2xx': r => r.status >= 200 && r.status < 300,
    'returns id': () => id != null,
  });

  return id;
}

function pollOrder(id, tries) {
  tries = tries || 6; // up to ~3s total
  for (let i = 0; i < tries; i++) {
    const r = http.get(`${BASE}${ORDER_PATH}/${id}`);
    // Your API returns 202 while processing; accept 200 or 202
    check(r, { 'GET 2xx': rr => rr.status === 200 || rr.status === 202 });
    if (r.status === 200) break;
    sleep(0.5);
  }
}

export default function () {
  const id = createOrder();
  if (id) pollOrder(id);
  sleep(0.2);
}
