import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Questions } from "./classifier.ts";
import { JevClassifier } from "./jev.ts";

// A real SDK client over a stubbed fetch: checks what goes over the wire without calling Jev.
function stubbedJev(respond: (body: unknown) => Response) {
  const requests: { url: string; body: unknown }[] = [];
  const client = new TypeSafeClient({
    apiKey: "test-key",
    compression: false,
    retry: { maxRetries: 0 },
    logLevel: "off",
    fetch: async (url, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      requests.push({ url, body });
      return respond(body);
    },
  });
  return { jev: new JevClassifier(client, "jev-1.13.0"), requests };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const questions: Questions = {
  severity: { prompt: "How disruptive?", choices: { minor: "Small", major: null } },
  endDate: { prompt: "When does it end?", choices: { "2026-11-13": null, not_stated: "No date" } },
};

describe("JevClassifier", () => {
  it("asks each question as a choice, with the pinned model", async () => {
    const { jev, requests } = stubbedJev(() =>
      json({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }),
    );
    await jev.classify({ notice: "Excavation notice", text: "Vesijohtotyö." }, questions);

    expect(jev.model).toBe("jev-1.13.0");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/\/v1\/systemone$/);
    expect(requests[0]!.body).toEqual({
      model: "jev-1.13.0",
      state: { notice: "Excavation notice", text: "Vesijohtotyö." },
      questions: {
        severity: { type: "choice", instructions: "How disruptive?", criteria: { minor: "Small", major: null } },
        endDate: { type: "choice", instructions: "When does it end?", criteria: { "2026-11-13": null, not_stated: "No date" } },
      },
    });
  });

  it("returns each answer's choice and confidence", async () => {
    const { jev } = stubbedJev(() =>
      json({
        model: "jev-1.13.0",
        answers: {
          severity: { type: "choice", choice: "major", confidence: 0.91, probabilities: { minor: 0.09, major: 0.91 } },
          endDate: { type: "choice", choice: "not_stated", confidence: 0.8, probabilities: {} },
        },
        usage: { input_tokens: 600, output_tokens: 0 },
      }),
    );

    expect(await jev.classify({ text: "x" }, questions)).toEqual({
      severity: { choice: "major", confidence: 0.91 },
      endDate: { choice: "not_stated", confidence: 0.8 },
    });
  });

  it("drops answers that aren't choices or are missing", async () => {
    const { jev } = stubbedJev(() =>
      json({ model: "jev-1.13.0", answers: { severity: { type: "noul", noul: 0.9 } }, usage: {} }),
    );

    expect(await jev.classify({ text: "x" }, questions)).toEqual({});
  });

  it("rejects when Jev fails, so the text stays uncached and is retried", async () => {
    const { jev } = stubbedJev(() => json({ error: "overloaded" }, 503));

    await expect(jev.classify({ text: "x" }, questions)).rejects.toThrow();
  });
});
