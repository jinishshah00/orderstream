import { Pool } from "pg";
export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || "postgres://app:app@postgres:5432/orders",
});
