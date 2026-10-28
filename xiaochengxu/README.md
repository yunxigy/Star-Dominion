# 逐梦工具箱微信小程序

这是工具站的原生微信小程序版本，使用 WXML、WXSS 和 TypeScript 实现首页、分类、搜索与工具工作台，不再通过 WebView 加载网站。

## 开发者工具

1. 用微信开发者工具打开 `E:\AI\gp\xiaochengxu`。
2. 使用项目配置中的个人主体 AppID。
3. 运行前执行一次小程序 TypeScript 检查：

   ```powershell
   cd E:\AI\gp\SD
   & 'E:\AI\gp\SD\node_modules\.bin\tsc.cmd' --noEmit -p ..\xiaochengxu\tsconfig.json
   ```

## 发布前配置

原生页面不需要配置 WebView 业务域名，也不需要网站根目录校验文件。

需要在小程序后台的“开发设置 > 服务器域名”中配置：

- `request 合法域名`：`https://zhumenggy.top`
- `uploadFile`、`downloadFile`、`socket`、`udp`：当前版本没有额外使用时不填

小程序只调用 `https://zhumenggy.top` 的公开 HTTPS 接口，不把 `localhost`、局域网地址、内部端口、AppSecret 或第三方密钥放进客户端。

## 当前边界

- 原生首页只展示工具界面和工具逻辑，不加入股票入口、个人项目、研报、登录管理或独立工作区。
- JSON、文本、计算器、趣味、测评、塔罗、图片基础处理、CSV/参考文献和站长工具已经有原生工作台。
- 视频工具使用受控线上接口，支持解析任务轮询和保存到相册；请求失败会保留输入并提供重试。
- PDF、深度图片处理、复杂办公/学术文件和部分开发工具会显示明确的“适配中”说明。
- 音频编码、NCM 解密、变声以及桌面鼠标测试依赖浏览器或桌面能力，不在小程序中上传文件或伪造结果。

## 验证

在 `SD` 目录执行：

```powershell
npm test -- nativeMiniProgramContract.test.ts nativeToolRegistry.test.ts nativeRegistryCompleteness.test.ts nativeRequestTools.test.ts
& 'E:\AI\gp\SD\node_modules\.bin\tsc.cmd' --noEmit -p ..\xiaochengxu\tsconfig.json
```
