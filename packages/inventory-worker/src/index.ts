import pino from "pino";
import { Kafka, logLevel } from "kafkajs";
import { Pool } from "pg";

const logger = pino({ name: "inventory-worker" });

const kafka = new Kafka({
  clientId: "inventory-worker",
  brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
  logLevel: logLevel.INFO
});
const consumer = kafka.consumer({ groupId: "inventory-worker" });
const producer = kafka.producer();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || "postgres://app:app@postgres:5432/orders",
});

// retry params
const BACKOFFS_MS = [2000, 5000, 15000];

type Item = { sku: string; qty: number; price: number };
type PaymentAuthorized = {
  event: "payment.authorized";
  orderId: string;
  amount: number;
  items: Item[];
  authorizedAt: string;
  retry?: number;
};

function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function reserveStock(items: Item[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // check
    for (const it of items) {
      const r = await client.query("SELECT stock FROM inventory WHERE sku=$1 FOR UPDATE", [it.sku]);
      const stock = r.rowCount ? (r.rows[0].stock as number) : 0;
      if (stock < it.qty) throw new Error(`OUT_OF_STOCK:${it.sku}`);
    }
    // decrement
    for (const it of items) {
      await client.query("UPDATE inventory SET stock = stock - $2 WHERE sku=$1", [it.sku, it.qty]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function processAuthorized(msg: PaymentAuthorized) {
  await reserveStock(msg.items);
  await producer.send({
    topic: "inventory.reserved",
    messages: [{ key: msg.orderId, value: JSON.stringify({
      event: "inventory.reserved", orderId: msg.orderId, reservedAt: new Date().toISOString()
    })}]
  });
  logger.info({ orderId: msg.orderId }, "inventory reserved");
}

async function handleWithRetry(payload: PaymentAuthorized) {
  try {
    await processAuthorized(payload);
  } catch (err: any) {
    const retry = (payload.retry ?? 0) + 1;
    if (String(err?.message || "").startsWith("OUT_OF_STOCK")) {
      await producer.send({
        topic: "inventory.failed",
        messages: [{ key: payload.orderId, value: JSON.stringify({
          event: "inventory.failed", orderId: payload.orderId, reason: "OUT_OF_STOCK"
        })}]
      });
      logger.warn({ orderId: payload.orderId }, "inventory failed: OUT_OF_STOCK");
      return;
    }
    if (retry >= 4) {
      await producer.send({
        topic: "inventory.reserved.dlq",
        messages: [{ key: payload.orderId, value: JSON.stringify({ ...payload, retry }) }]
      });
      logger.error({ orderId: payload.orderId, retry }, "sent to DLQ");
      return;
    }
    await producer.send({
      topic: "inventory.reserved.retry",
      messages: [{ key: payload.orderId, value: JSON.stringify({ ...payload, retry }) }]
    });
    logger.warn({ orderId: payload.orderId, retry }, "sent to retry");
  }
}

async function requeueFromRetry(payload: PaymentAuthorized) {
  const retry = payload.retry ?? 1;
  const backoff = BACKOFFS_MS[Math.min(retry - 1, BACKOFFS_MS.length - 1)];
  logger.warn({ orderId: payload.orderId, retry, backoff }, "retrying after backoff");
  await delay(backoff);
  await producer.send({
    topic: "payment.authorized",
    messages: [{ key: payload.orderId, value: JSON.stringify(payload) }]
  });
}

async function start() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "payment.authorized" });
  await consumer.subscribe({ topic: "inventory.reserved.retry" });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      const payload = JSON.parse(message.value.toString()) as PaymentAuthorized;
      if (topic === "payment.authorized")       await handleWithRetry(payload);
      else if (topic === "inventory.reserved.retry") await requeueFromRetry(payload);
    }
  });
  logger.info("inventory-worker running");
}

start().catch((e) => { logger.error(e); process.exit(1); });
