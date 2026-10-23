# Events from different Sources are linked into Clusters, never merged

The same real-world cause, for example one dig, often shows up as several Events: Helsinki's permit, a Digitraffic lane closure and an HSL tram diversion. Each carries facts the others lack. Merging them into one Event would lose those facts, and a wrong merge would be hard to undo. So each Event stays separate and keeps its own Source and confidence, and a Cluster links them. A wrong link is simply removed. Deduplication for webhooks and pushes happens per Cluster.
