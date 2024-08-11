import express from "express";
import pino from "pino";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { createKafka } from "./kafka.js";
import { pool } from "./db.js";
import { redis } from "./cache.js";

const logger = pino({ name: "api-gateway" });
const app = express();
app.use(express.json());

const kafka = createKafka("api-gateway");
const producer = kafka.producer();

const OrderSchema = z.object({
  userId: z.string(),
  items: z.array(z.object({
    sku: z.string(),
    qty: z.number().int().positive(),
    price: z.number().positive()
  })).min(1)
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/orders", async (req, res) => {
  const parsed = OrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const orderId = uuid();
  const payload = {
    event: "order.created",
    orderId,
    userId: parsed.data.userId,
    items: parsed.data.items,
    createdAt: new Date().toISOString()
  };

  try {
    // publish event
    await producer.send({ topic: "order.created", messages: [{ key: orderId, value: JSON.stringify(payload) }] });
    logger.info({ orderId }, "published order.created");
    return res.status(201).json({ orderId });
  } catch (err) {
    logger.error({ err }, "publish failed");
    return res.status(500).json({ error: "publish_failed" });
  }
});

app.get("/orders/:id", async (req, res) => {
  const id = req.params.id;
  const key = `order:${id}`;

  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));

  const q = await pool.query(
    `SELECT id, user_id, status, amount, failure_reason, created_at, updated_at FROM orders WHERE id = $1`,
    [id]
  );

  if (q.rowCount === 0) return res.status(202).json({ id, status: "PROCESSING" });

  const row = q.rows[0];
  await redis.setex(key, 30, JSON.stringify(row));
  return res.json(row);
});

const port = Number(process.env.PORT || 3000);

async function start() {
  await producer.connect();
  app.listen(port, () => logger.info(`api-gateway on :${port}`));
}
start().catch((e) => { logger.error(e); process.exit(1); });
