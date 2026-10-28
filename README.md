# Star-Dominion · 逐梦工具箱

逐梦工具箱把常用网页工具、研报中心、文档转换、视频下载、论文查重和站长检查放在一个入口中。网页使用 React + TypeScript，涉及文件转换、采集和下载的功能通过独立 Python 服务提供。

本仓库根目录直接展示项目内容：`SD/`、各业务服务、`xiaochengxu/` 和 `平台管理/`，无需再进入一层“工具箱”文件夹。

## 功能组成

| 模块 | 能力 | 源码 |
| --- | --- | --- |
| 工具箱本体 | 工具导航、搜索、分类，以及文本、图片、编码、PDF 等浏览器工具 | [SD](./SD/) |
| 研报中心 | GitHub 周榜、公开资讯、AI 早报、采集记录与管理员刷新 | [research-reports](./research-reports/) |
| 文档转换 | Office 转 PDF、PDF/Markdown/HTML/扫描件转 Word、表格提取与批处理 | [document-converter](./document-converter/) |
| 视频下载 | 解析支持平台的单个公开视频、选择格式、排队下载、取消及短期文件交付 | [video-downloader](./video-downloader/) |
| 论文查重 | 上传文档、抽取文本、计算相似度并定位相似片段 | [plagiarism](./plagiarism/) |
| 站长工具 | HTTP、DNS、TLS 证书和 WebSocket 检查 | [webmaster-inspector](./webmaster-inspector/) |
| 资讯采集 | Cloudflare Worker 采集与推送 AI 圈动态 | [ai-circle-events](./ai-circle-events/) |
| 小程序 | 微信小程序工具入口与页面 | [xiaochengxu](./xiaochengxu/) |

## 目录结构

```text
Star-Dominion/
├── SD/                       # React/Vite 网页
├── research-reports/         # 研报、资讯与早报服务
├── document-converter/       # 文档转换服务
├── video-downloader/         # 视频解析下载服务
├── plagiarism/               # 文本相似度服务
├── webmaster-inspector/      # 网络与网站检查服务
├── ai-circle-events/         # 独立部署的资讯 Worker
├── xiaochengxu/              # 微信开发者工具项目
└── 平台管理/
    ├── scripts/              # Windows 启动、检查、停止脚本
    ├── .env.local.example    # 本地配置模板
    ├── .env.production.example
    ├── nginx.conf            # Nginx 示例
    └── DEPLOY.md             # 部署说明
```

## 环境要求

- Git；网页建议使用 Node.js 22.12+ 和 npm。
- Python 服务建议使用 Python 3.11，并为每个服务建立独立虚拟环境。
- Office 转 PDF 需要 LibreOffice；扫描件 OCR 需要 Tesseract，中文识别还需要 `chi_sim` 语言包。
- 视频音视频合并需要 FFmpeg；yt-dlp 由视频服务的 Python 依赖提供。
- 小程序需要微信开发者工具；资讯 Worker 的发布需要单独配置 Cloudflare。

不同服务的开发依赖版本可能不同，使用独立虚拟环境可避免它们互相覆盖。

## 快速开始：先运行网页

```powershell
git clone https://github.com/yunxigy/Star-Dominion.git
cd Star-Dominion
cd SD
npm ci
npm run dev
```

访问 `http://127.0.0.1:8013/`。开发命令会准备 MediaPipe 静态资源。仅运行网页时，浏览器本地工具可以使用；调用后端的转换、研报、下载和检查功能需要继续启动对应服务。

## 安装后端

以下命令在仓库根目录执行。为使用 `pyproject.toml` 的服务安装项目依赖：

```powershell
foreach ($name in @('research-reports', 'video-downloader', 'webmaster-inspector')) {
    Push-Location $name
    python -m venv .venv
    ./.venv/Scripts/python.exe -m pip install -e .
    Pop-Location
}
```

文档转换和查重按各自依赖文件安装：

```powershell
foreach ($name in @('document-converter', 'plagiarism')) {
    Push-Location $name
    python -m venv .venv
    ./.venv/Scripts/python.exe -m pip install -r requirements.txt
    Pop-Location
}
```

如果使用下方统一启动脚本，还需在 `SD/` 完成 `npm ci`，并执行一次 `npm run prepare:mediapipe`。

## 配置和统一启动

复制配置模板：

```powershell
Copy-Item ./平台管理/.env.local.example ./平台管理/.env.local
```

编辑该文件，填写本地配置。不要覆盖已有的真实配置文件。

| 配置项 | 用途 |
| --- | --- |
| `SITE_AUTH_URL`、`RESEARCH_REPORTS_SITE_AUTH_URL` | 外部认证服务地址，默认指向本机 8000 |
| `SITE_AUTH_INTERNAL_KEY` | 与认证服务一致的内部密钥；启动脚本要求至少 32 字符 |
| `VITE_LOGIN_URL` | 单独部署的登录页地址；在前端构建时写入 |
| `VITE_STM32_URL` | 独立 STM32 页面入口；在前端构建时写入 |
| `GITHUB_TOKEN` | 可选的研报元数据访问凭据 |
| `SILICONFLOW_API_KEY` | 可选的早报模型凭据，只供服务端使用 |
| `RESEARCH_REPORTS_X_INGEST_TOKEN` | 可选的 Worker 写入凭据 |
| `VIDEO_SIGNING_SECRET` | 视频任务签名密钥，生产环境至少 32 字符 |
| `VIDEO_FFMPEG_BIN` | FFmpeg 命令或完整路径 |
| `VIDEO_COOKIE_SECURE` | 本地 HTTP 为 false，生产 HTTPS 为 true |

在仓库根目录执行：

```powershell
./平台管理/scripts/start-local.ps1
./平台管理/scripts/check-local.ps1
./平台管理/scripts/stop-local.ps1
```

只启动后端可使用 `start-local.ps1 -WithoutFrontends`。脚本优先使用各服务目录下的 `.venv/Scripts/python.exe`，并记录自己启动的进程；端口被其他进程占用时会停止启动并报告冲突。

公开清单 [local-services.json](./平台管理/scripts/local-services.json) 只管理六个工具箱服务。同机完整工作区可以使用被忽略的 `local-services.private.json` 覆盖清单；其中工作目录相对于清单的 `workspace_root` 解析。

## 服务与代理

| 服务 | 默认端口 | 浏览器代理前缀 | 单独启动命令（在对应目录） |
| --- | --- | --- | --- |
| 网页 | 8013 | `/` | `npm run dev` |
| 查重 | 8005 | `/plagiarism-api/` | `python main.py` |
| 研报 | 8009 | `/reports-api/` | `python -m uvicorn research_reports.main:create_app --factory --host 127.0.0.1 --port 8009` |
| 文档转换 | 8010 | `/document-api/` | `python -m uvicorn document_converter.app:app --host 127.0.0.1 --port 8010` |
| 视频下载 | 8011 | `/video-api/` | `python -m uvicorn video_downloader.app:app --host 127.0.0.1 --port 8011 --workers 1` |
| 站长检查 | 8012 | `/webmaster-api/` | `python -m uvicorn webmaster_inspector.app:app --host 127.0.0.1 --port 8012 --workers 1` |

单独启动时需自行激活虚拟环境并给进程设置环境变量；Python 服务不会因为文件存在就自动读取 `平台管理/.env.local`。统一启动脚本负责读取此文件。

视频服务的会话、队列和限流状态保存在进程内，必须使用单 Worker。文档转换可以通过 `/api/v1/capabilities` 查看系统依赖是否就绪；缺少 LibreOffice 或 OCR 组件时不会伪造转换结果。

## 数据与认证

运行数据库、缓存、下载临时文件、真实环境文件及依赖目录均被 Git 忽略。研报数据位于其 `data/`，视频临时目录由 `VIDEO_TEMP_DIR` 设置。升级代码前单独备份持久化数据。

登录服务和 OpenWrite 不在本仓库。工具箱通过 HTTP 认证接口获取会话；未接入认证服务时，公开工具仍可使用，管理员操作不可用。同一父目录有本地登录/STM32 前端源码时可以继续集成；设置 `GP_STANDALONE=1` 可以强制测试独立仓库入口。

## 开发与验证

在 `SD/` 执行：

```powershell
npm run lint
npm run build
npm test
```

构建结果位于 `SD/dist/`。后端在各自目录执行 `python -m pytest -q`。支持 `.[dev]` 的服务先执行 `python -m pip install -e ".[dev]"`；文档转换安装 `pytest`，查重服务安装 `pytest httpx`。请使用对应服务的虚拟环境。资讯 Worker 在自己的目录执行 `npm ci`、`npm test` 和 `npm run typecheck`。

根目录还可执行：

```powershell
python ./平台管理/scripts/verify-layout.py
Invoke-Pester -Script ./平台管理/scripts/tests/local-services.tests.ps1
```

这些检查覆盖源码、构建和本地协议，不替代真实平台视频下载、模型调用、小程序真机与生产部署验证。

## 部署

1. 构建 `SD/dist/`，在 Nginx 中作为静态根目录。
2. 用进程管理器分别运行需要的 Python 服务，并显式传入生产环境变量。
3. 按 [nginx.conf](./平台管理/nginx.conf) 设置 API 代理，填写实际域名、TLS 证书及安装路径。
4. 验证系统组件与健康接口，执行 `nginx -t` 后再重载。
5. 需要管理功能时接入外部认证；资讯 Worker 单独部署，不由本地六服务清单启动。

详细说明见 [部署文档](./平台管理/DEPLOY.md)、[文档转换](./document-converter/README.md)、[视频服务](./video-downloader/README.md) 和 [研报服务](./research-reports/README.md)。

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 页面正常，某个工具请求失败 | 查看对应端口、`.runtime/logs` 和 Vite/Nginx 代理；网页启动不等于后端已启动 |
| 转换提示能力缺失 | 检查 LibreOffice、Tesseract、中文语言包及 `/api/v1/capabilities` |
| 下载无法合并或平台解析失败 | 检查 FFmpeg、yt-dlp 能力和平台当前访问条件；仅支持授权的单个公开视频 |
| 管理员接口返回 401/503 | 检查外部登录服务、会话和双方的内部密钥 |
| 启动提示端口冲突 | 查明占用进程；停止脚本只管理自身记录的进程 |

## 其他独立项目

- [守岸人](https://github.com/yunxigy/ShouAnRen)
- [股票研究](https://github.com/yunxigy/Stock-Research)
- [STM32 上位机](https://github.com/yunxigy/STM32-Host)

各仓库独立维护。本仓库当前主分支只发布工具箱；旧提交历史保留。
