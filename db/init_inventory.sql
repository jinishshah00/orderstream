CREATE TABLE IF NOT EXISTS inventory (
  sku TEXT PRIMARY KEY,
  available INT NOT NULL DEFAULT 0,
  reserved  INT NOT NULL DEFAULT 0
);
INSERT INTO inventory (sku, available, reserved)
VALUES ('SKU-1', 100, 0)
ON CONFLICT (sku) DO UPDATE SET available = EXCLUDED.available;
