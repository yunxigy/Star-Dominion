import { describe, expect, test } from "vitest";

import { DESKTOP_WORKSPACE_HEIGHT, RESEARCH_GRID_COLUMNS, WORKSPACE_WIDTH } from "./layoutRules";

describe("stock workspace layout", () => {
  test("uses three primary research columns", () => {
    expect(RESEARCH_GRID_COLUMNS).toEqual(["morning", "strategy", "news"]);
  });

  test("uses the available viewport width", () => {
    expect(WORKSPACE_WIDTH).toBe("calc(100% - 24px)");
  });

  test("allows the desktop workspace to extend by roughly one additional viewport", () => {
    expect(DESKTOP_WORKSPACE_HEIGHT).toBe("calc(200dvh - 84px)");
  });
});
