import React from 'react';

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'pdf' | 'image' | 'converter' | 'dev' | 'calc';
  color: string;
  gradient: string;
  glow: string;
  component: React.LazyExoticComponent<React.FC<{ onClose: () => void }>>;
}

// ── PDF 工具 ──────────────────────────────────────────────
const MergePdf = React.lazy(() => import('../components/tools/pdf/MergePdf'));
const SplitPdf = React.lazy(() => import('../components/tools/pdf/SplitPdf'));
const CompressPdf = React.lazy(() => import('../components/tools/pdf/CompressPdf'));
const PdfToImage = React.lazy(() => import('../components/tools/pdf/PdfToImage'));
const ImageToPdf = React.lazy(() => import('../components/tools/pdf/ImageToPdf'));
const RotatePdf = React.lazy(() => import('../components/tools/pdf/RotatePdf'));
const DeletePdfPages = React.lazy(() => import('../components/tools/pdf/DeletePdfPages'));
const PdfWatermark = React.lazy(() => import('../components/tools/pdf/PdfWatermark'));
const PdfEncrypt = React.lazy(() => import('../components/tools/pdf/PdfEncrypt'));
const ExtractPdfImages = React.lazy(() => import('../components/tools/pdf/ExtractPdfImages'));
const ExtractPdfText = React.lazy(() => import('../components/tools/pdf/ExtractPdfText'));
const WordToPdf = React.lazy(() => import('../components/tools/pdf/WordToPdf'));

// ── 图片工具 ─────────────────────────────────────────────
const CompressImage = React.lazy(() => import('../components/tools/image/CompressImage'));
const ResizeImage = React.lazy(() => import('../components/tools/image/ResizeImage'));
const CropImage = React.lazy(() => import('../components/tools/image/CropImage'));
const WatermarkImage = React.lazy(() => import('../components/tools/image/WatermarkImage'));
const ImageToBase64 = React.lazy(() => import('../components/tools/image/ImageToBase64'));
const Base64ToImage = React.lazy(() => import('../components/tools/image/Base64ToImage'));
const ColorPicker = React.lazy(() => import('../components/tools/image/ColorPicker'));
const MergeImages = React.lazy(() => import('../components/tools/image/MergeImages'));
const SplitImageGrid = React.lazy(() => import('../components/tools/image/SplitImageGrid'));
const FaviconGenerator = React.lazy(() => import('../components/tools/image/FaviconGenerator'));
const IdPhotoResize = React.lazy(() => import('../components/tools/image/IdPhotoResize'));
const IdPhotoBgColor = React.lazy(() => import('../components/tools/image/IdPhotoBgColor'));

// ── 格式转换 ─────────────────────────────────────────────
const JpgToPng = React.lazy(() => import('../components/tools/converter/JpgToPng'));
const PngToJpg = React.lazy(() => import('../components/tools/converter/PngToJpg'));
const JpgToWebp = React.lazy(() => import('../components/tools/converter/JpgToWebp'));
const PngToWebp = React.lazy(() => import('../components/tools/converter/PngToWebp'));
const WebpToJpg = React.lazy(() => import('../components/tools/converter/WebpToJpg'));
const WebpToPng = React.lazy(() => import('../components/tools/converter/WebpToPng'));
const SvgToPng = React.lazy(() => import('../components/tools/converter/SvgToPng'));
const PngToIco = React.lazy(() => import('../components/tools/converter/PngToIco'));
const BmpToJpg = React.lazy(() => import('../components/tools/converter/BmpToJpg'));
const HeicToJpg = React.lazy(() => import('../components/tools/converter/HeicToJpg'));

// ── 开发者工具 ───────────────────────────────────────────
const JsonFormat = React.lazy(() => import('../components/tools/dev/JsonFormat'));
const JsonMinify = React.lazy(() => import('../components/tools/dev/JsonMinify'));
const JsonValidate = React.lazy(() => import('../components/tools/dev/JsonValidate'));
const XmlFormat = React.lazy(() => import('../components/tools/dev/XmlFormat'));
const HtmlFormat = React.lazy(() => import('../components/tools/dev/HtmlFormat'));
const CssFormat = React.lazy(() => import('../components/tools/dev/CssFormat'));
const JsFormat = React.lazy(() => import('../components/tools/dev/JsFormat'));
const SqlFormat = React.lazy(() => import('../components/tools/dev/SqlFormat'));
const RegexTester = React.lazy(() => import('../components/tools/dev/RegexTester'));
const TimestampConverter = React.lazy(() => import('../components/tools/dev/TimestampConverter'));
const UrlEncode = React.lazy(() => import('../components/tools/dev/UrlEncode'));
const Base64Codec = React.lazy(() => import('../components/tools/dev/Base64Codec'));
const Md5Generator = React.lazy(() => import('../components/tools/dev/Md5Generator'));
const Sha256Generator = React.lazy(() => import('../components/tools/dev/Sha256Generator'));
const UuidGenerator = React.lazy(() => import('../components/tools/dev/UuidGenerator'));
const PasswordGenerator = React.lazy(() => import('../components/tools/dev/PasswordGenerator'));
const JwtDecoder = React.lazy(() => import('../components/tools/dev/JwtDecoder'));
const ColorConverter = React.lazy(() => import('../components/tools/dev/ColorConverter'));
const QrCodeGenerator = React.lazy(() => import('../components/tools/dev/QrCodeGenerator'));
const QrCodeReader = React.lazy(() => import('../components/tools/dev/QrCodeReader'));

// ── 计算器 ───────────────────────────────────────────────
const BmiCalculator = React.lazy(() => import('../components/tools/calc/BmiCalculator'));
const BmrCalculator = React.lazy(() => import('../components/tools/calc/BmrCalculator'));
const AgeCalculator = React.lazy(() => import('../components/tools/calc/AgeCalculator'));
const DateDiffCalculator = React.lazy(() => import('../components/tools/calc/DateDiffCalculator'));
const WorkdayCalculator = React.lazy(() => import('../components/tools/calc/WorkdayCalculator'));
const PercentageCalculator = React.lazy(() => import('../components/tools/calc/PercentageCalculator'));
const DiscountCalculator = React.lazy(() => import('../components/tools/calc/DiscountCalculator'));
const LoanCalculator = React.lazy(() => import('../components/tools/calc/LoanCalculator'));
const MortgageCalculator = React.lazy(() => import('../components/tools/calc/MortgageCalculator'));
const CompoundInterest = React.lazy(() => import('../components/tools/calc/CompoundInterest'));
const UnitConverter = React.lazy(() => import('../components/tools/calc/UnitConverter'));
const LengthConverter = React.lazy(() => import('../components/tools/calc/LengthConverter'));
const WeightConverter = React.lazy(() => import('../components/tools/calc/WeightConverter'));
const TemperatureConverter = React.lazy(() => import('../components/tools/calc/TemperatureConverter'));
const AreaConverter = React.lazy(() => import('../components/tools/calc/AreaConverter'));
const SpeedConverter = React.lazy(() => import('../components/tools/calc/SpeedConverter'));
const TimeConverter = React.lazy(() => import('../components/tools/calc/TimeConverter'));

// ── 注册表 ───────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  // PDF 工具
  { id: 'merge-pdf', name: 'PDF 合并', description: '多个 PDF 合并为一个文件', icon: 'Merge', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: MergePdf },
  { id: 'split-pdf', name: 'PDF 拆分', description: '按页码拆分 PDF 文件', icon: 'Scissors', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: SplitPdf },
  { id: 'compress-pdf', name: 'PDF 压缩', description: '减小 PDF 文件体积', icon: 'Minimize2', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: CompressPdf },
  { id: 'pdf-to-image', name: 'PDF 转图片', description: 'PDF 页面转为 PNG/JPG 图片', icon: 'Image', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: PdfToImage },
  { id: 'image-to-pdf', name: '图片转 PDF', description: '多张图片合并为 PDF', icon: 'FileImage', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: ImageToPdf },
  { id: 'rotate-pdf', name: 'PDF 旋转', description: '旋转 PDF 页面方向', icon: 'RotateCw', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: RotatePdf },
  { id: 'delete-pdf-pages', name: 'PDF 删除页面', description: '删除指定页面后生成新 PDF', icon: 'Trash2', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: DeletePdfPages },
  { id: 'pdf-watermark', name: 'PDF 加水印', description: '为 PDF 添加文字水印', icon: 'Droplets', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: PdfWatermark },
  { id: 'pdf-encrypt', name: 'PDF 加密码', description: '为 PDF 设置打开密码', icon: 'Lock', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: PdfEncrypt },
  { id: 'extract-pdf-images', name: '提取 PDF 图片', description: '从 PDF 中提取所有图片', icon: 'Download', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: ExtractPdfImages },
  { id: 'extract-pdf-text', name: '提取 PDF 文字', description: '从 PDF 中提取纯文本内容', icon: 'FileText', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: ExtractPdfText },
  { id: 'word-to-pdf', name: 'Word 转 PDF', description: 'Word 文档转换为 PDF 格式', icon: 'FileSpreadsheet', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: WordToPdf },

  // 图片工具
  { id: 'compress-image', name: '图片压缩', description: '压缩图片文件大小', icon: 'Minimize2', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: CompressImage },
  { id: 'resize-image', name: '图片改尺寸', description: '调整图片宽高像素', icon: 'Maximize2', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ResizeImage },
  { id: 'crop-image', name: '图片裁剪', description: '自由裁剪图片区域', icon: 'Crop', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: CropImage },
  { id: 'watermark-image', name: '图片加水印', description: '为图片添加文字水印', icon: 'Droplets', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: WatermarkImage },
  { id: 'image-to-base64', name: '图片转 Base64', description: '图片编码为 Base64 文本', icon: 'Code', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageToBase64 },
  { id: 'base64-to-image', name: 'Base64 转图片', description: 'Base64 文本解码为图片', icon: 'Image', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: Base64ToImage },
  { id: 'color-picker', name: '图片取色器', description: '从图片中提取颜色值', icon: 'Pipette', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ColorPicker },
  { id: 'merge-images', name: '图片拼接', description: '多张图片拼接为一张', icon: 'LayoutGrid', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: MergeImages },
  { id: 'split-image-grid', name: '九宫格切图', description: '图片切割为九宫格', icon: 'Grid3x3', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: SplitImageGrid },
  { id: 'favicon-generator', name: 'Favicon 生成', description: '从图片生成网站图标', icon: 'Globe', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: FaviconGenerator },
  { id: 'id-photo-resize', name: '证件照裁剪', description: '按证件照标准裁剪图片', icon: 'User', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: IdPhotoResize },
  { id: 'id-photo-bg-color', name: '证件照换底色', description: '更换证件照背景颜色', icon: 'Palette', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: IdPhotoBgColor },

  // 格式转换
  { id: 'jpg-to-png', name: 'JPG 转 PNG', description: 'JPG 图片转为 PNG 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: JpgToPng },
  { id: 'png-to-jpg', name: 'PNG 转 JPG', description: 'PNG 图片转为 JPG 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: PngToJpg },
  { id: 'jpg-to-webp', name: 'JPG 转 WebP', description: 'JPG 图片转为 WebP 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: JpgToWebp },
  { id: 'png-to-webp', name: 'PNG 转 WebP', description: 'PNG 图片转为 WebP 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: PngToWebp },
  { id: 'webp-to-jpg', name: 'WebP 转 JPG', description: 'WebP 图片转为 JPG 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: WebpToJpg },
  { id: 'webp-to-png', name: 'WebP 转 PNG', description: 'WebP 图片转为 PNG 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: WebpToPng },
  { id: 'svg-to-png', name: 'SVG 转 PNG', description: 'SVG 矢量图转为 PNG 位图', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: SvgToPng },
  { id: 'png-to-ico', name: 'PNG 转 ICO', description: 'PNG 图片转为 ICO 图标', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: PngToIco },
  { id: 'bmp-to-jpg', name: 'BMP 转 JPG', description: 'BMP 图片转为 JPG 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: BmpToJpg },
  { id: 'heic-to-jpg', name: 'HEIC 转 JPG', description: 'HEIC 图片转为 JPG 格式', icon: 'ArrowRightLeft', category: 'converter', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: HeicToJpg },

  // 开发者工具
  { id: 'json-format', name: 'JSON 格式化', description: '美化 JSON 数据格式', icon: 'Braces', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: JsonFormat },
  { id: 'json-minify', name: 'JSON 压缩', description: '压缩 JSON 去除空白', icon: 'Minimize2', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: JsonMinify },
  { id: 'json-validate', name: 'JSON 校验', description: '校验 JSON 语法是否正确', icon: 'CheckCircle', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: JsonValidate },
  { id: 'xml-format', name: 'XML 格式化', description: '美化 XML 数据格式', icon: 'Code2', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: XmlFormat },
  { id: 'html-format', name: 'HTML 格式化', description: '美化 HTML 代码格式', icon: 'Code2', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: HtmlFormat },
  { id: 'css-format', name: 'CSS 格式化', description: '美化 CSS 代码格式', icon: 'Paintbrush', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: CssFormat },
  { id: 'js-format', name: 'JS 格式化', description: '美化 JavaScript 代码格式', icon: 'FileCode', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: JsFormat },
  { id: 'sql-format', name: 'SQL 格式化', description: '美化 SQL 查询语句格式', icon: 'Database', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: SqlFormat },
  { id: 'regex-tester', name: '正则测试', description: '在线测试正则表达式', icon: 'Regex', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: RegexTester },
  { id: 'timestamp-converter', name: '时间戳转换', description: '时间戳与日期互转', icon: 'Clock', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: TimestampConverter },
  { id: 'url-encode', name: 'URL 编码解码', description: 'URL 编码与解码转换', icon: 'Link', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: UrlEncode },
  { id: 'base64-codec', name: 'Base64 编解码', description: 'Base64 编码与解码', icon: 'Binary', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: Base64Codec },
  { id: 'md5-generator', name: 'MD5 生成', description: '计算文本的 MD5 哈希值', icon: 'Hash', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: Md5Generator },
  { id: 'sha256-generator', name: 'SHA256 生成', description: '计算文本的 SHA256 哈希值', icon: 'Shield', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: Sha256Generator },
  { id: 'uuid-generator', name: 'UUID 生成', description: '生成随机 UUID', icon: 'Fingerprint', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: UuidGenerator },
  { id: 'password-generator', name: '密码生成', description: '生成随机安全密码', icon: 'Key', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: PasswordGenerator },
  { id: 'jwt-decoder', name: 'JWT 解析', description: '解析 JWT Token 内容', icon: 'Scan', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: JwtDecoder },
  { id: 'color-converter', name: '颜色转换', description: 'HEX/RGB/HSL 颜色互转', icon: 'Palette', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: ColorConverter },
  { id: 'qr-code-generator', name: '二维码生成', description: '文本/链接生成二维码', icon: 'QrCode', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: QrCodeGenerator },
  { id: 'qr-code-reader', name: '二维码识别', description: '上传图片识别二维码内容', icon: 'ScanLine', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: QrCodeReader },

  // 计算器
  { id: 'bmi-calculator', name: 'BMI 计算器', description: '计算身体质量指数', icon: 'Heart', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: BmiCalculator },
  { id: 'bmr-calculator', name: 'BMR 计算器', description: '计算基础代谢率', icon: 'Flame', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: BmrCalculator },
  { id: 'age-calculator', name: '年龄计算器', description: '根据生日计算精确年龄', icon: 'Calendar', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: AgeCalculator },
  { id: 'date-diff', name: '日期间隔', description: '计算两个日期之间的天数', icon: 'CalendarDays', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: DateDiffCalculator },
  { id: 'workday-calculator', name: '工作日计算', description: '计算指定天数后的工作日日期', icon: 'Briefcase', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: WorkdayCalculator },
  { id: 'percentage-calculator', name: '百分比计算', description: '各种百分比运算', icon: 'Percent', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: PercentageCalculator },
  { id: 'discount-calculator', name: '折扣计算', description: '计算折后价格', icon: 'Tag', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: DiscountCalculator },
  { id: 'loan-calculator', name: '贷款计算', description: '等额本息/等额本金还款计算', icon: 'Landmark', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: LoanCalculator },
  { id: 'mortgage-calculator', name: '房贷计算', description: '房贷月供与利息计算', icon: 'Home', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: MortgageCalculator },
  { id: 'compound-interest', name: '复利计算', description: '复利终值与收益计算', icon: 'TrendingUp', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: CompoundInterest },
  { id: 'unit-converter', name: '单位换算', description: '通用单位换算工具', icon: 'ArrowLeftRight', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: UnitConverter },
  { id: 'length-converter', name: '长度换算', description: '米/千米/英里/尺等换算', icon: 'Ruler', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: LengthConverter },
  { id: 'weight-converter', name: '重量换算', description: '千克/磅/盎司等换算', icon: 'Weight', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: WeightConverter },
  { id: 'temperature-converter', name: '温度换算', description: '摄氏/华氏/开尔文换算', icon: 'Thermometer', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: TemperatureConverter },
  { id: 'area-converter', name: '面积换算', description: '平方米/亩/公顷/平方英尺等换算', icon: 'Square', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: AreaConverter },
  { id: 'speed-converter', name: '速度换算', description: 'km/h/mph/m/s 等换算', icon: 'Gauge', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: SpeedConverter },
  { id: 'time-converter', name: '时间换算', description: '时/分/秒/天等换算', icon: 'Timer', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: TimeConverter },
];

export const CATEGORIES = [
  { id: 'pdf', name: 'PDF 工具', description: 'PDF 处理、转换、编辑', icon: 'FileText', color: 'red', gradient: 'from-red-600 to-rose-600' },
  { id: 'image', name: '图片工具', description: '图片编辑、处理、优化', icon: 'Image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600' },
  { id: 'converter', name: '格式转换', description: '图片格式互转', icon: 'ArrowRightLeft', color: 'violet', gradient: 'from-violet-600 to-purple-600' },
  { id: 'dev', name: '开发者工具', description: '编码、哈希、格式化', icon: 'Code', color: 'amber', gradient: 'from-amber-600 to-orange-600' },
  { id: 'calc', name: '计算器', description: '数学计算、单位换算', icon: 'Calculator', color: 'cyan', gradient: 'from-cyan-600 to-sky-600' },
] as const;

export function getToolsByCategory(category: string): ToolDef[] {
  return TOOLS.filter(t => t.category === category);
}

export function getToolById(id: string): ToolDef | undefined {
  return TOOLS.find(t => t.id === id);
}
