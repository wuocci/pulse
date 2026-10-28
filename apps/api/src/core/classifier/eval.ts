import { writeFileSync } from "node:fs";
import { classifierConfig } from "../../config.ts";
import { type PermitCollection, toPermitItems } from "../adapters/land-use-permits.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { type Answers, QUESTION_IDS } from "./classifier.ts";
import answerKey from "./fixtures/answer-key.json" with { type: "json" };
import permits from "./fixtures/permits.json" with { type: "json" };
import { createJevClassifier } from "./jev.ts";
import { subjectFor } from "./questions.ts";
import { type Graded, isCorrect, type Label, score } from "./score.ts";

// Runs the real Classifier on the recorded notices and grades it against the hand-labelled answer key.
// Calls Jev live, so it is a script rather than a test:
//   pnpm --filter @pulse/api eval:classifier [raw-answers.json]

const config = classifierConfig();
if (!config) throw new Error("Set TYPESAFE_API_KEY to run the Classifier eval.");
const classifier = createJevClassifier(config);

const labels = new Map(answerKey.notices.map((n) => [n.id, n as Record<string, unknown>]));
const now = new Date(`${permits._recorded.at}T12:00:00Z`);
const layers = permits.layers as Record<string, PermitCollection>;

const subjects = fiCapitalRegion.sources.flatMap((source) => {
  const collection = layers[source.layer];
  if (!collection) return [];
  return toPermitItems(collection, { source, timeZone: fiCapitalRegion.timeZone, now }).flatMap((item) => {
    const id = item.event.sources[0]!.id;
    const subject = subjectFor(item, source.permitType);
    return labels.has(id) && subject ? [{ id, ...subject }] : [];
  });
});

// A few calls at a time, to stay polite to the API.
const raw: Record<string, Answers> = {};
for (let i = 0; i < subjects.length; i += 4) {
  await Promise.all(
    subjects.slice(i, i + 4).map(async ({ id, state, questions }) => {
      raw[id] = await classifier.classify(state, questions);
    }),
  );
}
if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(raw, null, 2)}\n`);

const graded: (Graded & { id: string })[] = subjects.flatMap(({ id, questions }) =>
  QUESTION_IDS.filter((q) => questions[q]).map((question) => ({
    id,
    question,
    label: (labels.get(id)![question] ?? null) as Label,
    answer: raw[id]![question],
  })),
);

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "–");
console.log(`${subjects.length} notices, model ${classifier.model}, threshold ${config.threshold}\n`);
console.log("question        labelled  right(any conf)  accepted  right when accepted");
for (const [question, s] of Object.entries(score(graded, config.threshold))) {
  console.log(
    `${question.padEnd(16)}${String(s.labelled).padEnd(10)}${pct(s.correct, s.answered).padEnd(17)}` +
      `${`${s.accepted}/${s.labelled}`.padEnd(10)}${pct(s.acceptedCorrect, s.accepted)}`,
  );
}

console.log("\nBy threshold (accepted / right when accepted), all questions together:");
for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
  const all = Object.values(score(graded, t));
  const accepted = all.reduce((n, s) => n + s.accepted, 0);
  const right = all.reduce((n, s) => n + s.acceptedCorrect, 0);
  const labelled = all.reduce((n, s) => n + s.labelled, 0);
  console.log(`  ${t}: ${accepted}/${labelled} accepted, ${pct(right, accepted)} right`);
}

console.log("\nWrong or below the threshold:");
for (const { id, question, label, answer } of graded) {
  if (label === null || !answer) continue;
  if (isCorrect(label, answer.choice) &&answer.confidence >= config.threshold) continue;
  console.log(`  ${id} ${question}: labelled ${JSON.stringify(label)}, Jev ${answer.choice} @ ${answer.confidence.toFixed(2)}`);
}
