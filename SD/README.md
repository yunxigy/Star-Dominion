# 逐梦工具箱

128 个免费在线工具，大部分纯前端处理，数据不出浏览器。

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite" alt="Vite 8">
  <img src="https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss" alt="Tailwind CSS 4">
</p>

---

## 工具分类

| 分类 | 数量 | 说明 |
|------|------|------|
| PDF 工具 | 14 | 合并、拆分、压缩、转图片、加水印、加密 |
| 图片工具 | 13 | 压缩、裁剪、改尺寸、加水印、Base64、取色器 |
| 格式转换 | 12 | JPG/PNG/WebP/SVG/BMP/HEIC/ICO 互转 |
| 开发者工具 | 20 | JSON/XML/HTML/CSS 格式化、正则测试、编码解码 |
| 计算器 | 17 | BMI、贷款、房贷、复利、单位换算 |
| 图片增强 | 10 | 清晰度增强、亮度/锐化、马赛克、表情包 |
| 测评中心 | 11 | MBTI、大五人格、九型人格、DISC |
| 塔罗星座 | 11 | 每日塔罗、星座配对、运势查询 |
| 文档工具 | 5 | OCR 识别、文本翻译、论文查重 |
| 鼠标测试 | 10 | CPS 点击、反应速度、DPI 检测 |

## 隐私标签

| 标签 | 含义 |
|------|------|
| 🔵 无标签 | 纯前端处理，数据不出浏览器 |
| 🟡 API | 调用第三方 API |
| 🔴 上传 | 文件上传到后端 |

## 本地开发

```bash
npm install
npm run dev          # 启动开发服务器 (端口 5173)
npm run validate     # 校验工具注册表
npm run build        # 构建生产版本
```

## 部署

`npm run build` 后部署 `dist/` 到任意静态托管（Vercel、Nginx 等）。

## 许可证

MIT License

## 证件照 AI 换底色

证件照换底色使用浏览器内的 MediaPipe Selfie Multiclass 模型分离人物与背景。照片、蒙版和导出结果只存在于用户当前浏览器，不会上传到本站后端，也不需要服务器 GPU 或运行时外网访问。

### 构建与部署

```bash
npm ci
npm run build
```

`prebuild` 会从固定版本的 `@mediapipe/tasks-vision@1.0.1` 复制六个 WASM 运行文件。约 16.4 MB 的固定模型已存放在仓库内。生产构建必须包含：

- `dist/vendor/mediapipe/models/selfie_multiclass_256x256.tflite`
- `dist/vendor/mediapipe/wasm/vision_wasm_internal.wasm`
- 其余五个同目录的 JS/WASM 运行文件

仓库根目录的 `nginx.conf` 已为 `.wasm` 配置 `application/wasm`，为 `.tflite` 配置 `application/octet-stream`，并对固定资源启用 30 天不可变缓存。服务器更新前应执行 `nginx -t`，确认配置通过后再 reload。

如果页面提示模型加载失败，请在浏览器网络面板确认上述文件返回 HTTP 200，且没有被 SPA 回退成 `text/html`。部署在子路径时，模型和 WASM 会自动跟随 Vite 的 `BASE_URL`。

### 浏览器与模型限制

- 需要支持 WebAssembly、Canvas 2D 和 Pointer Events 的现代 Chrome、Edge、Firefox 或 Safari。
- 解码后超过 4000 万像素的照片会被拒绝，以避免浏览器内存耗尽。
- 松散发丝、透明头纱、运动模糊、多人合照和主体占满画面时可能需要使用擦除/恢复画笔修正。
- 第三方组件和模型许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
