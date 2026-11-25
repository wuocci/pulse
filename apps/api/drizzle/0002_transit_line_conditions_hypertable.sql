-- Custom SQL migration file, put your code below! --
-- drizzle-kit can't express hypertables. The retention policy is set at startup from config.
CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint
SELECT create_hypertable('transit_line_conditions', by_range('bucket', INTERVAL '7 days'));
