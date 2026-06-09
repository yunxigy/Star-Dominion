# 项目状态文档

> 最后更新：2026年5月28日（重构后）

## 项目概览

本项目包含两个主要子项目：

1. **SD项目（Star Dominion）** - 在线工具箱网站
2. **Openwrite项目** - AI驱动的长篇小说创作平台

两个项目已成功集成，通过统一的域名提供服务。

---

## 1. SD项目（Star Dominion）

### 基本信息
- **项目名称**：Star Dominion（星域）
- **版本**：1.2.0
- **技术栈**：React 18 + TypeScript 5 + Vite 5 + Tailwind CSS 3
- **设计风格**：渐变玻璃风（Glass Morphism）

### 功能模块（重构后）
| 分类 | 工具数 | 说明 |
|------|--------|------|
| PDF 工具 | 12 | 合并、拆分、压缩、转图片、加水印、加密码等 |
| 图片工具 | 12 | 压缩、裁剪、改尺寸、加水印、Base64 转换等 |
| 图片格式转换 | 10 | JPG/PNG/WebP/SVG/BMP/HEIC/ICO 互转 |
| 开发者工具 | 20 | JSON/XML/HTML/CSS/SQL 格式化、正则测试等 |
| 计算器 | 17 | BMI、贷款、房贷、复利、日期差、单位换算等 |
| 趣味工具 | 6 | 随机数生成、抽奖、随机密码等 |
| 图片增强 | 10 | 清晰度增强、亮度/对比度/饱和度调整等 |
| 测评中心 | 11 | MBTI、大五人格、九型人格等 |
| 塔罗/星座 | 11 | 每日塔罗、三张牌塔罗、星座配对等 |
| 鼠标测试 | 10 | CPS点击速度、反应速度、DPI分析等 |
| **文档处理** | **9** | **OCR识别、文本翻译、语法检查、论文查重等（新增）** |

**总计：128 个工具**

### 页面路由（重构后）
| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | HomePage | 专业工具站首页（重构） |
| `/gj` | ToolboxPage | 工具箱主页面 |
| `/fy` | TranslationPage | ScreenTranslator项目介绍 |
| `/bp` | Stm32Page | STM32控制台 |
| `/ai` | AIAgentPage | OpenWrite AI写作系统 |

**已删除页面：**
- `/zm` - 星盟组成（无实际功能）
- `/hs` - 我与花之诗（无实际功能）
- `/lwc` - 论文查重（移入工具箱内部）

### 关键文件
- `App.tsx` - 路由配置
- `components/ToolRunner.tsx` - 工具运行器上下文
- `tools/registry.tsx` - 工具注册表（128个工具）
- `pages/` - 各页面组件
- `components/tools/` - 各工具组件（含新增的document目录）

---

## 2. Openwrite项目

### 基本信息
- **项目名称**：OpenWrite
- **版本**：5.4.0
- **技术栈**：Python 3.10+ + FastAPI + React 19
- **核心理念**：长篇小说不是一次性 prompt，而是一场持续数月的协作

### 功能模块
| 功能 | 说明 |
|------|------|
| Goethe 规划 Agent | 长会话规划，汇总灵感、建立人物、设定、大纲 |
| Dante 创作 Agent | 正文推进主 Agent，自动决定何时写章、审查、回修资产 |
| AutoWriter 自动写作 | 设定目标字数后自动推进多个章节 |
| 风格合成 | 提供参考文章，AI 拆解学习后生成风格说明书 |
| 上下文组装 | 写章前自动组装 canonical packet |
| 章节审查 | 独立审查流程，检查设定冲突、人物一致性、情节合理性 |
| WebSocket 流式输出 | Web 端实时显示 AI 生成过程 |

### API端点
| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/novels` | GET | 列出所有小说 |
| `/api/novels/{id}/status` | GET | 获取状态总览 |
| `/api/novels/{id}/chapters` | GET | 章节列表 |
| `/api/novels/{id}/chapters/{ch}` | GET | 章节内容 |
| `/api/novels/{id}/chapters/{ch}/write` | POST | 写章 |
| `/api/novels/{id}/chapters/{ch}/review` | POST | 审查章节 |
| `/api/novels/{id}/outline` | GET | 获取大纲 |
| `/api/novels/{id}/characters` | GET/POST | 角色 CRUD |
| `/api/novels/{id}/world/entities` | GET | 世界实体 |
| `/api/novels/{id}/truth` | GET | 真相文件 |
| `/api/novels/{id}/foreshadowing` | GET/POST | 伏笔 CRUD |
| `/api/novels/{id}/style` | GET | 风格系统 |
| `/api/novels/{id}/workflow` | GET | 工作流状态 |
| `/api/llm-config` | GET/PUT | LLM 配置 |
| `/health` | GET | 健康检查 |

### WebSocket端点
| 端点 | 功能 |
|------|------|
| `/ws/chat/{agent_type}?novel_id=X` | Dante/Goethe 聊天 |
| `/ws/progress/{task_id}` | 长任务进度推送 |

### 关键文件
- `server/main.py` - FastAPI应用入口
- `tools/cli.py` - CLI入口和工具执行器
- `tools/agent/dante.py` - Dante Agent
- `tools/goethe.py` - Goethe Agent
- `frontend/src/App.tsx` - 前端路由配置
- `frontend/src/pages/` - 前端页面组件

---

## 3. 项目集成

### 集成方式
- **SD项目**作为主站，提供各种在线工具
- **Openwrite项目**作为子项目，专注于小说创作
- Openwrite通过`/openwrite/`路径集成到SD主站

### 代理配置
SD项目的Vite配置了以下代理：
```typescript
proxy: {
  '/openwrite': {
    target: 'http://localhost:5174',
    changeOrigin: true,
  },
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    timeout: 600000,
  },
  '/ws': {
    target: 'ws://localhost:8000',
    ws: true,
  },
}
```

### 路径映射
- `/openwrite/*` → Openwrite前端（端口5174）
- `/api/*` → Openwrite后端（端口8000）
- `/ws/*` → Openwrite WebSocket（端口8000）

---

## 4. 部署状态

### 服务器信息
- **服务器IP**：110.40.174.239
- **域名**：zhumenggy.top
- **操作系统**：Linux 6.6.117-45.oc9.x86_64

### 部署架构
```
用户请求
    ↓
Nginx（反向代理）
    ↓
┌─────────────────────────────────────┐
│ SD项目（静态文件）                    │
│ - 主站：zhumenggy.top               │
│ - 工具箱：zhumenggy.top/gj          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Openwrite项目                        │
│ - 前端：zhumenggy.top/openwrite/    │
│ - 后端：zhumenggy.top/api/          │
│ - WebSocket：zhumenggy.top/ws/      │
└─────────────────────────────────────┘
```

### 服务状态
- **SD项目**：已构建，静态文件在`dist/`目录
- **Openwrite后端**：运行在8000端口
- **Openwrite前端**：已构建，静态文件在`static/`目录

### 环境变量（Openwrite）
```env
LLM_PROVIDER=openai
LLM_API_KEY=tp-cs549odsi8bk2yu2es0nfg7d1bmgpvev7bffuzm0eau08oxw
LLM_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
LLM_MODEL=mimo-v2.5-pro
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=131072
LLM_STREAM=true
LLM_API_FORMAT=chat
LLM_TIMEOUT_SECONDS=120.0
LLM_MAX_RETRIES=3
```

---

## 5. 数据存储

### SD项目
- 静态工具，无数据存储
- 所有处理在浏览器端完成

### Openwrite项目
- **数据目录**：`data/novels/`
- **小说结构**：
  ```
  data/novels/{novel_id}/
  ├── src/           # 源文件（大纲、章节草稿）
  │   ├── outline.md
  │   └── characters/
  └── data/          # 运行时数据
      ├── manuscript/    # 章节正文
      ├── workflows/     # 工作流状态
      ├── world/         # 世界观设定
      └── snapshots/     # 快照备份
  ```

### 当前小说数据
- **小说ID**：jianniang
- **章节数**：待统计
- **状态**：创作中

---

## 6. 开发环境

### 本地开发
```bash
# SD项目
cd SD
npm install
npm run dev  # 端口5173

# Openwrite项目
cd Openwrite-main
pip install -r requirements.txt
python -m uvicorn server.main:app --reload --port 8000
cd frontend
npm install
npm run dev  # 端口5174
```

### 构建部署
```bash
# SD项目
cd SD
npm run build
# 产物在dist/目录

# Openwrite前端
cd Openwrite-main/frontend
npm run build
cp -r dist ../static
```

---

## 7. 待办事项

### 近期计划
- [ ] 完善文档处理工具功能
- [ ] 添加更多实用工具（SEO、生活工具等）
- [ ] 优化广告位布局
- [ ] 提升系统稳定性

### 长期规划
- [ ] 添加用户系统
- [ ] 支持多人协作
- [ ] 移动端适配
- [ ] 国际化支持

---

## 8. 更新日志

### 2026年5月28日（下午 - UI重构）
- **左侧导航栏**：新增全局AppLayout组件，导航栏固定在左侧
- **工具新窗口**：工具点击后使用window.open()打开浏览器新窗口
- **移除模态框**：ToolRunner不再使用BaseModal，改为新窗口模式
- **页面调整**：HomePage和ToolboxPage适配新布局
- **新增文件**：AppLayout.tsx、ToolWindow.tsx

### 2026年5月28日（下午 - 功能重构）
- **删除无用页面**：星盟组成（/zm）、我与花之诗（/hs）、ToolCategoryPage（死代码）
- **重构首页**：从个人主页风格重构为专业工具站首页
- **新增文档处理分类**：9个新工具（OCR、翻译、语法检查、论文查重等）
- **论文查重移入工具箱**：从独立页面改为弹窗工具
- **清理废弃代码**：删除STAR_ALLIANCE_DATA、FLOWER_QUOTES、PLANS_DATA等
- **工具总数**：从95个增加到128个
- **安装tesseract.js**：支持浏览器端OCR识别

### 2026年5月28日（上午）
- 创建项目状态文档
- 完成项目结构梳理
- 确认集成部署状态

---

## 9. 联系方式

- **项目地址**：https://github.com/yunxigy/Star-Dominion.git
- **访问地址**：https://zhumenggy.top
- **备用地址**：http://110.40.174.239

---

*本文档将随项目更新持续完善*
