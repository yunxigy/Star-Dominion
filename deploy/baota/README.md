# 宝塔上线操作手册

本文只描述全站认证与本轮端口整理后的上线步骤。线上已有的 `/stock/`、`/stock-api/` 规则是生产资产，必须保留；根目录 `nginx.conf` 仅作本地参考，不能覆盖宝塔站点配置。

## 1. 固定端口

| 端口 | 服务 | 对公网暴露 |
| --- | --- | --- |
| 8000 | site-auth | 否，仅经 `/auth-api/` |
| 8001 | Openwrite | 否 |
| 8002 | 股票编排后端 | 否，仅经现有 `/stock-api/` |
| 8003 | 个股分析适配器 | 否 |
| 8004 | 模型网关 | 否 |
| 8005 | 论文查重 | 否，仅经 `/plagiarism-api/` |
| 8006 | 守岸人 | 否，仅经 `/api/`、`/wuwa/` |
| 8007 | STM32 HTTP/WebSocket | 否，仅经 `/stm32/api/` |
| 8008 | STM32 设备 TCP | 按设备来源设置防火墙白名单 |

所有 HTTP 服务只监听 `127.0.0.1`。8008 必须监听设备可达地址，因此应在云防火墙和系统防火墙限制来源 IP。

## 2. 环境与密钥

复制 `.env.production.example` 为服务器上的 `.env.production`，将其权限设为仅运行用户可读，并在宝塔进程环境中加载。生成三个互不相同的随机值：

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

前两个分别用于 `SITE_AUTH_INTERNAL_KEY`、服务令牌或签名密钥；Fernet 值用于 `STOCK_MODEL_MASTER_KEY`。每个变量都应单独生成，不得把管理员密码或大模型 API Key 当作内部密钥。

硅基流动等平台模型配置可以不填。系统不会自动选默认来源：每次分析由用户选择“个人配置”或后台提供的平台配置。

宝妈指数需要 Node.js/npm 可供股票后端进程调用，并使用固定只读采集器：

```bash
STOCK_XHS_MCP_COMMAND="npx -y @sillyl12324/xhs-mcp@2.7.0"
STOCK_XHS_DATA_DIR="<SITE_ROOT>/stock-research-package/stock-module/data/xhs-mcp"
STOCK_MOM_REFRESH_TIME="08:30"
STOCK_TIMEZONE="Asia/Shanghai"
```

`STOCK_XHS_DATA_DIR` 含小红书登录态，必须只允许运行用户读写，禁止放入 Nginx 静态目录或备份到公开位置。首次上线由管理员在股票页面扫码登录；之后系统每天 08:30 自动采集东方财富和小红书，管理员也可手动刷新。若部署多进程，SQLite 租约会阻止同一时刻重复采集。

## 3. 安装与构建

在各 Python 项目中使用独立虚拟环境安装对应 `requirements.txt` 或 `pyproject.toml`。股票后端必须安装 `workers` 可选依赖（包含 AKShare、APScheduler、MCP 客户端），并确保 Node.js/npm 已安装。前端构建：

```bash
cd <SITE_ROOT>/SD && npm ci && npm run build
cd <SITE_ROOT>/Openwrite-main/frontend && npm ci && npm run build
cd <SITE_ROOT>/stock-research-package/stock-module/frontend && npm ci && npm run build
```

```bash
cd <SITE_ROOT>/stock-research-package/stock-module/backend
<PYTHON> -m pip install -e ".[workers]"
node --version
npx --version
```

构建 SD 前必须把 `VITE_AMAP_KEY` 与 `VITE_AMAP_SECURITY_CODE` 放入构建进程环境。它们会进入浏览器资源，应在高德控制台绑定正式域名。

## 4. 宝塔进程

为每个服务设置工作目录、同一份生产环境变量及开机自启：

| 服务 | 工作目录 | 启动命令 |
| --- | --- | --- |
| site-auth | `<SITE_ROOT>/site-auth` | `<PYTHON> -m uvicorn site_auth.main:create_app --factory --host 127.0.0.1 --port 8000` |
| Openwrite | `<SITE_ROOT>/Openwrite-main` | `<PYTHON> start.py` |
| stock-hub | `<SITE_ROOT>/stock-research-package/stock-module/backend` | `<PYTHON> -m uvicorn app.main:app --host 127.0.0.1 --port 8002` |
| stock-analysis | `<SITE_ROOT>/stock-research-package/stock-module/analysis-service` | `<PYTHON> -m uvicorn analysis_service.main:app --host 127.0.0.1 --port 8003` |
| stock-gateway | `<SITE_ROOT>/stock-research-package/stock-module/backend` | `<PYTHON> -m uvicorn app.gateway_main:app --host 127.0.0.1 --port 8004` |
| plagiarism | `<SITE_ROOT>/plagiarism` | `<PYTHON> main.py` |
| ShouAnRen | `<SITE_ROOT>/守岸人3.0` | `<PYTHON> -m server.main` |
| STM32 | `<SITE_ROOT>/4G` | `<PYTHON> 4G.py` |

`<PYTHON>` 必须替换为对应虚拟环境的绝对路径。不要使用开发服务器承载三个前端；将构建产物交给 Nginx。

## 5. 只创建一个管理员

先备份现有数据库。确认生产 `SITE_AUTH_DATA_DIR` 指向正确目录后，从终端交互输入密码：

```bash
cd <SITE_ROOT>/site-auth
<PYTHON> -m site_auth.cli recreate-admin \
  --email <ADMIN_EMAIL> \
  --username <ADMIN_USERNAME> \
  --confirm-delete-all-users
```

该命令会在同一事务中删除 site-auth 的全部账号和会话，再创建唯一管理员。它不会读取或迁移守岸人的旧密码哈希；守岸人的旧 `users` 表不再是认证来源。执行后应归档旧库，确认无回滚需求再清理。

## 6. 合并 Nginx

把 `deploy/nginx/site-modules.conf.example` 中需要的 `location` 合并到宝塔现有站点的 `server {}` 内。保留线上 `/stock/`、`/stock-api/`，然后在宝塔执行配置检查；只有 `nginx -t` 成功才能重载。

## 7. 上线验收

按顺序检查：

1. `GET /auth-api/health`、`GET /stock-api/api/v1/health` 返回 200。
2. 未登录访问股票首页和晨报正常；访问模型配置或个股详细分析返回 401/跳转登录。
3. 注册入口不可用；管理员可登录，普通旧账号不可登录。
4. 登录后股票个人模型配置、个股分析、守岸人聊天和管理后台可用。
5. `POST /plagiarism-api/api/plagiarism/compare` 接受 `file1`、`file2`，单文件超过 10 MiB 返回 413。
6. `/stm32/api/ws` 可升级 WebSocket，8008 仅允许设备白名单访问。
7. 浏览器 Cookie 中 `sd_session` 为 HttpOnly、Secure，修改类请求携带 `X-CSRF-Token`。
8. 股票目录能按代码、名称和拼音首字母搜索；管理员可刷新目录。
9. 宝妈指数历史接口可读；管理员扫码登录小红书后可手动刷新，东方财富或小红书单源失败时页面明确显示部分可用。

验收失败时先恢复上一版进程与 Nginx 配置，再恢复部署前数据库备份。线上验收全部通过后，才能更新根目录 README 的“已上线”状态。
