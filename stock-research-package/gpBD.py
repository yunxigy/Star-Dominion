import os
import time
import datetime
import logging
import pandas as pd
import akshare as ak
import requests
import json
import re
from prettytable import PrettyTable

# ====================== 0. 彻底屏蔽系统代理网络 ======================
# 屏蔽代理（涵盖大小写），防止请求国内数据源（如东方财富）时报错或被拦截
proxy_keys = ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]
for key in proxy_keys:
    if key in os.environ:
        del os.environ[key]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# 【请填入你自己的硅基流动 Key】
SILICONFLOW_API_KEY = os.environ.get("SILICONFLOW_API_KEY", "").strip()

# ====================== 1. 抓取近期热门板块 (加入强力重试防断线) ======================
def get_top_hot_concept_stocks(top_n=10):
    logging.info(f"正在获取今日全市场热度及涨幅前 {top_n} 大风口板块...")

    # 增加最多3次的自动重试机制
    for attempt in range(3):
        try:
            time.sleep(1) # 增加请求间隔，防止被防爬虫误杀
            board_df = ak.stock_board_concept_name_em()

            if board_df is None or board_df.empty:
                logging.warning("抓取到的数据为空，尝试重试...")
                continue

            # 综合排序：选取涨幅高且换手率活跃的板块（完全保留情绪板块）
            hot_boards = board_df[board_df['换手率'] > 2.0].sort_values(by=['涨跌幅', '换手率'], ascending=[False, False]).head(top_n)
            hot_concepts_names = hot_boards['板块名称'].tolist()
            logging.info(f"🔥 今日最强热度与情绪风口：{', '.join(hot_concepts_names)}")

            hot_stocks_pool = {}
            for concept in hot_concepts_names:
                cons_df = ak.stock_board_concept_cons_em(symbol=concept)
                for _, row in cons_df.iterrows():
                    code = row['代码']
                    if code not in hot_stocks_pool:
                        hot_stocks_pool[code] = {'名称': row['名称'], '所属热门板块': [concept]}
                    else:
                        hot_stocks_pool[code]['所属热门板块'].append(concept)
                # 遍历板块成分股时必须有停顿，否则容易被封IP
                time.sleep(0.3)

            return hot_stocks_pool

        except Exception as e:
            logging.error(f"第 {attempt + 1} 次获取热门板块失败: {e}")
            if attempt < 2:
                logging.info("休息 3 秒后准备重试...")
                time.sleep(3)
            else:
                logging.error("重试次数耗尽，请检查网络或彻底关闭系统代理软件(如Clash/v2ray的TUN模式)。")
                return {}

# ====================== 2. 个股近期公告抓取与 AI 排雷 ======================
def get_recent_announcements(code: str) -> str:
    try:
        url = f"https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=10&page_index=1&ann_type=A&client_source=web&stock_list={code}"
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.get(url, headers=headers, timeout=5).json()
        articles = res.get('data', {}).get('list', [])
        news_list = []
        for a in articles:
            title = a.get('art_title', '')
            date_str = a.get('notice_date', '')[:10]
            if "决议公告" in title or "日常关联交易" in title: continue
            news_list.append(f"[{date_str}] {title}")
        return "\n".join(news_list[:5]) if news_list else "近期无重大公告"
    except Exception:
        return "公告获取失败"

class LLMRiskController:
    def __init__(self):
        self.api_url = "https://api.siliconflow.cn/v1/chat/completions"
        self.api_key = SILICONFLOW_API_KEY
        if not self.api_key:
            raise RuntimeError("请先设置 SILICONFLOW_API_KEY 环境变量")
        self.model = "Qwen/Qwen3.5-122B-A10B"

    def review_stock(self, name: str, concepts: str, news_text: str) -> dict:
        prompt = f"""
你是A股顶级短线游资风控总监。我通过量化技术面选出了股票【{name}】，所属热门概念是：【{concepts}】。
以下是该股近几天的官方重要公告：
{news_text}

请帮我做最后的【排雷】和【亮点提炼】。严格按JSON格式返回：
{{
    "is_safe": true 或者 false, (有减持、亏损、立案、退市风险必填false)
    "risk_warning": "具体的利空雷点说明，若无重大利空请填'基本面安全'",
    "core_logic": "一句话概括核心炒作题材"
}}
"""
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {"model": self.model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.1, "max_tokens": 512}
        try:
            response = requests.post(self.api_url, json=payload, headers=headers, timeout=20)
            raw_result = response.json()["choices"][0]["message"]["content"].strip()
            # 用正则表达式暴力提取JSON，防止大模型加废话
            match = re.search(r'\{.*\}', raw_result, re.DOTALL)
            if match:
                return json.loads(match.group(0))
            return {"is_safe": True, "risk_warning": "AI解析失败", "core_logic": concepts}
        except Exception:
            return {"is_safe": True, "risk_warning": "AI调用超时", "core_logic": concepts}

# ====================== 3. 技术面量化核心策略 ======================
def check_2b_strategy(df: pd.DataFrame, curr: pd.Series) -> bool:
    """条件1：2B法则反转表现"""
    if len(df) < 150: return False
    if not (curr['EMA21'] > curr['EMA55'] > curr['EMA144']): return False
    support = df['最低'].rolling(window=20).min().shift(1).iloc[-1]
    last_3d = df.tail(3)
    fake_break = any(last_3d['最低'] < support * 0.995)
    recover = curr['收盘'] > support * 1.005
    if not (fake_break and recover): return False
    resistance = df['最高'].rolling(window=12).max().shift(1).iloc[-1]
    if (resistance - curr['收盘']) / curr['收盘'] < 0.04: return False
    if curr['成交量'] <= df.iloc[-2]['成交量']: return False
    return True

def check_ma5_trend_strategy(df: pd.DataFrame, curr: pd.Series) -> bool:
    """条件2：沿5日线趋势上涨 (首板涨停后，连续小幅或中幅上涨)"""
    if len(df) < 15: return False
    if curr['收盘'] < curr['MA5'] or curr['MA5'] < df.iloc[-2]['MA5']: return False

    recent_10_days = df.tail(10)
    limit_up_days = recent_10_days[recent_10_days['涨跌幅'] >= 9.5]
    if limit_up_days.empty: return False

    first_board_idx = None
    for idx in limit_up_days.index:
        if idx > df.index[0] and df.loc[idx - 1, '涨跌幅'] < 9.5:
            first_board_idx = idx
            break
    if first_board_idx is None: return False

    days_after = df.loc[first_board_idx + 1:]
    if days_after.empty: return False

    for _, row in days_after.iterrows():
        if row['最低'] < row['MA5'] * 0.985: return False
        if row['涨跌幅'] < -4.0 or row['涨跌幅'] > 8.0: return False
    return True

def get_dragon_tag(df: pd.DataFrame, curr: pd.Series) -> str:
    """条件3：龙头筛选 (热门题材龙头、补涨龙、情绪龙)"""
    if len(df) < 10: return ""
    recent_5_days = df.tail(5)

    consecutive_boards = 0
    max_consecutive = 0
    for pct in recent_5_days['涨跌幅']:
        if pct >= 9.5:
            consecutive_boards += 1
            max_consecutive = max(max_consecutive, consecutive_boards)
        else:
            consecutive_boards = 0

    if max_consecutive >= 3:
        return "🔥情绪妖王(≥3连板)"
    if max_consecutive == 2:
        return "🔥连板情绪龙"

    if len(df) >= 5:
        today_up = curr['涨跌幅'] >= 9.5
        yesterday_rest = df.iloc[-2]['涨跌幅'] < 5.0
        prev_up = any(df.iloc[-5:-2]['涨跌幅'] >= 9.5)
        if today_up and yesterday_rest and prev_up:
            return "🐉反包/补涨龙"

    past_10_days_gain = (curr['收盘'] - df.iloc[-10]['收盘']) / df.iloc[-10]['收盘']
    if past_10_days_gain > 0.35 and curr['收盘'] > curr['MA5']:
        return "👑题材趋势龙头"

    return ""

# ====================== 4. 主程序：本地执行 ======================
def local_stock_screener():
    print("\n" + "="*80)
    print("🚀 启动本地硬核游资选股引擎 (热度板块 + 2B/5日线/龙头 并集筛选)")
    print("="*80)

    hot_stocks_pool = get_top_hot_concept_stocks(top_n=10)
    if not hot_stocks_pool:
        print("热门板块全军覆没，请排查网络后重试。")
        return

    one_year_ago = (datetime.datetime.now() - datetime.timedelta(days=365)).strftime("%Y%m%d")
    tech_passed_stocks = []

    processed_count = 0
    total_count = len(hot_stocks_pool)

    logging.info(f"第一阶段：开始在 {total_count} 只真实热门股中寻找符合【2B / 首板推升 / 龙头】的标的...")
    for code, info in hot_stocks_pool.items():
        processed_count += 1
        name = info['名称']
        concepts = ",".join(info['所属热门板块'][:2])

        if 'ST' in name or not code.startswith(('600','601','603','000','001','002')):
            continue

        print(f"\r正在处理技术面: {processed_count}/{total_count} [{name}]...     ", end="", flush=True)

        try:
            df = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=one_year_ago, adjust="qfq")
            if df.empty or len(df) < 20: continue

            df['MA5'] = df['收盘'].rolling(window=5).mean()
            df['EMA21'] = df['收盘'].ewm(span=21, adjust=False).mean()
            df['EMA55'] = df['收盘'].ewm(span=55, adjust=False).mean()
            df['EMA144'] = df['收盘'].ewm(span=144, adjust=False).mean()
            curr = df.iloc[-1]

            if curr['涨跌幅'] <= 0: continue

            is_2b = check_2b_strategy(df, curr)
            is_ma5 = check_ma5_trend_strategy(df, curr)
            dragon_tag = get_dragon_tag(df, curr)

            if is_2b or is_ma5 or dragon_tag:
                tags = []
                if dragon_tag: tags.append(dragon_tag)
                if is_ma5: tags.append("📈首板5日线推升")
                if is_2b: tags.append("🎯2B法则反转")

                tech_passed_stocks.append({
                    "代码": code, "名称": name, "收盘价": round(curr['收盘'], 2),
                    "今日涨幅(%)": round(curr['涨跌幅'], 2), "命中策略": " + ".join(tags),
                    "概念": concepts
                })
        except Exception:
            pass
        time.sleep(0.05)

    print("\n" + "-"*80)
    logging.info(f"第一阶段完成！初选出 {len(tech_passed_stocks)} 只符合要求的极品标的。")
    if not tech_passed_stocks:
        print("📉 今日未能选出符合技术面的标的，提前结束。")
        return

    logging.info("第二阶段：召唤 AI 风控总监，调阅近期官方公告进行排雷...")
    ai_controller = LLMRiskController()
    final_results = []

    for idx, stock in enumerate(tech_passed_stocks):
        print(f"🕵️ 正在排雷 ({idx+1}/{len(tech_passed_stocks)}): {stock['名称']}")
        announcements = get_recent_announcements(stock['代码'])
        llm_res = ai_controller.review_stock(stock['名称'], stock['概念'], announcements)

        stock['AI评价'] = llm_res.get('core_logic', '无')
        if not llm_res.get('is_safe', True):
            stock['风控状态'] = f"❌ 危险: {llm_res.get('risk_warning')}"
        else:
            stock['风控状态'] = "✅ 安全"

        final_results.append(stock)
        time.sleep(1)

    print("\n\n" + "="*100)
    print("🎉 选股与排雷完毕！今日终极兵器谱如下：")

    table = PrettyTable()
    table.field_names = ["代码", "名称", "涨幅(%)", "命中策略", "风控状态", "核心炒作与排雷评价"]
    table.align = "l"

    for res in final_results:
        status = res["风控状态"]
        if "❌" in status: status = f"\033[91m{status}\033[0m"
        table.add_row([res["代码"], res["名称"], res["今日涨幅(%)"], res["命中策略"], status, res["AI评价"]])

    print(table)

    out_file = f"游资并集策略选股_{datetime.datetime.now().strftime('%Y%m%d')}.xlsx"
    pd.DataFrame(final_results).to_excel(out_file, index=False)
    print(f"\n📂 包含详细报告的 Excel 已自动导出至同目录: {out_file}")
    print("="*100)

if __name__ == "__main__":
    local_stock_screener()
