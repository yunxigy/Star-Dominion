# Assessment Radar Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible, responsive SVG radar chart to non-MBTI assessment results while preserving the existing exact-value bars.

**Architecture:** Keep polar-coordinate math in a pure `radarGeometry.ts` module, render it through a focused `AssessmentRadarChart` component, and let `AssessmentResult` decide when the chart appears. The chart consumes existing normalized scores and never changes scoring or result selection.

**Tech Stack:** React 19, TypeScript, native SVG, Tailwind CSS, Vitest, React server rendering

---

## File Structure

- `SD/components/tools/test/assessment/radarGeometry.ts` — pure coordinate and polygon helpers.
- `SD/components/tools/test/assessment/radarGeometry.test.ts` — geometry boundary tests.
- `SD/components/tools/test/assessment/AssessmentRadarChart.tsx` — responsive, accessible SVG rendering.
- `SD/components/tools/test/assessment/AssessmentRadarChart.test.tsx` — SVG semantics and score rendering tests.
- `SD/components/tools/test/assessment/AssessmentResult.tsx` — non-MBTI chart integration and explanatory copy.
- `SD/components/tools/test/assessment/AssessmentResult.test.tsx` — mode-specific integration tests.

### Task 1: Pure radar geometry

**Files:**
- Create: `SD/components/tools/test/assessment/radarGeometry.ts`
- Test: `SD/components/tools/test/assessment/radarGeometry.test.ts`

- [ ] **Step 1: Write the failing geometry tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildRadarPoints, radarPoint } from './radarGeometry';

describe('radar geometry', () => {
  it('places the first full-score point at the top of the chart', () => {
    expect(radarPoint(0, 4, 100, 100, 80)).toEqual({ x: 100, y: 20 });
  });

  it('maps zero to the center and clamps scores to 0–100', () => {
    expect(radarPoint(2, 5, 0, 100, 80)).toEqual({ x: 100, y: 100 });
    expect(radarPoint(0, 4, 140, 100, 80)).toEqual({ x: 100, y: 20 });
  });

  it('builds one finite point per dimension and treats null as zero', () => {
    const points = buildRadarPoints([100, 50, null, 25], 100, 80);
    expect(points).toHaveLength(4);
    expect(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(points[2]).toEqual({ x: 100, y: 100 });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
cd E:\AI\gp\SD
npm.cmd test -- components/tools/test/assessment/radarGeometry.test.ts
```

Expected: FAIL because `./radarGeometry` does not exist.

- [ ] **Step 3: Implement the minimal geometry module**

```ts
export interface RadarPoint {
  x: number;
  y: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function radarPoint(
  index: number,
  count: number,
  value: number,
  center: number,
  radius: number,
): RadarPoint {
  const normalized = Math.min(100, Math.max(0, value)) / 100;
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return {
    x: round(center + Math.cos(angle) * radius * normalized),
    y: round(center + Math.sin(angle) * radius * normalized),
  };
}

export function buildRadarPoints(
  values: Array<number | null>,
  center: number,
  radius: number,
): RadarPoint[] {
  return values.map((value, index) =>
    radarPoint(index, values.length, value ?? 0, center, radius),
  );
}

export const pointsAttribute = (points: RadarPoint[]) =>
  points.map(({ x, y }) => `${x},${y}`).join(' ');
```

- [ ] **Step 4: Run the geometry tests and verify GREEN**

Run the Step 2 command.

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the pure geometry**

```powershell
git add -- SD/components/tools/test/assessment/radarGeometry.ts SD/components/tools/test/assessment/radarGeometry.test.ts
git commit -m "feat: add assessment radar geometry"
```

### Task 2: Accessible responsive SVG component

**Files:**
- Create: `SD/components/tools/test/assessment/AssessmentRadarChart.tsx`
- Test: `SD/components/tools/test/assessment/AssessmentRadarChart.test.tsx`

- [ ] **Step 1: Write failing component tests**

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssessmentRadarChart } from './AssessmentRadarChart';

const dimensions = [
  { id: 'a', label: '直接表达', color: '#b7583e', description: '清晰表达' },
  { id: 'b', label: '理性分析', color: '#537b98', description: '分析结构' },
  { id: 'c', label: '共情倾听', color: '#8c6179', description: '理解感受' },
  { id: 'd', label: '协作协调', color: '#6f9364', description: '推动合作' },
];

describe('AssessmentRadarChart', () => {
  it('renders an accessible SVG with labels and percentages', () => {
    const html = renderToStaticMarkup(
      <AssessmentRadarChart
        title="沟通风格"
        dimensions={dimensions}
        scores={{ a: 80, b: 60, c: 40, d: 20 }}
        accentColor="#6d4c8d"
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('沟通风格维度雷达图');
    expect(html).toContain('直接表达：80%');
    expect(html).toContain('viewBox="0 0 320 340"');
  });

  it('describes null dimensions as information insufficient', () => {
    const html = renderToStaticMarkup(
      <AssessmentRadarChart
        title="沟通风格"
        dimensions={dimensions}
        scores={{ a: null, b: 60, c: 40, d: 20 }}
        accentColor="#6d4c8d"
      />,
    );
    expect(html).toContain('直接表达：信息不足');
    expect(html).toContain('stroke-dasharray="4 4"');
  });
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
npm.cmd test -- components/tools/test/assessment/AssessmentRadarChart.test.tsx
```

Expected: FAIL because `AssessmentRadarChart` does not exist.

- [ ] **Step 3: Implement the SVG component**

Create the component:

```tsx
import React, { useId } from 'react';
import type { AssessmentDimension } from './types';
import { buildRadarPoints, pointsAttribute, radarPoint } from './radarGeometry';

interface AssessmentRadarChartProps {
  title: string;
  dimensions: AssessmentDimension[];
  scores: Record<string, number | null>;
  accentColor: string;
}

const CENTER = 160;
const RADIUS = 105;

export function AssessmentRadarChart({
  title,
  dimensions,
  scores,
  accentColor,
}: AssessmentRadarChartProps) {
  const titleId = useId();
  const descriptionId = useId();
  const values = dimensions.map((dimension) => scores[dimension.id]);
  const dataPoints = buildRadarPoints(values, CENTER, RADIUS);
  const description = dimensions
    .map((dimension) => {
      const value = scores[dimension.id];
      return `${dimension.label}：${value === null ? '信息不足' : `${value}%`}`;
    })
    .join('；');

  return (
    <svg
      viewBox="0 0 320 340"
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="mx-auto block h-auto w-full max-w-[520px]"
    >
      <title id={titleId}>{title}维度雷达图</title>
      <desc id={descriptionId}>{description}</desc>

      {[25, 50, 75, 100].map((level) => (
        <polygon
          key={level}
          points={pointsAttribute(buildRadarPoints(dimensions.map(() => level), CENTER, RADIUS))}
          fill="none"
          stroke="#ddc8af"
          strokeWidth={level === 100 ? 1.5 : 1}
        />
      ))}

      {dimensions.map((dimension, index) => {
        const endpoint = radarPoint(index, dimensions.length, 100, CENTER, RADIUS);
        return (
          <line
            key={dimension.id}
            x1={CENTER}
            y1={CENTER}
            x2={endpoint.x}
            y2={endpoint.y}
            stroke="#cdb89f"
            strokeWidth="1"
            strokeDasharray={scores[dimension.id] === null ? '4 4' : undefined}
          />
        );
      })}

      <polygon
        points={pointsAttribute(dataPoints)}
        fill={accentColor}
        fillOpacity="0.2"
        stroke={accentColor}
        strokeWidth="2.5"
        className="transition-all duration-700 motion-reduce:transition-none"
      />

      {dataPoints.map((point, index) => scores[dimensions[index].id] !== null && (
        <circle
          key={dimensions[index].id}
          cx={point.x}
          cy={point.y}
          r="4"
          fill={dimensions[index].color}
          stroke="white"
          strokeWidth="2"
          aria-hidden="true"
        />
      ))}

      {dimensions.map((dimension, index) => {
        const labelPoint = radarPoint(index, dimensions.length, 100, CENTER, 132);
        const textAnchor = labelPoint.x < CENTER - 12
          ? 'start'
          : labelPoint.x > CENTER + 12
            ? 'end'
            : 'middle';
        const value = scores[dimension.id];
        return (
          <text
            key={dimension.id}
            x={labelPoint.x}
            y={labelPoint.y}
            textAnchor={textAnchor}
            className="fill-[#5f4c3a] text-[11px] font-bold"
          >
            <tspan x={labelPoint.x} dy="0">{dimension.label}</tspan>
            <tspan x={labelPoint.x} dy="15" className="fill-[#8b735c] font-medium">
              {value === null ? '信息不足' : `${value}%`}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run component and geometry tests**

```powershell
npm.cmd test -- components/tools/test/assessment/AssessmentRadarChart.test.tsx components/tools/test/assessment/radarGeometry.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the chart component**

```powershell
git add -- SD/components/tools/test/assessment/AssessmentRadarChart.tsx SD/components/tools/test/assessment/AssessmentRadarChart.test.tsx
git commit -m "feat: add accessible assessment radar chart"
```

### Task 3: Integrate the chart into results

**Files:**
- Modify: `SD/components/tools/test/assessment/AssessmentResult.tsx`
- Test: `SD/components/tools/test/assessment/AssessmentResult.test.tsx`

- [ ] **Step 1: Write failing result integration tests**

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { communicationStyleDefinition } from './definitions/communicationStyle';
import { mbtiDefinition } from './definitions/mbti';
import { AssessmentResult } from './AssessmentResult';
import type { AssessmentScoreResult } from './types';

const baseResult = {
  rankedDimensionIds: [],
  closeDimensionIds: [],
  insufficientDimensionIds: [],
};

it('shows the radar chart before exact bars for non-MBTI results', () => {
  const score: AssessmentScoreResult = {
    ...baseResult,
    dimensionScores: { direct: 80, analytical: 60, empathetic: 40, collaborative: 20 },
    rankedDimensionIds: ['direct', 'analytical', 'empathetic', 'collaborative'],
    primaryResultId: 'direct',
    secondaryResultId: 'analytical',
  };
  const html = renderToStaticMarkup(
    <AssessmentResult definition={communicationStyleDefinition} score={score} onRestart={() => {}} onClose={() => {}} />,
  );
  expect(html).toContain('沟通风格测试维度雷达图');
  expect(html).toContain('本次回答中的相对倾向');
});

it('keeps MBTI pair bars without a radar chart', () => {
  const score: AssessmentScoreResult = {
    ...baseResult,
    dimensionScores: { E: 60, I: 40, S: 55, N: 45, T: 70, F: 30, J: 65, P: 35 },
    mbtiType: 'ESTJ',
  };
  const html = renderToStaticMarkup(
    <AssessmentResult definition={mbtiDefinition} score={score} onRestart={() => {}} onClose={() => {}} />,
  );
  expect(html).not.toContain('维度雷达图');
  expect(html).toContain('E · 60');
  expect(html).toContain('I · 40');
});
```

- [ ] **Step 2: Run the result test and verify RED**

```powershell
npm.cmd test -- components/tools/test/assessment/AssessmentResult.test.tsx
```

Expected: the non-MBTI test FAILS because no radar chart is rendered; the MBTI assertion remains green.

- [ ] **Step 3: Integrate the chart**

Import `AssessmentRadarChart`. Add `chart` colors to the existing group style entries:

```ts
fun: {
  chart: '#a34d24',
  eyebrow: 'text-[#a34d24]',
  wash: 'from-[#fff0d8] via-[#fff8ed] to-[#f3eadf]',
  border: 'border-[#e6bd8c]',
  button: 'bg-[#a34d24] hover:bg-[#853b1a]',
},
personality: {
  chart: '#6d4c8d',
  eyebrow: 'text-[#6d4c8d]',
  wash: 'from-[#f2e9f7] via-[#fffaf2] to-[#e9eee2]',
  border: 'border-[#cbb4d8]',
  button: 'bg-[#6d4c8d] hover:bg-[#573b72]',
},
orientation: {
  chart: '#8d5265',
  eyebrow: 'text-[#8d5265]',
  wash: 'from-[#f7e8eb] via-[#fffaf2] to-[#e4efea]',
  border: 'border-[#d6b3bd]',
  button: 'bg-[#8d5265] hover:bg-[#744153]',
},
```

Immediately after the “维度地图” heading block and before the current MBTI/non-MBTI branch, render:

```tsx
{definition.mode !== 'mbti' && definition.dimensions.length >= 3 && (
  <div className="mb-7 rounded-2xl border border-[#ead9c5] bg-white/60 px-2 py-4 sm:px-4">
    <AssessmentRadarChart
      title={definition.title}
      dimensions={definition.dimensions}
      scores={score.dimensionScores}
      accentColor={style.chart}
    />
    <p className="px-3 text-center text-xs leading-5 text-[#8b735c]">
      百分比表示本次回答中的相对倾向，不是人群百分位；下方柱状图可查看准确数值与说明。
    </p>
  </div>
)}
```

- [ ] **Step 4: Run focused and assessment tests**

```powershell
npm.cmd test -- components/tools/test/assessment/AssessmentResult.test.tsx components/tools/test/assessment/AssessmentRadarChart.test.tsx components/tools/test/assessment
```

Expected: all assessment tests PASS.

- [ ] **Step 5: Commit result integration**

```powershell
git add -- SD/components/tools/test/assessment/AssessmentResult.tsx SD/components/tools/test/assessment/AssessmentResult.test.tsx
git commit -m "feat: visualize assessment dimensions with radar chart"
```

### Task 4: Full verification and responsive smoke test

**Files:**
- Verify only; modify assessment files only if a failing test identifies a radar-specific defect.

- [ ] **Step 1: Run automated verification in order**

```powershell
cd E:\AI\gp\SD
npm.cmd run validate
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: registry reports 184 tools; Vitest has zero failures; TypeScript exits 0; Vite build succeeds.

- [ ] **Step 2: Run source and scope checks**

```powershell
rg -n "recharts|chart\.js|d3" components/tools/test/assessment
git diff --check
git status --short
```

Expected: no chart-library import; no whitespace errors; only planned radar files plus pre-existing unrelated workspace changes.

- [ ] **Step 3: Run desktop and 390px smoke checks**

Start the local app and open `/tool/communication-style-test`, complete enough answers to reach the result, and verify the radar has four labeled axes followed by four exact-value bars. At a 390px viewport verify `document.documentElement.scrollWidth <= window.innerWidth`. Open `/tool/mbti-test` and verify there is no radar chart and the four pair bars remain visible. Open a sensitive assessment with skipped dimensions and verify the SVG accessible description says “信息不足”.

- [ ] **Step 4: Stop the local server and inspect final diff**

Stop only the server process started in Step 3. Confirm no generated output is staged and no unrelated file was modified by this implementation.
