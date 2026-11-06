# The Classifier runs once per Event at ingest, never per client

The original concept had Jev judge relevance and impact for every (event, user) pair. That cost grows with Events × users × regions. Instead, the Classifier (Jev, behind an interface) only structures each Event once, when it is ingested. Impact for a Watch is computed in plain code from geometry, time window, lines and Severity. If the Classifier is unavailable, the Event is published at once with vague Precision and zero confidence, then reclassified in place, so data never waits on the Classifier.

## Amendment 2026-10-23: choose, don't extract; only where structure is missing

Jev answers typed questions (choice, score, yes/no) about text; it doesn't produce free-form values. Code finds the candidates (dates by regex, lines from the Source's own line list) and the Classifier picks among them, so it can never invent a value. Probes on live data (see `docs/research/jev-probe-2026-10-23.md`) showed it is reliable for this and costs about $0.03 per 1000 items. The Classifier is only used where a Source lacks structure: Helsinki excavation notices, yes; HSL alerts (Digitransit already gives affected lines and stops) and Digitraffic roadworks (already carry severity and restriction types), no. Questions the text can't answer, such as traffic impact of an excavation, are not asked; that comes from structured data or from Impact rules.

## Amendment 2026-11-04: an event's Severity is its crowd

Events from the outdoor-event permits and the Linked Events calendar are asked one thing for Severity: are 1,000 or more people there at once at the busiest moment, or fewer? 1,000 or more is worth considering; fewer is minor. The calendar's times and place are structure, but how many come isn't: its capacity is what the organiser typed, often the whole building (a museum's date night says 5,000), so the calendar goes through the Classifier too, with the capacity as a fact. Until the answer counts, a venue for 5,000 or more stays worth considering. Two choices on purpose: offered bands up to "over 20,000", Jev split its confidence between the big ones and stayed under the threshold even on Tuomaan markkinat; asked the one line that matters, it answered 0.94. Traffic arrangements keep the Severity question: their disruption is the street they take, not a crowd.

## Amendment 2026-11-04: a dig's Severity is how loud it is

Digs still aren't asked Severity: the text can't tell how much street a dig takes. But it names the kind of work, so the Classifier is asked whether it's loud enough to hear from inside nearby homes day after day (rock blasting, piling, demolition, building a street or tramline) or ordinary (a cable trench, a connection, a repair). Loud is worth considering even when no street is blocked; ordinary stays minor, as does any dig the Classifier is unsure about.
