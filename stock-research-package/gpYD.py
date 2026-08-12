import os
import time
import json
import logging
import datetime
import pandas as pd
import akshare as ak
import schedule
import requests
import numpy as np
from tenacity import retry, stop_after_attempt, wait_exponential

# ====================== 0. 基础配置【仅需修改这里！】 ======================
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# 1. Server酱 SendKey（填写你自己的，消息自动转发企业微信）
PUSH_WEBHOOK_URL = os.environ.get("SERVERCHAN_SEND_KEY", "").strip()

# 2. 硅基流动 API Key
SILICONFLOW_API_KEY = os.environ.get("SILICONFLOW_API_KEY", "").strip()

# 全局配置
PROCESSED_IDS_FILE = "processed_news_ids.txt"
global_hot_concepts = set()
global_blacklist_stocks = set()

# 加载已处理新闻ID（防止重复推送）
def load_processed_ids():
    if os.path.exists(PROCESSED_IDS_FILE):
        with open(PROCESSED_IDS_FILE, "r", encoding="utf-8") as f:
            return set(f.read().splitlines())
    return set()

processed_news_ids = load_processed_ids()

def save_processed_id(news_id):
    with open(PROCESSED_IDS_FILE, "a", encoding="utf-8") as f:
        f.write(f"{news_id}\n")

# ====================== 1. Server酱 消息推送模块 ======================
def send_alert(title: str, content: str):
    """推送消息：Server酱 → 自动转发到你的企业微信群"""
    logging.info(f"【触发推送】{title}")
    if not PUSH_WEBHOOK_URL or PUSH_WEBHOOK_URL == "这里填写你的Server酱 SendKey":
        logging.warning("未配置SendKey，仅打印日志")
        return

    url = f"https://sctapi.ftqq.com/{PUSH_WEBHOOK_URL}.send"
    data = {"text": title, "desp": content}

    try:
        requests.post(url, data=data, timeout=5)
        logging.info(f"✅ 推送成功：{title}")
    except Exception as e:
        logging.error(f"❌ 推送失败：{str(e)}")

# ====================== 2. 硅基流动大模型舆情分析模块 ======================
class LLMAnalyzer:
    def __init__(self):
        self.api_url = "https://api.siliconflow.cn/v1/chat/completions"
        self.api_key = SILICONFLOW_API_KEY
        if not self.api_key:
            raise RuntimeError("请先设置 SILICONFLOW_API_KEY 环境变量")
        # 修正为硅基流动官方模型ID
        self.model = "Qwen/Qwen3.5-122B-A10B"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def analyze_news(self, text: str) -> dict:
        prompt = f"""
你是专业的A股分析师。严格按JSON格式返回，无多余内容：
1. sentiment: 重大利好/正面/中性/负面/突发利空
2. stocks: 涉及股票简称列表
3. concepts: 核心概念板块
4. reason: 理由(≤30字)

新闻：{text}
"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": 512
        }

        try:
            response = requests.post(self.api_url, json=payload, headers=headers, timeout=15)
            response.raise_for_status()
            result = response.json()["choices"][0]["message"]["content"].strip()

            if result.startswith("```"):
                result = result.replace("```json", "").replace("```", "").strip()
            return json.loads(result)
        except Exception as e:
            logging.error(f"模型分析失败：{e}")
            return {"sentiment": "中性", "stocks": [], "concepts": [], "reason": "解析失败"}

# ====================== 3. 实时财经新闻监控模块 ======================
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def get_realtime_news():
    return ak.stock_zh_a_alerts_cls()

def monitor_realtime_news():
    logging.info("开始监控实时财经新闻...")
    try:
        news_df = get_realtime_news()
        if news_df.empty:
            return

        analyzer = LLMAnalyzer()
        for _, row in news_df.head(5).iterrows():
            title = row['内容']
            news_id = str(hash(title))

            if news_id in processed_news_ids:
                continue
            processed_news_ids.add(news_id)
            save_processed_id(news_id)

            if len(title) < 15:
                continue

            analysis = analyzer.analyze_news(title)
            sentiment = analysis.get("sentiment")
            stocks = analysis.get("stocks", [])
            concepts = analysis.get("concepts", [])

            # 重大消息推送
            if sentiment in ["重大利好", "突发利空"]:
                msg = f"【{sentiment}】\n原因：{analysis['reason']}\n标的：{stocks}\n板块：{concepts}"
                send_alert(f"【舆情预警】{sentiment}", msg)

            # 更新黑名单/热门板块
            if sentiment in ["正面", "重大利好"]:
                global_hot_concepts.update(concepts)
            if sentiment in ["负面", "突发利空"]:
                global_blacklist_stocks.update(stocks)

    except Exception as e:
        logging.error(f"监控异常：{e}")

# ====================== 4. 优化版 2B法则选股核心模块 ======================
def check_2b_strategy(df: pd.DataFrame) -> bool:
    if len(df) < 150:
        return False

    # 1. 趋势判定：EMA21/55/144 多头排列
    df['EMA21'] = df['收盘'].ewm(span=21, adjust=False).mean()
    df['EMA55'] = df['收盘'].ewm(span=55, adjust=False).mean()
    df['EMA144'] = df['收盘'].ewm(span=144, adjust=False).mean()
    curr = df.iloc[-1]
    if not (curr.EMA21 > curr.EMA55 > curr.EMA144):
        return False

    # 2. 支撑位计算（无未来函数、无滞后）
    df['支撑位'] = df['最低'].rolling(window=20).min().shift(1)
    support = df['支撑位'].iloc[-1]
    if pd.isna(support):
        return False

    # 3. 2B核心：假跌破 + 有效收回
    last_3d = df.tail(3)
    fake_break = any(last_3d['最低'] < support * 0.995)    # 跌破≥0.5%
    recover = curr['收盘'] > support * 1.005                 # 收回≥1%
    if not (fake_break and recover):
        return False

    # 4. 上涨空间判定（BMS优化版）
    df['阻力位'] = df['最高'].rolling(window=12).max().shift(1)
    resistance = df['阻力位'].iloc[-1]
    if pd.isna(resistance):
        return False
    profit_space = (resistance - curr['收盘']) / curr['收盘']
    if profit_space < 0.04:
        return False

    # 5. 量能+反弹过滤
    if curr['成交量'] <= df.iloc[-2]['成交量']:
        return False
    bounce = (curr['收盘'] - last_3d['最低'].min()) / last_3d['最低'].min()
    if bounce < 0.015:
        return False

    return True

# ====================== 5. 盘后自动选股 ======================
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def get_hist_data(code, start_date):
    return ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start_date, adjust="qfq")

def daily_stock_selection():
    logging.info("开始执行2B法则盘后选股...")
    try:
        spot_df = ak.stock_zh_a_spot_em()
        # 过滤：剔除ST、只做主板
        spot_df = spot_df[~spot_df['名称'].str.contains('ST')]
        spot_df = spot_df[spot_df['代码'].str.startswith(('600','601','603','000','001','002'))]

        # 初选：红盘+活跃度
        candidates = spot_df[(spot_df['涨跌幅']>0) & (spot_df['换手率']>2)]
        logging.info(f"初选标的：{len(candidates)} 只")

        selected = []
        one_year_ago = (datetime.datetime.now()-datetime.timedelta(days=365)).strftime("%Y%m%d")

        for _, row in candidates.iterrows():
            code, name = row['代码'], row['名称']
            if name in global_blacklist_stocks:
                continue

            try:
                hist_df = get_hist_data(code, one_year_ago)
                if hist_df.empty:
                    continue
                if check_2b_strategy(hist_df):
                    selected.append(f"{name}({code})")
                    logging.info(f"✅ 选中：{name}")
            except Exception as e:
                logging.warning(f"{name} 数据获取失败")

            if len(selected) >= 20:
                break
            time.sleep(0.3)

        # 推送选股结果
        if selected:
            msg = f"今日2B法则精选标的：\n" + "\n".join(selected)
        else:
            msg = "今日无符合标准的2B信号，空仓等待"
        send_alert("【2B法则盘后选股报告】", msg)

    except Exception as e:
        logging.error(f"选股崩溃：{e}")

# ====================== 6. 调度与主程序 ======================
def is_trading_time():
    now = datetime.datetime.now()
    if now.weekday() >=5:
        return False
    t = now.time()
    return (datetime.time(9,15)<=t<=datetime.time(11,30)) or (datetime.time(13,0)<=t<=datetime.time(15,0))

def job_realtime():
    if is_trading_time():
        monitor_realtime_news()

def main():
    print("="*60)
    print("🚀 2B法则量化监控系统 最终版 启动成功")
    print("📩 消息自动推送：企业微信")
    print("="*60)

    # 定时任务
    schedule.every(5).minutes.do(job_realtime)
    schedule.every().day.at("15:30").do(daily_stock_selection)

    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == "__main__":
    main()
