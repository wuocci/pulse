# One Postgres (PostGIS + TimescaleDB) on a Hetzner VPS via Docker Compose

Pulse needs geo queries (matching Events to Watches), time series (Conditions and Baselines), and long-running ingest workers (HSL's MQTT stream). That rules out serverless platforms for the core. We run everything as Docker Compose on an existing Hetzner server, with one Postgres that has the PostGIS and TimescaleDB extensions. It's cheap, it runs identically on a laptop, and there's no lock-in. Moving to managed hosting later is a deployment change, not a redesign.
