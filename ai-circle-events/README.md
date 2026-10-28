# AI Circle Events Worker

Cloudflare Worker 每 15 分钟扫描固定 AI 账号的公开 X 动态，过滤低价值内容，将本轮新动态交给 Gemini 2.5 Flash 汇总，并通过受保护的 HTTPS API 推送至研报服务。Gemini 在 Cloudflare 侧调用，中国境内的研报服务器不需要也不会调用 Gemini。

## 数据链路

```text
Cloudflare Cron / 手动触发
  → Provider（默认 FxTwitter）扫描账号新动态
  → 过滤、去重和 KV 游标检查
  → 每批仅调用一次 Gemini 2.5 Flash
  → 校验结构化结果
  → HTTPS 推送到 research-reports
  → 网站确认成功后提交完整扫描账号的 KV 游标
```

监控账号：`OpenAI`、`AnthropicAI`、`GoogleDeepMind`、`sama`、`demishassabis`、`huggingface`、`MistralAI`、`perplexity_ai`、`claudeai`。FxTwitter 是可替换的 Provider；来源失败会单独记录并跳过该账号，不会中断其他账号。

## 本地检查

需要 Node.js 与 npm。安装依赖并运行离线测试：

```powershell
npm ci
npm test
npm run typecheck
```

测试使用模拟 Provider、Gemini、网站 API 和假 KV，不访问真实 X、Google API 或生产网站。

## 本地手动运行

1. 复制 `.dev.vars.example` 为 `.dev.vars`，填写仅供本地开发的 Gemini Key、网站 Token 和手动触发 Token。
2. 在 `wrangler.jsonc` 中填入 Cloudflare KV namespace ID；本地开发也需要绑定 KV 预览空间。
3. 把 `SITE_API_URL` 改为研报服务的公开 HTTPS 地址，例如 `https://<你的域名>/reports-api/api/v1/ingest/x`。
4. 启动 Worker：

   ```powershell
   npx wrangler dev
   ```

5. 在另一个终端手动触发：

   ```powershell
   curl.exe -X POST http://127.0.0.1:8787/trigger `
     -H "Authorization: Bearer <你的 MANUAL_TRIGGER_TOKEN>"
   ```

健康检查 `GET /health` 不需要配置密钥。手动执行入口需要 `MANUAL_TRIGGER_TOKEN`；缺少 Gemini、网站地址/Token 或 KV 绑定时会安全失败。不要把真实 Key 放进命令历史或提交到版本库。

## Cloudflare 配置与部署

先分别创建生产和预览 KV namespace：

```powershell
npx wrangler kv namespace create AI_EVENTS_KV
npx wrangler kv namespace create AI_EVENTS_KV --preview
```

将命令输出的 ID 分别写入 `wrangler.jsonc` 的 `id` 与 `preview_id`，并把 `SITE_API_URL` 变量改成网站的 HTTPS 写入地址。当前配置中的 ID 是占位符，必须替换后才能部署。

通过 Wrangler Secrets 配置服务端密钥：

```powershell
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SITE_PUSH_TOKEN
npx wrangler secret put MANUAL_TRIGGER_TOKEN
```

`SITE_PUSH_TOKEN` 必须与研报服务 `.env.local` 中的 `RESEARCH_REPORTS_X_INGEST_TOKEN` 完全一致。手动触发 Token 应使用独立的高熵随机值。模型默认是 `gemini-2.5-flash`，可通过 `GEMINI_MODEL` 调整。

部署前先做打包检查：

```powershell
npm run deploy:dry-run
```

确认 KV ID、Secrets 和网站 HTTPS 地址均已配置后，再由部署者执行正式部署：

```powershell
npx wrangler deploy
```

Cron 已配置为 `*/15 * * * *`。Cloudflare 定时运行与 `POST /trigger` 共用相同 Pipeline。手动触发接口不接受匿名请求；错误响应和日志不输出密钥或动态正文。

## 游标、幂等和恢复

- 每个账号单独保存 `cursor:<handle>`；首轮只扫描最新页，之后向旧页分页直到命中旧游标或完成扫描。
- 达到 Provider 页数上限的账号标记为部分扫描，不推进它的游标，以便下轮补齐。
- 单账号抓取失败不会阻塞其他账号。没有新动态或全部被确定性过滤时不会调用 Gemini。
- 一轮有合格动态时只调用一次 Gemini。响应必须与输入动态 ID 集合、作者、正文、链接和时间一致，且重要度必须为 0–100 整数。
- Worker 使用稳定的 `X-Idempotency-Key` 推送整批数据；研报服务确认成功后才推进完整扫描账号的游标。推送失败会保留游标供下轮重试。
- KV lease 用于跳过常见的并发重入；它是 KV 上的短时协调标记，不是强一致分布式锁。

## HTTP 接口

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| `GET` | `/health` | Worker 存活检查，只返回状态和版本 | 无 |
| `POST` | `/trigger` | 手动启动同一采集 Pipeline | `Authorization: Bearer <MANUAL_TRIGGER_TOKEN>` |

Worker 发送到网站的请求由 `SITE_API_URL` 指定，必须为 HTTPS；接收端校验 Token、请求大小和字段，并提供 `/api/v1/x-events/latest` 供网站展示。
