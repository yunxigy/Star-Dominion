import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { MomIndexSnapshot } from "../types";
import { MomIndexPanel } from "./MomIndexPanel";


const snapshot: MomIndexSnapshot = {
  snapshot_date: "2026-07-27",
  generated_at: "2026-07-27T08:31:00+08:00",
  completeness: "partial",
  stale: true,
  sectors: {
    nasdaq: {
      sector_id: "nasdaq",
      name: "纳斯达克",
      index: 52.4,
      buy_index: 46.2,
      sell_index: 8.1,
      total_posts: 31,
      valid_posts: 29,
      newbie_posts: 8,
      newbie_ratio: 27.6,
      buy_count: 5,
      sell_count: 1,
      risk_level: "warming",
      interpretation: "开始升温",
      top_posts: [],
    },
    gold: {
      sector_id: "gold",
      name: "黄金",
      index: 61,
      buy_index: 12,
      sell_index: 65,
      total_posts: 28,
      valid_posts: 26,
      newbie_posts: 9,
      newbie_ratio: 34.6,
      buy_count: 1,
      sell_count: 6,
      risk_level: "warning",
      interpretation: "高度警惕",
      top_posts: [],
    },
    cpo: {
      sector_id: "cpo",
      name: "CPO 通信",
      index: 38,
      buy_index: 42,
      sell_index: 4,
      total_posts: 22,
      valid_posts: 22,
      newbie_posts: 4,
      newbie_ratio: 18.2,
      buy_count: 3,
      sell_count: 0,
      risk_level: "normal",
      interpretation: "正常区间",
      top_posts: [],
    },
    semiconductor: {
      sector_id: "semiconductor",
      name: "半导体",
      index: 77,
      buy_index: 72,
      sell_index: 3,
      total_posts: 40,
      valid_posts: 38,
      newbie_posts: 15,
      newbie_ratio: 39.5,
      buy_count: 12,
      sell_count: 0,
      risk_level: "extreme",
      interpretation: "极度狂热",
      top_posts: [],
    },
  },
  sources: [
    {
      source_id: "eastmoney",
      status: "ok",
      collected_at: "2026-07-27T08:30:00+08:00",
      post_count: 121,
      message: null,
    },
    {
      source_id: "xiaohongshu",
      status: "login_required",
      collected_at: "2026-07-27T08:30:00+08:00",
      post_count: 0,
      message: "需要重新登录",
    },
  ],
};


it("renders four sectors, real source status and stale warning", () => {
  render(<MomIndexPanel snapshot={snapshot} history={[snapshot]} />);

  expect(screen.getByText("纳斯达克")).toBeInTheDocument();
  expect(screen.getByText("黄金")).toBeInTheDocument();
  expect(screen.getByText("CPO 通信")).toBeInTheDocument();
  expect(screen.getByText("半导体")).toBeInTheDocument();
  expect(screen.getByText("小红书需要重新登录")).toBeInTheDocument();
  expect(screen.getByText("当前展示最近真实快照")).toBeInTheDocument();
});


it("shows administrator refresh and login actions", () => {
  const onRefresh = vi.fn();
  const onLogin = vi.fn();
  render(
    <MomIndexPanel
      snapshot={snapshot}
      history={[]}
      admin={{ refreshing: false, onRefresh, onLogin }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "立即刷新宝妈指数" }));
  fireEvent.click(screen.getByRole("button", { name: "打开小红书登录窗口" }));
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(onLogin).toHaveBeenCalledOnce();
});
