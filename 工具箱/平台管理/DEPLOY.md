# 工具箱部署

1. 克隆 `yunxigy/Star-Dominion`，建议放在 `/www/wwwroot/Star-Dominion`。
2. 在 `工具箱/SD` 执行 `npm ci`、`npm run build`，静态根目录为 `工具箱/SD/dist`。
3. 为各 Python 服务创建虚拟环境，按各目录说明安装依赖并配置进程守护；监听地址设为 `127.0.0.1`，端口见 [README](./README.md)。
4. 将 `.env.production.example` 复制为主机上的私有环境文件，配置密钥和外部认证地址。生产环境使用 HTTPS，视频服务运行单 Worker。
5. 按 [nginx.conf](./nginx.conf) 设置静态目录及 API 代理，配置实际域名、TLS 证书后运行 `nginx -t`，通过后重载。

文档转换需按支持格式安装 LibreOffice 等系统依赖；视频下载需 ffmpeg 和 yt-dlp。股票、守岸人、STM32 使用独立仓库部署，不需要复制到本仓库。外部登录页可由 `VITE_LOGIN_URL` 设置；该变量在前端构建时生效。

本次仓库拆分没有执行线上部署或重启服务。
