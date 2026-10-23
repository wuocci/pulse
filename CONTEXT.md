# Pulse

Pulse tells people what's different today around their places and trips, compared to normal. It collects public data (transit, roads, weather, city works) into one region-agnostic API. The Pulse app is the first client of that API.

## Language

### What the world tells us

**Source**:
A publisher of public data that Pulse reads, such as HSL, Fintraffic Digitraffic, FMI or the City of Helsinki.
_Avoid_: Provider, feed (a feed is one channel of a Source)

**Region**:
A named area that Pulse covers, with its Sources, default timezone, languages and attribution texts. Events don't belong to a Region; matching is by geometry only.
_Avoid_: City, market, area

**Coverage**:
Which Layers are available at a given point, so clients can tell "nothing is happening" apart from "we don't know about this place".

**Adapter**:
The part of Pulse that reads one data standard (GTFS-RT, DATEX II, CAP) or one non-standard Source and produces Events or Conditions.
_Avoid_: Scraper, connector, integration

**Source record**:
One item exactly as a Source published it, kept as an append-only version. Events are derived from Source records.
_Avoid_: Raw event, message

**Condition**:
A continuous measurement of how something is flowing, such as a road segment's average speed or a transit line's delay. Conditions are internal and never shown to clients directly.
_Avoid_: Metric, reading, sample

**Baseline**:
The normal value of a Condition for a given weekday and time of day.
_Avoid_: Average, typical, norm

### What Pulse publishes

**Event**:
Something with a place and a time window that may change how people move or live around it, such as works, a closure, a transit disruption, a weather warning or an Anomaly.

**Public event**:
An Event where people gather, such as a concert, a marathon or a market. It is a kind of Event, not a synonym for one.
_Avoid_: "event" on its own when you mean this

**Cluster**:
A group of Events from different Sources that share one real-world cause, such as a permit, a lane closure and a tram diversion all caused by the same dig. The Events stay separate; the Cluster only links them.
_Avoid_: Merged event, duplicate

**Anomaly**:
An Event that Pulse creates when a Condition deviates significantly from its Baseline. No Source reports it directly.
_Avoid_: Spike, incident

**Severity**:
How disruptive an Event is in general, independent of any particular person: info, minor, consider or major.

**Precision**:
How exactly an Event's location is known: exact, segment, area or vague.

**Layer**:
One of the three questions Pulse answers: My trips, My area or Right now.

### What clients ask about

**Watch**:
A client's standing request to be told about Events that affect a given geometry and time window, delivered by webhook. A Watch carries no user identity.
_Avoid_: Subscription, alert rule

**Place**:
A saved location that a Watch covers, such as a home, workplace or daycare.

**Trip**:
A journey from A to B with a travel mode and either a departure or an arrival time. A one-off "Where to?" lookup is a Trip.
_Avoid_: Commute, journey, route (a route is one way to make a Trip)

**Routine**:
A saved Trip with a recurring schedule in a local timezone. Only Routines get Watches and Briefings.
_Avoid_: Commute, saved trip, recurring trip

**Usual route**:
One of the one to three typical itineraries for a Routine at its scheduled time, or the one the user pinned. Events are matched against Usual routes.
_Avoid_: Default route, normal route

**Impact**:
How much an Event matters for one specific Watch, Place or Trip. Unlike Severity, Impact depends on who is asking.

**Briefing**:
A scheduled webhook to a Routine's Watch shortly before departure (45 minutes by default), sent even if nothing has changed.
_Avoid_: Digest, morning check

**Classifier**:
The step that turns a Source's free text into structured Event fields (where, when, lines, stops, Severity). It runs once per Event, never once per client.
_Avoid_: Jev (Jev is the current implementation, not the concept)
