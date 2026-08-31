import { describe, expect, it } from "vitest";
import { assessSourceQuality, assessSourceUrlPolicy, calibrateSourceQualityScore, inferSourceTier } from "../source-quality.js";
import { verifiedSourcePublishedAt } from "../source-store.js";

describe("source quality filters", () => {
  it("keeps only publication dates visibly exposed by the source", () => {
    expect(verifiedSourcePublishedAt("2024-12-20", ["Published 2024-12-20", "Source body"])).toBe("2024-12-20");
    expect(verifiedSourcePublishedAt("2024-12-20", ["Published 2024/12/20", "Source body"])).toBe("2024-12-20");
    expect(verifiedSourcePublishedAt("2026-07-14", ["Current repository page", "© 2026 GitHub"])).toBeUndefined();
    expect(verifiedSourcePublishedAt("not-a-date", ["not-a-date"])).toBeUndefined();
  });

  it("rejects blocked, empty reader, and mojibake pages", () => {
    expect(assessSourceQuality({
      title: "安全验证 - 知乎",
      content: "请完成安全验证后继续访问。",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "Page not found | World Food Programme",
      content: "Page not found | World Food Programme",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "2026世界杯导航",
      content: "2026世界杯导航 博彩 彩票",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "伊春市纪委365bet体育存款_beat365平台_365平台",
      content: "从北京中山公园正门进入，沿东侧长廊曲折北行。",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "文革与当代史研究网 - Powered by Discuz!",
      content: "Powered by Discuz!",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "全知识",
      content: "内容正在升级中 本站的全部概述文字在知识共享署名-相同方式共享3.0协议之条款下提供",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "URL Source: https://example.test/file.pdf",
      content: "URL Source: https://example.test/file.pdf",
    })).toMatchObject({ usable: false, reason: "empty_reader_output" });

    expect(assessSourceQuality({
      title: "URL Source: https://zhuanlan.zhihu.com/p/571666651",
      snippet: "知乎，中文互联网高质量的问答社区和创作者聚集的原创内容平台。",
      content: "知乎 首页 发现 等你来答 登录 注册",
    })).toMatchObject({ usable: false, reason: "empty_reader_output" });

    expect(assessSourceQuality({
      title: "涔犺繎骞虫€讳功璁板叧浜庢壎璐",
      content: "涔犺繎骞虫€讳功璁板叧浜庢壎璐劚璐伐浣滅殑閲嶈璁鸿",
    })).toMatchObject({ usable: false, reason: "mojibake_content" });
  });

  it("keeps short but meaningful fixture content", () => {
    expect(assessSourceQuality({
      title: "Fetched source",
      content: "Fetched full page content with stronger evidence than the search snippet.",
    })).toEqual({ usable: true });
  });

  it("recognizes high-confidence official domains and calibrates their score", () => {
    expect(inferSourceTier("https://www.stats.gov.cn/sj/", "secondary")).toBe("official");
    expect(inferSourceTier("https://data.europa.eu/example", "secondary")).toBe("official");
    expect(inferSourceTier("https://www.acm.nl/en/publications/cloud-market-study", "secondary")).toBe("official");
    expect(inferSourceTier("https://www.jftc.go.jp/en/pressreleases/", "secondary")).toBe("official");
    expect(inferSourceTier("https://journal.example/paper", "secondary")).toBe("secondary");
    expect(calibrateSourceQualityScore({
      url: "https://www.stats.gov.cn/sj/",
      declaredTier: "secondary",
      declaredScore: 0.4,
      fetched: true,
    })).toMatchObject({
      sourceTier: "official",
      qualityScore: 0.85,
      signals: ["official_domain", "full_content_fetched"],
    });
  });

  it("forces repository, repost, and community hosts below primary authority", () => {
    const cases = [
      ["https://www.researchgate.net/publication/123", 0.55, "research_repository_or_profile_domain"],
      ["https://m.sohu.com/a/123", 0.55, "reposted_content_domain"],
      ["https://example.medium.com/analysis", 0.6, "community_publishing_domain"],
    ] as const;

    for (const [url, cap, signal] of cases) {
      expect(inferSourceTier(url, "primary")).toBe("secondary");
      expect(calibrateSourceQualityScore({
        url,
        declaredTier: "primary",
        declaredScore: 0.99,
        fetched: true,
      })).toMatchObject({
        sourceTier: "secondary",
        qualityScore: cap,
        signals: expect.arrayContaining([signal, `quality_score_capped_${cap}`]),
      });
    }
  });

  it("keeps publisher-hosted primary sources unchanged", () => {
    expect(calibrateSourceQualityScore({
      url: "https://journal.publisher.test/article/123",
      declaredTier: "primary",
      declaredScore: 0.9,
      fetched: true,
    })).toMatchObject({ sourceTier: "primary", qualityScore: 0.9 });
  });

  it("rejects reserved placeholder domains without blocking the test TLD", () => {
    for (const url of [
      "https://example.com/source",
      "https://docs.example.org/report",
      "https://sub.example.net/data",
    ]) {
      expect(assessSourceUrlPolicy(url)).toEqual({ usable: false, reason: "placeholder_source_policy" });
      expect(assessSourceQuality({ url, title: "Placeholder", snippet: "Synthetic source text." })).toEqual({
        usable: false,
        reason: "placeholder_source_policy",
      });
    }
    expect(assessSourceUrlPolicy("https://example.test/source")).toEqual({ usable: true });
  });

  it("rejects title-only sources because they cannot summarize source contents", () => {
    expect(assessSourceQuality({
      title: "《新青年》唤醒新青年",
    })).toMatchObject({ usable: false, reason: "title_only_source" });
  });

  it("rejects encyclopedia and aggregator sources by URL policy", () => {
    for (const url of [
      "https://zh.wikipedia.org/wiki/Example",
      "https://zh-classical.wikipedia.org/wiki/Example",
      "https://baike.baidu.com/item/example",
      "https://www.wenxuecity.com/book/?act=view&chapterID=1",
      "https://www.semanticscholar.org/paper/example",
      "https://zhuanlan.zhihu.com/p/571666651",
    ]) {
      expect(assessSourceUrlPolicy(url)).toMatchObject({ usable: false, reason: "blocked_source_policy" });
      expect(assessSourceQuality({ url, title: "Example", snippet: "Search snippet." })).toMatchObject({ usable: false, reason: "blocked_source_policy" });
    }
  });

  it("rejects document sharing, courseware, and mind-map preview sources", () => {
    for (const url of [
      "https://www.docin.com/p-1183084741.html",
      "https://m.docin.com/p-2346449567.html",
      "https://www.taodocs.com/p-57912755.html",
      "https://www.doc88.com/p-0743229382014.html",
      "https://max.book118.com/21552154.shtm",
      "https://www.zxxk.com/10964512.html",
      "https://mm.edrawsoft.cn/656677",
      "https://doc.guandang.net/b0a1194.html",
      "https://www.ppkao.com/28e8a2bf14af43de8b83ebdee4115065",
      "https://www.freetiku.com/view-1-3OIea9WiPc1g3SvK.html",
      "https://www.yebaike.com/3645138.html",
      "https://www.toutiao.com/7412265849081381411",
      "https://doc.mbalib.com/view/d161908904bca1b7d90f2b7b211c5131.html",
    ]) {
      expect(assessSourceUrlPolicy(url)).toMatchObject({ usable: false, reason: "blocked_source_policy" });
      expect(assessSourceQuality({ url, title: "马克思主义在中国传播", snippet: "搜索摘要。" })).toMatchObject({ usable: false, reason: "blocked_source_policy" });
    }

    expect(assessSourceQuality({
      title: "试述马克思主义的早期传播.doc免费全文阅读",
      snippet: "文档列表 文档介绍 下载积分 内容提示",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "专题3.3 马克思主义在中国的传播(课件word)-学科网",
      snippet: "同步课堂历史必修3 课件下载",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });

    expect(assessSourceQuality({
      title: "考试资料网_考试试题_考试题库_找答案就上考试资料网",
      snippet: "论述如何科学认识毛泽东思想的历史地位。",
    })).toMatchObject({ usable: false, reason: "blocked_or_verification_page" });
  });
});
