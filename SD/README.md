<p align="center">
  <h1 align="center">Star Dominion</h1>
  <p align="center">在线工具箱 | 免费 · 无需注册 · 纯前端处理</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite" alt="Vite 5">
  <img src="https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?logo=tailwindcss" alt="Tailwind CSS 3">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

---

## 简介

Star Dominion 是一个面向搜索流量和广告变现的在线工具箱网站，提供 **70+ 免费在线工具**，涵盖 PDF 处理、图片编辑、格式转换、开发者工具、计算器等核心类别，以及趣味工具、心理测评、塔罗星座等泛娱乐工具。

所有工具均在浏览器端完成处理，数据不上传服务器，保障用户隐私。

## 工具分类

| 分类 | 工具数 | 说明 |
|------|--------|------|
| **PDF 工具** | 14 | 合并、拆分、压缩、转图片、加水印、加密码、提取文字/图片等 |
| **图片工具** | 13 | 压缩、裁剪、改尺寸、加水印、Base64 转换、取色器、九宫格切图等 |
| **图片格式转换** | 12 | JPG/PNG/WebP/SVG/BMP/HEIC/ICO 互转 |
| **开发者工具** | 20 | JSON/XML/HTML/CSS/SQL 格式化、正则测试、时间戳、编码解码、哈希生成等 |
| **计算器** | 17 | BMI、贷款、房贷、复利、日期差、单位换算等 |
| **趣味工具** | 6 | 随机数生成、抽奖、随机密码、随机昵称、今天吃什么、随机选择器 |
| **图片增强** | 10 | 清晰度增强、亮度/对比度/饱和度调整、锐化、去 EXIF、马赛克、表情包制作等 |
| **测评中心** | 11 | MBTI、大五人格、九型人格、恋爱依恋类型、DISC 职场性格、拖延症测试等 |
| **塔罗/星座** | 11 | 每日塔罗、三张牌塔罗、星座配对、每日运势、生命灵数、梦境解析等 |

## 技术栈

- **前端框架**：React 18 + TypeScript 5
- **构建工具**：Vite 5
- **样式方案**：Tailwind CSS 3 + Glass Morphism 毛玻璃设计
- **动画**：Framer Motion
- **图标**：Lucide React
- **代码分割**：React.lazy + Suspense 按需加载每个工具

## 设计风格

采用**渐变玻璃风**（Glass Morphism）设计语言：

- 柔和紫蓝渐变 mesh 背景
- 毛玻璃半透明卡片（`backdrop-blur-xl` + `bg-white/5`）
- 左侧分类侧边栏导航，一次点击直达工具
- 移动端响应式布局，侧边栏可收起

## 项目结构

```
SD/
├── index.html              # 入口 HTML
├── vite.config.ts           # Vite 配置
├── tailwind.config.js       # Tailwind 配置
├── tsconfig.json            # TypeScript 配置
├── src/
│   ├── main.tsx             # 应用入口
│   ├── App.tsx              # 路由配置
│   ├── index.css            # 全局样式（mesh-bg, glass-card 等）
│   ├── tools/
│   │   └── registry.tsx     # 工具注册表（73 个工具定义）
│   ├── pages/
│   │   ├── HomePage.tsx     # 首页
│   │   └── ToolboxPage.tsx  # 工具箱主页面（侧边栏布局）
│   ├── components/
│   │   ├── BaseModal.tsx    # 通用模态框壳
│   │   ├── ToolRunner.tsx   # 工具运行器上下文
│   │   ├── ProjectList.tsx  # 个人项目展示
│   │   ├── PlanSection.tsx  # 计划看板
│   │   └── tools/           # 各工具组件
│   │       ├── pdf/         # PDF 工具
│   │       ├── image/       # 图片工具
│   │       ├── converter/   # 格式转换
│   │       ├── dev/         # 开发者工具
│   │       └── calculator/  # 计算器
│   ├── layouts/
│   │   └── PageLayout.tsx   # 页面布局
│   └── constants.ts         # 常量数据
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 部署

构建产物在 `dist/` 目录，可直接部署到任何静态托管服务：

- Vercel
- Netlify
- Cloudflare Pages
- Nginx 静态服务

## SEO 优化

- 每个工具拥有独立路由，方便搜索引擎收录
- 工具之间互相推荐，提升站内浏览深度
- 页面结构适合广告展示，不影响用户操作

## 许可证

MIT License
