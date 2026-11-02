import type { HandKeptEntry } from "./index.ts";

// Long-running disruptions in the capital region that no feed carries, read by hand from the publishers' pages
// (docs/research/helsinki-construction-projects-2026-11-02.md). Re-check each by its `checked` date; when it's over,
// leave it: its end date resolves it.
export const handKept: HandKeptEntry[] = [
  {
    // In the dig permits as KP2600143, but with a permit end (30.9.) the work has overrun.
    id: "hopeasalmentien-silta-2026",
    kind: "works",
    title: {
      en: "Bridge closed · Hopeasalmentien silta, Kulosaari",
      fi: "Silta suljettu · Hopeasalmentien silta, Kulosaari",
    },
    // The bridge deck, across Itäväylä (from the permit's area).
    where: {
      geometry: { type: "LineString", coordinates: [[24.99445, 60.18555], [24.9947, 60.186], [24.9946, 60.18625]] },
      precision: "exact",
    },
    when: { start: "2026-02-02T00:00:00+02:00", end: "2026-11-30T23:59:59+02:00" },
    // Not major: a drive along Itäväylä passes under it (lanes closed at times), and a match can't tell over from
    // under. On foot or by bike it's in the way either way.
    severity: "consider",
    mainlyAffected: "everyone",
    noticeable: ["blocked"],
    originalText: {
      en: "The bridge is closed to all traffic while it's repaired. On foot or by bike, use the Adjutantinpolku underpass. Buses 16 and 86N take a detour. Lanes on Itäväylä under the bridge are closed at times.",
      fi: "Silta on suljettu kaikelta liikenteeltä korjauksen ajan. Jalankulku ja pyöräily Adjutantinpolun alikulun kautta. Bussit 16 ja 86N kulkevat poikkeusreittiä. Itäväylän kaistoja sillan alla suljetaan ajoittain.",
    },
    readFrom: "City of Helsinki news, 30 Oct 2026: closed until the end of November",
    checked: "2026-11-02",
  },
];
