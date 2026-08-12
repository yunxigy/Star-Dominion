# 本地服务运行与数据库迁移

## 服务编排

本地服务清单位于 [`scripts/local-services.json`](../../scripts/local-services.json)。启动、停止和健康检查脚本都从该文件读取服务名、工作目录、端口和健康端点，避免修改端口后只更新了一处。

```powershell
.\scripts\start-local.ps1
.\scripts\check-local.ps1
.\scripts\stop-local.ps1
```

只启动后端时：

```powershell
.\scripts\start-local.ps1 -WithoutFrontends
```

启动脚本会把仓库根目录加入当前进程的 `PYTHONPATH`，使独立服务能够读取 `shared/site_auth_contract.py`。生产部署仍应显式配置等价的模块搜索路径，不要把密钥写入清单。

## 健康检查

清单中的服务必须声明 `health_url` 或 `tcp_only: true`。`check-local.ps1` 会先检查所有端口，再请求声明的 HTTP 健康端点，最后执行匿名 401、管理员登录和跨服务认证冒烟检查。

## SQLite 迁移

每个服务使用自己的 SQLite 文件和 `schema_metadata` 表，不共享数据库。空库由 SQLAlchemy 创建表；已有库先执行版本化迁移，再补齐缺失表。

- `research-reports` 当前 schema 版本为 1，负责补充 `ai_reports.events_json` 和 `ai_reports.risks_json`。
- `site-auth` 当前 schema 版本为 0，仅记录版本，后续增量变更从 1 开始。
- `守岸人` 当前 schema 版本为 1，包装原有聊天分支和增量字段迁移；重复启动不会重复添加列或分支。

迁移失败会阻止服务继续启动。升级前请备份生产数据库；代码回滚不会自动删除已添加的列。
