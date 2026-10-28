import { describe, expect, it } from "vitest";

import { resolveWorkerConfig } from "./config";

const validEnvironment = {
  GEMINI_API_KEY: "gemini-test-secret",
  SITE_PUSH_TOKEN: "site-test-secret",
  MANUAL_TRIGGER_TOKEN: "manual-test-secret",
  SITE_API_URL: "https://reports.example.test/reports-api/api/v1/ingest/x",
};

describe("resolveWorkerConfig", () => {
  it("uses the confirmed Gemini model and FxTwitter base URL defaults", () => {
    const config = resolveWorkerConfig(validEnvironment);

    expect(config.geminiModel).toBe("gemini-2.5-flash");
    expect(config.fxTwitterBaseUrl).toBe("https://api.fxtwitter.com");
  });

  it("rejects non-HTTPS provider and site endpoints", () => {
    expect(() =>
      resolveWorkerConfig({
        ...validEnvironment,
        FXTWITTER_BASE_URL: "http://api.fxtwitter.com",
      }),
    ).toThrow(/HTTPS/i);

    expect(() =>
      resolveWorkerConfig({
        ...validEnvironment,
        SITE_API_URL: "http://reports.example.test/ingest",
      }),
    ).toThrow(/HTTPS/i);
  });

  it("fails closed when a required secret is missing without echoing secrets", () => {
    let message = "";
    try {
      resolveWorkerConfig({
        ...validEnvironment,
        SITE_PUSH_TOKEN: "",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/SITE_PUSH_TOKEN/i);
    expect(message).not.toContain(validEnvironment.GEMINI_API_KEY);
    expect(message).not.toContain(validEnvironment.MANUAL_TRIGGER_TOKEN);
  });
});
