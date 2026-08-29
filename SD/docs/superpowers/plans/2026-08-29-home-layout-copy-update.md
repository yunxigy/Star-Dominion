# 首页布局与广告词调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧首页右侧时钟与分类入口的垂直布局，并将首页首条广告词更新为 200+ 免费在线工具。

**Architecture:** 继续使用 `HomePage` 现有的响应式两列结构和 Tailwind utility classes。外层网格改为顶部对齐，右侧卡片保留 `flex-col` 与 `gap-8`，移除 `justify-between`，让卡片按自身内容高度、内容按自然文档流排列；广告词只修改 `TypewriterText` 的首条静态文案。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, ESLint, Vite。

---

### Task 1: Add homepage source contracts

**Files:**
- Create: `pages/homePageSourceContract.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');

describe('homepage spacing and copy contract', () => {
  it('uses the 200+ online-tools headline copy', () => {
    expect(source).toContain("'200+ 免费在线工具，助力高效工作'");
    expect(source).not.toContain("'100+ 免费在线工具，助力高效工作'");
  });

  it('keeps the right rail in natural flow instead of distributing a forced gap', () => {
    expect(source).toContain('className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px] items-start"');
    expect(source).not.toContain('items-stretch');
    expect(source).toContain('className="glass-card rounded-[2rem] p-6 sm:p-8 flex flex-col gap-8"');
    expect(source).not.toContain('flex flex-col justify-between gap-8');
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm.cmd test -- --run pages/homePageSourceContract.test.ts`

Expected: FAIL because `HomePage.tsx` still contains the `100+` copy and `justify-between`.

### Task 2: Apply the homepage spacing and copy update

**Files:**
- Modify: `pages/HomePage.tsx:83-137`

- [ ] **Step 1: Replace the stale copy**

```tsx
<TypewriterText texts={[
  '200+ 免费在线工具，助力高效工作',
  '本地优先，隐私分级保护',
  'PDF、图片、开发、计算一应俱全',
  '持续更新，更多功能敬请期待'
]} />
```

- [ ] **Step 2: Let the right rail flow naturally**

```tsx
<section className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px] items-start">
```

```tsx
className="glass-card rounded-[2rem] p-6 sm:p-8 flex flex-col gap-8"
```

- [ ] **Step 3: Run the focused regression test**

Run: `npm.cmd test -- --run pages/homePageSourceContract.test.ts`

Expected: PASS with 2 tests passing.

### Task 3: Verify the full frontend quality gates

**Files:**
- No additional files.

- [ ] **Step 1: Run the complete test suite**

Run: `npm.cmd test -- --run --reporter=dot`

Expected: all existing tests pass with 0 failures.

- [ ] **Step 2: Run lint**

Run: `npm.cmd run lint`

Expected: exit code 0 with no lint errors.

- [ ] **Step 3: Run the production build**

Run: `npm.cmd run build`

Expected: Vite completes successfully with exit code 0.

- [ ] **Step 4: Commit the implementation**

```bash
git add pages/HomePage.tsx pages/homePageSourceContract.test.ts
git commit -m "fix: tighten homepage rail spacing and update tool copy"
```
