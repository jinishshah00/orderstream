import pino from "pino";
import { Kafka, logLevel } from "kafkajs";
import { pool, migrate } from "./db.js";
import './otel';

const logger = pino({ name: "order-service" });

const kafka = new Kafka({
  clientId: "order-service",
  brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
  logLevel: logLevel.INFO
});
const consumer = kafka.consumer({ groupId: "order-service" });

type OrderItem = { sku: string; qty: number; price: number };
type OrderCreated = { event:"order.created"; orderId:string; userId:string; items:OrderItem[]; createdAt:string; };
type PaymentAuthorized = { event:"payment.authorized"; orderId:string; amount:number; authorizedAt:string; };
type PaymentFailed = { event:"payment.failed"; orderId:string; reason:string; };
type InventoryReserved = { event:"inventory.reserved"; orderId:string; reservedAt:string; };
type InventoryFailed = { event:"inventory.failed"; orderId:string; reason:string; };

async function handleOrderCreated(msg: OrderCreated) {
  const amount = msg.items.reduce((s, it) => s + it.qty * it.price, 0);
  await pool.query(
    `INSERT INTO orders(id, user_id, status, amount)
     VALUES ($1,$2,'PENDING',$3)
     ON CONFLICT (id) DO NOTHING`,
    [msg.orderId, msg.userId, amount]
  );
  logger.info({ orderId: msg.orderId, amount }, "orders row inserted");
}

async function handlePaymentAuthorized(msg: PaymentAuthorized) {
  await pool.query(`UPDATE orders SET status='PAID', updated_at=now() WHERE id=$1`, [msg.orderId]);
  logger.info({ orderId: msg.orderId }, "order marked PAID");
}

async function handlePaymentFailed(msg: PaymentFailed) {
  await pool.query(
    `UPDATE orders SET status='FAILED', failure_reason=$2, updated_at=now() WHERE id=$1`,
    [msg.orderId, msg.reason]
  );
  logger.info({ orderId: msg.orderId }, "order marked FAILED (payment)");
}

async function handleInventoryReserved(msg: InventoryReserved) {
  await pool.query(
    `UPDATE orders SET status='COMPLETED', updated_at=now() WHERE id=$1`,
    [msg.orderId]
  );
  logger.info({ orderId: msg.orderId }, "order marked COMPLETED");
}

async function handleInventoryFailed(msg: InventoryFailed) {
  await pool.query(
    `UPDATE orders SET status='FAILED', failure_reason=$2, updated_at=now() WHERE id=$1`,
    [msg.orderId, msg.reason]
  );
  logger.info({ orderId: msg.orderId }, "order marked FAILED (inventory)");
}

async function start() {
  await migrate();
  await consumer.connect();
  await consumer.subscribe({ topic: "order.created" });
  await consumer.subscribe({ topic: "payment.authorized" });
  await consumer.subscribe({ topic: "payment.failed" });
  await consumer.subscribe({ topic: "inventory.reserved" });
  await consumer.subscribe({ topic: "inventory.failed" });


  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      const payload = JSON.parse(message.value.toString());
      if (topic === "order.created")        await handleOrderCreated(payload as OrderCreated);
      else if (topic === "payment.authorized") await handlePaymentAuthorized(payload as PaymentAuthorized);
      else if (topic === "payment.failed")  await handlePaymentFailed(payload as PaymentFailed);
      else if (topic === "inventory.reserved") await handleInventoryReserved(payload as InventoryReserved);
      else if (topic === "inventory.failed")   await handleInventoryFailed(payload as InventoryFailed);
    }
  });

  logger.info("order-service running");
}

start().catch((e) => { logger.error(e); process.exit(1); });
