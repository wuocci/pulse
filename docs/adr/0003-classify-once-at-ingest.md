# The Classifier runs once per Event at ingest, never per client

The original concept had Jev judge relevance and impact for every (event, user) pair. That cost grows with Events × users × regions. Instead, the Classifier (Jev, behind an interface) only structures each Event once, when it is ingested. Impact for a Watch is computed in plain code from geometry, time window, lines and Severity. If the Classifier is unavailable, the Event is published at once with vague Precision and zero confidence, then reclassified in place, so data never waits on the Classifier.
