import { describe, expect, it } from "vitest";
import type { ResearchRequirement } from "@deepresearch/contracts";
import { normalizeRequirements } from "../phases/rubric.js";
import { authorityFirstScoutQueries, filterSearchHitsForQuery, interleaveSearchHitLists, rankSearchHitsForResearch } from "../source-discovery.js";

describe("authority-first source discovery", () => {
  it("seeds evidence-bearing authority requirements before broad LLM queries", () => {
    const requirements: ResearchRequirement[] = [
      requirement("R1", "Compare national market shares.", ["Competition authority reports and official statistics"]),
      { ...requirement("R2", "Write in English.", []), kind: "constraint", evidenceRequired: false },
    ];

    const queries = authorityFirstScoutQueries(requirements, ["broad market overview"], "fallback", 3);

    expect(queries[0]).toContain("Compare national market shares");
    expect(queries[0]).toContain("official data report filetype:pdf");
    expect(queries).toContain("broad market overview");
    expect(queries.join(" ")).not.toContain("Write in English");
  });

  it("uses concise named-section queries and primary papers for biological research", () => {
    const parasitic = requirement(
      "R_PARASITIC",
      "Report must include a section titled 'Between Parasitic Plants' explaining gene exchange with host plants.",
      ["Mechanisms of HGT between parasitic plants and hosts", "Structures involved such as haustoria"],
    );
    parasitic.exampleScope = ["Cuscuta", "Striga"];
    const formatting: ResearchRequirement = {
      ...requirement("R_FORMAT", "Each section must use bullets.", ["Direct evidence addressing this requirement."]),
      kind: "deliverable",
    };

    const queries = authorityFirstScoutQueries([parasitic, formatting], ["broad plant HGT"], "fallback", 3);

    expect(queries[0]).toContain("parasitic plant host horizontal gene transfer Cuscuta Striga haustorium mRNA primary study");
    expect(queries[0]).not.toContain("Report must include a section titled");
    expect(queries.join(" ")).not.toContain("Each section must use bullets");
  });

  it("creates one compact primary-paper query for each plant HGT branch", () => {
    const sections = [
      ["Between Parasitic Plants", "parasitic plant host horizontal gene transfer"],
      ["Between Fungi and Plants", "fungus plant horizontal gene transfer"],
      ["Between Bacteria and Plants", "Agrobacterium T-DNA integration natural transgenic sweet potato"],
      ["Between Viruses and Plants", "endogenous pararetrovirus sequences integrated plant genome"],
    ] as const;
    const requirements = sections.map(([section], index) => {
      const req = requirement(`R_HGT_${index}`, `Report must include a section titled '${section}'.`, ["Direct biological mechanism and named genes"]);
      req.temporalScope = { mode: "as_of", basis: "covered_period", asOf: "2020-12-31" };
      return req;
    });

    const queries = authorityFirstScoutQueries(requirements, [], "fallback", 8);

    for (const [, anchor] of sections) expect(queries.some((query) => query.includes(anchor))).toBe(true);
    const branchQueries = queries.filter((query) => !query.includes("fallback"));
    expect(branchQueries).toHaveLength(7);
    expect(branchQueries.every((query) => !query.includes("covering evidence through"))).toBe(true);
    expect(branchQueries).toContain('"The genome of cultivated sweet potato contains Agrobacterium T-DNAs with expressed genes" site:pnas.org');
    expect(branchQueries).toContain('"Horizontal gene transfer of Fhb7 from fungus underlies Fusarium head blight resistance in wheat" site:science.org');
  });

  it("moves official full reports ahead of secondary portals while preserving stable ties", () => {
    const hits = [
      { url: "https://news.example/cloud", title: "Cloud commentary", snippet: "Summary" },
      { url: "https://www.ofcom.org.uk/report.pdf", title: "Cloud market study final report", snippet: "Official findings" },
      { url: "https://another.example/cloud", title: "Cloud analysis", snippet: "Summary" },
    ];

    expect(rankSearchHitsForResearch(hits, true)[0]?.url).toContain("ofcom.org.uk");
    expect(rankSearchHitsForResearch(hits, false)).toEqual(hits);
  });

  it("round-robins equivalent-quality hits across publisher domains", () => {
    const hits = [
      { url: "https://alpha-research.org/one", title: "Analysis one", snippet: "Summary" },
      { url: "https://alpha-research.org/two", title: "Analysis two", snippet: "Summary" },
      { url: "https://beta-research.net/one", title: "Analysis three", snippet: "Summary" },
      { url: "https://gamma-research.edu/one", title: "Analysis four", snippet: "Summary" },
    ];

    expect(rankSearchHitsForResearch(hits, true).map((hit) => hit.url)).toEqual([
      "https://alpha-research.org/one",
      "https://beta-research.net/one",
      "https://gamma-research.edu/one",
      "https://alpha-research.org/two",
    ]);
  });

  it("diversifies ordinary searches without applying authority re-ranking", () => {
    const hits = [
      { url: "https://alpha-research.org/one", title: "First provider result", snippet: "Summary" },
      { url: "https://alpha-research.org/two", title: "Second provider result", snippet: "Summary" },
      { url: "https://beta-research.net/one", title: "Third provider result", snippet: "Summary" },
      { url: "https://beta-research.net/two", title: "Fourth provider result", snippet: "Summary" },
    ];

    expect(rankSearchHitsForResearch(hits, false).map((hit) => hit.url)).toEqual([
      "https://alpha-research.org/one",
      "https://beta-research.net/one",
      "https://alpha-research.org/two",
      "https://beta-research.net/two",
    ]);
  });

  it("treats subdomains under a compound public suffix as one publisher domain", () => {
    const hits = [
      { url: "https://journal.publisher.co.uk/one", title: "Analysis one", snippet: "Summary" },
      { url: "https://cdn.publisher.co.uk/two", title: "Analysis two", snippet: "Summary" },
      { url: "https://independent-research.org/one", title: "Analysis three", snippet: "Summary" },
    ];

    expect(rankSearchHitsForResearch(hits, true).map((hit) => hit.url)).toEqual([
      "https://journal.publisher.co.uk/one",
      "https://independent-research.org/one",
      "https://cdn.publisher.co.uk/two",
    ]);
  });

  it("keeps higher authority score bands ahead of domain diversity and remains deterministic", () => {
    const hits = [
      { url: "https://commentary.test/one", title: "Commentary", snippet: "Summary" },
      { url: "https://www.ofcom.org.uk/one", title: "Market findings", snippet: "Official findings" },
      { url: "https://www.ofcom.org.uk/two", title: "Market decision", snippet: "Official decision" },
      { url: "https://another-analysis.test/one", title: "Analysis", snippet: "Summary" },
    ];

    const first = rankSearchHitsForResearch(hits, true).map((hit) => hit.url);
    const second = rankSearchHitsForResearch(hits, true).map((hit) => hit.url);

    expect(first.slice(0, 2)).toEqual([
      "https://www.ofcom.org.uk/one",
      "https://www.ofcom.org.uk/two",
    ]);
    expect(second).toEqual(first);
  });

  it("expands enumerated products into separate official-documentation queries", () => {
    const req = requirement(
      "R_PRODUCTS",
      "For each autopilot (ArduPilot, PX4, Paparazzi, LibrePilot, Betaflight, iNAV), provide RTOS, language, protocols, and license.",
      ["Official documentation or technical documentation for each autopilot"],
    );
    req.temporalScope = { mode: "as_of", asOf: "2024-12-31" };

    const queries = authorityFirstScoutQueries([req], ["broad autopilot overview"], "fallback", 8);

    expect(queries.slice(0, 6).map((query) => query.split(" ")[0])).toEqual([
      "ArduPilot", "PX4", "Paparazzi", "LibrePilot", "Betaflight", "iNAV",
    ]);
    expect(queries.slice(0, 6).every((query) => query.includes("official documentation"))).toBe(true);
    expect(queries.slice(0, 6).every((query) => query.endsWith("covering evidence through 2024-12-31"))).toBe(true);
    expect(queries.slice(0, 6).every((query) => !query.includes("before:"))).toBe(true);
  });

  it("expresses a source-publication cutoff as a search eligibility bound", () => {
    const req = requirement(
      "R_LITERATURE",
      "Survey academic perspectives on animation.",
      ["Academic literature"],
    );
    req.temporalScope = { mode: "as_of", basis: "source_publication", asOf: "2018-12-31" };

    const queries = authorityFirstScoutQueries([req], ["broad animation query"], "fallback survey prompt", 3);
    const [query] = queries;

    expect(query).toContain("published no later than 2018-12-31");
    expect(query).toContain("before:2019-01-01");
    expect(query).not.toContain(" as of ");
    expect(queries).toHaveLength(3);
    expect(queries.every((item) => item.endsWith("published no later than 2018-12-31 before:2019-01-01"))).toBe(true);
  });

  it("turns an early-year publication cutoff into a Q1 search ceiling", () => {
    const req = requirement(
      "R_EARLY_YEAR",
      "Survey alternative interconnect materials using research available up to early 2024.",
      ["Public materials research"],
    );
    req.temporalScope = { mode: "as_of", basis: "source_publication", asOf: "2024-03-31" };

    const queries = authorityFirstScoutQueries([req], ["broad interconnect metals"], "fallback metals", 3);

    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.endsWith("published no later than 2024-03-31 before:2024-04-01"))).toBe(true);
  });

  it("bounds both ends of publication ranges without publication-filtering covered periods", () => {
    const publication = requirement(
      "R_PUBLICATION_RANGE",
      "Review deep-learning research published between 2018 and 2023.",
      ["Peer-reviewed academic studies"],
    );
    publication.temporalScope = {
      mode: "range",
      basis: "source_publication",
      start: "2018-01-01",
      end: "2023-12-31",
    };
    const publicationQueries = authorityFirstScoutQueries(
      [publication],
      ["deep learning finance review"],
      "deep learning finance fallback",
      3,
    );
    expect(publicationQueries.every((query) => query.includes("after:2017-12-31"))).toBe(true);
    expect(publicationQueries.every((query) => query.includes("before:2024-01-01"))).toBe(true);

    const covered = requirement(
      "R_COVERED_RANGE",
      "Analyze market events from 2018 through 2023.",
      ["Reports explicitly covering the requested period"],
    );
    covered.temporalScope = {
      mode: "range",
      basis: "covered_period",
      start: "2018-01-01",
      end: "2023-12-31",
    };
    const coveredQueries = authorityFirstScoutQueries([covered], ["market event review"], "market event fallback", 3);
    expect(coveredQueries.every((query) => query.includes("covering period from 2018-01-01 through 2023-12-31"))).toBe(true);
    expect(coveredQueries.every((query) => !/(?:after|before):/u.test(query))).toBe(true);
  });

  it("carries month-level range semantics from requirements into search queries", () => {
    const requirements = normalizeRequirements([{
      id: "monthly_publication_range",
      description: "Review empirical studies published during January 2020 to August 2023.",
      priority: "must",
      evidenceNeeds: ["Eligible empirical studies"],
    }, {
      id: "monthly_event_range",
      description: "Analyze policy events from January 2020 to August 2023.",
      priority: "must",
      temporalScope: { mode: "range", basis: "covered_period" },
      evidenceNeeds: ["Evidence covering the event period"],
    }], [], "Review bounded studies and events.");

    const publicationQueries = authorityFirstScoutQueries([requirements[0]!], [], "publication fallback", 3);
    expect(publicationQueries.every((query) => query.includes("after:2019-12-31"))).toBe(true);
    expect(publicationQueries.every((query) => query.includes("before:2023-09-01"))).toBe(true);

    const coveredQueries = authorityFirstScoutQueries([requirements[1]!], [], "event fallback", 3);
    expect(coveredQueries.every((query) => query.includes("covering period from 2020-01-01 through 2023-08-31"))).toBe(true);
    expect(coveredQueries.every((query) => !/(?:after|before):/u.test(query))).toBe(true);
  });

  it("turns an exclusive month availability cutoff into the correct search bound", () => {
    const requirements = [
      requirement("R_ATTACKS", "Create the attack technology overview.", ["Official and primary attack research"]),
      requirement("R_DEFENSES", "Create the defense technology overview.", ["Official and primary defense research"]),
    ];
    for (const item of requirements) {
      item.temporalScope = { mode: "as_of", basis: "covered_period", asOf: "2025-02-28" };
    }

    const queries = authorityFirstScoutQueries(requirements, ["broad secure sensing survey"], "fallback secure sensing", 5);

    expect(queries).toHaveLength(4);
    expect(queries.every((query) => query.endsWith("covering evidence through 2025-02-28"))).toBe(true);
    expect(queries.every((query) => !query.includes("before:"))).toBe(true);
  });

  it("searches an explicitly exempt later source without unbounding other queries", () => {
    const req = requirement(
      "R_DATED_COMPARISON",
      "Compare the bounded regional evidence with the required global report.",
      ["Official report and academic study"],
    );
    req.temporalScope = {
      mode: "as_of",
      basis: "covered_period",
      asOf: "2022-12-31",
      exemptSources: [{
        title: "2023年全球未来就业报告",
        aliases: ["Global Future of Jobs Report 2023"],
      }],
    };

    const queries = authorityFirstScoutQueries([req], ["broad regional evidence"], "fallback comparison", 4);

    expect(queries[0]).toContain('"2023年全球未来就业报告" OR "Global Future of Jobs Report 2023"');
    expect(queries[0]).not.toContain("before:2023-01-01");
    expect(queries.slice(1)).toHaveLength(3);
    expect(queries.slice(1).every((query) => query.endsWith("covering evidence through 2022-12-31"))).toBe(true);
    expect(queries.every((query) => !query.includes("before:"))).toBe(true);
  });

  it("uses explicit non-geographic entity scope for concise official queries", () => {
    const req = requirement(
      "R_FRAMEWORKS",
      "Compare Node.js, React.js, jQuery, Angular, and Vue.js across architecture and security fields.",
      ["Official documentation for every named framework"],
    );
    req.entityScope = ["Node.js", "React.js", "jQuery", "Angular", "Vue.js"];
    req.metricScope = ["Architecture", "XSS", "CSRF"];

    const queries = authorityFirstScoutQueries([req], [], "fallback", 5);

    expect(queries.map((query) => query.split(" ")[0])).toEqual(["Node.js", "React.js", "jQuery", "Angular", "Vue.js"]);
    expect(queries.every((query) => query.includes("official documentation"))).toBe(true);
    expect(queries.every((query) => (query.match(/Node\.js|React\.js|jQuery|Angular|Vue\.js/gu) ?? []).length === 1)).toBe(true);
  });

  it("keeps scoped academic member queries concise and metric-focused", () => {
    const req = requirement(
      "R_THEORIES",
      "In a long classic-theory section, cover every listed portfolio theory and explain each one in chronological order with extensive prose.",
      ["Academic sources for each theory's originator, core ideas, and year of proposal."],
    );
    req.entityScope = ["Modern Portfolio Theory", "Capital Asset Pricing Model"];
    req.entityScopeRole = "members";
    req.metricScope = ["originator", "core ideas", "year of proposal"];

    const queries = authorityFirstScoutQueries([req], [], "fallback", 2);

    expect(queries[0]).toContain("Modern Portfolio Theory originator core ideas year of proposal Academic sources");
    expect(queries[1]).toContain("Capital Asset Pricing Model originator core ideas year of proposal Academic sources");
    expect(queries.join(" ")).not.toContain("extensive prose");
  });

  it("keeps a short parent-section anchor in scoped method queries", () => {
    const req = requirement(
      "R_OPTIMIZATION",
      "In the 'Portfolio Optimization and Rebalancing' section, cover advanced methods and extensive implementation detail.",
      ["Metaheuristic algorithms and representative research"],
    );
    req.entityScope = ["Metaheuristics Optimization", "Dynamic Rebalancing Strategies"];
    req.entityScopeRole = "groups";

    const queries = authorityFirstScoutQueries([req], [], "fallback", 2);

    expect(queries[0]).toContain("Metaheuristics Optimization Portfolio Optimization and Rebalancing");
    expect(queries[0]).toContain("primary study paper filetype:pdf");
    expect(queries[0]).not.toContain("extensive implementation detail");
  });

  it("does not promote such-as examples into scoped search subjects", () => {
    const req = requirement(
      "R_MCDM",
      "Explain how MCDM adds criteria (such as liquidity, social responsibility, growth) to portfolio selection.",
      ["Specific MCDM techniques and representative research"],
    );

    const queries = authorityFirstScoutQueries([req], [], "fallback", 2);

    expect(queries[0]).toMatch(/^financial portfolio selection MCDM/u);
    expect(queries[0]).not.toMatch(/^such as liquidity/u);
    expect(queries[0]).toContain("primary study paper filetype:pdf");
  });

  it("uses a concise named section and a shared domain anchor for sibling queries", () => {
    const overview = requirement(
      "R_OVERVIEW",
      "Review AI applications in portfolio management.",
      ["Representative research"],
    );
    const theory = requirement(
      "R_THEORY",
      "Review classic theories in portfolio management.",
      ["Originators and core ideas"],
    );
    const mcdm = requirement(
      "R_MCDM",
      "In the 'Multi-Criteria Decision Making (MCDM)' section, explain a long sequence of detailed portfolio selection obligations and application scenarios.",
      ["Specific techniques and application scenarios"],
    );

    const queries = authorityFirstScoutQueries([overview, theory, mcdm], [], "fallback", 4);
    const mcdmQuery = queries.find((query) => query.includes("financial portfolio selection MCDM"));

    expect(mcdmQuery).toContain("portfolio selection");
    expect(mcdmQuery).toContain("primary study paper filetype:pdf");
    expect(mcdmQuery).not.toContain("long sequence of detailed");
  });

  it("shares the portfolio root across management, selection, and optimization variants", () => {
    const management = requirement("R_MANAGEMENT", "Review AI in portfolio management.", ["Research"]);
    const selection = requirement("R_SELECTION", "Explain MCDM in portfolio selection.", ["Techniques"]);
    const optimization = requirement("R_OPTIMIZATION", "Explain methods in portfolio optimization.", ["Algorithms"]);
    const nested = requirement(
      "R_NESTED",
      "AI Applications — Asset Clustering and Network Analysis: Explain unsupervised-learning applications.",
      ["Direct evidence"],
    );

    const queries = authorityFirstScoutQueries([management, selection, optimization, nested], [], "fallback", 5);
    const nestedQuery = queries.find((query) => query.includes("stock network topology asset clustering"));

    expect(nestedQuery).toContain("portfolio");
  });

  it("round-robins authority queries across requirements and reserves broad coverage", () => {
    const technologies = ["GSM-R", "P25", "TETRA", "802.11", "WiMAX", "UMTS", "LTE-R"];
    const services = ["Predictive Maintenance", "Asset Monitoring", "Video Security", "PIS", "FIS", "Train Control", "Energy Efficiency"];
    const technologyRequirement = requirement(
      "R_TECHNOLOGIES",
      "Compare railway communication technologies.",
      ["Official technical standards and primary documentation"],
    );
    technologyRequirement.entityScope = technologies;
    technologyRequirement.metricScope = ["Frequency", "Bandwidth", "Data Rate"];
    const serviceRequirement = requirement(
      "R_SERVICES",
      "Analyze IIoT-enabled railway services.",
      ["Official deployment evidence and primary documentation"],
    );
    serviceRequirement.entityScope = services;
    serviceRequirement.metricScope = ["Implementation", "Technology", "Value"];

    const queries = authorityFirstScoutQueries(
      [technologyRequirement, serviceRequirement],
      ["railway communications evolution", "IIoT railway service overview"],
      "industrial IoT railway fallback",
      8,
    );

    expect(queries).toHaveLength(8);
    expect(queries.slice(0, 6).map((query) => query.split(" ")[0])).toEqual([
      "GSM-R", "Predictive", "P25", "Asset", "TETRA", "Video",
    ]);
    expect(queries.filter((query) => technologies.some((entity) => query.startsWith(`${entity} `)))).toHaveLength(3);
    expect(queries.filter((query) => services.some((entity) => query.startsWith(`${entity} `)))).toHaveLength(3);
    expect(queries[6]).toContain("railway communications evolution");
    expect(queries[7]).toContain("industrial IoT railway fallback");
  });

  it("gives sibling research requirements one scout lane before expanding a large entity list", () => {
    const theories = requirement(
      "R_THEORIES",
      "Explain the classic portfolio theories.",
      ["Originator, core ideas, and year of proposal"],
    );
    theories.entityScope = [
      "Modern Portfolio Theory",
      "Capital Asset Pricing Model",
      "Arbitrage Pricing Theory",
      "Efficient Market Hypothesis",
    ];
    theories.entityScopeRole = "members";
    theories.metricScope = ["Originator", "Core ideas", "Year of proposal"];
    const applications = requirement(
      "R_APPLICATIONS",
      "Review AI and machine-learning applications in portfolio management.",
      ["Representative research for signal generation, clustering, and feature enrichment"],
    );
    applications.entityScope = ["Signal Generation", "Asset Clustering", "Feature Enrichment"];
    applications.entityScopeRole = "groups";
    const multiCriteria = requirement(
      "R_MCDM",
      "Explain multi-criteria portfolio-selection techniques and their application scenarios.",
      ["Specific techniques and scenarios"],
    );
    const optimization = requirement(
      "R_OPTIMIZATION",
      "Explain portfolio optimization and dynamic rebalancing methods.",
      ["Metaheuristic algorithms and AI-enabled rebalancing"],
    );
    optimization.entityScope = ["Metaheuristics Optimization", "Dynamic Rebalancing Strategies"];
    optimization.entityScopeRole = "groups";

    const queries = authorityFirstScoutQueries(
      [theories, applications, multiCriteria, optimization],
      ["AI-enhanced portfolio management overview"],
      "portfolio research overview",
      8,
    );

    expect(queries.slice(0, 4).map((query) => query.split(" ")[0])).toEqual([
      "Modern",
      "Signal",
      "Explain",
      "Metaheuristics",
    ]);
    expect(queries.slice(0, 4).join(" ")).toContain("multi-criteria portfolio-selection");
    expect(queries[4]).toContain("Capital Asset Pricing Model");
  });

  it("round-robins query results so the first broad query cannot starve later entities", () => {
    expect(interleaveSearchHitLists([
      ["ardu-1", "ardu-2", "ardu-3"],
      ["px4-1", "px4-2"],
      ["paparazzi-1"],
    ])).toEqual(["ardu-1", "px4-1", "paparazzi-1", "ardu-2", "px4-2", "ardu-3"]);
  });

  it("filters authoritative but off-domain scout hits before knowledge capture", () => {
    const hits = [
      { url: "https://pubmed.ncbi.nlm.nih.gov/1", title: "Shared decision making models in clinical care", snippet: "A medical systematic review." },
      { url: "https://projects.example/mcdm", title: "MCDM in project portfolio selection", snippet: "Multi-criteria decision making for construction project portfolios." },
      { url: "https://aviation.example/mcdm", title: "MCDM in the aviation industry", snippet: "Multi-criteria decision methods for airline route portfolios." },
      { url: "https://finance.example/mcdm", title: "MCDM portfolio selection", snippet: "Multi-criteria decision making adds liquidity and ESG criteria to investment portfolios." },
    ];

    expect(filterSearchHitsForQuery(
      hits,
      "MCDM portfolio selection techniques and application scenarios primary study paper",
    ).map((hit) => hit.url)).toEqual(["https://finance.example/mcdm"]);
  });

  it("combines nested-topic and shared portfolio anchors into a concise academic query", () => {
    const parent = requirement(
      "R_PARENT",
      "Review AI applications in portfolio management.",
      ["Representative research"],
    );
    const sibling = requirement(
      "R_SIBLING",
      "Review classic theories in portfolio management.",
      ["Originators"],
    );
    const nested = requirement(
      "R_NESTED",
      "Review of AI Applications — Asset Clustering and Network Analysis: Explain a very long unsupervised-learning instruction with many implementation details.",
      ["Direct evidence for asset clustering"],
    );

    const queries = authorityFirstScoutQueries([parent, sibling, nested], [], "fallback", 4);
    const nestedQuery = queries.find((query) => query.includes("stock network topology asset clustering"));

    expect(nestedQuery).toContain("stock network topology asset clustering portfolio diversification");
    expect(nestedQuery).toContain("primary study paper filetype:pdf");
    expect(nestedQuery).not.toContain("many implementation details");
  });

  it("keeps a multi-topic AI requirement on its requested subject instead of applying the asset-only override", () => {
    const req = requirement(
      "R_AI_GROUPS",
      "Review signal generation, asset clustering, and feature enrichment in portfolio management.",
      ["Representative research"],
    );
    req.entityScope = ["Signal Generation", "Asset Clustering", "Feature Enrichment"];
    req.entityScopeRole = "groups";

    const [query] = authorityFirstScoutQueries([req], [], "fallback", 2);

    expect(query).toContain("Signal Generation");
    expect(query).not.toContain("stock network topology asset clustering");
  });

  it("uses concrete MCDM method names for financial portfolio discovery", () => {
    const req = requirement(
      "R_MCDM_FINANCE",
      "Explain MCDM methods for portfolio selection.",
      ["Specific techniques and application scenarios"],
    );

    const [query] = authorityFirstScoutQueries([req], [], "fallback", 2);

    expect(query).toContain("financial portfolio selection MCDM AHP TOPSIS ELECTRE PROMETHEE");
  });

  it("requires both finance and method anchors for scoped optimization searches", () => {
    const hits = [
      { url: "https://health.example/ml", title: "Machine learning in patient management", snippet: "Clinical prediction." },
      { url: "https://optimization.example/meta", title: "Advanced metaheuristic algorithms", snippet: "Benchmark function optimization." },
      { url: "https://finance.example/meta", title: "Metaheuristic portfolio optimization", snippet: "Investment portfolio selection with heuristic optimization." },
    ];

    expect(filterSearchHitsForQuery(
      hits,
      "Metaheuristics Optimization Portfolio Optimization and Rebalancing",
    ).map((hit) => hit.url)).toEqual(["https://finance.example/meta"]);
  });

  it("removes merely biological but non-transfer results from HGT queries", () => {
    const hits = [
      { url: "https://pmc.ncbi.nlm.nih.gov/articles/one", title: "Resource choice in Cuscuta", snippet: "Host selection by a parasitic plant." },
      { url: "https://elifesciences.org/articles/two", title: "Trans-species small RNAs", snippet: "Cross-kingdom small RNA transfer between Cuscuta and its host." },
    ];

    expect(filterSearchHitsForQuery(
      hits,
      "horizontal gene transfer parasitic plants Cuscuta Striga",
    ).map((hit) => hit.url)).toEqual(["https://elifesciences.org/articles/two"]);
  });

  it("accepts named MCDM techniques and rejects arXiv work after an explicit query cutoff", () => {
    const hits = [
      { url: "https://arxiv.org/abs/2401.16920", title: "[2401.16920] Sparse Portfolio Selection via Topological Data Analysis based Clustering", snippet: "Portfolio clustering." },
      { url: "https://arxiv.org/abs/2408.11739", title: "[2408.11739] Network-based diversification of stock portfolios", snippet: "Portfolio clustering." },
      { url: "https://finance.example/ahp-topsis", title: "AHP–TOPSIS Methodology for Stock Portfolio Investments", snippet: "A 2022 financial portfolio selection paper." },
    ];

    expect(filterSearchHitsForQuery(
      hits.slice(0, 2),
      "stock network topology asset clustering portfolio diversification covering evidence through 2024-04-30",
    ).map((hit) => hit.url)).toEqual(["https://arxiv.org/abs/2401.16920"]);
    expect(filterSearchHitsForQuery(
      [hits[2]!],
      "financial portfolio selection MCDM AHP TOPSIS ELECTRE PROMETHEE covering evidence through 2024-04-30",
    ).map((hit) => hit.url)).toEqual(["https://finance.example/ahp-topsis"]);
  });
});

function requirement(requirementId: string, description: string, evidenceNeeds: string[]): ResearchRequirement {
  return {
    requirementId,
    description,
    kind: "question",
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds,
    successCriteria: [`Address ${description}`],
  };
}
