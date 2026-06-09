# Star Dominion

在线工具箱 · 128 个工具 · 免费无需注册

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite" alt="Vite 5">
  <img src="https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?logo=tailwindcss" alt="Tailwind CSS 3">
</p>

---

## 简介

Star Dominion 是一个在线工具箱网站，提供 128 个免费工具，涵盖 PDF 处理、图片编辑、格式转换、开发者工具、计算器、趣味工具、心理测评、塔罗星座等类别。

大部分工具在浏览器端完成处理，数据不上传服务器。少数工具（如论文查重、文本翻译）需要调用后端服务或第三方 API，已在工具卡片上标注隐私级别。

## 工具分类

| 分类 | 数量 | 说明 |
|------|------|------|
| PDF 工具 | 14 | 合并、拆分、压缩、转图片、加水印、加密、提取文字/图片等 |
| 图片工具 | 13 | 压缩、裁剪、改尺寸、加水印、Base64、取色器、九宫格切图等 |
| 格式转换 | 12 | JPG/PNG/WebP/SVG/BMP/HEIC/ICO 互转 |
| 开发者工具 | 20 | JSON/XML/HTML/CSS/SQL 格式化、正则测试、时间戳、编码解码等 |
| 计算器 | 17 | BMI、贷款、房贷、复利、日期差、单位换算等 |
| 趣味工具 | 6 | 随机数、抽奖、随机密码、随机昵称、今天吃什么、随机选择器 |
| 图片增强 | 10 | 清晰度增强、亮度/对比度/锐化、去 EXIF、马赛克、表情包制作等 |
| 测评中心 | 11 | MBTI、大五人格、九型人格、恋爱依恋、DISC、拖延症测试等 |
| 塔罗/星座 | 11 | 每日塔罗、三张牌塔罗、星座配对、每日运势、生命灵数、梦境解析等 |
| 文档工具 | 5 | OCR 文字识别、文本翻译、论文查重、文本转语音等 |
| 鼠标测试 | 10 | CPS 点击测试、反应速度、DPI 检测、按键测试、滚轮测试等 |

## 隐私说明

| 标签 | 含义 |
|------|------|
| 🔵 无标签 | 纯前端处理，数据不出浏览器 |
| 🟡 API | 调用第三方 API（如文本翻译） |
| 🔴 上传 | 文件上传到后端服务（如论文查重） |

## 技术栈

- React 18 + TypeScript 5
- Vite 5
- Tailwind CSS 3 + Glass Morphism 毛玻璃设计
- Framer Motion 动画
- Lucide React 图标（按需导入）
- React.lazy + Suspense 工具懒加载

## 项目结构

```
SD/
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── scripts/
│   └── validate-registry.ts   # 注册表校验脚本
├── lib/
│   └── iconMap.ts             # 图标按需导入映射
├── tools/
│   └── registry.tsx           # 工具注册表（128 个工具）
├── pages/
│   ├── HomePage.tsx
│   ├── ToolboxPage.tsx
│   └── TranslationPage.tsx
├── components/
│   ├── BaseModal.tsx          # 通用模态框（Escape/焦点陷阱/ARIA）
│   ├── ToolRunner.tsx         # 工具运行器
│   ├── ToolWindow.tsx         # 工具窗口（含错误边界）
│   └── tools/                 # 各工具组件
│       ├── pdf/
│       ├── image/
│       ├── converter/
│       ├── dev/
│       ├── document/
│       ├── calculator/
│       ├── fun/
│       ├── test/
│       ├── tarot/
│       ├── mouse/
│       └── image-enhance/
├── layouts/
│   └── AppLayout.tsx
└── constants.ts
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 校验工具注册表
npm run validate

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 部署

构建产物在 `dist/` 目录，可部署到任意静态托管服务（Vercel、Netlify、Cloudflare Pages、Nginx 等）。

需要后端的功能（论文查重、Openwrite 写作模块等）需要单独部署对应的后端服务。

## 许可证

MIT License
