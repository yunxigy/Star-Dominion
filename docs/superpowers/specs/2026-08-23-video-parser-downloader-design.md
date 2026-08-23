# SD 主站视频解析下载功能设计

**日期：** 2026-08-23
**状态：** 已获用户确认
**目标版本：** 第一版（单个公开视频）

## 1. 背景与目标

在 SD 工具箱主站增加一个可实际使用的视频解析下载工具，支持抖音和哔哩哔哩的单个公开视频。页面参考 HelloTik 的信息层级：突出链接输入、粘贴、解析和下载，但视觉上沿用 SD 主站现有的暖色玻璃质感。

第一版的目标是：

- 在主站新增“视频工具”分类和“抖音/B站视频解析下载”工具卡片。
- 支持抖音单视频，以及 B 站单个视频的单 P 内容。
- 展示平台实际可用的清晰度、格式、音频状态和预估大小。
- 在服务端下载媒体，并在需要时使用 FFmpeg 合并 B 站的音视频流。
- 向用户展示提取、下载、合并和完成进度。
- 对平台变化、Cookie 失效、资源超限和依赖缺失给出准确错误。
- 通过域名限制、SSRF 防护、速率限制、并发限制和临时文件清理控制公开服务风险。

## 2. 非目标

第一版不包含：

- 合集、播放列表、多 P 批量下载、UP 主空间批量下载或抖音主页批量下载。
- 番剧、课程、付费、会员专享、登录后可见、私密、已删除、直播或地区不可用内容。
- 用户上传平台 Cookie、账号密码或浏览器会话。
- 音频单独提取、字幕下载、图集下载、转码、剪辑或永久媒体存储。
- 对“无水印”“固定 1080P”或任意平台内容均可下载作保证。
- 复制 HelloTik 的前端请求加密、轮换字段名或广告解锁机制。

## 3. 总体架构

系统由现有 SD React 前端和新的 `video-downloader` FastAPI 服务组成。生产环境由 Nginx 将 `/video-api/` 代理到服务端口 `8011`；Vite 开发服务器使用相同路径代理本地服务。

```text
浏览器
  ├─ POST /video-api/api/v1/parse
  │    └─ URL 策略校验 → yt-dlp 只读提取 → 标准化视频信息
  ├─ POST /video-api/api/v1/downloads
  │    └─ 内存任务队列 → yt-dlp 下载 → FFmpeg 按需合并
  ├─ GET /video-api/api/v1/downloads/{jobId}
  │    └─ 轮询阶段、进度和错误
  └─ GET /video-api/api/v1/downloads/{jobId}/file
       └─ 下载完成文件
```

服务使用单进程、单 worker 运行。任务、短时效解析记录和限流计数保存在内存中；服务重启后未完成任务安全失效。第一版不引入 Redis、Celery 或数据库。

## 4. 组件边界

### 4.1 SD 前端

前端新增独立工具组件，职责包括：

- 读取或粘贴链接并做即时平台提示。
- 调用解析接口并展示视频元数据。
- 展示后端返回的质量选项，不自行拼接 yt-dlp 格式表达式。
- 创建下载任务、轮询进度、触发最终文件下载和请求取消。
- 显示平台限制、隐私边界、版权提示和针对性错误。

拟新增的前端文件：

- `SD/components/tools/video/VideoDownloader.tsx`：页面和状态编排。
- `SD/components/tools/video/api.ts`：解析、任务、轮询、取消和健康检查客户端。
- `SD/components/tools/video/types.ts`：前后端契约类型。
- `SD/components/tools/video/VideoDownloader.test.tsx`：交互与状态测试。
- `SD/components/tools/video/api.test.ts`：接口客户端测试。

现有注册、代理、SEO 和部署文件按现有模式更新，不重构无关工具。

### 4.2 视频服务

服务保持小而明确的模块边界：

- `url_policy`：提取用户文本中的 URL、规范化协议、解析短链接并执行 SSRF 校验。
- `extractor`：封装 `yt-dlp`，把平台返回结果转成本站统一模型。
- `format_policy`：把原始格式归并成稳定的质量选项，并生成服务端格式选择规则。
- `job_manager`：维护队列、并发、取消、进度、过期和清理。
- `rate_limit`：维护受信代理后的客户端 IP 计数。
- `api`：验证请求、映射错误并返回稳定 JSON 契约。

平台提取细节不会进入 React 组件，任务管理也不会与 FastAPI 路由实现耦合。

## 5. 解析流程

### 5.1 输入接受范围

输入可以是纯 URL，也可以是包含一个分享 URL 的抖音分享文本。解析器只接受第一个受支持 URL；包含多个受支持 URL 时返回 `MULTIPLE_URLS_NOT_SUPPORTED`，不静默选择。

允许的主域名为：

- 抖音：`douyin.com`、`iesdouyin.com`。
- B 站：`bilibili.com`、`b23.tv`。

合法子域名允许通过，但主机名必须以标签边界匹配，`douyin.com.example.org` 不得通过。

### 5.2 短链接与 SSRF 防护

- 只接受 HTTPS；常见 HTTP 分享链接先升级为 HTTPS。
- 最多跟随 3 次重定向，每次跳转前后都重新校验协议、主机名和解析后的 IP。
- 拒绝 URL 用户信息、非标准端口、IP 字面量、localhost、环回、链路本地、私网、保留地址和不可解析主机。
- DNS 解析和发起请求使用同一已校验目标；重定向目标不能跳出允许域名。
- 解析短链接只读取必要响应头并限制响应大小与超时。
- 规范化后的最终 URL 才能传给 `yt-dlp`。

### 5.3 yt-dlp 提取

解析阶段执行 `download=False`，强制 `noplaylist=True`，并仅允许 Douyin 与 BiliBili 对应提取器。提取结果必须同时满足：

- 不是播放列表或多条目结果。
- 平台和提取器与规范化 URL 一致。
- 内容包含可用的视频格式。
- 时长不超过服务配置。

抖音可选使用服务器管理员提供的 Cookie 文件。B 站第一版只处理无需用户登录即可访问的公开视频；即使服务器配置 Cookie，也不能借此支持付费、会员专享或登录可见内容。

### 5.4 格式归一化

后端把原始格式转换为去重后的质量选项：

- 以高度为主显示 `360P`、`480P`、`720P`、`1080P` 等实际存在的档位。
- 同档位优先选择浏览器和 FFmpeg 兼容性更好的 MP4/H.264/AAC；没有时保留平台可用格式并准确标注容器。
- B 站视频流和音频流分离时，选项标记 `requiresMerge=true`。
- `estimatedBytes` 仅在平台提供可靠大小或可计算近似值时返回，否则为 `null` 并显示“大小未知”。
- 质量 ID 是本站生成的短标识，客户端不能提交任意 yt-dlp format ID 或格式表达式。

首次解析请求会建立一个短时匿名服务会话，通过 `HttpOnly`、`Secure`、`SameSite=Strict` Cookie 绑定同一浏览器；该会话不是平台登录态，也不包含抖音或 B 站身份。解析成功后，服务创建一个 5 分钟有效的解析记录。前端得到绑定匿名会话的签名凭证和公开元数据，但不会得到原始视频/音频下载 URL、平台 Cookie 或 yt-dlp 内部数据。签名凭证包含解析记录 ID、匿名会话摘要和过期时间；完整规范化 URL 与格式映射只保存在服务器内存中。

## 6. 下载任务

### 6.1 任务生命周期

任务状态固定为：

```text
queued → extracting → downloading → merging → completed
                    ↘ failed
queued/downloading/merging → cancelled
completed/failed/cancelled → expired
```

抖音单流下载通常跳过 `merging`。B 站分离流下载时，`yt-dlp` 调用 FFmpeg 进行无损封装合并；不进行视频重编码。

进度映射如下：

- `queued`：0%。
- `extracting`：1%–5%。
- `downloading`：5%–90%，来自 yt-dlp progress hook。
- `merging`：90%–99%。
- `completed`：100%。

### 6.2 任务执行与取消

- 全站默认最多同时执行 2 个下载任务，每个客户端 IP 最多 1 个。
- 队列满时返回 `QUEUE_FULL`，不无限堆积任务。
- 阻塞的 yt-dlp 工作在受控线程中运行；progress hook 检查取消标记并中止下载。
- 当实际累计下载字节超过大小限制时，progress hook 立即中止任务并清理片段；合并完成后再次校验最终文件大小。
- 取消或失败后删除该任务已生成的所有片段和输出文件。
- 输出文件名只包含清理后的标题、平台和作品 ID，去除路径分隔符、控制字符和 Windows 保留名称。
- 最终文件只能由创建任务的匿名服务会话下载，不能用用户输入拼接服务器路径。

### 6.3 临时文件

每个任务使用 `VIDEO_TEMP_DIR` 下的随机 UUID 子目录。完成文件默认保留 30 分钟；失败和取消任务立即清理。后台清理循环同时处理超时任务、孤儿目录和服务启动前遗留的过期目录。

服务不得把临时目录设置为仓库根目录、用户主目录或系统根目录。启动时验证解析后的绝对路径属于明确配置的临时目录。

## 7. HTTP API 契约

所有接口位于 `/api/v1`。前端请求使用 `credentials: 'same-origin'`；服务通过短时匿名 HttpOnly Cookie 关联解析记录和下载任务。Cookie 路径限制为 `/video-api/`，默认一小时过期，不作为跨站跟踪标识，也不写入应用或 Nginx 访问日志。

### 7.1 健康与能力

`GET /health`

```json
{
  "status": "ok",
  "capabilities": {
    "ytDlp": true,
    "ffmpeg": true,
    "douyinCookie": "configured"
  }
}
```

`status` 可为 `ok` 或 `degraded`。缺少 yt-dlp 或 FFmpeg 时返回 `degraded`；前端禁用无法完成的下载能力。Cookie 状态只返回 `configured`、`missing` 或 `invalid`，不暴露路径、内容或账号信息。

### 7.2 解析

`POST /parse`

请求：

```json
{
  "url": "https://www.bilibili.com/video/BV..."
}
```

成功响应：

```json
{
  "parseToken": "opaque-signed-token",
  "expiresAt": "2026-08-23T16:00:00Z",
  "video": {
    "platform": "bilibili",
    "id": "BV...",
    "title": "视频标题",
    "author": "作者",
    "thumbnailUrl": "https://...",
    "durationSeconds": 123,
    "qualities": [
      {
        "id": "q_1080p_mp4",
        "label": "1080P",
        "height": 1080,
        "extension": "mp4",
        "estimatedBytes": 104857600,
        "requiresMerge": true,
        "hasAudio": true
      }
    ]
  }
}
```

`thumbnailUrl` 只能来自经提取器确认的公开视频元数据，并使用严格的 `referrerPolicy`；它不是下载凭证。加载失败时前端显示平台占位图。

### 7.3 创建任务

`POST /downloads`

```json
{
  "parseToken": "opaque-signed-token",
  "qualityId": "q_1080p_mp4"
}
```

成功返回 HTTP 202：

```json
{
  "jobId": "random-job-id",
  "status": "queued"
}
```

### 7.4 查询、取消和取文件

- `GET /downloads/{jobId}`：在匿名会话授权后返回状态、阶段、进度、已下载字节、总字节、速度和错误。
- `DELETE /downloads/{jobId}`：在匿名会话授权后取消未完成任务；重复取消保持幂等。
- `GET /downloads/{jobId}/file`：仅向创建任务的匿名会话返回完成文件，并设置安全的 `Content-Disposition`。

状态接口的错误结构统一为：

```json
{
  "error": {
    "code": "COOKIE_REQUIRED",
    "message": "抖音当前需要服务器更新解析 Cookie，请稍后重试。",
    "retryable": true
  }
}
```

## 8. 错误分类

后端至少使用以下稳定错误码：

| 错误码 | HTTP | 含义 |
| --- | ---: | --- |
| `INVALID_URL` | 400 | 未找到合法 URL 或 URL 结构非法 |
| `MULTIPLE_URLS_NOT_SUPPORTED` | 400 | 输入中包含多个受支持链接 |
| `UNSUPPORTED_PLATFORM` | 400 | 不属于抖音或 B 站允许域名 |
| `PRIVATE_OR_UNAVAILABLE` | 422 | 私密、删除、登录可见或地区不可用 |
| `PLAYLIST_NOT_SUPPORTED` | 422 | 合集、播放列表、多 P 或多条目 |
| `COOKIE_REQUIRED` | 503 | 平台当前要求有效服务器 Cookie |
| `RATE_LIMITED` | 429 | IP 超过解析或下载频率 |
| `DURATION_LIMIT` | 413 | 视频超过时长限制 |
| `FILE_SIZE_LIMIT` | 413 | 预计或实际文件超过大小限制 |
| `QUEUE_FULL` | 503 | 当前下载并发和队列已满 |
| `DEPENDENCY_UNAVAILABLE` | 503 | yt-dlp 或 FFmpeg 缺失 |
| `EXTRACTOR_TEMPORARILY_UNAVAILABLE` | 502 | 平台改版、风控或临时网络错误 |
| `MERGE_FAILED` | 500 | FFmpeg 合并失败 |
| `JOB_NOT_FOUND` | 404 | 任务不存在或凭证无效 |
| `JOB_EXPIRED` | 410 | 任务和文件已过期清理 |

前端根据 `code` 显示中文提示和是否可重试，不通过匹配英文异常文本决定状态。

## 9. 页面与交互

### 9.1 工具入口

- `ToolDef.category` 增加 `video`。
- 分类名称为“视频工具”，使用现有 `Video` 图标和暖色主题下可辨识的强调色。
- 工具 ID 固定为 `video-parser-downloader`。
- 工具注册信息使用 `privacy: 'third-party-api'` 和 `status: 'beta'`；页面进一步说明链接会发送到本站解析服务，并由服务访问抖音或 B 站。
- 搜索标签包含“视频、下载、解析、抖音、douyin、B站、哔哩哔哩、bilibili、无水印”。

### 9.2 初始状态

页面顶部包含：

- 标题“视频解析下载”。
- 副标题“支持抖音与 B 站单个公开视频，解析平台当前可用的视频源”。
- 链接输入框、“粘贴”和“解析视频”按钮。
- 平台支持标签和隐私提示。

输入为空时展示四个说明卡片：无需登录、实际清晰度、临时处理、快速下载；下方展示复制链接、粘贴解析、选择清晰度下载三步说明。

### 9.3 解析和结果状态

- 提交期间禁用重复提交，并显示“正在识别平台”和骨架屏。
- 成功后隐藏大面积说明内容，把结果置于输入框下方。
- 桌面端结果采用封面/元信息与清晰度列表双栏；移动端纵向排列。
- 结果展示平台、标题、作者、时长和封面。
- 清晰度项展示标签、容器、预估大小和是否需要合并。
- 页面不显示或提供复制原始媒体直链。

### 9.4 下载状态

- 创建任务后，对应质量按钮变为进度卡片。
- 阶段文案固定为等待、提取、下载、合并和完成。
- 显示进度条、速度、已下载大小和取消按钮；未知总大小时使用不确定进度样式。
- 完成后出现“保存视频”按钮，点击本站文件接口触发浏览器下载。
- 可重试错误保留解析结果；解析凭证过期时提示重新解析。

### 9.5 可访问性和移动端

- 表单使用真实 `label`，状态更新通过 `aria-live` 宣告。
- 所有操作可用键盘完成，Enter 提交，焦点不会在状态变化后丢失。
- 按钮保持至少 44px 触控尺寸，移动端输入和操作按钮不横向溢出。
- 动画遵循 `prefers-reduced-motion`。
- 错误不能只依赖颜色表达。

### 9.6 文案和合规提示

页面固定显示：

> 仅下载你拥有权利或已获授权的公开视频。请遵守内容平台条款与著作权规则。本站不保证所有内容均无水印或提供固定清晰度。

服务不移除画面中已经存在的水印，也不宣称规避平台权限控制。

## 10. 安全与资源控制

默认配置为：

| 配置 | 默认值 |
| --- | ---: |
| 匿名服务会话有效期 | 3600 秒 |
| 解析凭证有效期 | 300 秒 |
| 完成文件保留时间 | 1800 秒 |
| 最大视频时长 | 7200 秒 |
| 最大文件大小 | 2147483648 字节（2GB） |
| 全站并发下载 | 2 |
| 单 IP 并发下载 | 1 |
| 单 IP 解析频率 | 10 次/分钟 |
| 单 IP 下载频率 | 3 次/小时 |
| 短链接最大重定向 | 3 |

所有值均可通过 `VIDEO_*` 环境变量调整。速率限制使用 Nginx 传递的客户端 IP，但应用仅在请求来自配置的受信代理时读取 `X-Forwarded-For`，否则使用直连地址。

平台 Cookie 文件由服务器管理员配置，只允许服务账号读取。应用不得记录平台 Cookie、匿名会话 Cookie、签名媒体 URL 或解析凭证。Nginx 的 `/video-api/` 访问日志使用不含查询参数和 Cookie 的专用格式。应用日志只记录请求 ID、平台、作品 ID、阶段、耗时、字节数和稳定错误码。

## 11. 部署与运维

- 新服务默认监听 `127.0.0.1:8011`。
- 生产使用一个 Uvicorn worker，避免内存任务状态跨进程不一致。
- FFmpeg 是明确的系统依赖；启动健康检查验证其可执行文件和版本。
- `yt-dlp` 和 Python 依赖在项目配置中固定精确版本，并通过受控更新维护平台兼容性。
- Nginx 为 `/video-api/` 配置合理的连接、读取和发送超时，不缓存解析、状态或文件响应。
- 宝塔部署文档增加服务进程、环境变量、临时目录权限、日志和更新步骤。
- `.env.production.example` 只包含示例路径和非敏感默认值，不包含真实 Cookie 或签名密钥。

当平台改版导致提取器失效时，健康接口可保持服务在线，但具体平台解析返回 `EXTRACTOR_TEMPORARILY_UNAVAILABLE`。维护流程先升级固定版本并运行自动化与可选冒烟测试，再部署。

## 12. 测试策略

### 12.1 后端自动化测试

- URL 提取、域名标签边界、协议升级和多 URL 拒绝。
- 每跳重定向校验、私网/保留地址拒绝和 DNS 失败。
- 模拟 Douyin 与 BiliBili 的 yt-dlp 元数据，验证单视频限制与统一模型。
- 格式去重、质量排序、大小计算、音视频合并标记和质量 ID 防篡改。
- 时长、大小、解析频率、下载频率、单 IP 并发和全站并发限制。
- 任务状态迁移、进度映射、取消幂等、失败清理和过期清理。
- 匿名会话 Cookie 属性、任务所有权校验和跨会话访问拒绝。
- Cookie 缺失、平台临时故障、FFmpeg 失败和依赖缺失的错误映射。
- 健康接口不泄露 Cookie 路径或内容。

所有常规测试模拟平台响应，不依赖外网或平台实时状态。

### 12.2 前端自动化测试

- 空链接、受支持链接和不支持平台的表单行为。
- Clipboard API 成功和权限拒绝回退。
- 解析加载、成功、错误和凭证过期状态。
- 清晰度展示、未知大小、合并提示和任务进度。
- 取消、失败重试、完成下载和页面卸载时停止轮询。
- 键盘操作、ARIA 状态和移动端关键布局类。
- 注册表、分类、图标、SEO 和 sitemap 契约。

### 12.3 可选真实冒烟测试

真实平台测试默认关闭。部署者通过环境变量分别提供一个有权测试的抖音公开视频 URL 和 B 站单 P 公公开视频 URL。测试只验证解析元数据和下载一小段或受限样本，不把链接硬编码进仓库。

### 12.4 完成前验证

至少执行：

```powershell
cd E:\AI\gp\video-downloader
pytest

cd E:\AI\gp\SD
npm.cmd run validate
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

## 13. HelloTik 参考分析与取舍

HelloTik 当前公开前端采用两阶段请求：先获取一次性票据，再用浏览器 Web Crypto 加密解析参数并提交 `/api/parse`。返回数据包含标题、图片、视频和多清晰度信息；下载阶段使用浏览器 XHR 直接读取返回地址并保存 Blob，CORS 失败时退化为打开直链。

本项目借鉴其清晰的输入、结果和下载进度交互，但不复制以下实现：

- 不使用前端字段混淆或硬编码响应解密常量作为安全边界。
- 不把平台媒体直链返回给浏览器。
- 不依赖浏览器 CORS 完成下载。
- 不使用广告解锁作为第一版限流手段。

选择服务端任务模式的主要原因是 B 站经常需要合并独立音视频流，同时短时媒体地址可能过期或要求特定请求头。

参考：

- <https://www.hellotik.app/zh/douyin>
- <https://www.hellotik.app/_next/static/chunks/app/%5Blang%5D/douyin/page-e135bffe40a7c1d6.js>
- <https://www.hellotik.app/_next/static/chunks/8983-ea30684aedc373ac.js>
- <https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md>
- <https://github.com/yt-dlp/yt-dlp/blob/master/README.md>

## 14. 验收标准

功能在满足以下条件时可验收：

1. 工具能从主站分类、搜索和直接 `/tool/video-parser-downloader` 路由进入。
2. 合法抖音单视频可解析出元数据和实际可用质量，并下载为含音频的可播放文件。
3. 合法 B 站单 P 公公开视频可解析质量，并在分离流情况下自动合并为含音频的文件。
4. 合集、播放列表、多 P、私密、登录可见和不支持域名会被明确拒绝。
5. 浏览器拿不到平台原始视频/音频下载 URL、平台 Cookie 或任意服务器文件路径。
6. 下载进度、合并阶段、取消、重试和过期状态均有可理解反馈。
7. 临时文件会在取消、失败或到期后清理，服务重启不会暴露遗留文件。
8. 解析、下载、并发、时长和大小限制可配置且有自动化测试。
9. 页面在桌面端和移动端可用，关键交互满足键盘与 ARIA 要求。
10. 后端测试以及 SD 的 validate、Vitest、TypeScript 和生产构建全部通过。
