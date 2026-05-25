# ScreenTranslator

屏幕实时翻译工具 — 基于 OCR + 百度翻译 API，将窗口中的英文文本实时翻译为中文，以悬浮字幕的形式覆盖显示在原文位置上。

## 功能特点

- **实时屏幕翻译** — 自动截取目标窗口画面，OCR 识别英文文本，翻译后覆盖显示在原文位置
- **透明覆盖层** — 使用 Win32 分层窗口实现，鼠标穿透，不影响原始操作
- **目标窗口定位** — 覆盖窗口自动跟随目标程序，译文只显示在目标窗口范围内
- **进程下拉选择** — 设置界面自动列出所有运行中的窗口程序，一键选择
- **百度翻译 API** — 支持批量翻译请求，自带内存缓存（5000 条），减少 API 调用
- **全局热键** — `Ctrl+Alt+T` 随时开关翻译
- **系统托盘** — 最小化到托盘，右键菜单提供设置、日志、退出等功能

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | .NET 8.0 WPF (win-x64) |
| OCR 引擎 | Sdcb.PaddleOCR 3.0.1 + PaddleOCR V4 模型 |
| 翻译 API | 百度通用翻译 API |
| 窗口覆盖 | Win32 HwndSource (WS_EX_LAYERED + WS_EX_TRANSPARENT) |
| 屏幕截图 | GDI BitBlt / PrintWindow |
| 托盘图标 | Hardcodet.NotifyIcon.Wpf |
| 配置存储 | System.Text.Json → `%APPDATA%/ScreenTranslator/settings.json` |

## 工作原理

```
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌─────────────────┐
│  目标窗口     │───▶│  GDI 截图     │───▶│  PaddleOCR    │───▶│  百度翻译 API    │
│  (游戏/应用)  │    │  BitBlt /     │    │  文本检测 +    │    │  英文 → 中文     │
│              │    │  PrintWindow  │    │  识别 + 分类   │    │  批量 + 缓存     │
└─────────────┘    └──────────────┘    └───────────────┘    └────────┬────────┘
                                                                      │
┌─────────────┐    ┌──────────────┐                                   │
│  目标窗口     │◀──│  透明覆盖窗口  │◀──────────────────────────────────┘
│  (原文被覆盖) │    │  渲染译文     │
│              │    │  鼠标穿透     │
└─────────────┘    └──────────────┘
```

每次刷新周期（默认 1.5 秒）：

1. **截图** — 截取目标窗口客户区画面
2. **OCR** — PaddleOCR 检测文本区域并识别文字（后台线程）
3. **过滤** — 按置信度和语言筛选结果（默认只保留英文，置信度 ≥ 0.5）
4. **翻译** — 批量调用百度翻译 API（带缓存，相同文本不重复请求）
5. **渲染** — 在透明覆盖窗口上绘制译文（半透明背景 + 白色文字 + 黑色描边）

## 项目结构

```
ScreenTranslator/
├── App.xaml / App.xaml.cs          # 入口：系统托盘、全局异常处理
├── SettingsWindow.xaml / .cs       # 设置界面：API 配置、进程选择
├── Config/
│   └── Settings.cs                 # 配置模型 + JSON 序列化
├── Core/
│   ├── OverlayWindow.cs            # 核心：透明覆盖窗口 + 翻译循环
│   ├── OcrEngine.cs                # PaddleOCR 引擎封装
│   ├── BaiduTranslator.cs          # 百度翻译 API 封装（含缓存）
│   ├── ScreenCapture.cs            # 屏幕截图（BitBlt / PrintWindow）
│   ├── TranslationOverlay.cs       # 译文渲染（DrawingContext）
│   └── Logger.cs                   # 文件日志
├── Models/
│   ├── OcrResult.cs                # OCR 识别结果
│   └── TranslationItem.cs          # 翻译条目（含坐标）
├── Native/
│   ├── NativeMethods.cs            # Win32 P/Invoke 声明
│   ├── WindowHelper.cs             # 窗口管理工具
│   └── HotKeyManager.cs            # 全局热键管理
└── Resources/icons/app.ico         # 应用图标
```

## 快速开始

### 环境要求

- Windows 10/11 x64
- .NET 8.0 Desktop Runtime（[下载](https://dotnet.microsoft.com/download/dotnet/8.0)）

### 百度翻译 API 申请

1. 访问 [百度翻译开放平台](https://fanyi-api.baidu.com/)
2. 注册并开通**通用翻译 API**（标准版免费，高级版需认证）
3. 获取 **App ID** 和 **密钥**

### 下载 PaddleOCR 模型

项目不包含 OCR 模型文件（体积较大），需自行下载并放到 `Models/` 目录：

```
Models/
├── ch_PP-OCRv4_det_infer/          # 文本检测模型
│   ├── inference.pdmodel
│   ├── inference.pdiparams
│   └── inference.pdiparams.info
├── en_PP-OCRv4_rec_infer/          # 英文识别模型
│   ├── inference.pdmodel
│   ├── inference.pdiparams
│   ├── inference.pdiparams.info
│   └── en_dict.txt
└── ch_ppocr_mobile_v2.0_cls_infer/ # 方向分类模型
    ├── inference.pdmodel
    ├── inference.pdiparams
    └── inference.pdiparams.info
```

模型下载地址：
- PaddleOCR 官方模型库: https://github.com/PaddlePaddle/PaddleOCR/blob/main/doc/doc_ch/models_list.md
- 文本检测（V4）: `ch_PP-OCRv4_det` → 下载 `inference` 模型
- 英文识别（V4）: `en_PP-OCRv4_rec` → 下载 `inference` 模型
- 方向分类: `ch_ppocr_mobile_v2.0_cls` → 下载 `inference` 模型

下载后解压，将每个模型的 `inference.pdmodel` 和 `inference.pdiparams` 放到对应子目录即可。

### 编译运行

```bash
cd ScreenTranslator
dotnet restore
dotnet build
dotnet run
```

编译产物在 `bin/Debug/net8.0-windows/win-x64/` 目录。

### 使用步骤

1. 启动程序后，系统托盘出现图标
2. 右键托盘图标 → **设置**
3. 填写百度翻译的 **App ID** 和 **密钥**
4. 在下拉菜单中选择要翻译的目标程序（或选择全屏模式）
5. 点击**保存**
6. 按 `Ctrl+Alt+T` 或双击托盘图标开启翻译
7. 译文将自动显示在目标窗口的原文位置上

## 配置说明

配置文件位置：`%APPDATA%/ScreenTranslator/settings.json`

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| BaiduAppId | string | "" | 百度翻译 API App ID |
| BaiduSecretKey | string | "" | 百度翻译 API 密钥 |
| TargetProcessName | string? | "Unity" | 目标进程名，null 或空 = 全屏模式 |
| RefreshIntervalMs | int | 1500 | 刷新间隔（毫秒），最小 100 |
| OcrConfidenceThreshold | float | 0.5 | OCR 置信度阈值 |
| FontSize | double | 16 | 译文字号 |
| FontColor | string | "#FFFFFF" | 译文颜色（十六进制） |
| StrokeWidth | double | 2 | 文字描边宽度 |
| BackgroundAlpha | byte | 48 | 背景透明度（0-255） |
| AutoStartTranslation | bool | false | 启动时自动开始翻译 |

## 依赖项

| 包名 | 版本 | 用途 |
|------|------|------|
| Sdcb.PaddleOCR | 3.0.1 | PaddleOCR .NET 绑定 |
| Sdcb.PaddleInference | 3.0.1 | PaddlePaddle 推理引擎 |
| Sdcb.PaddleInference.runtime.win64.mkl | 3.1.0.54 | Windows x64 MKL 运行时 |
| OpenCvSharp4 | 4.11.0 | OpenCvSharp 图像处理 |
| OpenCvSharp4.runtime.win | 4.11.0 | OpenCvSharp Windows 运行时 |
| Hardcodet.NotifyIcon.Wpf | 1.1.0 | WPF 系统托盘图标 |
| System.Text.Json | 8.0.4 | JSON 序列化 |

## 许可证

本项目仅供学习和个人使用。
