import { describe, expect, it, vi } from "vitest";
import { AcademicAugmentedSearchProvider, arxivQueryForAcademicSearch } from "../providers/academic.js";
import type { SearchHit, SearchProvider } from "../providers/types.js";

const hit = (url: string, title = url): SearchHit => ({ url, title, snippet: "" });

describe("AcademicAugmentedSearchProvider", () => {
  it("runs web and academic search for a literature-shaped query", async () => {
    const web = provider("web", [hit("https://example.com/web")]);
    const academic = provider("arxiv", [hit("https://arxiv.org/abs/1902.00870")]);
    const combined = new AcademicAugmentedSearchProvider({ web, academic });

    await expect(combined.search("Kaniewski 2019 robust self-testing paper", 5)).resolves.toHaveLength(2);
    expect(web.search).toHaveBeenCalledWith("Kaniewski 2019 robust self-testing paper", 5, {});
    expect(academic.search).toHaveBeenCalledWith(
      'au:Kaniewski AND all:"robust self-testing"',
      5,
      {},
    );
  });

  it("keeps ordinary web queries off the academic provider", async () => {
    const web = provider("web", [hit("https://example.com/weather")]);
    const academic = provider("arxiv", []);
    const combined = new AcademicAugmentedSearchProvider({ web, academic });

    await expect(combined.search("上海今日天气", 3)).resolves.toHaveLength(1);
    expect(web.search).toHaveBeenCalledOnce();
    expect(academic.search).not.toHaveBeenCalled();
  });

  it("interleaves sources and deduplicates canonical URLs", async () => {
    const web = provider("web", [
      hit("https://example.com/web-1"),
      hit("https://arxiv.org/abs/1902.00870?utm_source=search#abstract", "duplicate"),
      hit("https://example.com/web-2"),
    ]);
    const academic = provider("arxiv", [
      hit("https://arxiv.org/abs/1902.00870"),
      hit("https://arxiv.org/abs/1512.02074"),
    ]);
    const combined = new AcademicAugmentedSearchProvider({ web, academic });

    await expect(combined.search("quantum self-testing protocol paper", 4)).resolves.toEqual([
      hit("https://example.com/web-1"),
      hit("https://arxiv.org/abs/1902.00870"),
      hit("https://arxiv.org/abs/1512.02074"),
      hit("https://example.com/web-2"),
    ]);
  });

  it.each(["web", "academic"] as const)("keeps %s results when the other source fails", async (survivor) => {
    const ok = provider(survivor, [hit(`https://example.com/${survivor}`)]);
    const failed: SearchProvider = {
      name: "failed",
      search: vi.fn(async () => { throw new Error("unavailable"); }),
    };
    const combined = new AcademicAugmentedSearchProvider({
      web: survivor === "web" ? ok : failed,
      academic: survivor === "academic" ? ok : failed,
    });

    await expect(combined.search("device-independent quantum protocol paper", 3)).resolves.toEqual([
      hit(`https://example.com/${survivor}`),
    ]);
  });

  it("rejects promptly when cancelled even if a child provider does not settle", async () => {
    const controller = new AbortController();
    const never: SearchProvider = {
      name: "never",
      search: vi.fn(async () => await new Promise<SearchHit[]>(() => undefined)),
    };
    const combined = new AcademicAugmentedSearchProvider({ web: never, academic: never });
    const pending = combined.search("quantum self-testing paper", 3, { signal: controller.signal });
    controller.abort("cancel academic search");

    await expect(pending).rejects.toThrow("cancel academic search");
  });
});

describe("arxivQueryForAcademicSearch", () => {
  it("uses an author adjacent to a year without mistaking the title for an author", () => {
    expect(arxivQueryForAcademicSearch("Robust self-testing Kaniewski 2019 paper")).toBe(
      'au:Kaniewski AND all:"robust self-testing"',
    );
    expect(arxivQueryForAcademicSearch("2019 Kaniewski robust self-testing paper")).toBe(
      'au:Kaniewski AND all:"robust self-testing"',
    );
  });

  it("converts an ordinary academic query and preserves explicit arXiv syntax", () => {
    expect(arxivQueryForAcademicSearch("device-independent quantum key distribution paper")).toBe(
      'all:"device-independent quantum key distribution"',
    );
    expect(arxivQueryForAcademicSearch('au:Kaniewski AND all:"self-testing"')).toBe(
      'au:Kaniewski AND all:"self-testing"',
    );
    expect(arxivQueryForAcademicSearch("上海今日天气")).toBeUndefined();
  });

  it("keeps discriminating self-testing facets instead of truncating them", () => {
    expect(arxivQueryForAcademicSearch("Mermin inequality self-testing original paper")).toBe(
      'all:"self-testing" AND all:Mermin',
    );
    expect(arxivQueryForAcademicSearch("self-testing CHSH Mermin parallel graph states paper")).toBe(
      'all:"self-testing" AND (all:Mermin OR all:CHSH OR all:parallel OR all:"graph state")',
    );
    expect(arxivQueryForAcademicSearch("self-testing delegated quantum computing verification")).toBe(
      '(all:"delegated quantum computation" OR all:"verified quantum computation" OR ti:"classical command of quantum systems")',
    );
    expect(arxivQueryForAcademicSearch("Mayers Yao 1998 self-testing quantum state")).toBe(
      "au:Mayers AND au:Yao",
    );
    expect(arxivQueryForAcademicSearch("tilted CHSH Mayers-Yao self-testing paper")).toBe(
      'all:"self-testing" AND (all:CHSH OR all:"tilted CHSH" OR all:"Mayers-Yao")',
    );
  });
});

function provider(name: string, hits: SearchHit[]): SearchProvider {
  return { name, search: vi.fn(async () => hits) };
}
