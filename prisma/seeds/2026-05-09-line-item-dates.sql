-- One-time backfill: per-line pickup/return dates on sr_order_line_items.
--
-- Brief's sample referenced sr_orders.pickup_date / return_date — those
-- columns don't exist in this schema (sr_orders uses start_date/end_date).
-- The vestigial sr_order_line_items.start_date / end_date pair is checked
-- first since some legacy data has them populated.

ALTER TABLE sr_order_line_items
  ADD COLUMN IF NOT EXISTS pickup_date DATE,
  ADD COLUMN IF NOT EXISTS return_date DATE;

UPDATE sr_order_line_items oli
SET pickup_date = COALESCE(
      oli.start_date,
      (SELECT o.start_date FROM sr_orders o WHERE o.id = oli.order_id),
      CURRENT_DATE
    ),
    return_date = COALESCE(
      oli.end_date,
      (SELECT o.end_date FROM sr_orders o WHERE o.id = oli.order_id),
      CURRENT_DATE + INTERVAL '1 day'
    )
WHERE pickup_date IS NULL OR return_date IS NULL;

ALTER TABLE sr_order_line_items
  ALTER COLUMN pickup_date SET NOT NULL,
  ALTER COLUMN return_date SET NOT NULL;
