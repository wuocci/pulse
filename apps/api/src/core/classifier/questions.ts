import type { Event, MainlyAffected, Severity, WorkType } from "@pulse/schema";
import type { PermitItem } from "../adapters/land-use-permits.ts";
import type { LandUsePermitSource } from "../regions/index.ts";
import { type ChoiceQuestion, type ClassifierState, NOT_STATED, type Questions } from "./classifier.ts";

// The questions the Classifier is asked, per permit-system layer. Findings behind them:
// docs/research/jev-probe-2026-10-23.md and jev-ranking-probe-2026-10-24.md.
// Only questions the text can answer: digs aren't asked Severity (the text can't tell how much street a dig takes).

// Part of the cache key. Bump it whenever a question, its choices or the state sent changes,
// which deliberately invalidates every cached answer.
export const QUESTION_VERSION = 1;

type PermitType = LandUsePermitSource["permitType"];

// What to send the Classifier about one Event, and what to ask it.
export interface Subject {
  state: ClassifierState;
  questions: Questions;
}

const severity: ChoiceQuestion = {
  prompt: "How disruptive is this in general, for anyone moving around the area?",
  choices: {
    info: "Barely noticeable; good to know at most",
    minor: "A small local nuisance, such as a reserved parking spot or a narrowed sidewalk",
    consider: "Worth planning around, such as a closed lane, a detour or crowds",
    major: "A large disruption, such as closed streets, big crowds or diverted transit",
  } satisfies Record<Severity, string>,
};

const mainlyAffected: ChoiceQuestion = {
  prompt: "Who does this mainly get in the way of?",
  // "unknown" is the fallback when no answer counts, never a choice.
  choices: {
    drivers: "People driving: closed lanes, detours, slower traffic",
    cyclists: "People cycling: closed bike lanes or paths",
    pedestrians: "People walking: closed sidewalks, crowds on foot",
    transit: "Public transport: moved stops, diverted routes",
    parking: "People parking: reserved or banned parking spaces",
    everyone: "Everyone moving around the area",
    nobody: "Hardly anyone: the work stays off the street",
  } satisfies Record<Exclude<MainlyAffected, "unknown">, string>,
};

const workType: ChoiceQuestion = {
  prompt: "What kind of work is this excavation for?",
  choices: {
    water_sewer: "Water supply, sewers or storm water",
    district_heating: "District heating or cooling",
    electricity_telecom: "Electricity, telecom or other cables",
    paving: "Resurfacing or paving",
    street_construction: "Building or rebuilding a street",
    building_site: "Space for a building site, such as a crane or a site fence",
    other: "Something else, or the text doesn't say",
  } satisfies Record<WorkType, string>,
};

// The text's current end date, chosen among the dates code found in it.
function endDate(dates: string[]): ChoiceQuestion {
  return {
    prompt:
      "When does the work end according to the text? If the text records changes to the dates, use the latest change. " +
      "The date a change was written on is not an end date.",
    choices: { ...Object.fromEntries(dates.map((d) => [d, null])), [NOT_STATED]: "The text gives no end date" },
  };
}

const NOTICE: Record<PermitType, string> = {
  excavation: "Excavation notice from the city's permit system",
  "traffic-arrangement": "Temporary traffic arrangement permit from the city's permit system",
  "outdoor-event": "Outdoor event permit from the city's permit system",
};

// The Subject for one permit Event, or null when it has no text to classify.
// The Adapter's facts (category, full address, …) go into the state but never onto the Event.
export function subjectFor({ event, facts }: PermitItem, permitType: PermitType): Subject | null {
  const text = event.originalText?.fi;

  if (permitType === "excavation") {
    // The title holds the city's end date, so a dig's state is its own text only: the end date question compares the two.
    if (!text) return null;
    const dates = candidateDates(text);
    return {
      state: { notice: NOTICE[permitType], ...facts, text },
      questions: { workType, ...(dates.length ? { endDate: endDate(dates) } : {}), mainlyAffected },
    };
  }

  const days = durationDays(event);
  const title = event.title.fi;
  if (!title) return null;
  return {
    state: {
      notice: NOTICE[permitType],
      ...facts,
      title,
      ...(text ? { text } : {}),
      ...(days ? { durationDays: days } : {}),
    },
    questions: { severity, mainlyAffected },
  };
}

// Calendar dates in the text, as YYYY-MM-DD, in text order and each once: Finnish d.m.yyyy (also "d.m. yyyy")
// and ISO yyyy-mm-dd. A date without a year ("05.10. - 23.10.2026") takes the year of the next full date in the
// text, and is skipped when there is none.
export function candidateDates(text: string): string[] {
  const found = [...text.matchAll(/(?<![\d.])(?:(\d{1,2})\.(\d{1,2})\.(?: ?(\d{4}))?|(\d{4})-(\d{2})-(\d{2}))(?!\d)/g)].map(
    (m) => (m[2] ? { year: m[3], month: m[2], day: m[1]! } : { year: m[4], month: m[5]!, day: m[6]! }),
  );
  const dates = new Set<string>();
  found.forEach(({ year, month, day }, i) => {
    const y = year ?? found.slice(i + 1).find((later) => later.year)?.year;
    if (!y) return;
    const date = `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (isRealDate(date)) dates.add(date);
  });
  return [...dates];
}

function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// Calendar days from the Event's first to its last day, both included.
function durationDays(event: Event): number | undefined {
  if (!event.when.end) return undefined;
  const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((day(event.when.end) - day(event.when.start)) / 86_400_000) + 1;
}
