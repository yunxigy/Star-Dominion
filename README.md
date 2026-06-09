# Star Dominion

在线多功能平台，集成工具箱、AI 写作、AI 角色陪伴于一体。

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite" alt="Vite 5">
  <img src="https://img.shields.io/badge/FastAPI-0.100-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Python-3.10-3776AB?logo=python" alt="Python 3.10">
</p>

---

## 平台架构

Star Dominion 是一个综合性 Web 平台，由三个核心模块组成：

```
Star Dominion
├── SD/                 # 前端主体 — 在线工具箱（128 个工具）
├── Openwrite-main/     # AI 写作模块 — 长篇小说创作平台
├── 守岸人3.0/           # AI 陪伴模块 — 角色对话与互动剧情
└── plagiarism/         # 论文查重后端服务
```

---

## 模块一：在线工具箱（SD）

128 个免费在线工具，大部分纯前端处理：

| 分类 | 数量 | 说明 |
|------|------|------|
| PDF 工具 | 14 | 合并、拆分、压缩、转图片、加水印、加密 |
| 图片工具 | 13 | 压缩、裁剪、改尺寸、加水印、Base64、取色器 |
| 格式转换 | 12 | JPG/PNG/WebP/SVG/BMP/HEIC/ICO 互转 |
| 开发者工具 | 20 | JSON/XML/HTML/CSS 格式化、正则测试、编码解码 |
| 计算器 | 17 | BMI、贷款、房贷、复利、单位换算 |
| 图片增强 | 10 | 清晰度增强、亮度/锐化、马赛克、表情包制作 |
| 测评中心 | 11 | MBTI、大五人格、九型人格、DISC 等 |
| 塔罗星座 | 11 | 每日塔罗、星座配对、运势查询 |
| 文档工具 | 5 | OCR 识别、文本翻译、论文查重 |
| 鼠标测试 | 10 | CPS 点击、反应速度、DPI 检测 |

## 模块二：AI 写作（Openwrite）

AI 驱动的长篇小说创作平台：

- 多 LLM 后端支持（OpenAI、Claude、DeepSeek、小米 MiMo 等）
- 大纲自动生成与章节规划
- 自动续写与风格控制
- 角色管理与世界观构建
- WebSocket 实时通信
- Zustand 状态持久化

## 模块三：AI 陪伴（守岸人 3.0）

AI 角色对话与互动剧情平台：

- **角色对话** — 多 LLM 后端，角色人设与记忆系统
- **语音交互** — MiMo TTS 语音克隆 + Whisper STT 语音识别
- **互动剧情** — 分支剧情系统，用户选择影响故事走向
- **多人群聊** — 多角色同时对话
- **角色羁绊** — 好感度系统，影响角色回应风格
- **Lorebook** — 世界信息知识库，关键词触发注入
- **Slash 命令** — `/help`、`/clear`、`/swipe` 等快捷操作
- **角色卡导入导出** — 兼容 Tavern Card PNG/JSON 格式

---

## 环境要求

- Node.js >= 18
- Python >= 3.10

## 快速启动

```bash
# 工具箱前端
cd SD && npm install && npm run dev

# AI 写作模块
cd Openwrite-main
pip install -r requirements.txt
cd frontend && npm install && npm run build
cd .. && python main.py

# AI 陪伴模块
cd 守岸人3.0
pip install -r server/requirements.txt
python -m server.main
```

## 部署

- **SD 前端**：`npm run build` 后部署 `dist/` 到任意静态托管（Vercel、Nginx 等）
- **Openwrite**：Python FastAPI 服务 + Vue 前端
- **守岸人 3.0**：Python FastAPI 服务 + 原生前端，支持 Docker 部署

## 许可证

MIT License
