from workers.ths_hot_concepts import parse_concept_detail, parse_fund_flow_page


FUND_FLOW_HTML = """
<span class="page_info">1/1</span>
<table>
  <thead><tr>
    <th>序号</th><th>行业</th><th>行业指数</th><th>涨跌幅</th>
    <th>流入资金(亿)</th><th>流出资金(亿)</th><th>净额(亿)</th>
    <th>公司家数</th><th>领涨股</th><th>涨跌幅</th><th>当前价(元)</th>
  </tr></thead>
  <tbody>
    <tr><td>1</td><td>机器人</td><td>1000</td><td>4.20%</td>
      <td>20</td><td>12</td><td>8</td><td>80</td><td>甲公司</td><td>10%</td><td>12</td></tr>
  </tbody>
</table>
"""


DETAIL_HTML = """
<div class="board-infos">
  <dl>
    <dt>板块涨幅</dt><dd>4.20%</dd>
    <dt>涨跌家数</dt><dd>60 20</dd>
    <dt>成交额(亿)</dt><dd>500</dd>
  </dl>
</div>
<table>
  <thead><tr><th>序号</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅(%)</th></tr></thead>
  <tbody><tr><td>1</td><td>600001</td><td>甲公司</td><td>12</td><td>9.80</td></tr></tbody>
</table>
"""


def test_parse_fund_flow_page_reads_current_concept_metrics() -> None:
    rows = parse_fund_flow_page(FUND_FLOW_HTML)

    assert rows == [{"name": "机器人", "pct": 4.2, "company_count": 80}]


def test_parse_concept_detail_reads_breadth_turnover_and_members() -> None:
    snapshot = parse_concept_detail("机器人", "301024", DETAIL_HTML)

    assert snapshot.name == "机器人"
    assert snapshot.code == "301024"
    assert snapshot.pct == 4.2
    assert snapshot.turnover_yi == 500.0
    assert snapshot.up_count == 60
    assert snapshot.down_count == 20
    assert [(item.symbol, item.name, item.pct) for item in snapshot.members] == [
        ("600001", "甲公司", 9.8)
    ]
