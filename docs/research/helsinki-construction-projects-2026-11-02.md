# Helsinki construction projects as a Source, 2026-11-02

Question: do the City of Helsinki, HSL, Fintraffic or Kaupunkiliikenne publish long-running street, bridge and metro construction projects (location, dates, what they close) in an openly licensed, machine-readable form we could ingest? The trigger was "the Kulosaari bridge renovation", which Pulse does not show.

## Which project is "the Kulosaari bridge"?

There are three, and only one is under way now. Taken from hel.fi pages and a Kaupunkiliikenne press release, all fetched today:

| Project | Status | Affects |
| --- | --- | --- |
| **Hopeasalmentien silta**: the bridge over Itäväylä in Kulosaari, plus repairs to the metro tunnel/deck at its north end | Under way since early Feb 2026. The city originally said Sep 2026. Its news item of 30.10.2026 says the bridge "pysyy suljettuna marraskuun loppuun" (stays closed until the end of November) | The bridge is closed to all traffic. Pedestrians and cyclists go via the Adjutantinpolku underpass, buses 16 and 86N are detoured, and Itäväylä lanes were closed at times. Metro service is not affected |
| **Kulosaarensilta** (road bridge over Kulosaarensalmi): demolish and rebuild | Being planned. Construction is due to start in early 2028 and last about 3.5 years | One lane in each direction plus one walking and cycling side. The metro is not expected to be affected |
| **Kulosaari north metro bridge** repair, plus Kulosaari station renovation | Done during the **Herttoniemi–Hakaniemi metro outage of 3.5.–8.12.2027**, which serves the Junatie metro bridge replacement (2026–2028) | Metro |

The maintainer's description (began about a year ago; affects pedestrians, cyclists, drivers and the metro area) best matches **Hopeasalmentien silta**.

## What was checked (all fetched today unless marked otherwise)

| Candidate | Format / licence | Has the Kulosaari work? | Notes |
| --- | --- | --- | --- |
| kartta.hel.fi `avoindata` WFS GetCapabilities | WFS 2.0, GeoJSON output. CC BY 4.0 according to the HRI dataset | n/a | 300 layers. None is a construction-project layer: nothing named `hanke`, `rakennushanke`, `infrahanke`, `katutyö` or `silta`. The relevant layers are the permit system's: `Kaivuilmoitus_*`, `Aluevuokraus_*`, `Tilapainen_liikennejarjestely_*`, `Lyhyt_maanvuokraus_*`, `Winkki_works`. The global `/ws/geoserver/wfs` returns 401 |
| `avoindata:Kaivuilmoitus_alue` (**already ingested**) | as above. Polygons with `tyo_alkaa`, `tyo_paattyy`, `tyon_tarkoitus`, `osoite`, `status` | **Yes**: `KP2600143-8` "Hopeasalmentien silta, Itäväylä", "Sillan korjaus", 2026-02-02 → **2026-09-30**, status `Käynnissä` | Its end date lags reality: the city says the bridge is closed until the end of November. Pulse's `statusAt` therefore marks it resolved. Its free text logs updated traffic-arrangement plans but does not say what is closed. Also present: `KP2600636-4` Kulosaarensilta resurfacing (one day, 15.10.2026), and the Junatie metro bridge works `KP2600653`/`57`/`59`/`63` (to 2028) |
| `avoindata:Aluevuokraus_alue` (**not ingested**) | same WFS. Same fields as Kaivuilmoitus | **Yes**: `AL2600147-11` "Hopeasalmensillan korjausurakan työmaa-alue", 6 polygons. These include "Itäväylä (oikeanpuoleiset ajokaistat Hopeasalmensillan itä- ja länsipuolella)" (right-hand lanes) 2026-02-02 → 05-05, "Itäväylä (etelään vievä vasen kaista)" (southbound left lane) on 2026-02-26 and 03-17, and the site compound to **2026-11-30** | The only place lane closures show up at all, and only in the free-text `osoite`. Also carries the Junatie metro bridge site areas (`AL2600727-4`, to 2028-08) |
| `avoindata:Tilapainen_liikennejarjestely_alue` (**already ingested**) | same WFS | **No** Hopeasalmentie permit (290 features) | Does carry the Junatie metro bridge bus-terminus arrangements (`LJ2600038-2`, to 2028-08) |
| `avoindata:Winkki_works` | same WFS | No | 2 features, both from 2010–2013. Dead legacy layer |
| HRI CKAN (`hri.fi/data/api/3`), searched for kaivuilmoitus, aluevuokraus, katutyöt, hankkeet, rakennushankkeet, infrahanke, silta | — | — | The only relevant dataset is "Yleisten alueiden tapahtuma- ja maankäyttölupajärjestelmä" (CC BY 4.0, WFS updated several times a day). This is the permit layers above. The "rakennushankkeet" hits are quarterly building statistics with no location or traffic data. `avoindata.fi` now redirects to `avoindata.suomi.fi` |
| hel.fi project page "Kulosaarensillan uusiminen" and the hel.fi news items | HTML only | Yes, as prose | No map, RSS, API or dataset on the page (checked via WebFetch). The prose is the only place that says what is closed and for whom |
| Kaupunkiliikenne press release (STT, 27.8.2026) | HTML only | Kulosaari metro bridge and the 2027 outage | No feed found. The release points to Kaupunkiliikenne's site and newsletter. Not checked further |
| Digitransit HSL `alerts` (GraphQL) | JSON, needs a key | **No**: 26 alerts, none for Hopeasalmentie or routes 16/86N | Only Junatie works appear, indirectly (stop H2551 out of use, route 59). Bus detours like 16's probably live in GTFS static as timetable changes, not alerts (inferred, not verified) |
| Digitraffic `traffic-message/v1` (ROAD_WORK, TRAFFIC_ANNOUNCEMENT, EXEMPTED_TRANSPORT, WEIGHT_RESTRICTION) | JSON / Datex-like. CC BY 4.0 | **No** | 403 road works. The only "Itäväylä" mention is road 103 to Vuosaari. Covers the state network only, as expected |
| Linked Events (`api.hel.fi/linkedevents`) | JSON | No | Cultural events. The only hit was a 2023 webinar |

## Findings

- **No openly published "construction project" dataset exists** for Helsinki streets, bridges or the metro: no project entity with a start, an end and what it closes. Project pages on hel.fi are prose only, and Kaupunkiliikenne publishes press releases.
- The permit system is the only machine-readable trace, and it is fragmentary. One project is split across several permit types (excavation, area lease, traffic arrangement) and many polygons. Its dates are those of the permits, not of the closure. Lane closures appear only as free-text addresses. Work on Kaupunkiliikenne's own property, such as metro bridges, is mostly absent: the dataset notes that permits of other city departments are generally not included.
- Hopeasalmentien silta is in data Pulse already pulls (`KP2600143`), but its permit officially ended on 30.09, so Pulse shows it as resolved while the bridge is still closed.
- Pulse does not ingest `Aluevuokraus_alue`. It holds the Itäväylä lane closures for this project and the site areas of the Junatie metro bridge. Adding it is cheap (same WFS, same fields as Kaivuilmoitus), but most of its rows are skips, scaffolding and hoists, so it needs the Classifier or a text filter (e.g. `ajokaista`, `työmaa-alue`, `urakka`).
- Long, planned metro outages (Herttoniemi–Hakaniemi, 3.5.–8.12.2027) are announced months ahead only in press releases. HSL will presumably publish them as GTFS and alerts closer to the date (inferred).

## Recommendation

There is **no ingestible Source for construction projects**. The best machine-readable candidate is the permit WFS Pulse already uses (`https://kartta.hel.fi/ws/geoserver/avoindata/wfs`, GeoJSON, CC BY 4.0). It does contain the Kulosaari (Hopeasalmentie) work, but with stale end dates and without "what closes".

- **Fallback: a hand-kept Source** of major projects, seeded from hel.fi project pages and Kaupunkiliikenne releases. It should hold geometry, real start and end dates, what is affected (metro, lanes, walking and cycling) and a link. Seed it with Hopeasalmentien silta (to the end of Nov 2026), the Junatie metro bridge (2026–2028), the metro outage of 3.5.–8.12.2027 and Kulosaarensilta (from 2028).
- Optionally add `avoindata:Aluevuokraus_alue` as another permit Source, filtered to large or roadway rows, to pick up lane closures automatically.
- Possibly treat a permit whose text logs extensions (`LISÄYS … lisäaika`) and still says `Käynnissä` past its `tyo_paattyy` as "maybe still ongoing" instead of resolved. This is a judgement call, and it would not have fixed this case: the permit was not extended past 30.09.
