import { base64EncodeBytes } from '../../../utils/encoding';
import { formatBytes, SelectedFile, validateSelectedFile } from '../../../services/file';
import { getImageInfo, getImageOutputFormat, ImageSize } from '../../../services/canvas';

Component({
  properties: {
    toolId: {
      type: String,
      value: 'image-to-base64',
    },
  },

  data: {
    filePath: '',
    fileName: '',
    fileSize: '',
    width: 0,
    height: 0,
    output: '',
    error: '',
    busy: false,
    hasFile: false,
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  },

  methods: {
    async onFileSelect(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const files = event.detail.files as SelectedFile[] | undefined;
      const file = files?.[0];
      if (!file) return;
      const validation = validateSelectedFile(file, {
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
        maxBytes: 20 * 1024 * 1024,
      });
      if (!validation.ok) {
        this.setData({ error: validation.error, hasFile: false });
        return;
      }
      this.setData({
        filePath: file.path,
        fileName: file.name,
        fileSize: formatBytes(file.size),
        output: '',
        error: '',
        busy: true,
        hasFile: true,
      });
      try {
        const size = await getImageInfo(file.path);
        this.setData({ width: size.width, height: size.height });
        if ((this.properties.toolId as string) === 'image-to-base64') {
          await this.encodeImage(file, size);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '读取图片失败';
        this.setData({ error: message });
      } finally {
        this.setData({ busy: false });
      }
    },

    async encodeImage(file: SelectedFile, _size: ImageSize) {
      const fileData = await new Promise<ArrayBuffer>((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          success: (result) => {
            if (result.data instanceof ArrayBuffer) resolve(result.data);
            else reject(new Error('图片读取结果无效'));
          },
          fail: (result) => reject(new Error(result.errMsg || '读取图片失败')),
        });
      });
      const format = getImageOutputFormat(file.name.split('.').pop() ?? 'png');
      const mime = format.mime === 'image/jpeg' ? 'image/jpeg' : format.mime;
      this.setData({ output: `data:${mime};base64,${base64EncodeBytes(new Uint8Array(fileData))}` });
    },

    copyOutput() {
      const output = this.data.output as string;
      if (!output) return;
      wx.setClipboardData({
        data: output,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    },

    clear() {
      this.setData({ filePath: '', fileName: '', fileSize: '', width: 0, height: 0, output: '', error: '', hasFile: false });
    },
  },
});
