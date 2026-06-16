# Star Dominion

综合性 Web 平台，集成在线工具箱、AI 写作、AI 角色陪伴于一体。

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite" alt="Vite 8">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Python-3.11-3776AB?logo=python" alt="Python 3.11">
</p>

---

## 平台架构

```
Star Dominion
├── SD/                 # 在线工具箱（128 个工具，端口 5173）
├── Openwrite-main/     # AI 写作平台（端口 8001 + 5174）
└── 守岸人3.0/           # AI 角色陪伴（端口 8000）
```

| 模块 | 技术栈 | 端口 | 说明 |
|------|--------|------|------|
| SD 工具箱 | React + TypeScript + Vite | 5173 | 128 个在线工具，纯前端为主 |
| Openwrite | Python FastAPI + React | 8001 / 5174 | AI 长篇小说创作平台 |
| 守岸人 3.0 | Python FastAPI + 原生 JS | 8000 | AI 角色对话与互动剧情 |

---

## 快速启动

```bash
# 1. 守岸人（端口 8000）
cd 守岸人3.0 && python -m server.main

# 2. Openwrite 后端（端口 8001）
cd Openwrite-main && python start.py

# 3. Openwrite 前端（端口 5174）
cd Openwrite-main/frontend && npm run dev

# 4. SD 工具箱（端口 5173）
cd SD && npm run dev
```

访问：
- SD 工具箱：`http://localhost:5173`
- Openwrite：`http://localhost:5174/openwrite/`
- 守岸人：`http://localhost:8000`

---

## 环境要求

- Node.js >= 18
- Python >= 3.11

## 许可证

MIT License
