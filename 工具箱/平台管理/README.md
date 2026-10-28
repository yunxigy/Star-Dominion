# 工具箱运行与部署

## 安装与启动

前端在 `工具箱/SD/` 执行 `npm ci`、`npm run dev`，默认端口 8013。Python 服务各自的 README 和 `pyproject.toml`/`requirements.txt` 为依赖安装入口。

复制 `.env.local.example` 为 `.env.local`，生成至少 32 字符的 `SITE_AUTH_INTERNAL_KEY` 和 `VIDEO_SIGNING_SECRET`，并按需配置外部认证服务。示例文件仅包含占位值；真实密钥和数据不提交。

在仓库根目录启动、检查、停止：

```powershell
./工具箱/平台管理/scripts/start-local.ps1
./工具箱/平台管理/scripts/check-local.ps1
./工具箱/平台管理/scripts/stop-local.ps1
```

| 服务 | 端口 | 目录 |
| --- | --- | --- |
| 论文查重 | 8005 | `工具箱/plagiarism` |
| 研报中心 | 8009 | `工具箱/research-reports` |
| 文档转换 | 8010 | `工具箱/document-converter` |
| 视频下载 | 8011 | `工具箱/video-downloader` |
| 站长工具 | 8012 | `工具箱/webmaster-inspector` |
| 网页 | 8013 | `工具箱/SD` |

公开的 `scripts/local-services.json` 仅管理以上六个服务。同机运行其他独立项目时，可以创建被 Git 忽略的 `scripts/local-services.private.json` 覆盖服务清单，沿用相同字段。停止脚本仅处理本目录记录且进程标识吻合的服务。

## 外部项目

登录服务通过 `SITE_AUTH_URL` 和 `/auth-api/` 提供；仓库包含 HTTP 协议适配器，不包含账号数据库和登录服务实现。未接入时，公开工具仍可使用，管理接口拒绝匿名访问。`VITE_LOGIN_URL` 指向单独部署的登录页。

STM32、股票和守岸人分别部署独立仓库。Vite 保留本机可选集成入口；设置 `GP_STANDALONE=1` 可以强制使用当前仓库的独立入口。

## 校验与部署

前端执行 `npm run lint`、`npm run build`；服务单测按各子项目 README 执行。`python 工具箱/平台管理/scripts/verify-layout.py` 检查目录、服务路径及忽略规则。

[DEPLOY.md](./DEPLOY.md) 和 [nginx.conf](./nginx.conf) 提供工具箱部署示例。它们不会修改现有线上配置；部署前需按目标主机设置域名、证书、路径及外部服务地址。
