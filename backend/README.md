# 取水小站：称重售水柜

工作目录中的 `STM32/`、`backend/`、`xcx/` 构成售水链路。根目录 `dist/` 是原有结构设计网页，本次保留原样；设备维护页是 `backend/public/index.html`。

## 本次修复

| 链路 | 原问题 | 当前行为 |
| --- | --- | --- |
| HX711 → 单片机 → TCP | 原始 ADC 通过 `WEIGHT` 发送，被服务器当成克；只在关门后上报，且可能是旧样本 | 每 250ms 读取并发送 `RAW`，读失败发送 `SENSOR:ERROR`，不重发缓存重量 |
| 门检测 | 仅在门状态变化时上报，新连接一直 UNKNOWN | 启动上报，每 10 秒注册时同步，变化时经防抖立即上报 |
| TCP 注册 | 同连接重复 REG 会清空门状态和重量 | 重复注册只更新活跃时间；新连接替换旧连接会中断未完成会话 |
| UART 下行 | 双缓冲覆盖可能丢掉 OPEN；超长行的尾部可能被误当命令 | 四行 FIFO，整行丢弃溢出/错误帧，保留完整 OPEN/PONG 顺序 |
| 开门 → 取水 | 没有基线、净取水数量与取货会话 | 开门前取稳定基线，实时按净减量识别整瓶水，放回会减少数量 |
| 关门 → 确认 | 仅保存当前重量，无稳定判断 | 实际门检测回报后立即显示关门，至少等待 1 秒及 3 个新稳定样本后确认数量 |
| 设备失联/称重断流 | 页面可能继续显示旧状态和旧瓶数 | 活动会话瓶数清空，明确等待恢复或中断；已完成结果保持不变 |
| 小程序 | 原型开锁页、URL 解析依赖浏览器全局、旧请求覆盖新状态 | 蓝白页面、扫码/编号连接、实时瓶数、状态步骤、关门通知、页面恢复与过期请求保护 |
| 联调脚本 | API 脚本仍用 3000，后端实际 38080 | 默认统一 HTTP 38080/TCP 9001，可用环境变量调整；测试各自使用空闲端口 |

当前仅识别同一种、整瓶毛重一致的水。没有接入账户、支付、订单扣费。开门和设备注册仍是原型接口，不能视为商业运营的授权系统；对外营业前需顾客身份、设备认证和开门授权。管理标定接口已经单独要求 ADMIN_TOKEN。

## 启动后端和标定入口

Node.js 20+，无第三方依赖。在项目根目录使用 PowerShell：

```powershell
$env:ADMIN_TOKEN = Read-Host '设置本次服务的标定管理令牌'
node backend/server.mjs
```

打开 `http://127.0.0.1:38080/`，设备编号默认为 `CABINET001`。展开“称重标定”：

1. 清空称重托盘，等 RAW 稳定，点击“将当前 RAW 填入空载值”。
2. 放上准确称过的已知负载，稳定后点击“将当前 RAW 填入负载值”。
3. 输入已知负载克数，以及一整瓶水（包含瓶与盖）的实测毛重。
4. 填入启动时的管理令牌并保存。令牌只在内存中使用，不保存到浏览器存储，也不进入小程序。

未标定仍可调试开门，瓶数显示 `—` / “设备待标定”，不会假设水是 500g。已知负载可以是一瓶水，负载克数与整瓶毛重都填实际称量值。零点与负载 RAW 都必须是新的 `RAW` 协议读数，不能混用 HX711 不同符号解码方式的数值。

换算：`countsPerGram = (rawLoaded - rawEmpty) / knownGrams`；当前克数 `(raw - rawEmpty) / countsPerGram`；净取水克数 `(baselineRaw - currentStableRaw) / countsPerGram`。允许负斜率。取整后的整瓶误差不得超过 35g；最近 3 个样本跨度至少 450ms、极差不超过 8g（未标定只做开门测试，原始稳定阈值为 1000 ADC）。这些是联调初值，必须根据实测噪声、柜体振动和不同瓶的毛重差验收，不能代替计量标定。

参数保存到 `backend/data/calibration.json`，最近每柜 50 次会话保存到 `backend/data/sessions.json`。写入采用临时文件后替换。正在取水不能更改标定；重启会将未完成会话标为中断，保留已经确认的结果。数据目录已加入忽略规则，备份时需单独保留。

## STM32、4G 与锁具

打开 `STM32/USER/text.uvprojx`，ARMCC V5.06 update 5，目标 STM32F407ZG。已编译产物 `STM32/OBJ/text.hex`，尚未烧录。

| 接口 | 引脚 / 设置 |
| --- | --- |
| HX711 | DOUT PC6；SCK PC7；TIM3 读取，24 位数据 + 第 25 个增益脉冲 |
| 4G | STM32 PA9/TX → 模块 RX，PA10/RX ← 模块 TX；115200 8N1 |
| 调试串口 | PD8/TX、PD9/RX；115200 8N1 |
| 开锁控制 | PE0，高电平脉冲 1 秒（逻辑控制脚，线圈需匹配的驱动与供电） |
| 门检测 | PE1 上拉，关门接 GND，开门断开；用户已确认接线逻辑一致 |

4G 模块必须自行设置 TCP 客户端透传、服务器地址和端口 9001、断线自动重连。`main.h` 中的 `SERVER_ADDR` 只是启动打印，固件没有通过 AT 指令配置模块。仅改这个字符串不会改变 4G 的实际连接目标。HX711 与串口使用匹配的 3.3V 电平并共地。

文本协议，以 LF 或 CRLF 结尾：

```text
设备 → 后端
REG:CABINET001
STATUS:LOCKED
RAW:8546000
SENSOR:ERROR
STATUS:OPEN
OK
PING

后端 → 设备
OPEN
PONG
```

旧固件 `WEIGHT:<raw>` 无法判断是否真的是克，当前服务器会把它当成称重无效，要求同步更新固件。`OK` 只是指令应答，页面不会因此显示“门已打开”。开门 12 秒无门反馈提示失败，不自动重发。若 90 秒内收到同次请求的延迟开门反馈，且新鲜稳定重量仍与原基线一致，会恢复这次会话；基线不确定则要求现场核对。

## 小程序运行与部署

微信开发者工具导入 `xcx/`；首屏 `pages/unlock/unlock`。用户提供域名后，`xcx/app.js` 的 `globalData.apiBase` 已设为 `https://zhumenggy.top/water`，实际状态接口为 `https://zhumenggy.top/water/api/status`。域名现有首页是“逐梦工具箱”，`/api/health` 已有其他服务而 `/api/status` 返回 404，所以售水柜使用独立 `/water/` 前缀，保留站点现有根目录和 API。

2026-10-25 当前机器正常验证了域名 HTTPS 证书和首页响应。微信后台仍需在“开发管理 → 开发设置 → 服务器域名 → request 合法域名”添加 `https://zhumenggy.top`（不带 `/water` 路径）。目前私有配置 `urlCheck: true` 会检查域名，本次没有关闭校验。规则已通过 agent-reach 网页读取核对[微信官方网络说明](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)。尚未获得服务器或微信后台操作入口，因此没有修改线上配置。

HTTP 默认 38080，TCP 默认 9001；启动前可设置 `HTTP_PORT`、`TCP_PORT`。将 `backend/deploy/zhumenggy-water.nginx.conf` 中两段 location 加入现有域名的 HTTPS server 块，保持原站点、证书和 `/api/` 路由。配置会将 `/water/api/status` 转成上游 `/api/status`；不要删掉 `proxy_pass` 结尾的 `/`。先在域名所在服务器启动后端，再运行 `nginx -t`，通过后 reload。上线后只读检查：

```powershell
curl.exe https://zhumenggy.top/water/api/health
# 预期 {"code":0,"protocol":2}
$env:API_BASE = 'https://zhumenggy.top/water'
node backend/test-api.mjs
```

标定维护页为 `https://zhumenggy.top/water/`。4G 模块仍连接 TCP 9001，不能填写 `https://` 或 `/water/` 路径；此次没有改变单片机端口或固件。HTTP 200 的首页不证明后端 API 接通，API 502、设备离线、微信域名拒绝分别排查代理、设备、微信设置。

纯本地联调可临时将 `apiBase` 设为 `http://127.0.0.1:38080`；手机调试要使用手机可达的地址（127.0.0.1 指手机本身）。

## 软件验证与实物验收

```powershell
node backend/test-all.mjs
python -m unittest discover -s STM32/tests -v
# 对已经运行的服务只读检查，不开门
node backend/test-api.mjs
```

2026-10-25 本地证据：Node 共 23 项（包括真正运行 Page JS → HTTP → TCP 模拟设备 → Page 的完整软件链路），STM32 静态约束 9 项；MSVC 运行实际固件指令队列 C 代码，1 万次循环及错误边界通过；Keil 生成 HEX，0 errors / 0 warnings；安装的微信 WXML/WXSS 编译器已编译本页成功。`artifacts/` 存放编译输出与浏览器布局截图，预览数据明确为模拟值，不能当作微信真机截图。

现场必须再验证：烧录新 HEX；确认 4G 透传注册和周期 RAW；PE0 脉冲与真实锁动作；PE1 打开/关闭回报；空载/砝码/整瓶毛重标定；拿 1/2 瓶、放回 1 瓶、晃动后关门、延迟开门、断网恢复；微信手机前后台切换；关闭调试模式后 HTTPS 请求成功。当前没有硬件在环证据，也没有验证称重精度或真实微信运行效果。

纯本地演示可单独运行 `node backend/test-device.mjs`，它注册 `DEMO001`，只发送人工模拟数据。其模拟参数为零点 8000000、已知负载读数 8100000、已知重量 1000g、整瓶 550g。仅可填入 DEMO001 的标定用于演示，不得给真实设备使用这组假数据。
