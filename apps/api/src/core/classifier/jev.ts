import { type ChoiceQuestion as JevChoice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { ClassifierConfig } from "../../config.ts";
import { type Answers, type Classifier, type ClassifierState, QUESTION_IDS, type Questions } from "./classifier.ts";

// The Classifier on Jev (TypeSafe's `systemOne`): each of our questions is a Jev choice question.
// Failures reject, so the caller leaves the text uncached and the next refresh retries it.
export class JevClassifier implements Classifier {
  constructor(
    private readonly client: Pick<TypeSafeClient, "systemOne">,
    readonly model: string,
  ) {}

  async classify(state: ClassifierState, questions: Questions): Promise<Answers> {
    const asked: Record<string, JevChoice> = {};
    for (const id of QUESTION_IDS) {
      const question = questions[id];
      if (question) asked[id] = { type: "choice", instructions: question.prompt, criteria: question.choices };
    }
    const { answers } = await this.client.systemOne({ state, questions: asked, model: this.model });

    const result: Answers = {};
    for (const id of QUESTION_IDS) {
      const answer = answers[id];
      if (answer?.type === "choice") result[id] = { choice: answer.choice, confidence: answer.confidence };
    }
    return result;
  }
}

export function createJevClassifier({ apiKey, model }: ClassifierConfig): JevClassifier {
  return new JevClassifier(new TypeSafeClient({ apiKey, defaultModel: model }), model);
}
