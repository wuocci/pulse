# Source records are append-only; Events are derived state

Every version of every item a Source publishes is stored as an append-only Source record. Events and their change logs are derived from those records. That lets us re-run improved Adapters or a better Classifier over history, explain any webhook after the fact, and send meaningful changes ("end date moved from 14 Nov to 28 Nov") instead of bare snapshots. Raw records can expire after a retention period.
