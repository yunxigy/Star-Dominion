import os
import time
import datetime
import logging
import random
import pandas as pd
import akshare as ak
from prettytable import PrettyTable

# ====================== 0. 彻底屏蔽系统代理网络 ======================
os.environ["http_proxy"] = ""
os.environ["https_proxy"] = ""
os.environ["all_proxy"] = ""
for k in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]:
    if k in os.environ:
        del os.environ[k]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

def get_latest_trade_date() -> str:
    today = datetime.datetime.now()
    if today.weekday() == 5: today -= datetime.timedelta(days=1)
    elif today.weekday() == 6: today -= datetime.timedelta(days=2)
    return today.strftime("%Y%m%d")

# ====================== 1. 核心装甲：带内存缓存的数据路由器 ======================
class DataFetcher:
    # 【核心升级】添加类级别内存缓存，绝不重复请求全市场数据！
    _spot_cache = pd.DataFrame()

    @staticmethod
    def _find_col(df: pd.DataFrame, possible_names: list) -> str:
        for name in possible_names:
            if name in df.columns: return name
            # 模糊匹配
            for col in df.columns:
                if name in str(col): return col
        return None

    @classmethod
    def get_spot_data(cls) -> pd.DataFrame:
        """获取全市场行情 (带内存缓存 + 降级机制)"""
        # 如果内存里已经有了，直接秒回！节省一次巨大的网络请求
        if not cls._spot_cache.empty:
            return cls._spot_cache.copy()

        time.sleep(random.uniform(0.5, 1.5))
        try:
            df = ak.stock_zh_a_spot_em()
            if df is not None and not df.empty:
                cls._spot_cache = df.copy() # 存入缓存
                return df
        except Exception:
            pass

        logging.info("♻️ 正在切换至备用接口 [新浪财经行情]...")
        try:
            df = ak.stock_zh_a_spot()
            if df is not None and not df.empty:
                df.rename(columns={'code': '代码', 'name': '名称', 'trade': '收盘',
                                   'changepercent': '涨跌幅'}, inplace=True)
                df['代码'] = df['代码'].astype(str).str[-6:]
                cls._spot_cache = df.copy() # 存入缓存
                return df
        except Exception as e:
            logging.error(f"❌ 备用新浪财经接口失效: {e}")

        return pd.DataFrame()

    @staticmethod
    def get_board_concepts() -> pd.DataFrame:
        """获取热门板块 (东财 -> 同花顺)"""
        time.sleep(random.uniform(0.5, 1.0))
        try:
            df = ak.stock_board_concept_name_em()
            if df is not None and not df.empty:
                return df
        except Exception:
            pass

        logging.info("♻️ 正在切换至备用接口 [同花顺板块]...")
        try:
            df = ak.stock_board_concept_name_ths()
            if df is not None and not df.empty:
                # 【全兼容匹配】不管同花顺叫概念、指数还是简称，统统揪出来
                c_name = DataFetcher._find_col(df, ['概念名称', '指数', '板块', '名称', '简称', 'name'])
                c_pct = DataFetcher._find_col(df, ['涨跌幅', '涨幅', 'pct'])

                if c_name: df.rename(columns={c_name: '板块名称'}, inplace=True)
                if c_pct: df.rename(columns={c_pct: '涨跌幅'}, inplace=True)
                if '换手率' not in df.columns: df['换手率'] = 100.0
                return df
        except Exception as e:
            logging.error(f"❌ 备用同花顺板块接口失效: {e}")

        return pd.DataFrame()

    @staticmethod
    def get_zt_pool(trade_date: str) -> pd.DataFrame:
        """获取涨停板梯队 (东财 -> 同花顺)"""
        time.sleep(random.uniform(0.5, 1.0))
        try:
            df = ak.stock_zt_pool_em(date=trade_date)
            if df is not None and not df.empty:
                col_lianban = DataFetcher._find_col(df, ['连板数', '连续涨停天数', '连板'])
                col_fengdan = DataFetcher._find_col(df, ['封单金额', '封单资金', '封板资金', '封单'])
                if col_lianban: df.rename(columns={col_lianban: '连板数'}, inplace=True)
                if col_fengdan: df.rename(columns={col_fengdan: '封单资金'}, inplace=True)
                return df
        except Exception:
            pass

        logging.info("♻️ 正在切换至备用接口 [同花顺涨停池]...")
        try:
            df = ak.stock_zt_pool_ths(date=trade_date)
            if df is not None and not df.empty:
                df.rename(columns={'股票代码': '代码', '股票简称': '名称', '封单额': '封单资金'}, inplace=True)
                return df
        except Exception:
             pass
        return pd.DataFrame()

    @staticmethod
    def get_hist_kline(code: str, start_date: str) -> pd.DataFrame:
        """获取个股日K线 (东财 -> 新浪)"""
        time.sleep(random.uniform(0.1, 0.4))
        try:
            df = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start_date, adjust="qfq")
            if df is not None and not df.empty:
                return df
        except Exception:
            pass

        try:
            prefix = "sh" if str(code).startswith("6") else "sz"
            df = ak.stock_zh_a_daily(symbol=f"{prefix}{code}", start_date=start_date, end_date="20990101", adjust="qfq")
            if df is not None and not df.empty:
                df.rename(columns={'date': '日期', 'open': '开盘', 'close': '收盘', 'high': '最高', 'low': '最低', 'volume': '成交量'}, inplace=True)
                df['收盘'] = pd.to_numeric(df['收盘'])
                df['涨跌幅'] = df['收盘'].pct_change() * 100
                return df
        except Exception:
            pass

        return pd.DataFrame()

# ====================== 2. 纯代码量化：判断大盘情绪与主线 ======================
def analyze_market_sentiment_and_theme() -> dict:
    logging.info("🌐 正在通过量化数据扫描全市场情绪与资金主线...")
    try:
        spot_df = DataFetcher.get_spot_data()
        if spot_df.empty:
            return {"sentiment": "全网接口瘫痪", "sentiment_reason": "-", "main_theme": "-", "theme_reason": "-"}

        spot_df['涨跌幅'] = pd.to_numeric(spot_df['涨跌幅'], errors='coerce').fillna(0)
        up_count = len(spot_df[spot_df['涨跌幅'] > 0])
        down_count = len(spot_df[spot_df['涨跌幅'] < 0])
        limit_up_count = len(spot_df[spot_df['涨跌幅'] >= 9.5])
        limit_down_count = len(spot_df[spot_df['涨跌幅'] <= -9.5])

        if limit_down_count > 30:
            sentiment, reason = "冰点 / 恐慌退潮", f"跌停 {limit_down_count} 家，亏钱效应炸裂。"
        elif limit_up_count > 80 and up_count > 3500:
            sentiment, reason = "高潮 / 主升浪", f"涨停 {limit_up_count} 家，上涨 {up_count} 家，情绪亢奋。"
        elif up_count > 3000:
            sentiment, reason = "普涨修复", f"上涨 {up_count} 家，下跌 {down_count} 家，市场回暖。"
        elif down_count > 3000:
            sentiment, reason = "普跌极寒", f"下跌 {down_count} 家，泥沙俱下。"
        else:
            sentiment, reason = "混沌分歧", f"上涨 {up_count} 家，下跌 {down_count} 家，涨停 {limit_up_count} 家，高低切。"

        board_df = DataFetcher.get_board_concepts()
        if not board_df.empty and '板块名称' in board_df.columns:
            blacklist = ["昨日", "连板", "涨停", "打板", "ST", "退市", "新股", "次新", "业绩", "股息", "百元", "微盘"]
            board_df['板块名称'] = board_df['板块名称'].astype(str)
            clean_board = board_df[~board_df['板块名称'].str.contains('|'.join(blacklist))]

            clean_board['涨跌幅'] = pd.to_numeric(clean_board.get('涨跌幅', 0), errors='coerce').fillna(0)
            clean_board['换手率'] = pd.to_numeric(clean_board.get('换手率', 0), errors='coerce').fillna(0)

            hot_boards = clean_board[clean_board['换手率'] > 2.0].sort_values(by=['涨跌幅', '换手率'], ascending=[False, False]).head(3)
            themes = hot_boards['板块名称'].tolist()

            if themes and hot_boards.iloc[0]['涨跌幅'] > 1.5:
                main_theme = " + ".join(themes)
                theme_reason = f"量价齐升，【{themes[0]}】大涨 {hot_boards.iloc[0]['涨跌幅']}%。"
            else:
                main_theme, theme_reason = "轮动期 / 无绝对主线", "板块涨幅较小，未见强大吸金题材。"
        else:
            main_theme, theme_reason = "获取失败", f"未能成功解析板块表头，当前表头：{list(board_df.columns) if not board_df.empty else '空'}"

        return {"sentiment": sentiment, "sentiment_reason": reason, "main_theme": main_theme, "theme_reason": theme_reason}
    except Exception as e:
        return {"sentiment": f"分析异常: {e}", "sentiment_reason": "-", "main_theme": "-", "theme_reason": "-"}

# ====================== 3. 情绪龙头战法 ======================
def select_dragon_stocks(trade_date: str) -> list:
    logging.info(f"🐉 正在解析 {trade_date} 涨停板梯队...")
    try:
        zt_pool = DataFetcher.get_zt_pool(trade_date)
        if zt_pool.empty: return []

        zt_pool = zt_pool[~zt_pool['名称'].str.contains('ST|N|C')]
        if '连板数' not in zt_pool.columns: return []

        max_height = pd.to_numeric(zt_pool['连板数'], errors='coerce').max()
        target_board = 3 if max_height > 5 else 2

        target_stocks = zt_pool[zt_pool['连板数'] == target_board].copy()
        if target_stocks.empty: return []

        if '封单资金' in target_stocks.columns:
            target_stocks['封单资金'] = pd.to_numeric(target_stocks['封单资金'], errors='coerce').fillna(0)
            target_stocks = target_stocks.sort_values(by='封单资金', ascending=False).head(5)
        else:
            target_stocks = target_stocks.head(5)

        results = []
        for _, row in target_stocks.iterrows():
            fd_val = row.get('封单资金', 0)
            fd_str = f"{fd_val / 100000000:.2f} 亿" if pd.notna(fd_val) and fd_val > 0 else "未知/盘后清空"

            col_hangye = DataFetcher._find_col(zt_pool, ['所属行业', '行业'])
            col_time = DataFetcher._find_col(zt_pool, ['最后封板时间', '首次封板时间', '封板时间'])

            results.append({
                "代码": row['代码'],
                "名称": row['名称'],
                "所属行业": row.get(col_hangye, '未知') if col_hangye else '未知',
                "当前连板": f"{row['连板数']}板",
                "封单金额": fd_str,
                "最后封板时间": str(row.get(col_time, '未知')) if col_time else '未知'
            })
        return results
    except Exception as e:
        logging.error(f"龙头选股失败: {e}")
        return []

# ====================== 4. 5日线强趋势战法 ======================
def select_trend_stocks() -> list:
    logging.info("📈 正在扫描5日线强趋势标的 (首板+依托5日线暴力推升)...")
    try:
        spot_df = DataFetcher.get_spot_data() # 这里直接秒读内存缓存！
        if spot_df.empty: return []

        spot_df = spot_df[~spot_df['名称'].str.contains('ST')]
        spot_df = spot_df[spot_df['代码'].astype(str).str.startswith(('600','601','603','000','001','002'))]

        condition = pd.to_numeric(spot_df['涨跌幅'], errors='coerce') >= 4.0

        if '换手率' in spot_df.columns:
            spot_df['换手率'] = pd.to_numeric(spot_df['换手率'], errors='coerce').fillna(0)
            condition = condition & (spot_df['换手率'] > 5.0)

        if '量比' in spot_df.columns:
            spot_df['量比'] = pd.to_numeric(spot_df['量比'], errors='coerce').fillna(0)
            condition = condition & (spot_df['量比'] > 1.2)

        candidates = spot_df[condition]

        trend_results = []
        one_year_ago = (datetime.datetime.now() - datetime.timedelta(days=60)).strftime("%Y%m%d")

        count = 0
        total_candidates = len(candidates)
        logging.info(f"缩圈完毕，锁定 {total_candidates} 只高热度候选股进行K线精扫。")

        for _, row in candidates.iterrows():
            code, name = row['代码'], row['名称']
            try:
                df = DataFetcher.get_hist_kline(code, one_year_ago)
                if df.empty or len(df) < 15: continue

                df['收盘'] = pd.to_numeric(df['收盘'], errors='coerce')
                df['MA5'] = df['收盘'].rolling(window=5).mean()
                curr = df.iloc[-1]

                if curr['收盘'] < curr['MA5'] or curr['MA5'] < df.iloc[-2]['MA5']: continue

                recent_10_days = df.tail(10)
                limit_up_days = recent_10_days[recent_10_days['涨跌幅'] >= 9.5]
                if limit_up_days.empty: continue

                first_board_idx = None
                for idx in limit_up_days.index:
                    if idx > df.index[0] and df.loc[idx - 1, '涨跌幅'] < 9.5:
                        first_board_idx = idx
                        break
                if first_board_idx is None: continue

                days_after = df.loc[first_board_idx + 1:]
                if days_after.empty: continue

                df['最低'] = pd.to_numeric(df['最低'], errors='coerce')
                broken_ma5 = any(days_after['最低'] < days_after['MA5'] * 0.99)
                if broken_ma5: continue

                avg_pct_chg = days_after['涨跌幅'].mean()
                min_pct_chg = days_after['涨跌幅'].min()

                if avg_pct_chg >= 4.0 and min_pct_chg > -1.5:
                    trend_results.append({
                        "代码": code,
                        "名称": name,
                        "近3日涨幅": f"{df.tail(3)['涨跌幅'].sum():.2f}%",
                        "日均推升幅度": f"{avg_pct_chg:.2f}%",
                        "技术形态": "首板后沿5日线暴力推升"
                    })

                if len(trend_results) >= 5: break

            except Exception:
                pass

            count += 1
            if count % 10 == 0:
                print(f"\r正在扫描K线: 已处理 {count}/{total_candidates}...", end="", flush=True)

        print()
        return trend_results

    except Exception as e:
        logging.error(f"趋势选股失败: {e}")
        return []

# ====================== 5. 主程序引擎 ======================
def main():
    print("\n" + "="*80)
    print("🚀 启动【量化破局者·极速缓存自愈版】")
    print("="*80)

    trade_date = get_latest_trade_date()

    market_analysis = analyze_market_sentiment_and_theme()
    dragon_picks = select_dragon_stocks(trade_date)
    trend_picks = select_trend_stocks()

    print("\n" + "🌟" * 40)
    print("【第一部分：数据大局观与资金主线】")
    print(f"🔮 盘面情绪定性：\033[1;31m{market_analysis.get('sentiment', '未知')}\033[0m")
    print(f"   ↳ 量化支撑：{market_analysis.get('sentiment_reason', '')}")
    print(f"🔥 当前资金主线：\033[1;33m{market_analysis.get('main_theme', '未知')}\033[0m")
    print(f"   ↳ 盘面动向：{market_analysis.get('theme_reason', '')}")
    print("🌟" * 40 + "\n")

    print("【第二部分：情绪龙头接力精选 (看封单定强弱)】")
    if dragon_picks:
        table_dragon = PrettyTable()
        table_dragon.field_names = ["股票代码", "股票名称", "所属板块", "梯队高度", "打板封单金额", "最后封板时间"]
        table_dragon.align = "l"
        for p in dragon_picks:
            table_dragon.add_row([p["代码"], p["名称"], p["所属行业"], p["当前连板"], p["封单金额"], p["最后封板时间"]])
        print(table_dragon)
        print("💡 游资心法：封单金额越大、封板时间越早，接力转天上板的确定性越高。")
    else:
        print("📉 今日梯队断层或数据未就绪，未选出符合高度的接力标的。")

    print("\n【第三部分：5日线趋势无敌精选 (首板后均涨幅>4%)】")
    if trend_picks:
        table_trend = PrettyTable()
        table_trend.field_names = ["股票代码", "股票名称", "近3日累计涨幅", "涨停后日均推升", "技术形态"]
        table_trend.align = "l"
        for p in trend_picks:
            table_trend.add_row([p["代码"], p["名称"], p["近3日涨幅"], p["日均推升幅度"], p["技术形态"]])
        print(table_trend)
        print("💡 游资心法：不涨停涨不停，这种票通常是机构与游资共振的中军，跌破5日线无条件止损。")
    else:
        print("📉 条件极其苛刻（每天推升超4%且不破5日线），今日全市场无符合的标的。")

    print("\n" + "="*80)

if __name__ == "__main__":
    main()