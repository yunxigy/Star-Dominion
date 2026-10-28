import { NativeCategoryDefinition } from '../types/tool';

export const NATIVE_CATEGORIES: NativeCategoryDefinition[] = [
  { id: 'pdf', name: 'PDF 工具', description: 'PDF 处理、转换、编辑', icon: 'file' },
  { id: 'image', name: '图片工具', description: '图片编辑、处理、优化', icon: 'image' },
  { id: 'image-enhance', name: '图片增强', description: '清晰度、亮度、锐化、水印', icon: 'sparkles' },
  { id: 'converter', name: '格式转换', description: '图片格式互转', icon: 'convert' },
  { id: 'dev', name: '开发者工具', description: '编码、哈希、格式化', icon: 'code' },
  { id: 'calc', name: '计算器', description: '数学计算、单位换算', icon: 'calculator' },
  { id: 'fun', name: '趣味工具', description: '随机数、抽奖、趣味生成', icon: 'dice' },
  { id: 'test', name: '测评中心', description: 'MBTI、人格、性格测试', icon: 'brain' },
  { id: 'tarot', name: '塔罗星座', description: '塔罗占卜、星座运势', icon: 'star' },
  { id: 'document', name: '文档处理', description: 'OCR、翻译、查重、语法检查', icon: 'document' },
  { id: 'audio', name: '音频处理', description: '格式转换、NCM 解密、变声', icon: 'audio' },
  { id: 'video', name: '视频工具', description: '公开视频解析与临时下载', icon: 'video' },
  { id: 'data', name: '数据处理', description: 'Excel/CSV 处理、文件校验、批量操作', icon: 'table' },
  { id: 'office', name: '办公工具', description: '发票整理、表格对比、合同审阅', icon: 'briefcase' },
  { id: 'academic', name: '学术工具', description: '论文检查、参考文献、公式编辑', icon: 'academic' },
  { id: 'general', name: '生活工具', description: '证件照、条码、压缩包、字幕', icon: 'home' },
  { id: 'text', name: '文本工具', description: '文本清理、提取、替换与文件整理', icon: 'text' },
  { id: 'webmaster', name: '站长工具', description: 'SEO 元数据与网站状态检查', icon: 'globe' },
];
