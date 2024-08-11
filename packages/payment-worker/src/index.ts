import pino from "pino";
import { Kafka, logLevel } from "kafkajs";

const logger = pino({ name: "payment-worker" });

const kafka = new Kafka({
  clientId: "payment-worker",
  brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
  logLevel: logLevel.INFO
});
const consumer = kafka.consumer({ groupId: "payment-worker" });
const producer = kafka.producer();

// env knobs (you can tweak in docker-compose)
const SUCCESS_RATE = Number(process.env.PAYMENT_SUCCESS_RATE || 0.8); // 80% succeed
const THROW_RATE   = Number(process.env.PAYMENT_THROW_RATE || 0.05);  // 5% throw to trigger retry
const BACKOFFS_MS = [2000, 5000, 15000]; // retry 1/2/3

type OrderItem = { sku: string; qty: number; price: number };
type OrderCreated = {
  event: "order.created";
  orderId: string; userId: string; items: OrderItem[]; createdAt: string;
  retry?: number;
};

function random() { return Math.random(); }
function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function processOrderCreated(msg: OrderCreated) {
  // simulate transient error (to exercise retry)
  if (random() < THROW_RATE) {
    throw new Error("transient_payment_service_error");
  }

  const amount = msg.items.reduce((s, it) => s + it.qty * it.price, 0);
  if (random() < SUCCESS_RATE) {
    await producer.send({
      topic: "payment.authorized",
      messages: [{ key: msg.orderId, value: JSON.stringify({
        event: "payment.authorized", orderId: msg.orderId, amount, items: msg.items, authorizedAt: new Date().toISOString()
      })}]
    });
    logger.info({ orderId: msg.orderId, amount }, "payment authorized");
  } else {
    await producer.send({
      topic: "payment.failed",
      messages: [{ key: msg.orderId, value: JSON.stringify({
        event: "payment.failed", orderId: msg.orderId, reason: "DECLINED"
      })}]
    });
    logger.info({ orderId: msg.orderId }, "payment declined");
  }
}

async function handleWithRetry(payload: OrderCreated) {
  try {
    await processOrderCreated(payload);
  } catch (err) {
    const retry = (payload.retry ?? 0) + 1;
    if (retry >= 4) {
      await producer.send({
        topic: "order.created.dlq",
        messages: [{ key: payload.orderId, value: JSON.stringify({ ...payload, retry }) }]
      });
      logger.error({ orderId: payload.orderId, retry }, "sent to DLQ");
      return;
    }
    await producer.send({
      topic: "order.created.retry",
      messages: [{ key: payload.orderId, value: JSON.stringify({ ...payload, retry }) }]
    });
    logger.warn({ orderId: payload.orderId, retry }, "sent to retry");
  }
}

async function requeueFromRetry(payload: OrderCreated) {
  const retry = payload.retry ?? 1;
  const backoff = BACKOFFS_MS[Math.min(retry - 1, BACKOFFS_MS.length - 1)];
  logger.warn({ orderId: payload.orderId, retry, backoff }, "retrying after backoff");
  await delay(backoff);
  await producer.send({
    topic: "order.created",
    messages: [{ key: payload.orderId, value: JSON.stringify(payload) }]
  });
}

async function start() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "order.created" });
  await consumer.subscribe({ topic: "order.created.retry" });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      const payload = JSON.parse(message.value.toString()) as OrderCreated;
      if (topic === "order.created")       await handleWithRetry(payload);
      else if (topic === "order.created.retry") await requeueFromRetry(payload);
    }
  });

  logger.info("payment-worker running");
}

start().catch((e) => { logger.error(e); process.exit(1); });
