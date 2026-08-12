import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ImportantNews } from "./ImportantNews";
import { MorningReportPanel } from "./MorningReportPanel";
import { StrategyPanel } from "./StrategyPanel";

describe("primary research panel layout", () => {
  test("keeps each column content in an independent scroll container", () => {
    const { container } = render(
      <>
        <MorningReportPanel
          report={null}
          error=""
          refreshing={false}
          onOpenDetail={() => undefined}
          onRefresh={() => undefined}
        />
        <StrategyPanel
          items={[]}
          sources={[]}
          catalystSymbols={new Set()}
          refreshing={false}
          onOpenDetail={() => undefined}
          onRefresh={() => undefined}
        />
        <ImportantNews items={[]} onReadNewspaper={() => undefined} />
      </>,
    );

    expect(container.querySelector(".morning-panel > .research-panel-body")).toBeInTheDocument();
    expect(container.querySelector(".strategy-panel > .research-panel-body")).toBeInTheDocument();
    expect(container.querySelector(".news-panel > .research-panel-body")).toBeInTheDocument();
  });
});
