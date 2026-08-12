import { describe, expect, test } from "vitest";

import { CATALYST_SCORE_THRESHOLD, filterCatalystCandidates, isAuthenticatedResponse } from "./viewRules";

const candidate = (score: number) => ({ total_score: score }) as never;

describe("stock workspace view rules", () => {
  test("keeps only cat research candidates strictly above 55", () => {
    expect(CATALYST_SCORE_THRESHOLD).toBe(55);
    expect(filterCatalystCandidates([candidate(55), candidate(55.1), candidate(80)])).toHaveLength(2);
  });

  test("only accepts successful session responses", () => {
    expect(isAuthenticatedResponse(200)).toBe(true);
    expect(isAuthenticatedResponse(204)).toBe(true);
    expect(isAuthenticatedResponse(401)).toBe(false);
    expect(isAuthenticatedResponse(500)).toBe(false);
  });
});
