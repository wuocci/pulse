-- drizzle-kit can't express hypertables. The retention policy is set at startup from config.
SELECT create_hypertable('car_park_conditions', by_range('bucket', INTERVAL '7 days'));
