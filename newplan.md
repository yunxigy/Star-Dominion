# 在线工具箱项目 README

## 1. 项目目标

本项目是一个面向搜索流量和广告变现的在线工具箱网站，主要提供 PDF 工具、图片工具、图片格式转换、开发者工具、计算器类工具。

核心目标：

1. 提供真正可用的免费在线工具。
2. 每个工具拥有独立页面，方便 SEO 收录。
3. 工具之间互相推荐，提升站内浏览深度。
4. 页面结构适合广告展示，但不能影响用户操作。
5. 尽量优先实现低成本、高搜索需求、高复用度的工具。

---

## 2. 网站栏目结构建议

建议使用如下路由结构：

```txt
/
├── /pdf-tools/                         PDF 工具首页
├── /pdf-tools/merge-pdf/               PDF 合并
├── /pdf-tools/split-pdf/               PDF 拆分
├── /pdf-tools/compress-pdf/            PDF 压缩
├── /pdf-tools/pdf-to-word/             PDF 转 Word
├── /pdf-tools/word-to-pdf/             Word 转 PDF
├── /pdf-tools/pdf-to-image/            PDF 转图片
├── /pdf-tools/image-to-pdf/            图片转 PDF
├── /pdf-tools/rotate-pdf/              PDF 旋转
├── /pdf-tools/delete-pdf-pages/        PDF 删除页面
├── /pdf-tools/add-pdf-watermark/       PDF 加水印
├── /pdf-tools/add-pdf-password/        PDF 加密码
├── /pdf-tools/unlock-pdf/              PDF 解锁，仅限合法用途
├── /pdf-tools/extract-pdf-images/      提取 PDF 图片
├── /pdf-tools/extract-pdf-text/        提取 PDF 文字
│
├── /image-tools/                       图片工具首页
├── /image-tools/compress-image/        图片压缩
├── /image-tools/resize-image/          图片改尺寸
├── /image-tools/crop-image/            图片裁剪
├── /image-tools/watermark-image/       图片加水印
├── /image-tools/image-to-base64/       图片转 Base64
├── /image-tools/base64-to-image/       Base64 转图片
├── /image-tools/color-picker/          图片取色器
├── /image-tools/merge-images/          图片拼接
├── /image-tools/split-image-grid/      九宫格切图
├── /image-tools/favicon-generator/     Favicon 生成器
├── /image-tools/id-photo-resize/       证件照尺寸裁剪
├── /image-tools/id-photo-bg-color/     证件照换底色
│
├── /image-converter/                   图片格式转换首页
├── /image-converter/jpg-to-png/        JPG 转 PNG
├── /image-converter/png-to-jpg/        PNG 转 JPG
├── /image-converter/jpg-to-webp/       JPG 转 WebP
├── /image-converter/png-to-webp/       PNG 转 WebP
├── /image-converter/webp-to-jpg/       WebP 转 JPG
├── /image-converter/webp-to-png/       WebP 转 PNG
├── /image-converter/svg-to-png/        SVG 转 PNG
├── /image-converter/png-to-ico/        PNG 转 ICO
├── /image-converter/jpg-to-ico/        JPG 转 ICO
├── /image-converter/bmp-to-jpg/        BMP 转 JPG
├── /image-converter/heic-to-jpg/       HEIC 转 JPG
│
├── /dev-tools/                         开发者工具首页
├── /dev-tools/json-format/             JSON 格式化
├── /dev-tools/json-minify/             JSON 压缩
├── /dev-tools/json-validate/           JSON 校验
├── /dev-tools/xml-format/              XML 格式化
├── /dev-tools/html-format/             HTML 格式化
├── /dev-tools/css-format/              CSS 格式化
├── /dev-tools/js-format/               JavaScript 格式化
├── /dev-tools/sql-format/              SQL 格式化
├── /dev-tools/regex-tester/            正则表达式测试
├── /dev-tools/timestamp-converter/     时间戳转换
├── /dev-tools/url-encode-decode/       URL 编码解码
├── /dev-tools/base64-encode-decode/    Base64 编码解码
├── /dev-tools/md5-generator/           MD5 生成器
├── /dev-tools/sha256-generator/        SHA256 生成器
├── /dev-tools/uuid-generator/          UUID 生成器
├── /dev-tools/password-generator/      随机密码生成器
├── /dev-tools/jwt-decoder/             JWT 解析
├── /dev-tools/color-converter/         HEX/RGB/HSL 颜色转换
├── /dev-tools/qr-code-generator/       二维码生成器
├── /dev-tools/qr-code-reader/          二维码识别
│
├── /calculators/                       计算器首页
├── /calculators/bmi-calculator/        BMI 计算器
├── /calculators/bmr-calculator/        BMR 基础代谢计算器
├── /calculators/age-calculator/        年龄计算器
├── /calculators/date-difference/       日期间隔计算器
├── /calculators/workday-calculator/    工作日计算器
├── /calculators/percentage-calculator/ 百分比计算器
├── /calculators/discount-calculator/   折扣计算器
├── /calculators/loan-calculator/       贷款计算器
├── /calculators/mortgage-calculator/   房贷计算器
├── /calculators/compound-interest/     复利计算器
├── /calculators/unit-converter/        单位换算
├── /calculators/length-converter/      长度换算
├── /calculators/weight-converter/      重量换算
├── /calculators/temperature-converter/ 温度换算
├── /calculators/area-converter/        面积换算
├── /calculators/speed-converter/       速度换算
├── /calculators/time-converter/        时间换算
│
├── /blog/                              工具教程文章
└── /privacy/                           隐私政策

新增：
1. 趣味工具
   - 随机数生成器
   - 抽奖工具
   - 随机密码生成器
   - 随机昵称生成器
   - 今天吃什么
   - 随机选择器

2. 图片增强工具
   - 图片清晰度增强
   - 图片亮度/对比度/饱和度调整
   - 图片锐化
   - 图片去 EXIF
   - 图片加水印
   - 图片加文字
   - 图片打马赛克
   - 截图美化
   - 表情包制作器
   - 社交媒体封面生成器

3. 测评中心
   - MBTI 趣味测试
   - 大五人格测试
   - 九型人格测试
   - 恋爱依恋类型测试
   - 爱情语言测试
   - 职业兴趣测试
   - DISC 职场性格测试
   - 拖延症测试
   - 社恐指数测试
   - 学习风格测试
   - 情绪稳定性测试

4. 塔罗/星座中心
   - 每日塔罗
   - 三张牌塔罗
   - 爱情塔罗
   - 事业塔罗
   - 是或否塔罗
   - 塔罗牌义大全
   - 星座配对
   - 每日星座运势
   - 生命灵数计算器
   - 姓名打分娱乐版
   - 梦境解析大全