import { describe, expect, it } from "vitest";
import {
  abortError,
  formatFetchError,
  formatFetchErrorWithCauseDetails,
  sleep,
  sleepWithAbort,
  throwIfAborted,
} from "../index.js";

function abortedSignal(reason?: unknown): AbortSignal {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
}

describe("abortError", () => {
  it("returns the reason itself when it is an Error", () => {
    const reason = new Error("stop");
    expect(abortError(abortedSignal(reason), "fallback")).toBe(reason);
  });

  it("uses a string reason as the message", () => {
    const err = abortError(abortedSignal("user cancelled"), "fallback");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("user cancelled");
  });

  it("returns the default AbortError reason when abort() has no argument", () => {
    const err = abortError(abortedSignal(), "Jina search aborted");
    expect(err.name).toBe("AbortError");
  });

  it("falls back to the caller message for non-Error, non-string reasons", () => {
    expect(abortError(abortedSignal(42), "Jina search aborted").message).toBe("Jina search aborted");
    expect(abortError(abortedSignal(null), "fetch_page aborted").message).toBe("fetch_page aborted");
  });

  it("falls back to the caller message for an undefined signal", () => {
    expect(abortError(undefined, "request aborted").message).toBe("request aborted");
  });
});

describe("throwIfAborted", () => {
  it("does nothing for a live or missing signal", () => {
    expect(() => throwIfAborted(undefined, "x")).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal, "x")).not.toThrow();
  });

  it("throws the abort error when aborted", () => {
    expect(() => throwIfAborted(abortedSignal(42), "Bing search aborted")).toThrow("Bing search aborted");
  });
});

describe("sleep", () => {
  it("resolves after roughly the requested delay", async () => {
    const start = Date.now();
    await sleep(40);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("sleepWithAbort", () => {
  it("resolves after the delay when not aborted", async () => {
    const start = Date.now();
    await sleepWithAbort(40, undefined, "aborted");
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const start = Date.now();
    await expect(sleepWithAbort(5000, abortedSignal(42), "Brave Search aborted")).rejects.toThrow("Brave Search aborted");
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("rejects when the signal fires mid-wait", async () => {
    const controller = new AbortController();
    const pending = sleepWithAbort(5000, controller.signal, "DeepSeek API request aborted");
    setTimeout(() => controller.abort(new Error("stop now")), 20);
    await expect(pending).rejects.toThrow("stop now");
  });

  it("resolves normally on an already-aborted signal when rejectIfAlreadyAborted is false", async () => {
    await expect(sleepWithAbort(10, abortedSignal(42), "Bocha search aborted", { rejectIfAlreadyAborted: false })).resolves.toBeUndefined();
  });

  it("resolves immediately for non-positive delays when immediateWhenNonPositive is set", async () => {
    await expect(sleepWithAbort(0, abortedSignal(42), "Bocha search aborted", {
      immediateWhenNonPositive: true,
      rejectIfAlreadyAborted: false,
    })).resolves.toBeUndefined();
  });
});

describe("formatFetchError", () => {
  it("stringifies non-Error values", () => {
    expect(formatFetchError("nope")).toBe("nope");
    expect(formatFetchError(42)).toBe("42");
  });

  it("formats an Error without a cause", () => {
    expect(formatFetchError(new TypeError("bad"))).toBe("TypeError: bad");
  });

  it("appends the cause message when present", () => {
    const cause = new Error("connection refused");
    expect(formatFetchError(new Error("fetch failed", { cause }))).toBe("Error: fetch failed; cause=connection refused");
  });
});

describe("formatFetchErrorWithCauseDetails", () => {
  it("matches formatFetchError when there is no Error cause", () => {
    expect(formatFetchErrorWithCauseDetails("nope")).toBe("nope");
    expect(formatFetchErrorWithCauseDetails(new TypeError("bad"))).toBe("TypeError: bad");
  });

  it("includes code, syscall and hostname from the cause", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND example.com"), {
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname: "example.com",
    });
    expect(formatFetchErrorWithCauseDetails(new Error("fetch failed", { cause })))
      .toBe("Error: fetch failed; cause=ENOTFOUND getaddrinfo example.com getaddrinfo ENOTFOUND example.com");
  });

  it("falls back to the bare cause message without system metadata", () => {
    expect(formatFetchErrorWithCauseDetails(new Error("fetch failed", { cause: new Error("boom") })))
      .toBe("Error: fetch failed; cause=boom");
  });
});
