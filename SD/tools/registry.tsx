import React from 'react';

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'pdf' | 'image' | 'converter' | 'dev' | 'calc' | 'fun' | 'image-enhance' | 'test' | 'tarot' | 'mouse' | 'document' | 'audio' | 'video' | 'office' | 'academic' | 'general' | 'data' | 'text' | 'webmaster';
  color: 'red' | 'emerald' | 'violet' | 'amber' | 'cyan' | 'pink' | 'blue' | 'lime' | 'indigo';
  gradient: string;
  glow: string;
  component: React.LazyExoticComponent<React.FC<{ onClose: () => void }>>;
  /** 隐私级别 */
  privacy?: 'local' | 'third-party-api' | 'backend-upload';
  /** 工具状态 */
  status?: 'stable' | 'beta' | 'experimental';
  /** 搜索标签（拼音、别名） */
  tags?: string[];
  /** 测评二级分组 */
  assessmentGroup?: 'fun' | 'personality' | 'orientation';
  /** 测评题量 */
  questionCount?: number;
  /** 预计完成分钟数 */
  estimatedMinutes?: number;
  /** 是否属于需要额外提示与可跳题的敏感主题 */
  sensitive?: boolean;
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
const LengthConverter = React.lazy(() => import('../components/tools/calc/LengthConverter'));
const WeightConverter = React.lazy(() => import('../components/tools/calc/WeightConverter'));
const TemperatureConverter = React.lazy(() => import('../components/tools/calc/TemperatureConverter'));
const AreaConverter = React.lazy(() => import('../components/tools/calc/AreaConverter'));
const SpeedConverter = React.lazy(() => import('../components/tools/calc/SpeedConverter'));
const TimeConverter = React.lazy(() => import('../components/tools/calc/TimeConverter'));

// ── 趣味工具 ───────────────────────────────────────────────
const RandomNumber = React.lazy(() => import('../components/tools/fun/RandomNumber'));
const LotteryTool = React.lazy(() => import('../components/tools/fun/LotteryTool'));
const RandomPassword = React.lazy(() => import('../components/tools/fun/RandomPassword'));
const RandomNickname = React.lazy(() => import('../components/tools/fun/RandomNickname'));
const WhatToEat = React.lazy(() => import('../components/tools/fun/WhatToEat'));
const RandomPicker = React.lazy(() => import('../components/tools/fun/RandomPicker'));

// ── 图片增强 ───────────────────────────────────────────────
const ImageSharpness = React.lazy(() => import('../components/tools/image-enhance/ImageSharpness'));
const ImageBrightness = React.lazy(() => import('../components/tools/image-enhance/ImageBrightness'));
const ImageSharpen = React.lazy(() => import('../components/tools/image-enhance/ImageSharpen'));
const ImageExifRemover = React.lazy(() => import('../components/tools/image-enhance/ImageExifRemover'));
const ImageEnhanceWatermark = React.lazy(() => import('../components/tools/image-enhance/ImageEnhanceWatermark'));
const ImageAddText = React.lazy(() => import('../components/tools/image-enhance/ImageAddText'));
const ImageMosaic = React.lazy(() => import('../components/tools/image-enhance/ImageMosaic'));
const ScreenshotBeautify = React.lazy(() => import('../components/tools/image-enhance/ScreenshotBeautify'));
const MemeGenerator = React.lazy(() => import('../components/tools/image-enhance/MemeGenerator'));
const SocialMediaCover = React.lazy(() => import('../components/tools/image-enhance/SocialMediaCover'));

// ── 测评中心 ───────────────────────────────────────────────
const MbtiTest = React.lazy(() => import('../components/tools/test/MbtiTest'));
const BigFiveTest = React.lazy(() => import('../components/tools/test/BigFiveTest'));
const EnneagramTest = React.lazy(() => import('../components/tools/test/EnneagramTest'));
const AttachmentStyleTest = React.lazy(() => import('../components/tools/test/AttachmentStyleTest'));
const LoveLanguageTest = React.lazy(() => import('../components/tools/test/LoveLanguageTest'));
const CareerInterestTest = React.lazy(() => import('../components/tools/test/CareerInterestTest'));
const DiscTest = React.lazy(() => import('../components/tools/test/DiscTest'));
const ProcrastinationTest = React.lazy(() => import('../components/tools/test/ProcrastinationTest'));
const SocialAnxietyTest = React.lazy(() => import('../components/tools/test/SocialAnxietyTest'));
const LearningStyleTest = React.lazy(() => import('../components/tools/test/LearningStyleTest'));
const EmotionalStabilityTest = React.lazy(() => import('../components/tools/test/EmotionalStabilityTest'));
const AnimalPersonalityTest = React.lazy(() => import('../components/tools/test/AnimalPersonalityTest'));
const ColorPersonalityTest = React.lazy(() => import('../components/tools/test/ColorPersonalityTest'));
const LifeEnergyTest = React.lazy(() => import('../components/tools/test/LifeEnergyTest'));
const CommunicationStyleTest = React.lazy(() => import('../components/tools/test/CommunicationStyleTest'));
const EmotionalIntelligenceTest = React.lazy(() => import('../components/tools/test/EmotionalIntelligenceTest'));
const CoreValuesTest = React.lazy(() => import('../components/tools/test/CoreValuesTest'));
const OrientationSpectrumTest = React.lazy(() => import('../components/tools/test/OrientationSpectrumTest'));
const RomanticOrientationTest = React.lazy(() => import('../components/tools/test/RomanticOrientationTest'));
const IntimacyBoundariesTest = React.lazy(() => import('../components/tools/test/IntimacyBoundariesTest'));

// ── 塔罗/星座 ──────────────────────────────────────────────
const DailyTarot = React.lazy(() => import('../components/tools/tarot/DailyTarot'));
const ThreeCardTarot = React.lazy(() => import('../components/tools/tarot/ThreeCardTarot'));
const LoveTarot = React.lazy(() => import('../components/tools/tarot/LoveTarot'));
const CareerTarot = React.lazy(() => import('../components/tools/tarot/CareerTarot'));
const YesNoTarot = React.lazy(() => import('../components/tools/tarot/YesNoTarot'));
const TarotGuide = React.lazy(() => import('../components/tools/tarot/TarotGuide'));
const ZodiacMatch = React.lazy(() => import('../components/tools/tarot/ZodiacMatch'));
const DailyHoroscope = React.lazy(() => import('../components/tools/tarot/DailyHoroscope'));
const LifePathNumber = React.lazy(() => import('../components/tools/tarot/LifePathNumber'));
const NameScore = React.lazy(() => import('../components/tools/tarot/NameScore'));
const DreamDictionary = React.lazy(() => import('../components/tools/tarot/DreamDictionary'));

// ── 鼠标测试 ───────────────────────────────────────────────
const CpsTest = React.lazy(() => import('../components/tools/mouse/CpsTest'));
const ReactionTestMouse = React.lazy(() => import('../components/tools/mouse/ReactionTest'));
const DpiAnalyzer = React.lazy(() => import('../components/tools/mouse/DpiAnalyzer'));
const DoubleClickTest = React.lazy(() => import('../components/tools/mouse/DoubleClickTest'));
const MouseButtonTest = React.lazy(() => import('../components/tools/mouse/MouseButtonTest'));
const ScrollTest = React.lazy(() => import('../components/tools/mouse/ScrollTest'));
const MouseTrail = React.lazy(() => import('../components/tools/mouse/MouseTrail'));
const PollingRate = React.lazy(() => import('../components/tools/mouse/PollingRate'));
const JitterTest = React.lazy(() => import('../components/tools/mouse/JitterTest'));
const DragTest = React.lazy(() => import('../components/tools/mouse/DragTest'));

// ── 文档处理 ───────────────────────────────────────────────
const PlagiarismCheck = React.lazy(() => import('../components/tools/document/PlagiarismCheck'));
const OcrRecognition = React.lazy(() => import('../components/tools/document/OcrRecognition'));
const TextTranslate = React.lazy(() => import('../components/tools/document/TextTranslate'));
const TextSummarize = React.lazy(() => import('../components/tools/document/TextSummarize'));
const GrammarCheck = React.lazy(() => import('../components/tools/document/GrammarCheck'));
const TextToSpeech = React.lazy(() => import('../components/tools/document/TextToSpeech'));
const CaseConverter = React.lazy(() => import('../components/tools/document/CaseConverter'));
const WordCount = React.lazy(() => import('../components/tools/document/WordCount'));
const DocumentConversionCenter = React.lazy(() => import('../components/tools/document/DocumentConversionCenter'));

// ── 音频处理 ───────────────────────────────────────────────
const AudioConverter = React.lazy(() => import('../components/tools/audio/AudioConverter'));
const NcmConverter = React.lazy(() => import('../components/tools/audio/NcmConverter'));
const VoiceChanger = React.lazy(() => import('../components/tools/audio/VoiceChanger'));

// ── 视频处理 ───────────────────────────────────────────────
const VideoDownloader = React.lazy(() => import('../components/tools/video/VideoDownloader'));

// ── 数据处理（新） ────────────────────────────────────────
const ExcelCsvWorkbench = React.lazy(() => import('../components/tools/data/ExcelCsvWorkbench'));
const BatchFileProcessor = React.lazy(() => import('../components/tools/data/BatchFileProcessor'));
const FileChecksum = React.lazy(() => import('../components/tools/data/FileChecksum'));
const PrivacyCleaner = React.lazy(() => import('../components/tools/data/PrivacyCleaner'));

// ── 办公工具（新） ────────────────────────────────────────
const InvoiceOrganizer = React.lazy(() => import('../components/tools/office/InvoiceOrganizer'));
const SpreadsheetDiff = React.lazy(() => import('../components/tools/office/SpreadsheetDiff'));
const SmartCleaner = React.lazy(() => import('../components/tools/office/SmartCleaner'));
const WordFormatChecker = React.lazy(() => import('../components/tools/office/WordFormatChecker'));
const ContractReviewer = React.lazy(() => import('../components/tools/office/ContractReviewer'));
const FormatConverter = React.lazy(() => import('../components/tools/office/FormatConverter'));
const EmailAttachmentSorter = React.lazy(() => import('../components/tools/office/EmailAttachmentSorter'));
const CalendarTool = React.lazy(() => import('../components/tools/office/CalendarTool'));

// ── 学术工具（新） ────────────────────────────────────────
const ThesisFormatChecker = React.lazy(() => import('../components/tools/academic/ThesisFormatChecker'));
const ReferenceWorkbench = React.lazy(() => import('../components/tools/academic/ReferenceWorkbench'));
const FormulaEditor = React.lazy(() => import('../components/tools/academic/FormulaEditor'));
const ImageTableToExcel = React.lazy(() => import('../components/tools/academic/ImageTableToExcel'));
const LiteratureNotes = React.lazy(() => import('../components/tools/academic/LiteratureNotes'));
const PdfAnnotationSummary = React.lazy(() => import('../components/tools/academic/PdfAnnotationSummary'));
const QuestionScanner = React.lazy(() => import('../components/tools/academic/QuestionScanner'));
const TermConsistency = React.lazy(() => import('../components/tools/academic/TermConsistency'));

// ── 新增开发者工具 ─────────────────────────────────────────
const StructDataConverter = React.lazy(() => import('../components/tools/dev/StructDataConverter'));
const ApiDebugger = React.lazy(() => import('../components/tools/dev/ApiDebugger'));
const OpenApiTool = React.lazy(() => import('../components/tools/dev/OpenApiTool'));
const NetworkDiagnostics = React.lazy(() => import('../components/tools/dev/NetworkDiagnostics'));
const CronTool = React.lazy(() => import('../components/tools/dev/CronTool'));
const CidrCalculator = React.lazy(() => import('../components/tools/dev/CidrCalculator'));
const LogAnalyzer = React.lazy(() => import('../components/tools/dev/LogAnalyzer'));
const EnvDiff = React.lazy(() => import('../components/tools/dev/EnvDiff'));
const SqlWorkbench = React.lazy(() => import('../components/tools/dev/SqlWorkbench'));
const EncodingFixer = React.lazy(() => import('../components/tools/dev/EncodingFixer'));

// ── 文本效率工具 ─────────────────────────────────────────
const RemoveBlankLinesTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.RemoveBlankLinesTool })));
const DedupeLinesTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.DedupeLinesTool })));
const SortLinesTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.SortLinesTool })));
const BatchReplaceTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.BatchReplaceTool })));
const LineNumberTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.LineNumberTool })));
const CharacterFrequencyTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.CharacterFrequencyTool })));
const EntityExtractorTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.EntityExtractorTool })));
const TextFileBatchTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.TextFileBatchTool })));
const MarkupConverterTool = React.lazy(() => import('../components/tools/text/TextTools').then(module => ({ default: module.MarkupConverterTool })));

// ── 站长与 SEO 工具 ─────────────────────────────────────
const MetaTagTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.MetaTagTool })));
const OpenGraphPreviewTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.OpenGraphPreviewTool })));
const RobotsTxtTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.RobotsTxtTool })));
const SitemapGeneratorTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.SitemapGeneratorTool })));
const UrlParserTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.UrlParserTool })));
const UtmBuilderTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.UtmBuilderTool })));
const SlugGeneratorTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.SlugGeneratorTool })));
const UserAgentParserTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.UserAgentParserTool })));
const SslCheckerTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.SslCheckerTool })));
const DnsLookupTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.DnsLookupTool })));
const HttpStatusTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.HttpStatusTool })));
const WebSocketTesterTool = React.lazy(() => import('../components/tools/webmaster/WebmasterTools').then(module => ({ default: module.WebSocketTesterTool })));

// ── 生活工具（新） ────────────────────────────────────────
const IdPhoto = React.lazy(() => import('../components/tools/general/IdPhoto'));
const BarcodeQr = React.lazy(() => import('../components/tools/general/BarcodeQr'));
const ArchiveViewer = React.lazy(() => import('../components/tools/general/ArchiveViewer'));
const SubtitleTool = React.lazy(() => import('../components/tools/general/SubtitleTool'));
const ColorTool = React.lazy(() => import('../components/tools/general/ColorTool'));
const GeneralUnitConverter = React.lazy(() => import('../components/tools/general/UnitConverter'));
const PasswordGen = React.lazy(() => import('../components/tools/general/PasswordGen'));
const GeneralTextDiff = React.lazy(() => import('../components/tools/general/TextDiff'));
const MarkdownEditor = React.lazy(() => import('../components/tools/general/MarkdownEditor'));
const VcardQr = React.lazy(() => import('../components/tools/general/VcardQr'));

// ── 新增PDF/文档/图片增强工具 ──────────────────────────────
const PdfPageEditor = React.lazy(() => import('../components/tools/pdf/PdfPageEditor'));
const SearchablePdfOcr = React.lazy(() => import('../components/tools/pdf/SearchablePdfOcr'));
const ScanProcessor = React.lazy(() => import('../components/tools/image-enhance/ScanProcessor'));
const DocumentDiff = React.lazy(() => import('../components/tools/document/DocumentDiff'));

// ── 注册表 ───────────────────────────────────────────────

type ToolDefinition = Omit<ToolDef, 'privacy' | 'status'> &
  Partial<Pick<ToolDef, 'privacy' | 'status'>>;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  // PDF 工具
  { id: 'merge-pdf', name: 'PDF 合并', description: '多个 PDF 合并为一个文件', icon: 'Merge', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: MergePdf, tags: ['hebing', 'merge', 'combine', '拼接'] },
  { id: 'split-pdf', name: 'PDF 拆分', description: '按页码拆分 PDF 文件', icon: 'Scissors', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: SplitPdf, tags: ['chaifen', 'split', '拆开', '分割'] },
  { id: 'compress-pdf', name: 'PDF 压缩', description: '减小 PDF 文件体积', icon: 'Minimize2', category: 'pdf', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: CompressPdf, tags: ['yasuo', 'compress', '缩小', '减小'] },
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
  { id: 'compress-image', name: '图片压缩', description: '压缩图片文件大小', icon: 'Minimize2', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: CompressImage, tags: ['yasuo', 'compress', '缩小', '图片压缩'] },
  { id: 'resize-image', name: '图片改尺寸', description: '调整图片宽高像素', icon: 'Maximize2', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ResizeImage, tags: ['chicun', 'resize', '像素', '缩放', '放大', '缩小'] },
  { id: 'crop-image', name: '图片裁剪', description: '自由裁剪图片区域', icon: 'Crop', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: CropImage, tags: ['caijian', 'crop', '剪切', '裁切'] },
  { id: 'image-to-base64', name: '图片转 Base64', description: '图片编码为 Base64 文本', icon: 'Code', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageToBase64 },
  { id: 'base64-to-image', name: 'Base64 转图片', description: 'Base64 文本解码为图片', icon: 'Image', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: Base64ToImage },
  { id: 'color-picker', name: '图片取色器', description: '从图片中提取颜色值', icon: 'Pipette', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ColorPicker },
  { id: 'merge-images', name: '图片拼接', description: '多张图片拼接为一张', icon: 'LayoutGrid', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: MergeImages },
  { id: 'split-image-grid', name: '九宫格切图', description: '图片切割为九宫格', icon: 'Grid3x3', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: SplitImageGrid },
  { id: 'favicon-generator', name: 'Favicon 生成', description: '从图片生成网站图标', icon: 'Globe', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: FaviconGenerator },
  { id: 'id-photo-resize', name: '证件照裁剪', description: '按证件照标准裁剪图片', icon: 'User', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: IdPhotoResize },
  { id: 'id-photo-bg-color', name: '证件照换底色', description: '浏览器本地 AI 人像分割，照片不上传', icon: 'Palette', category: 'image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: IdPhotoBgColor },

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
  { id: 'length-converter', name: '长度换算', description: '米/千米/英里/尺等换算', icon: 'Ruler', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: LengthConverter },
  { id: 'weight-converter', name: '重量换算', description: '千克/磅/盎司等换算', icon: 'Weight', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: WeightConverter },
  { id: 'temperature-converter', name: '温度换算', description: '摄氏/华氏/开尔文换算', icon: 'Thermometer', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: TemperatureConverter },
  { id: 'area-converter', name: '面积换算', description: '平方米/亩/公顷/平方英尺等换算', icon: 'Square', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: AreaConverter },
  { id: 'speed-converter', name: '速度换算', description: 'km/h/mph/m/s 等换算', icon: 'Gauge', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: SpeedConverter },
  { id: 'time-converter', name: '时间换算', description: '时/分/秒/天等换算', icon: 'Timer', category: 'calc', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: TimeConverter },

  // 趣味工具
  { id: 'random-number', name: '随机数生成器', description: '生成指定范围的随机数', icon: 'Dices', category: 'fun', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: RandomNumber },
  { id: 'lottery-tool', name: '抽奖工具', description: '在线抽奖随机选择', icon: 'Gift', category: 'fun', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: LotteryTool },
  { id: 'random-password', name: '随机密码生成', description: '生成安全随机密码', icon: 'KeyRound', category: 'fun', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: RandomPassword },
  { id: 'random-nickname', name: '随机昵称生成', description: '生成有趣随机昵称', icon: 'Smile', category: 'fun', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: RandomNickname },
  { id: 'what-to-eat', name: '今天吃什么', description: '随机推荐今天吃什么', icon: 'UtensilsCrossed', category: 'fun', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: WhatToEat },
  { id: 'random-picker', name: '随机选择器', description: '从选项中随机选择一个', icon: 'Shuffle', category: 'fun', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: RandomPicker },

  // 图片增强
  { id: 'image-sharpness', name: '图片清晰度增强', description: '提升图片清晰度和细节', icon: 'Sparkles', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageSharpness },
  { id: 'image-brightness', name: '亮度对比度调整', description: '调整图片亮度对比度饱和度', icon: 'Sun', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageBrightness },
  { id: 'image-sharpen', name: '图片锐化', description: '锐化图片增强边缘细节', icon: 'Focus', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageSharpen },
  { id: 'image-exif-remover', name: '图片去 EXIF', description: '清除图片 EXIF 元数据', icon: 'ShieldOff', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageExifRemover },
  { id: 'image-enhance-watermark', name: '图片加水印', description: '为图片添加文字或图片水印', icon: 'Stamp', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageEnhanceWatermark },
  { id: 'image-add-text', name: '图片加文字', description: '在图片上添加自定义文字', icon: 'Type', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageAddText },
  { id: 'image-mosaic', name: '图片打马赛克', description: '对图片区域添加马赛克', icon: 'Grid2x2', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ImageMosaic },
  { id: 'screenshot-beautify', name: '截图美化', description: '为截图添加圆角阴影背景', icon: 'ImagePlus', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: ScreenshotBeautify },
  { id: 'meme-generator', name: '表情包制作', description: '制作搞笑表情包图片', icon: 'Laugh', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: MemeGenerator },
  { id: 'social-media-cover', name: '社交媒体封面', description: '生成社交媒体封面图片', icon: 'Share2', category: 'image-enhance', color: 'emerald', gradient: 'from-emerald-600 to-teal-600', glow: 'rgba(16,185,129,0.3)', component: SocialMediaCover },

  // 测评中心
  { id: 'mbti-test', name: 'MBTI 40 题扩展版', description: '从四个偏好维度了解你的性格倾向', icon: 'Brain', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: MbtiTest, assessmentGroup: 'personality', questionCount: 40, estimatedMinutes: 8, sensitive: false, tags: ['mbti', '人格', '性格', '40题', '四维偏好'] },
  { id: 'big-five-test', name: '大五人格测试', description: '开放性尽责性外向性宜人性神经质', icon: 'Brain', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: BigFiveTest },
  { id: 'enneagram-test', name: '九型人格测试', description: '九型人格类型测试', icon: 'Pentagon', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: EnneagramTest },
  { id: 'attachment-style-test', name: '恋爱依恋类型', description: '安全型焦虑型回避型依恋测试', icon: 'HeartHandshake', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: AttachmentStyleTest },
  { id: 'love-language-test', name: '爱情语言测试', description: '你的爱情表达方式是什么', icon: 'Heart', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: LoveLanguageTest },
  { id: 'career-interest-test', name: '职业兴趣测试', description: '霍兰德职业兴趣测评', icon: 'Users', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: CareerInterestTest },
  { id: 'disc-test', name: 'DISC 职场性格', description: 'DISC 四维职场性格测试', icon: 'Briefcase', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: DiscTest },
  { id: 'procrastination-test', name: '拖延症测试', description: '你的拖延症有多严重', icon: 'Timer', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: ProcrastinationTest },
  { id: 'social-anxiety-test', name: '社恐指数测试', description: '社交恐惧程度自测', icon: 'Eye', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: SocialAnxietyTest },
  { id: 'learning-style-test', name: '学习风格测试', description: '你是视觉型还是听觉型学习者', icon: 'BookOpen', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: LearningStyleTest },
  { id: 'emotional-stability-test', name: '情绪稳定性测试', description: '评估你的情绪稳定程度', icon: 'Activity', category: 'test', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: EmotionalStabilityTest },
  { id: 'animal-personality-test', name: '动物人格测试', description: '18 个生活场景，看看你更像哪种动物伙伴', icon: 'Brain', category: 'test', color: 'pink', gradient: 'from-orange-500 to-pink-500', glow: 'rgba(236,72,153,0.3)', component: AnimalPersonalityTest, privacy: 'local', status: 'stable', assessmentGroup: 'fun', questionCount: 18, estimatedMinutes: 4, sensitive: false, tags: ['动物人格', '趣味测试', 'animal', '性格'] },
  { id: 'color-personality-test', name: '色彩人格测试', description: '从情境选择中发现你的代表色与行动气质', icon: 'Palette', category: 'test', color: 'pink', gradient: 'from-rose-500 to-orange-500', glow: 'rgba(244,114,182,0.3)', component: ColorPersonalityTest, privacy: 'local', status: 'stable', assessmentGroup: 'fun', questionCount: 18, estimatedMinutes: 4, sensitive: false, tags: ['色彩人格', '颜色测试', '趣味', 'color'] },
  { id: 'life-energy-test', name: '生活能量类型', description: '探索你补充能量、投入行动和恢复节奏的方式', icon: 'Activity', category: 'test', color: 'pink', gradient: 'from-amber-500 to-rose-500', glow: 'rgba(251,146,60,0.3)', component: LifeEnergyTest, privacy: 'local', status: 'stable', assessmentGroup: 'fun', questionCount: 18, estimatedMinutes: 4, sensitive: false, tags: ['生活能量', '恢复方式', '趣味', 'energy'] },
  { id: 'communication-style-test', name: '沟通风格测试', description: '了解你的直接、分析、共情与协作倾向', icon: 'MessageSquare', category: 'test', color: 'violet', gradient: 'from-violet-600 to-fuchsia-600', glow: 'rgba(139,92,246,0.3)', component: CommunicationStyleTest, privacy: 'local', status: 'stable', assessmentGroup: 'personality', questionCount: 18, estimatedMinutes: 4, sensitive: false, tags: ['沟通风格', '表达', '协作', 'communication'] },
  { id: 'emotional-intelligence-test', name: '情绪智力测试', description: '观察自我觉察、调节、共情与关系管理', icon: 'Heart', category: 'test', color: 'violet', gradient: 'from-fuchsia-600 to-violet-600', glow: 'rgba(168,85,247,0.3)', component: EmotionalIntelligenceTest, privacy: 'local', status: 'stable', assessmentGroup: 'personality', questionCount: 18, estimatedMinutes: 4, sensitive: false, tags: ['情绪智力', '情商', '共情', 'eq'] },
  { id: 'core-values-test', name: '核心价值观测试', description: '发现自主、稳定、成就、连接、探索与贡献偏好', icon: 'Brain', category: 'test', color: 'violet', gradient: 'from-indigo-600 to-violet-600', glow: 'rgba(99,102,241,0.3)', component: CoreValuesTest, privacy: 'local', status: 'stable', assessmentGroup: 'personality', questionCount: 18, estimatedMinutes: 4, sensitive: false, tags: ['核心价值观', '人生选择', '价值排序', 'values'] },
  { id: 'orientation-spectrum-test', name: '吸引倾向光谱探索', description: '温和观察性吸引方向、低频体验与探索状态', icon: 'Eye', category: 'test', color: 'indigo', gradient: 'from-rose-500 to-indigo-600', glow: 'rgba(99,102,241,0.3)', component: OrientationSpectrumTest, privacy: 'local', status: 'stable', assessmentGroup: 'orientation', questionCount: 18, estimatedMinutes: 4, sensitive: true, tags: ['吸引倾向', '性取向探索', '光谱', 'orientation'] },
  { id: 'romantic-orientation-test', name: '浪漫倾向探索', description: '分开观察浪漫心动、深度连接与低频体验', icon: 'Heart', category: 'test', color: 'indigo', gradient: 'from-pink-500 to-indigo-600', glow: 'rgba(99,102,241,0.3)', component: RomanticOrientationTest, privacy: 'local', status: 'stable', assessmentGroup: 'orientation', questionCount: 18, estimatedMinutes: 4, sensitive: true, tags: ['浪漫倾向', '浪漫吸引', '关系探索', 'romantic'] },
  { id: 'intimacy-boundaries-test', name: '亲密边界风格', description: '了解自主、靠近、透明沟通与渐进节奏偏好', icon: 'ShieldCheck', category: 'test', color: 'indigo', gradient: 'from-teal-600 to-indigo-600', glow: 'rgba(79,70,229,0.3)', component: IntimacyBoundariesTest, privacy: 'local', status: 'stable', assessmentGroup: 'orientation', questionCount: 18, estimatedMinutes: 4, sensitive: true, tags: ['亲密边界', '关系边界', '沟通', 'intimacy'] },

  // 塔罗/星座
  { id: 'daily-tarot', name: '每日塔罗', description: '抽取今日塔罗牌运势', icon: 'Sparkles', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: DailyTarot },
  { id: 'three-card-tarot', name: '三张牌塔罗', description: '过去现在未来三牌阵', icon: 'Layers', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: ThreeCardTarot },
  { id: 'love-tarot', name: '爱情塔罗', description: '爱情关系塔罗牌占卜', icon: 'Heart', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: LoveTarot },
  { id: 'career-tarot', name: '事业塔罗', description: '事业发展塔罗牌占卜', icon: 'Briefcase', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: CareerTarot },
  { id: 'yes-no-tarot', name: '是或否塔罗', description: '快速回答是或否问题', icon: 'HelpCircle', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: YesNoTarot },
  { id: 'tarot-guide', name: '塔罗牌义大全', description: '78 张塔罗牌牌义详解', icon: 'BookOpen', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: TarotGuide },
  { id: 'zodiac-match', name: '星座配对', description: '十二星座配对指数查询', icon: 'Star', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: ZodiacMatch },
  { id: 'daily-horoscope', name: '每日星座运势', description: '十二星座今日运势查询', icon: 'Sun', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: DailyHoroscope },
  { id: 'life-path-number', name: '生命灵数', description: '根据生日计算生命灵数', icon: 'Hash', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: LifePathNumber },
  { id: 'name-score', name: '姓名打分', description: '趣味姓名评分娱乐版', icon: 'FileSignature', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: NameScore },
  { id: 'dream-dictionary', name: '梦境解析', description: '常见梦境象征意义解读', icon: 'Moon', category: 'tarot', color: 'blue', gradient: 'from-blue-600 to-indigo-600', glow: 'rgba(59,130,246,0.3)', component: DreamDictionary },

  // 鼠标测试
  { id: 'cps-test', name: '点击速度测试', description: '测试每秒点击次数 CPS', icon: 'MousePointerClick', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: CpsTest },
  { id: 'reaction-test', name: '反应速度测试', description: '测试鼠标点击反应时间', icon: 'Zap', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: ReactionTestMouse },
  { id: 'dpi-analyzer', name: 'DPI 检测分析', description: '测量鼠标实际 DPI 值', icon: 'Crosshair', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: DpiAnalyzer },
  { id: 'double-click-test', name: '双击测试', description: '测试鼠标双击间隔和灵敏度', icon: 'MousePointer', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: DoubleClickTest },
  { id: 'mouse-button-test', name: '按键测试', description: '测试鼠标所有按键是否正常', icon: 'CheckCircle', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: MouseButtonTest },
  { id: 'scroll-test', name: '滚轮测试', description: '测试滚轮灵敏度和方向', icon: 'ArrowUpDown', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: ScrollTest },
  { id: 'mouse-trail', name: '轨迹可视化', description: '鼠标移动轨迹热力图', icon: 'Route', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: MouseTrail },
  { id: 'polling-rate', name: '回报率测试', description: '估算鼠标 USB 回报率 Hz', icon: 'Activity', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: PollingRate },
  { id: 'jitter-test', name: '抖动测试', description: '检测鼠标静止时的抖动漂移', icon: 'TrendingUp', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: JitterTest },
  { id: 'drag-test', name: '拖拽测试', description: '测试拖拽操作的精度和稳定性', icon: 'Move', category: 'mouse', color: 'lime', gradient: 'from-lime-600 to-green-600', glow: 'rgba(132,204,22,0.3)', component: DragTest },

  // 文档处理
  { id: 'plagiarism-check', name: '论文查重', description: '上传两篇论文比对相似度', icon: 'FileSearch', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: PlagiarismCheck, privacy: 'backend-upload', status: 'beta' },
  { id: 'ocr-recognition', name: 'OCR 文字识别', description: '从图片中提取文字内容', icon: 'ScanText', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: OcrRecognition, privacy: 'local', status: 'stable' },
  { id: 'text-translate', name: '文本翻译', description: '多语言文本互译', icon: 'Languages', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: TextTranslate, privacy: 'third-party-api', status: 'stable' },
  { id: 'text-summarize', name: '文本摘要', description: '自动提取文本关键内容', icon: 'AlignLeft', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: TextSummarize },
  { id: 'grammar-check', name: '语法检查', description: '检查文本语法和拼写错误', icon: 'CheckSquare', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: GrammarCheck, privacy: 'third-party-api', status: 'stable' },
  { id: 'text-to-speech', name: '文本转语音', description: '将文本转换为语音朗读', icon: 'Volume2', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: TextToSpeech },
  { id: 'case-converter', name: '大小写转换', description: '英文文本大小写批量转换', icon: 'CaseSensitive', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: CaseConverter },
  { id: 'word-count', name: '字数统计', description: '统计文本字数、词数、行数', icon: 'FileText', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: WordCount },
  { id: 'document-conversion-center', name: '文档转换中心', description: 'PDF、Office、Markdown、HTML、OCR 真实转换与批量打包', icon: 'FileArchive', category: 'document', color: 'indigo', gradient: 'from-indigo-600 to-blue-600', glow: 'rgba(99,102,241,0.3)', component: DocumentConversionCenter, privacy: 'backend-upload', status: 'beta', tags: ['文档', '转换', 'word', 'pdf', 'excel', 'ppt', 'ocr', '批量', 'zip'] },

  // ── 文本效率工具 ──────────────────────────────────────
  { id: 'remove-blank-lines', name: '文本去空行', description: '批量删除文本中的空白行', icon: 'Eraser', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: RemoveBlankLinesTool, privacy: 'local', status: 'stable', tags: ['文本', '去空行', 'remove blank lines', 'qingli', '清理'] },
  { id: 'dedupe-lines', name: '文本行去重', description: '去除重复行并保留首次出现顺序', icon: 'CopyCheck', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: DedupeLinesTool, privacy: 'local', status: 'stable', tags: ['文本', '去重', 'dedupe', 'quchong', '清洗'] },
  { id: 'sort-lines', name: '文本行排序', description: '按中文、字母和数字自然排序', icon: 'ArrowDownAZ', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: SortLinesTool, privacy: 'local', status: 'stable', tags: ['文本', '排序', 'sort lines', 'paixu', '自然排序'] },
  { id: 'batch-text-replace', name: '批量文本替换', description: '批量替换文本内容并支持正则', icon: 'Replace', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: BatchReplaceTool, privacy: 'local', status: 'stable', tags: ['文本', '替换', 'replace', '正则', 'zhihuan'] },
  { id: 'line-number-tool', name: '文本行号工具', description: '添加或移除文本行号前缀', icon: 'ListOrdered', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: LineNumberTool, privacy: 'local', status: 'stable', tags: ['文本', '行号', 'line number', 'hanghao', '编号'] },
  { id: 'character-frequency', name: '字符与词频统计', description: '统计字符、词数、行数和出现频率', icon: 'BarChart3', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: CharacterFrequencyTool, privacy: 'local', status: 'stable', tags: ['文本', '词频', 'frequency', 'tongji', '统计'] },
  { id: 'entity-extractor', name: '文本信息提取', description: '提取邮箱、链接和 IP 地址', icon: 'ScanSearch', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: EntityExtractorTool, privacy: 'local', status: 'stable', tags: ['文本', '提取', '邮箱', 'url', 'ip', 'shiti'] },
  { id: 'text-file-batch', name: '文本文件批处理', description: '合并文本文件或按行数切分下载', icon: 'Files', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: TextFileBatchTool, privacy: 'local', status: 'stable', tags: ['文本文件', '批处理', 'merge', 'split', 'piliang', '文件'] },
  { id: 'markup-converter', name: 'Markdown/HTML 转换', description: 'Markdown、HTML 与纯文本互转', icon: 'FileCode2', category: 'text', color: 'cyan', gradient: 'from-sky-600 to-cyan-600', glow: 'rgba(14,165,233,0.3)', component: MarkupConverterTool, privacy: 'local', status: 'stable', tags: ['markdown', 'html', '纯文本', '转换', 'zhuanhuan'] },

  // ── 站长与 SEO 工具 ───────────────────────────────────
  { id: 'meta-tag-generator', name: 'Meta 标签生成器', description: '生成标题、描述与社交分享标签', icon: 'Tags', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: MetaTagTool, privacy: 'local', status: 'stable', tags: ['seo', 'meta', '标签', 'yuansu', '元数据'] },
  { id: 'open-graph-preview', name: 'Open Graph 预览', description: '预览链接在社交平台的分享卡片', icon: 'Share2', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: OpenGraphPreviewTool, privacy: 'local', status: 'stable', tags: ['seo', 'og', 'open graph', '分享', 'yulan'] },
  { id: 'robots-txt-generator', name: 'robots.txt 生成器', description: '生成搜索引擎抓取规则文件', icon: 'Bot', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: RobotsTxtTool, privacy: 'local', status: 'stable', tags: ['seo', 'robots', '抓取', '规则', 'shengcheng'] },
  { id: 'sitemap-generator', name: 'Sitemap 生成器', description: '生成站点地图 XML 文件', icon: 'Map', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: SitemapGeneratorTool, privacy: 'local', status: 'stable', tags: ['seo', 'sitemap', '站点地图', 'xml', 'shengcheng'] },
  { id: 'url-parser', name: 'URL 解析器', description: '拆解 URL 组成与查询参数', icon: 'Link2', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: UrlParserTool, privacy: 'local', status: 'stable', tags: ['url', '解析', 'query', '地址', 'jiexi'] },
  { id: 'utm-builder', name: 'UTM 链接生成器', description: '为营销链接追加 UTM 参数', icon: 'Megaphone', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: UtmBuilderTool, privacy: 'local', status: 'stable', tags: ['utm', '营销', '链接', '参数', 'lianjie'] },
  { id: 'slug-generator', name: 'Slug 生成器', description: '将标题转换为 URL 友好路径', icon: 'CaseLower', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: SlugGeneratorTool, privacy: 'local', status: 'stable', tags: ['slug', 'url', '路径', '标题', 'biaoti'] },
  { id: 'user-agent-parser', name: 'User-Agent 解析器', description: '识别浏览器、系统和设备类型', icon: 'MonitorSmartphone', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: UserAgentParserTool, privacy: 'local', status: 'stable', tags: ['user agent', 'ua', '浏览器', '设备', '解析'] },
  { id: 'ssl-checker', name: 'SSL 证书检查', description: '检查公开域名的 TLS 证书状态', icon: 'ShieldCheck', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: SslCheckerTool, privacy: 'third-party-api', status: 'beta', tags: ['ssl', 'tls', '证书', '域名', 'jiancha'] },
  { id: 'dns-lookup', name: 'DNS 查询', description: '查询公开域名的 A/AAAA 地址', icon: 'Globe2', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: DnsLookupTool, privacy: 'third-party-api', status: 'beta', tags: ['dns', '域名', '解析', 'a记录', '查询'] },
  { id: 'http-status-checker', name: 'HTTP 状态检查', description: '查看响应状态、请求头和重定向链', icon: 'Activity', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: HttpStatusTool, privacy: 'third-party-api', status: 'beta', tags: ['http', '状态码', 'header', '重定向', 'jiancha'] },
  { id: 'websocket-tester', name: 'WebSocket 握手测试', description: '测试公开 WebSocket 服务握手', icon: 'RadioTower', category: 'webmaster', color: 'indigo', gradient: 'from-indigo-600 to-sky-600', glow: 'rgba(79,70,229,0.3)', component: WebSocketTesterTool, privacy: 'third-party-api', status: 'beta', tags: ['websocket', 'ws', 'wss', '握手', 'ceshi'] },

  // ── 音频处理 ───────────────────────────────────────────
  { id: 'audio-converter', name: '音频格式转换', description: 'MP3/WAV/OGG/WebM 格式互转', icon: 'AudioLines', category: 'audio', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: AudioConverter, privacy: 'local', status: 'stable', tags: ['yinpin', 'mp3', 'wav', 'ogg', 'webm', 'geishi', '音频', '格式'] },
  { id: 'ncm-converter', name: 'NCM 转换器', description: '网易云音乐 NCM 解密为 MP3/FLAC', icon: 'Headphones', category: 'audio', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: NcmConverter, privacy: 'local', status: 'stable', tags: ['ncm', 'wangyiyun', 'netease', 'jiami', 'jiemi', '网易云', '解密', '音乐'] },
  { id: 'voice-changer', name: '音频变声器', description: '调节音调速度实现变声效果', icon: 'Music', category: 'audio', color: 'pink', gradient: 'from-pink-600 to-rose-600', glow: 'rgba(236,72,153,0.3)', component: VoiceChanger, privacy: 'local', status: 'stable', tags: ['biansheng', 'yin调', 'sudi', '变声', '音调', '速度'] },

  // ── 视频处理 ───────────────────────────────────────────
  {
    id: 'video-parser-downloader',
    name: '视频解析下载',
    description: '解析并下载抖音与B站单个公开视频，展示平台实际可用清晰度和任务进度',
    icon: 'Video',
    category: 'video',
    color: 'pink',
    gradient: 'from-orange-500 to-rose-500',
    glow: 'rgba(244,63,94,0.3)',
    component: VideoDownloader,
    privacy: 'third-party-api',
    status: 'beta',
    tags: ['shipin', '视频', 'xiazai', '下载', 'jiexi', '解析', 'douyin', '抖音', 'bilibili', 'B站', '哔哩哔哩', '无水印'],
  },

  // ── 数据处理（新） ──────────────────────────────────────
  { id: 'excel-csv-workbench', name: 'Excel/CSV 工作台', description: 'Excel/CSV 数据查看、筛选、排序、统计', icon: 'Table', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: ExcelCsvWorkbench, privacy: 'local', status: 'stable', tags: ['excel', 'csv', 'shuju', '数据', '表格', 'shaixuan', '筛选'] },
  { id: 'pdf-page-editor', name: 'PDF 页面编辑器', description: 'PDF 页面预览、排序、旋转、删除', icon: 'FileInput', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: PdfPageEditor, privacy: 'local', status: 'stable', tags: ['pdf', 'yemian', '页面', '编辑', 'paixu', '排序'] },
  { id: 'scan-processor', name: '扫描件处理中心', description: '扫描件增强、裁剪、纠偏、灰度化', icon: 'Scan', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: ScanProcessor, privacy: 'local', status: 'stable', tags: ['saomiao', '扫描', 'zengqiang', '增强', 'jiaopian', '纠偏'] },
  { id: 'searchable-pdf-ocr', name: 'PDF OCR 文字提取', description: '识别普通或扫描PDF并按页导出文字', icon: 'FileSearch', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: SearchablePdfOcr, privacy: 'local', status: 'beta', tags: ['ocr', 'shibie', '识别', 'pdf', 'sousuo', '搜索'] },
  { id: 'document-diff', name: 'Word/PDF 文档对比', description: '对比两份文档内容差异', icon: 'GitCompare', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: DocumentDiff, privacy: 'local', status: 'stable', tags: ['duibi', '对比', 'word', 'pdf', 'chayi', '差异'] },
  { id: 'batch-file-processor', name: '批量文件处理', description: '批量重命名、格式转换、压缩', icon: 'Files', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: BatchFileProcessor, privacy: 'local', status: 'stable', tags: ['piliang', '批量', 'chongmingming', '重命名', 'geshi', '格式'] },
  { id: 'file-checksum', name: '文件校验中心', description: '计算文件 MD5/SHA 哈希校验值', icon: 'ShieldCheck', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: FileChecksum, privacy: 'local', status: 'stable', tags: ['jiaoyan', '校验', 'hash', 'md5', 'sha', 'wajian', '文件'] },
  { id: 'privacy-cleaner', name: '隐私清理中心', description: '清除文件元数据和隐私信息', icon: 'ShieldOff', category: 'data', color: 'red', gradient: 'from-red-600 to-rose-600', glow: 'rgba(239,68,68,0.3)', component: PrivacyCleaner, privacy: 'local', status: 'stable', tags: ['yinsi', '隐私', 'qingli', '清理', 'exif', 'yuanjushuju', '元数据'] },

  // ── 办公工具（新） ──────────────────────────────────────
  { id: 'invoice-organizer', name: '发票整理助手', description: '本地OCR提取发票字段、分类并导出CSV', icon: 'Receipt', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: InvoiceOrganizer, privacy: 'local', status: 'beta', tags: ['fapiao', '发票', 'zhengli', '整理', 'guilei', '归类'] },
  { id: 'spreadsheet-diff', name: '表格差异对比', description: '对比两个 Excel/CSV 表格差异', icon: 'GitCompare', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: SpreadsheetDiff, privacy: 'local', status: 'stable', tags: ['biaoge', '表格', 'duibi', '对比', 'chayi', '差异', 'excel'] },
  { id: 'smart-cleaner', name: '表格智能清洗', description: '去重、补空、格式化、异常值处理', icon: 'Sparkles', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: SmartCleaner, privacy: 'local', status: 'stable', tags: ['qingxi', '清洗', 'quchong', '去重', 'bukong', '补空'] },
  { id: 'word-format-check', name: 'Word 格式检查', description: '检查 Word 文档格式规范性', icon: 'FileCheck', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: WordFormatChecker, privacy: 'local', status: 'stable', tags: ['word', 'geshi', '格式', 'jiancha', '检查', 'guifan', '规范'] },
  { id: 'contract-reviewer', name: '合同审阅辅助', description: '基于规则的合同关键条款检测（基础版，非AI分析）', icon: 'FileText', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: ContractReviewer, privacy: 'local', status: 'beta', tags: ['hetong', '合同', 'shenyue', '审阅', 'tiaokuan', '条款', 'fengxian', '风险'] },
  { id: 'format-converter', name: 'Markdown/HTML 转换', description: 'Markdown与HTML格式互转（暂不支持Word）', icon: 'ArrowRightLeft', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: FormatConverter, privacy: 'local', status: 'beta', tags: ['markdown', 'html', 'zhuanhuan', '转换', 'geshi', '格式'] },
  { id: 'email-attachment-sorter', name: '邮件附件整理', description: '批量提取、归类邮件附件', icon: 'Mail', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: EmailAttachmentSorter, privacy: 'local', status: 'stable', tags: ['youjian', '邮件', 'fujian', '附件', 'zhengli', '整理'] },
  { id: 'calendar-file-tool', name: '日历文件工具', description: 'ICS 日历文件生成与解析', icon: 'Calendar', category: 'office', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: CalendarTool, privacy: 'local', status: 'stable', tags: ['rili', '日历', 'ics', 'ical', 'richeng', '日程'] },

  // ── 学术工具（新） ──────────────────────────────────────
  { id: 'thesis-format-checker', name: '论文格式检查器', description: '检查论文格式是否符合规范要求', icon: 'GraduationCap', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: ThesisFormatChecker, privacy: 'local', status: 'stable', tags: ['lunwen', '论文', 'geshi', '格式', 'jiancha', '检查', 'guifan', '规范'] },
  { id: 'reference-workbench', name: '参考文献工作台', description: 'GB/T 7714/APA/MLA 格式生成与管理', icon: 'BookOpen', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: ReferenceWorkbench, privacy: 'local', status: 'stable', tags: ['cankao', '参考', 'wenxian', '文献', 'geishi', '格式', 'gbt7714', 'apa', 'mla'] },
  { id: 'formula-editor', name: '公式编辑与转换', description: 'LaTeX 公式编辑、预览与格式转换', icon: 'Sigma', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: FormulaEditor, privacy: 'local', status: 'stable', tags: ['gongshi', '公式', 'latex', 'bianji', '编辑', 'zhuanhuan', '转换'] },
  { id: 'image-table-to-excel', name: '图片表格转 Excel', description: '识别图片中的表格并转为 Excel', icon: 'Table', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: ImageTableToExcel, privacy: 'local', status: 'beta', tags: ['tupian', '图片', 'biaoge', '表格', 'excel', 'shibie', '识别', 'ocr'] },
  { id: 'literature-notes', name: '文献阅读笔记', description: '文献摘录、笔记管理与导出', icon: 'NotebookPen', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: LiteratureNotes, privacy: 'local', status: 'stable', tags: ['wenxian', '文献', 'biji', '笔记', 'zhailu', '摘录', 'daochu', '导出'] },
  { id: 'pdf-annotation-summary', name: 'PDF 批注汇总', description: '提取 PDF 中所有批注和高亮', icon: 'MessageSquare', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: PdfAnnotationSummary, privacy: 'local', status: 'stable', tags: ['pdf', 'pizhu', '批注', 'gaoliang', '高亮', 'huizong', '汇总'] },
  { id: 'question-scanner', name: '题目扫描整理', description: '扫描试卷提取题目并分类整理', icon: 'ClipboardList', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: QuestionScanner, privacy: 'local', status: 'stable', tags: ['timu', '题目', 'saomiao', '扫描', 'shijuan', '试卷', 'zhengli', '整理'] },
  { id: 'term-consistency-checker', name: '中英文术语一致性检查', description: '检查文档中术语翻译的一致性', icon: 'Languages', category: 'academic', color: 'violet', gradient: 'from-violet-600 to-purple-600', glow: 'rgba(139,92,246,0.3)', component: TermConsistency, privacy: 'local', status: 'stable', tags: ['shuyu', '术语', 'yizhixing', '一致性', 'fanyi', '翻译', 'zhongying', '中英'] },

  // ── 新增开发者工具 ──────────────────────────────────────
  { id: 'struct-data-converter', name: '结构化数据转换器', description: 'JSON/YAML/TOML/CSV 格式互转', icon: 'ArrowRightLeft', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: StructDataConverter, privacy: 'local', status: 'stable', tags: ['json', 'yaml', 'toml', 'csv', 'zhuanhuan', '转换', 'jiegou', '结构'] },
  { id: 'api-debugger', name: 'API 调试工作台', description: 'HTTP 请求调试与响应查看', icon: 'Globe', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: ApiDebugger, privacy: 'local', status: 'stable', tags: ['api', 'http', 'qingqiu', '请求', 'xiangying', '响应', 'tiaoshi', '调试'] },
  { id: 'open-api-tool', name: 'OpenAPI 文档工具', description: '解析JSON/YAML格式的OpenAPI与Swagger文档', icon: 'BookOpen', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: OpenApiTool, privacy: 'local', status: 'beta', tags: ['openapi', 'swagger', 'api', 'wendang', '文档', 'jiexi', '解析'] },
  { id: 'network-diagnostics', name: '网络诊断中心', description: 'DNS/Ping/端口/SSL 诊断工具', icon: 'Wifi', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: NetworkDiagnostics, privacy: 'local', status: 'stable', tags: ['wangluo', '网络', 'dns', 'ping', 'duankou', '端口', 'ssl', 'zhenduan', '诊断'] },
  { id: 'cron-tool', name: 'Cron 表达式工具', description: 'Cron 表达式生成、解析与下次执行时间', icon: 'Clock', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: CronTool, privacy: 'local', status: 'stable', tags: ['cron', 'biaodashi', '表达式', 'dingshi', '定时', 'renwu', '任务'] },
  { id: 'cidr-calculator', name: 'CIDR/子网计算器', description: 'IP 子网划分与 CIDR 计算', icon: 'Network', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: CidrCalculator, privacy: 'local', status: 'stable', tags: ['cidr', 'ziwang', '子网', 'ip', 'jisuan', '计算', 'wangluo', '网络'] },
  { id: 'log-analyzer', name: '日志分析器', description: '日志文件解析、过滤与统计', icon: 'FileSearch', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: LogAnalyzer, privacy: 'local', status: 'stable', tags: ['rizhi', '日志', 'fenxi', '分析', 'guolv', '过滤', 'tongji', '统计'] },
  { id: 'env-diff', name: '环境变量对比', description: '对比两个 .env 文件的差异', icon: 'GitCompare', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: EnvDiff, privacy: 'local', status: 'stable', tags: ['env', 'huanjing', '环境', 'bianliang', '变量', 'duibi', '对比'] },
  { id: 'sql-workbench', name: 'SQL 数据工作台', description: 'SQL 语句编写、执行与结果查看', icon: 'Database', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: SqlWorkbench, privacy: 'local', status: 'beta', tags: ['sql', 'shuju', '数据', 'chaxun', '查询', 'gongzuotai', '工作台'] },
  { id: 'encoding-fixer', name: '编码与乱码修复', description: '检测文件编码并修复乱码问题', icon: 'Code', category: 'dev', color: 'amber', gradient: 'from-amber-600 to-orange-600', glow: 'rgba(245,158,11,0.3)', component: EncodingFixer, privacy: 'local', status: 'stable', tags: ['bianma', '编码', 'luanma', '乱码', 'xiufu', '修复', 'gbk', 'utf8'] },

  // ── 生活工具（新） ──────────────────────────────────────
  { id: 'id-photo', name: '证件照处理', description: '证件照裁剪、换底色、排版', icon: 'User', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: IdPhoto, privacy: 'local', status: 'stable', tags: ['zhengjianzhao', '证件照', 'caijian', '裁剪', 'dise', '底色', 'paiban', '排版'] },
  { id: 'barcode-qr', name: '条码/二维码生成与扫描', description: '生成条形码、二维码及扫码识别', icon: 'QrCode', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: BarcodeQr, privacy: 'local', status: 'stable', tags: ['tiaoma', '条码', 'qrcode', 'erweima', '二维码', 'shengcheng', '生成', 'saomiao', '扫描'] },
  { id: 'archive-viewer', name: '压缩包预览与处理', description: '预览 ZIP 压缩包内容与文件列表', icon: 'Archive', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: ArchiveViewer, privacy: 'local', status: 'stable', tags: ['yasuo', '压缩', 'zip', 'yulan', '预览', 'jieya', '解压'] },
  { id: 'subtitle-tool', name: '字幕文件工具', description: 'SRT/VTT/ASS 字幕格式转换与时间调整', icon: 'Subtitles', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: SubtitleTool, privacy: 'local', status: 'stable', tags: ['zimu', '字幕', 'srt', 'vtt', 'ass', 'zhuanhuan', '转换', 'shijian', '时间'] },
  { id: 'color-tool', name: '颜色工具', description: 'HEX/RGB/HSL 转换与 WCAG 对比度检查', icon: 'Palette', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: ColorTool, privacy: 'local', status: 'stable', tags: ['yanse', '颜色', 'hex', 'rgb', 'hsl', 'duibidu', '对比度', 'wcag'] },
  { id: 'unit-converter-full', name: '全能单位换算器', description: '10 大分类完整单位换算工具', icon: 'ArrowLeftRight', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: GeneralUnitConverter, privacy: 'local', status: 'stable', tags: ['danwei', '单位', 'huansuan', '换算', 'changdu', '长度', 'zhongliang', '重量', 'wendu', '温度'] },
  { id: 'password-gen', name: '密码生成器', description: '安全随机密码生成与强度评估', icon: 'Key', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: PasswordGen, privacy: 'local', status: 'stable', tags: ['mima', '密码', 'shengcheng', '生成', 'anquan', '安全', 'qiangdu', '强度'] },
  { id: 'text-diff-advanced', name: '文本差异对比', description: 'LCS 算法精确对比与字符级高亮', icon: 'GitCompare', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: GeneralTextDiff, privacy: 'local', status: 'stable', tags: ['wenben', '文本', 'duibi', '对比', 'chayi', '差异', 'diff'] },
  { id: 'markdown-editor', name: 'Markdown 编辑器', description: 'Markdown 编辑、预览与导出', icon: 'FileCode', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: MarkdownEditor, privacy: 'local', status: 'stable', tags: ['markdown', 'bianji', '编辑', 'yulan', '预览', 'daochu', '导出'] },
  { id: 'vcard-qr', name: '二维码名片生成', description: 'vCard 名片生成与二维码编码', icon: 'Contact', category: 'general', color: 'cyan', gradient: 'from-cyan-600 to-sky-600', glow: 'rgba(6,182,212,0.3)', component: VcardQr, privacy: 'local', status: 'stable', tags: ['vcard', 'mingpian', '名片', 'erweima', '二维码', 'lianxifangshi', '联系方式'] },
];

export const TOOLS: ToolDef[] = TOOL_DEFINITIONS.map((tool) => ({
  privacy: 'local',
  status: 'stable',
  ...tool,
}));

export const CATEGORIES = [
  { id: 'pdf', name: 'PDF 工具', description: 'PDF 处理、转换、编辑', icon: 'FileText', color: 'red', gradient: 'from-red-600 to-rose-600' },
  { id: 'image', name: '图片工具', description: '图片编辑、处理、优化', icon: 'Image', color: 'emerald', gradient: 'from-emerald-600 to-teal-600' },
  { id: 'image-enhance', name: '图片增强', description: '清晰度、亮度、锐化、水印', icon: 'Sparkles', color: 'emerald', gradient: 'from-emerald-600 to-teal-600' },
  { id: 'converter', name: '格式转换', description: '图片格式互转', icon: 'ArrowRightLeft', color: 'violet', gradient: 'from-violet-600 to-purple-600' },
  { id: 'dev', name: '开发者工具', description: '编码、哈希、格式化', icon: 'Code', color: 'amber', gradient: 'from-amber-600 to-orange-600' },
  { id: 'calc', name: '计算器', description: '数学计算、单位换算', icon: 'Calculator', color: 'cyan', gradient: 'from-cyan-600 to-sky-600' },
  { id: 'fun', name: '趣味工具', description: '随机数、抽奖、趣味生成', icon: 'Dices', color: 'pink', gradient: 'from-pink-600 to-rose-600' },
  { id: 'test', name: '测评中心', description: 'MBTI、人格、性格测试', icon: 'Brain', color: 'violet', gradient: 'from-violet-600 to-purple-600' },
  { id: 'tarot', name: '塔罗星座', description: '塔罗占卜、星座运势', icon: 'Sparkles', color: 'blue', gradient: 'from-blue-600 to-indigo-600' },
  { id: 'mouse', name: '鼠标测试', description: 'CPS、DPI、反应速度、抖动', icon: 'MousePointerClick', color: 'lime', gradient: 'from-lime-600 to-green-600' },
  { id: 'document', name: '文档处理', description: 'OCR、翻译、查重、语法检查', icon: 'FileEdit', color: 'indigo', gradient: 'from-indigo-600 to-blue-600' },
  { id: 'audio', name: '音频处理', description: '格式转换、NCM解密、变声', icon: 'AudioLines', color: 'pink', gradient: 'from-pink-600 to-rose-600' },
  { id: 'video', name: '视频工具', description: '公开视频解析与临时下载', icon: 'Video', color: 'pink', gradient: 'from-orange-500 to-rose-500' },
  { id: 'data', name: '数据处理', description: 'Excel/CSV处理、文件校验、批量操作', icon: 'Table', color: 'red', gradient: 'from-red-600 to-rose-600' },
  { id: 'office', name: '办公工具', description: '发票整理、表格对比、合同审阅', icon: 'Briefcase', color: 'amber', gradient: 'from-amber-600 to-orange-600' },
  { id: 'academic', name: '学术工具', description: '论文检查、参考文献、公式编辑', icon: 'GraduationCap', color: 'violet', gradient: 'from-violet-600 to-purple-600' },
  { id: 'general', name: '生活工具', description: '证件照、条码、压缩包、字幕', icon: 'Home', color: 'cyan', gradient: 'from-cyan-600 to-sky-600' },
  { id: 'text', name: '文本工具', description: '文本清理、提取、替换与文件整理', icon: 'FileText', color: 'cyan', gradient: 'from-sky-600 to-cyan-600' },
  { id: 'webmaster', name: '站长工具', description: 'SEO 元数据、网站配置与网络状态检查', icon: 'Globe2', color: 'indigo', gradient: 'from-indigo-600 to-sky-600' },
] as const;

export function getToolsByCategory(category: string): ToolDef[] {
  return TOOLS.filter(t => t.category === category);
}

export function getToolById(id: string): ToolDef | undefined {
  return TOOLS.find(t => t.id === id);
}
