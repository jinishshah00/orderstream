import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || "postgres://app:app@postgres:5432/orders",
});

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders(
      id uuid PRIMARY KEY,
      user_id text NOT NULL,
      status text NOT NULL,
      amount numeric NOT NULL,
      failure_reason text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory(
      sku text PRIMARY KEY,
      stock int NOT NULL
    );
  `);
  // seed inventory
  await pool.query(`INSERT INTO inventory(sku, stock) VALUES ('A',10) ON CONFLICT (sku) DO NOTHING;`);
  await pool.query(`INSERT INTO inventory(sku, stock) VALUES ('B',10) ON CONFLICT (sku) DO NOTHING;`);
  await pool.query(`INSERT INTO inventory(sku, stock) VALUES ('C',10) ON CONFLICT (sku) DO NOTHING;`);
}
