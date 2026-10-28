# SD 视频解析下载服务

这是逐梦工具箱 `/tool/video-parser-downloader` 的私有后端。服务使用 FastAPI、yt-dlp 和 FFmpeg，为匿名访客解析抖音或哔哩哔哩的单个公开视频，并把短期下载任务绑定到 HttpOnly 会话。

## 功能边界

支持：

- 抖音、哔哩哔哩无需登录即可访问的单个公开视频。
- 展示平台实际返回的清晰度、格式、预计大小和音视频合并要求。
- 受限队列下载、进度查询、取消以及短期文件保存。

不支持：

- 合集、播放列表、B 站多 P、直播、批量下载。
- 会员、付费、私密、已删除或必须登录的内容。
- 用户上传 Cookie，或保证去除画面已有水印、固定 1080P/4K。

仅应下载部署者或访问者拥有权利、已获授权的内容，并遵守平台条款与著作权规则。

## 安装与启动

要求 Python 3.11+。B 站分离音视频流需要 FFmpeg：

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
ffmpeg -version
```

Windows PowerShell 激活命令为 `.\.venv\Scripts\Activate.ps1`。生产环境生成独立签名密钥并创建专用临时目录：

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
mkdir -p /www/wwwroot/110.40.174.239/runtime/video-downloads
```

服务的限流、队列和匿名会话都保存在单进程内存中，因此必须只运行一个 Uvicorn worker：

```bash
python -m uvicorn video_downloader.app:app --host 127.0.0.1 --port 8011 --workers 1
```

不要直接向公网开放 8011；统一通过 HTTPS Nginx 的 `/video-api/` 路由访问。

## 环境变量

所有设置使用 `VIDEO_` 前缀。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VIDEO_ENVIRONMENT` | `development` | `development`、`test` 或 `production` |
| `VIDEO_SIGNING_SECRET` | 空 | 令牌签名密钥；生产环境必须至少 32 字符 |
| `VIDEO_TEMP_DIR` | 系统临时目录下的专用子目录 | 下载任务目录；不得设为磁盘根、项目根或用户主目录 |
| `VIDEO_COOKIE_SECURE` | `true` | 生产环境必须为 `true`；纯 HTTP 本地开发设为 `false` |
| `VIDEO_COOKIE_NAME` | `sd_video_session` | 匿名会话 Cookie 名称 |
| `VIDEO_COOKIE_PATH` | `/video-api/` | Cookie 限定路径 |
| `VIDEO_SESSION_TTL_SECONDS` | `3600` | 匿名会话有效期 |
| `VIDEO_PARSE_TOKEN_TTL_SECONDS` | `300` | 解析令牌有效期 |
| `VIDEO_OUTPUT_TTL_SECONDS` | `1800` | 完成文件保留时间 |
| `VIDEO_MAX_DURATION_SECONDS` | `7200` | 最大视频时长 |
| `VIDEO_MAX_FILE_BYTES` | `2147483648` | 最大输出字节数 |
| `VIDEO_GLOBAL_DOWNLOAD_CONCURRENCY` | `2` | 全局并发下载数 |
| `VIDEO_PER_IP_ACTIVE_DOWNLOADS` | `1` | 每 IP 活跃下载数 |
| `VIDEO_PARSE_RATE_LIMIT` | `10` | 解析限流次数 |
| `VIDEO_PARSE_RATE_WINDOW_SECONDS` | `60` | 解析限流窗口 |
| `VIDEO_DOWNLOAD_RATE_LIMIT` | `3` | 下载创建限流次数 |
| `VIDEO_DOWNLOAD_RATE_WINDOW_SECONDS` | `3600` | 下载限流窗口 |
| `VIDEO_MAX_REDIRECTS` | `3` | 分享链接最大重定向次数 |
| `VIDEO_MAX_QUEUE_SIZE` | `8` | 等待队列最大任务数 |
| `VIDEO_TRUSTED_PROXIES` | `127.0.0.1/32,::1/128` | 可提供 `X-Forwarded-For` 的代理网段 |
| `VIDEO_DOUYIN_COOKIE_FILE` | 空 | 可选的服务端抖音 Cookie 文件，不接受用户上传 |
| `VIDEO_FFMPEG_BIN` | `ffmpeg` | FFmpeg 命令名或绝对路径 |

`VIDEO_LIVE_DOUYIN_URL` 与 `VIDEO_LIVE_BILIBILI_URL` 只供显式真实冒烟测试使用，不是运行时设置。

如果部署者确有权使用抖音 Cookie 文件，应把它放在静态目录之外，Linux 权限设为仅服务账号可读，例如 `chmod 600 /secure/path/douyin-cookies.txt`，目录权限也应限制为服务账号。不要把 Cookie 内容写进环境示例、日志、仓库或网页。

## API

Nginx 会去掉 `/video-api` 前缀，下面同时列出浏览器路径和服务内部路径。

| 方法 | 浏览器路径 | 内部路径 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/video-api/health` | `/health` | 公开能力状态，只返回 yt-dlp、FFmpeg 和抖音 Cookie 状态 |
| `POST` | `/video-api/api/v1/parse` | `/api/v1/parse` | 解析单个链接并设置匿名会话 Cookie |
| `POST` | `/video-api/api/v1/downloads` | `/api/v1/downloads` | 用解析令牌和清晰度 ID 创建任务 |
| `GET` | `/video-api/api/v1/downloads/{jobId}` | `/api/v1/downloads/{jobId}` | 查询所属会话的任务进度 |
| `DELETE` | `/video-api/api/v1/downloads/{jobId}` | `/api/v1/downloads/{jobId}` | 幂等取消任务 |
| `GET` | `/video-api/api/v1/downloads/{jobId}/file` | `/api/v1/downloads/{jobId}/file` | 下载所属会话的完成文件 |

前端不会收到原始媒体地址或 yt-dlp format selector。解析令牌只放在 JSON 请求体中；文件 URL 只含随机任务 ID。所有 API 响应禁止缓存。

## 稳定错误码

| 错误码 | 含义 |
| --- | --- |
| `INVALID_URL` | URL 或清晰度参数无效 |
| `UNSUPPORTED_PLATFORM` | 不在抖音/B站域名白名单 |
| `MULTIPLE_URLS_NOT_SUPPORTED` | 输入中包含多个链接 |
| `PLAYLIST_NOT_SUPPORTED` | 合集、列表或多 P 不受支持 |
| `PRIVATE_OR_UNAVAILABLE` | 内容私密、删除、付费或不可访问 |
| `COOKIE_REQUIRED` | 抖音需要服务器解析凭据 |
| `DURATION_LIMIT` | 超过最大时长 |
| `FILE_SIZE_LIMIT` | 超过最大文件大小 |
| `RATE_LIMITED` | 请求频率超限 |
| `QUEUE_FULL` | 下载队列已满 |
| `EXTRACTOR_TEMPORARILY_UNAVAILABLE` | 平台或提取器暂时不可用 |
| `DEPENDENCY_UNAVAILABLE` | yt-dlp 或 FFmpeg 等依赖不可用 |
| `MERGE_FAILED` | FFmpeg 合并失败 |
| `JOB_NOT_FOUND` | 任务不存在或不属于当前匿名会话 |
| `JOB_EXPIRED` | 解析记录、令牌或文件已过期 |

错误响应统一为 `{"error":{"code":"...","message":"...","retryable":false}}`。服务不会在响应中返回堆栈、Cookie、签名密钥或本地路径。

## 临时文件与安全

- URL 只允许 HTTPS 抖音/B站域名，重定向每跳重新校验；DNS 结果必须全部是公网地址。
- 预检连接固定到校验过的 IP，并保留原 Host/TLS SNI，防止 DNS rebinding。
- 下载任务、解析记录和文件都绑定匿名会话；另一浏览器查询同一 ID 会得到 404。
- 服务启动时清理孤儿目录，运行时清理失败/取消任务，完成文件到期后返回 410 并删除。
- Nginx `/video-api/` 应关闭 access log、缓存和请求缓冲，避免 URL、查询串或 Cookie 进入默认日志。

临时目录只能授予服务账号读写权限，不应位于网站静态目录、共享上传目录或公开备份中。计划任务可额外删除早于 `VIDEO_OUTPUT_TTL_SECONDS` 数倍的遗留 UUID 子目录，但不要把磁盘根目录或项目根作为清理目标。

## 测试

默认测试完全离线，不访问抖音或 B 站：

```bash
python -m pytest -q -m "not live"
```

真实平台冒烟是显式 opt-in，只解析元数据、不下载内容。变量必须指向部署者拥有或已获授权的公开视频：

```bash
VIDEO_LIVE_DOUYIN_URL="<AUTHORIZED_PUBLIC_URL>" \
VIDEO_LIVE_BILIBILI_URL="<AUTHORIZED_PUBLIC_URL>" \
python -m pytest -q -m live
```

更新固定版本的 yt-dlp 后，必须重新运行离线测试和授权 live smoke，再部署到生产环境。
