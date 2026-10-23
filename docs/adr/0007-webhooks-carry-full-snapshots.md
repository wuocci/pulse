# Webhooks carry a full Impact snapshot, not just what changed

A webhook fires for two reasons: an Event touching a Watch changed, or a Briefing is due. Either way, the payload contains the Watch's complete current Impact list, the changes since the last delivery, and the reason for sending. A client that missed a delivery recovers from the next one without replaying history. Deliveries are HMAC-signed, retried with backoff and carry a delivery ID, so receiving a duplicate does no harm.
