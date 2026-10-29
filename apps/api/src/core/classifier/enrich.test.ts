import type { Event } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import excavations from "../adapters/fixtures/land-use-permits/excavations.json" with { type: "json" };
import { type PermitCollection, type PermitItem, toPermitItems } from "../adapters/land-use-permits.ts";
import { InMemoryEventStore } from "../events/store.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { isPermitSource } from "../regions/index.ts";
import type { AnswerCache, CacheKey } from "./cache.ts";
import { cacheKey } from "./cache.ts";
import type { Answers, Classifier, ClassifierState, Questions } from "./classifier.ts";
import { Classification } from "./enrich.ts";
import { subjectFor } from "./questions.ts";

const source = fiCapitalRegion.sources.filter(isPermitSource).find((s) => s.permitType === "excavation")!;
const { timeZone } = fiCapitalRegion;
const now = new Date("2026-10-24T12:00:00+03:00");
const later = new Date("2026-10-24T12:10:00+03:00");
const itemsAt = (at: Date): PermitItem[] => toPermitItems(excavations as PermitCollection, { source, timeZone, now: at });
const DIG = "hel-excavations:KP2602791-2";

const answers: Answers = {
  workType: { choice: "water_sewer", confidence: 0.95 },
  endDate: { choice: "2026-11-13", confidence: 0.9 },
  mainlyAffected: { choice: "drivers", confidence: 0.8 },
};

// Answers every text the same way, counts what it was asked, and can be made to fail or to wait.
function fakeClassifier({ fail = false } = {}) {
  const asked: ClassifierState[] = [];
  let running = 0;
  let maxRunning = 0;
  const classifier: Classifier & { asked: ClassifierState[]; maxRunning: () => number } = {
    model: "fake-1",
    asked,
    maxRunning: () => maxRunning,
    async classify(state: ClassifierState, questions: Questions) {
      asked.push(state);
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      if (fail) throw new Error("Jev is down");
      return Object.fromEntries(Object.entries(answers).filter(([id]) => id in questions));
    },
  };
  return classifier;
}

class MemoryCache implements AnswerCache {
  rows = new Map<string, Answers>();
  private id = ({ stateHash, questionVersion, model }: CacheKey) => `${stateHash}|${questionVersion}|${model}`;
  async getMany(stateHashes: string[], questionVersion: number, model: string) {
    const found = new Map<string, Answers>();
    for (const stateHash of stateHashes) {
      const hit = this.rows.get(this.id({ stateHash, questionVersion, model }));
      if (hit) found.set(stateHash, hit);
    }
    return found;
  }
  async put(key: CacheKey, value: Answers) {
    if (!this.rows.has(this.id(key))) this.rows.set(this.id(key), value);
  }
}

function setup(classifier = fakeClassifier(), concurrency?: number) {
  const store = new InMemoryEventStore();
  const cache = new MemoryCache();
  const classification = new Classification({ classifier, cache, store, threshold: 0.6, concurrency, clock: () => later });
  // One refresh, as the scheduler runs it: prepare, store, then classify the rest in the background.
  const refresh = async (items = itemsAt(now), at = now) => {
    const { events, classifyRest } = await classification.prepare(source, items, { timeZone, now: at });
    await store.replaceSource(source.id, events);
    return { events, done: classifyRest() };
  };
  const stored = async (id: string) => (await store.query({})).find((e) => e.id === id)!;
  return { store, cache, classifier, refresh, stored };
}

describe("Classification", () => {
  it("publishes uncached Events unclassified at once, then patches in the answers", async () => {
    const { refresh, stored, cache } = setup();

    const { events, done } = await refresh();
    expect(events.find((e) => e.id === DIG)).toMatchObject({ confidence: 0, mainlyAffected: "unknown" });

    await done;
    expect(await stored(DIG)).toMatchObject({ workType: "water_sewer", mainlyAffected: "drivers", confidence: 0.8 });
    expect((await stored(DIG)).updatedAt).toBe(later.toISOString());
    expect(cache.rows.size).toBe(itemsAt(now).length);
  });

  it("applies cached answers at once, without asking the Classifier", async () => {
    const { refresh, cache, classifier } = setup();
    for (const item of itemsAt(now)) {
      await cache.put(cacheKey(subjectFor(item, "excavation")!.state, classifier.model), answers);
    }

    const { events, done } = await refresh();
    await done;

    expect(events.find((e) => e.id === DIG)).toMatchObject({ workType: "water_sewer", confidence: 0.8 });
    expect(classifier.asked).toHaveLength(0);
  });

  it("never sends the same text twice, even while the first answer is on its way", async () => {
    const { refresh, classifier, stored } = setup();
    const count = itemsAt(now).length;

    const first = await refresh();
    const second = await refresh(itemsAt(later));
    await Promise.all([first.done, second.done]);
    // The second refresh's Event gets the answer of the call already on its way.
    expect(await stored(DIG)).toMatchObject({ workType: "water_sewer", updatedAt: later.toISOString() });
    await (await refresh()).done;

    expect(classifier.asked).toHaveLength(count);
  });

  it("keeps the Event unclassified and caches nothing when the Classifier fails, so the next refresh retries", async () => {
    const classifier = fakeClassifier({ fail: true });
    const { refresh, stored, cache } = setup(classifier);
    const count = itemsAt(now).length;

    await (await refresh()).done;
    expect(await stored(DIG)).toMatchObject({ confidence: 0, mainlyAffected: "unknown" });
    expect(cache.rows.size).toBe(0);

    await (await refresh()).done;
    expect(classifier.asked).toHaveLength(2 * count);
  });

  it("doesn't overwrite an Event that a newer refresh replaced meanwhile", async () => {
    const { refresh, store, stored } = setup();

    const { done } = await refresh();
    const newer: Event[] = itemsAt(later).map((i) => ({ ...i.event, title: { en: "Newer", fi: "Uudempi" } }));
    await store.replaceSource(source.id, newer);
    await done;

    expect(await stored(DIG)).toMatchObject({ title: { en: "Newer" }, confidence: 0 });
  });

  it("recalculates the status when the text's end date fills an empty end", async () => {
    // The dig started on 2026-10-29; without an end it is active, with the text's end of 11-13 it's over.
    const afterwards = new Date("2026-11-20T12:00:00+02:00");
    const { refresh, cache, classifier } = setup();
    const items = itemsAt(afterwards).map((item) => {
      if (item.event.id !== DIG) return item;
      const { end: _, ...when } = item.event.when;
      // As the Adapter makes a dig with no end: active from its start.
      return { ...item, event: { ...item.event, when, status: "active" as const } };
    });
    const dig = items.find((i) => i.event.id === DIG)!;
    await cache.put(cacheKey(subjectFor(dig, "excavation")!.state, classifier.model), {
      endDate: { choice: "2026-11-13", confidence: 0.9 },
    });

    const { events } = await refresh(items, afterwards);

    expect(events.find((e) => e.id === DIG)).toMatchObject({ when: { end: "2026-11-13T23:59:59+02:00" }, status: "resolved" });
  });

  it("takes the Source's rule end days into account", async () => {
    const { refresh, cache, classifier } = setup();
    const items = itemsAt(now).map((item) =>
      item.event.id === DIG ? { ...item, event: { ...item.event, when: { ...item.event.when, end: "2027-05-14T23:59:59+03:00" } } } : item,
    );
    const dig = items.find((i) => i.event.id === DIG)!;
    await cache.put(cacheKey(subjectFor(dig, "excavation")!.state, classifier.model), answers);

    const { events } = await refresh(items);

    expect(events.find((e) => e.id === DIG)!.when).not.toHaveProperty("endConflict");
  });

  it("asks at most `concurrency` texts at a time", async () => {
    const classifier = fakeClassifier();
    const { refresh } = setup(classifier, 2);

    await (await refresh()).done;

    expect(classifier.maxRunning()).toBe(2);
  });
});
