import type { Event } from "@pulse/schema";
import { type PermitItem, statusAt } from "../adapters/land-use-permits.ts";
import type { EventStore } from "../events/store.ts";
import type { LandUsePermitSource } from "../regions/index.ts";
import { type AnswerCache, type CacheKey, cacheKey } from "./cache.ts";
import { type Answers, applyAnswers, type Classifier, type ClassifierState, type Questions } from "./classifier.ts";
import { QUESTION_VERSION, subjectFor } from "./questions.ts";

// The Classifier step of a refresh (ADR 0003): data never waits on the Classifier.
// Cached texts get their answers at once. The rest are published unclassified and asked in the background;
// their answers go to the cache and are patched into the stored Event.
// The refresh loop is the queue: a failed text stays uncached, so the next refresh retries it.
// No pg-boss yet: ADR 0008's job queue comes in when Watch matching or webhooks need durable jobs.

export interface ClassificationDeps {
  classifier: Classifier;
  cache: AnswerCache;
  store: EventStore;
  threshold: number;
  // The most Classifier requests at once, across all Sources.
  concurrency?: number;
  clock?: () => Date;
}

interface Pending {
  // The Event as published, unclassified.
  event: Event;
  state: ClassifierState;
  questions: Questions;
  key: CacheKey;
}

export class Classification {
  // Texts being asked right now, by state hash. A refresh meanwhile waits for the same answer instead of asking again.
  private inFlight = new Map<string, Promise<Answers>>();
  private running = 0;
  private waiting: (() => void)[] = [];
  private readonly concurrency: number;
  private readonly clock: () => Date;

  constructor(private readonly deps: ClassificationDeps) {
    this.concurrency = deps.concurrency ?? 6;
    this.clock = deps.clock ?? (() => new Date());
  }

  // The Events to publish now, and a function that classifies the rest once they are stored.
  async prepare(
    source: LandUsePermitSource,
    items: PermitItem[],
    { timeZone, now }: { timeZone: string; now: Date },
  ): Promise<{ events: Event[]; classifyRest: () => Promise<void> }> {
    const { classifier, cache, threshold } = this.deps;
    const subjects = items.map((item) => {
      const subject = subjectFor(item, source.permitType);
      return subject && { ...subject, key: cacheKey(subject.state, classifier.model) };
    });
    const hashes = [...new Set(subjects.flatMap((s) => (s ? [s.key.stateHash] : [])))];
    const cached = await cache.getMany(hashes, QUESTION_VERSION, classifier.model);

    const pending: Pending[] = [];
    const events = items.map(({ event }, i) => {
      const subject = subjects[i];
      if (!subject) return event;
      const answers = cached.get(subject.key.stateHash);
      if (answers) return classified(event, subject.questions, answers, { threshold, timeZone, now });
      pending.push({ event, ...subject });
      return event;
    });
    return { events, classifyRest: () => this.classifyAll(source.id, pending, timeZone) };
  }

  // Never rejects: it runs in the background, and failures only mean the next refresh tries again.
  private async classifyAll(sourceId: string, pending: Pending[], timeZone: string): Promise<void> {
    const results = await Promise.allSettled(pending.map((job) => this.classifyOne(sourceId, job, timeZone)));
    const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
    if (failures.length) {
      const first = failures[0] instanceof Error ? failures[0].message : String(failures[0]);
      console.error(`${sourceId}: classifying ${failures.length} of ${pending.length} texts failed, retrying next refresh:`, first);
    }
  }

  private async classifyOne(sourceId: string, job: Pending, timeZone: string): Promise<void> {
    const { stateHash } = job.key;
    let asking = this.inFlight.get(stateHash);
    if (!asking) {
      asking = this.ask(job);
      this.inFlight.set(stateHash, asking);
      void asking.finally(() => this.inFlight.delete(stateHash)).catch(() => {});
    }
    const answers = await asking;

    const now = this.clock();
    const next = classified(job.event, job.questions, answers, { threshold: this.deps.threshold, timeZone, now });
    await this.deps.store.replaceEvent(sourceId, job.event, { ...next, updatedAt: now.toISOString() });
  }

  // The Classifier's answers, cached. Rejects when the Classifier fails; a failed cache write only means asking again later.
  private async ask({ state, questions, key }: Pending): Promise<Answers> {
    const answers = await this.limited(() => this.deps.classifier.classify(state, questions));
    await this.deps.cache.put(key, answers).catch((error: unknown) => {
      console.error("Caching Classifier answers failed:", error instanceof Error ? error.message : error);
    });
    return answers;
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    while (this.running >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

// The Event with the accepted answers. A text end date can fill an empty end, so the status is worked out again.
function classified(
  event: Event,
  questions: Questions,
  answers: Answers,
  { threshold, timeZone, now }: { threshold: number; timeZone: string; now: Date },
): Event {
  const next = applyAnswers(event, questions, answers, { threshold, timeZone });
  return next.when.end === event.when.end ? next : { ...next, status: statusAt(now, next.when.start, next.when.end) };
}
