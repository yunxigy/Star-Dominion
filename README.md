# Star-Dominion · 工具箱

本仓库包含工具箱本体、研报中心、文档转换、视频下载、论文查重、站长工具，以及对应的小程序和部署配置。

| 目录 | 内容 |
| --- | --- |
| `工具箱/SD/` | React/Vite 工具箱网页 |
| `工具箱/research-reports/` | 研报中心 |
| `工具箱/document-converter/` | 文档转换 |
| `工具箱/video-downloader/` | 视频解析与下载 |
| `工具箱/plagiarism/` | 论文查重 |
| `工具箱/webmaster-inspector/` | 站长工具 |
| `工具箱/ai-circle-events/` | 工具箱资讯采集 |
| `工具箱/xiaochengxu/` | 工具箱小程序 |
| `工具箱/平台管理/` | 环境模板、启动检查脚本和 Nginx 示例 |

## 本地启动

```powershell
cd 工具箱/SD
npm ci
npm run dev
```

访问 `http://127.0.0.1:8013/`。检查执行 `npm run lint`，构建执行 `npm run build`。各 Python 服务在自己的目录安装依赖；完整端口和启动说明见 [平台管理](./工具箱/平台管理/README.md)。

## 独立项目

- [守岸人](https://github.com/yunxigy/ShouAnRen)
- [股票研究](https://github.com/yunxigy/Stock-Research)
- [STM32 上位机](https://github.com/yunxigy/STM32-Host)

OpenWrite 和登录服务留在本地，不纳入本次上传。认证由外部 HTTP 服务提供，工具箱保留调用接口；通过 `VITE_LOGIN_URL`、`VITE_STM32_URL` 配置独立入口。同一父目录存在本地 `登录/frontend/` 或 `STM32上位机/frontend/` 时，Vite 可继续集成这些本地页面；独立克隆会自动使用外部入口页。

本次调整保留既有 Git 历史。旧版本可从历史提交查看；当前主分支目录仅维护工具箱。
