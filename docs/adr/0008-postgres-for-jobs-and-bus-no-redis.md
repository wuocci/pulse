# Postgres handles jobs and live fan-out; no Redis for now

Durable work (classify, match Watches, deliver webhooks, Briefings, nightly Baselines) runs on pg-boss, a job queue that lives in Postgres. Live fan-out to streaming clients uses Postgres LISTEN/NOTIFY. Because jobs sit in the same database as the data, a job is committed in the same transaction as the Event that triggers it, with no outbox and no lost jobs. Our volume is a few thousand Events a day; the HSL realtime stream is aggregated in memory and never becomes individual jobs. Both sit behind small `Jobs` and `Bus` interfaces. Redis is reconsidered for the Bus only once we run more than one API instance.

## Considered options

- Redis pub/sub: fire-and-forget, so messages are lost while a worker is down. Wrong for durable work.
- BullMQ on Redis: durable, but needs an outbox table to avoid losing jobs between a Postgres commit and a Redis enqueue, plus an extra service.
