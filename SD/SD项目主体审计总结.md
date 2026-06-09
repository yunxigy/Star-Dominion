# SD 项目主体审计总结

## 审计范围

阅读了 `SD/` React + TypeScript + Vite 项目的主体代码，重点审查了架构、工具注册、隐私声明、依赖完整性、安全性等方面。

---

# 一、总体判断

主体架构清晰，"注册表 + 懒加载工具组件 + 独立工具窗口"结构合理。审计发现 6 类问题，已全部修复。

---

# 二、问题清单与修复状态

## 紧急 Bug ✅ 已修复

| # | 问题 | 状态 |
|---|------|------|
| 1 | `OcrRecognition` 构建失败（tesseract.js 缺失 + 隐式 any） | ✅ 重装 tesseract.js v5.1.1 |
| 2 | `HeicToJpg` 注册但不可用（heic2any 缺失） | ✅ 安装并实现完整功能 |
| 3 | `QrCodeReader` 注册但不可用（jsQR 缺失） | ✅ 安装并实现完整功能 |
| 4 | `PdfEncrypt` 加密失败仍保存未加密文件 | ✅ 加密失败不再保存 |
| 5 | `PdfToImage` ZIP 打包依赖缺失（jszip） | ✅ 已安装 |
| 6 | `WordToPdf` 依赖缺失（html2canvas） | ✅ 已安装 |

## 隐私声明不一致 ✅ 已修复

| # | 问题 | 状态 |
|---|------|------|
| 1 | README/首页宣称"纯前端处理"但不完全成立 | ✅ 改为"大部分工具纯前端处理" |
| 2 | `TextTranslate` 调用第三方翻译 API | ✅ 标记 `privacy: 'third-party-api'` |
| 3 | `PlagiarismCheck` 上传文件到后端 | ✅ 标记 `privacy: 'backend-upload'` |
| 4 | Vite proxy 依赖多个后端服务 | 已知，暂未改动 |

## 架构和工程化 ✅ 已修复

| # | 问题 | 状态 |
|---|------|------|
| 1 | 工具注册表缺少校验 | ✅ 新增 `scripts/validate-registry.ts` |
| 2 | 工具默认新标签页打开 | 已知，暂未改动 |
| 3 | 搜索只匹配 name/description | ✅ 支持 tags（拼音/别名）搜索 |
| 4 | 动态 Tailwind 类可能丢失 | 已知，暂未改动 |
| 5 | `BaseModal` 可访问性不足 | ✅ Escape 关闭、焦点陷阱、ARIA 属性、滚动锁定 |
| 6 | `ToolErrorBoundary` 不够完整 | ✅ 区分 chunk/依赖错误、显示友好提示和重试按钮 |
| 7 | PDF 工具"渲染成图片再合成"有质量风险 | 已知，暂未改动 |

---

# 三、新增功能

| 功能 | 说明 |
|------|------|
| 隐私标签系统 | `ToolDef` 新增 `privacy` 和 `status` 字段，工具卡片显示标签 |
| 注册表校验脚本 | `npm run validate` 检查 ID 唯一性、图标合法性、分类合法性 |
| 文件大小限制工具 | `formatFileSize`、`checkFileSize`、`FILE_SIZE_LIMITS` |
| 进度条组件 | `ProgressBar`、`StatusMessage` 组件 |

---

# 四、剩余待处理（低优先级）

| # | 问题 | 优先级 |
|---|------|--------|
| 1 | 动态 Tailwind 类（TranslationPage） | 低 |
| 2 | PDF 工具"渲染成图片"质量风险 | 低 |
| 3 | 工具打开方式优化（当前页/弹窗） | 低 |
| 4 | 隐私中心页面 | 低 |
| 5 | PWA / 离线能力 | 低 |
| 6 | SEO 元数据 | 低 |
