# 工具实际可用性审计

日期：2026-08-11  
审计对象：`SD` 工具箱（分支 `codex/id-photo-background-ai`）  
预览地址：`http://127.0.0.1:5176`

## 结论

- 工具注册表共 **131 个工具、12 个分类**，注册校验通过。
- 逐个访问 131 条 `/tool/:id` 路由，**131/131 能渲染，0 条路由失败**。
- 浏览器路由巡检没有捕获到应用级 `console.error`。
- JSON 格式化、BMI、随机数、大小写转换等代表性输入/执行流程均产生了正确结果。
- 49 个工具需要用户提供文件，3 个工具依赖浏览器音频/语音能力；这类工具已能显示上传/执行入口，但本轮浏览器环境不允许注入本地文件或授予设备权限，因此不能把它们标记成端到端通过。
- 翻译工具当前**实际不可用**：浏览器执行返回“翻译失败”。服务器直接请求 MyMemory 为 200，但响应没有 `Access-Control-Allow-Origin`，因此前端跨域请求在生产浏览器中也存在失败风险。
- 语法检查接口可用；输入英文时需要先把语言切换为 `en-US`，默认 `zh-CN` 下英文语句可能被误判为无错误。

## 自动化证据

| 检查项 | 结果 |
| --- | --- |
| `npm.cmd run validate` | 通过：131 工具、12 分类、无注册错误 |
| 全部路由渲染巡检 | 通过：131/131 |
| 应用浏览器 console error | 通过：0 |
| `npm.cmd test -- --reporter=dot` | 通过：26 个测试文件、101 个测试 |
| `npm.cmd run lint` | 通过：TypeScript `tsc --noEmit` |
| `npm.cmd run build -- --logLevel warn` | 通过；只有字体路径和 chunk 大小警告 |
| `plagiarism/tests` | 通过：3 个后端测试 |
| MediaPipe WASM | HTTP 200，`vision_wasm_internal.wasm` 11,756,954 bytes |
| MediaPipe TFLite | HTTP 200，`selfie_multiclass_256x256.tflite` 16,371,837 bytes |
| 查重后端健康检查 | HTTP 200：`http://127.0.0.1:8005/api/plagiarism/health` |

## 代表性功能操作

| 工具 | 操作 | 结果 |
| --- | --- | --- |
| JSON 格式化 | 输入 `{"name":"demo","items":[1,2]}`，点击“格式化” | 生成格式化结果并出现复制操作 |
| BMI | 输入 170 cm、65 kg | 得到 BMI `22.49`，分类“正常” |
| 随机数 | 10–20 生成 3 个 | 生成 12、16、19，汇总 47，范围正确 |
| 大小写转换 | 输入 `hello world`，点击“全部大写” | 输出 `HELLO WORLD` |
| 翻译 | 输入 `hello`，点击“翻译” | 失败并显示“翻译失败，请重试”（外部 CORS 问题） |
| 语法检查 | 选择 `en-US`，输入 `This are a test.` | 返回 `These`、`is` 等修改建议 |

## 需要文件的工具（49 个）

这些工具的路由和上传入口均能渲染；需要用真实图片、PDF、音频或文档完成一次手工上传回归：

`merge-pdf`、`split-pdf`、`compress-pdf`、`pdf-to-image`、`image-to-pdf`、`rotate-pdf`、`delete-pdf-pages`、`pdf-watermark`、`pdf-encrypt`、`extract-pdf-images`、`extract-pdf-text`、`word-to-pdf`、`compress-image`、`resize-image`、`crop-image`、`watermark-image`、`image-to-base64`、`color-picker`、`merge-images`、`split-image-grid`、`favicon-generator`、`id-photo-resize`、`id-photo-bg-color`、`jpg-to-png`、`png-to-jpg`、`jpg-to-webp`、`png-to-webp`、`webp-to-jpg`、`webp-to-png`、`svg-to-png`、`png-to-ico`、`bmp-to-jpg`、`heic-to-jpg`、`qr-code-reader`、`image-sharpness`、`image-brightness`、`image-sharpen`、`image-exif-remover`、`image-enhance-watermark`、`image-add-text`、`image-mosaic`、`screenshot-beautify`、`meme-generator`、`social-media-cover`、`plagiarism-check`、`ocr-recognition`、`audio-converter`、`ncm-converter`、`voice-changer`。

> 其中 `id-photo-bg-color` 的本地 AI 模型与 WASM 资源已确认能从预览服务返回 200；其分割/蒙版/合成测试也已通过。

## 需要设备能力的工具（3 个）

- `text-to-speech`：依赖 `speechSynthesis` 和系统语音包。
- `audio-converter`：依赖 `AudioContext`、音频文件和下载能力。
- `voice-changer`：依赖 `AudioContext`、`OfflineAudioContext` 和音频文件。

本轮没有自动接受麦克风/音频权限，也没有伪造设备输入；部署后应在真实 Chrome/Edge 上各做一次播放、暂停、停止和导出检查。

## 需要外部服务或后端的工具

- `plagiarism-check`：前端通过 `/plagiarism-api` 代理到 8005，后端健康检查和 3 个 API 测试通过；仍需用两个实际文件做一次浏览器端上传回归。
- `grammar-check`：直连 LanguageTool。接口可达，英文选择下能返回建议；生产环境应保留网络失败提示和语言选择提示。
- `text-translate`：直连 MyMemory。当前浏览器执行失败，原因是跨域响应缺少 `Access-Control-Allow-Origin`。要上线必须改为同源后端代理、可配置翻译服务，或替换为支持 CORS 的服务。

## 当前不能从本轮自动化得出的结论

浏览器自动化环境明确不支持本地文件上传，且不能在没有用户确认的情况下授予麦克风/音频权限。因此，图片、PDF、OCR、音频、查重和证件照的“真实文件处理”不应被误报为已端到端验证；它们目前是“路由与入口通过，文件处理待手测”。

## 建议修复优先级

1. **P0：修复 `text-translate` 的跨域架构**，生产前必须改走同源服务端代理或替换 API。
2. **P1：为语法检查增加语言自动提示/检测**，避免默认中文检查英文文本时给出误导性的“无错误”。
3. **P1：补一组真实 PNG/JPG/PDF/DOCX/WAV 测试夹具**，在可上传的 Playwright/CI 环境中覆盖 49 个文件工具。
4. **P2：在工具注册表中为所有工具补齐隐私/依赖标记**，现在只有少数工具显式标注了 `local`、`third-party-api` 或 `backend-upload`。

