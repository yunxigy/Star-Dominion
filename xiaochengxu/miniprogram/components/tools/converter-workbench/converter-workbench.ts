import { getImageOutputFormat } from '../../../services/canvas';
import { SelectedFile, validateSelectedFile } from '../../../services/file';

Component({
  properties: {
    toolId: {
      type: String,
      value: 'jpg-to-png',
    },
  },

  data: {
    fileName: '',
    message: '请选择图片文件。',
    error: '',
    hasFile: false,
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
  },

  methods: {
    onFileSelect(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const files = event.detail.files as SelectedFile[] | undefined;
      const file = files?.[0];
      if (!file) return;
      const validation = validateSelectedFile(file, { extensions: ['png', 'jpg', 'jpeg', 'webp'], maxBytes: 20 * 1024 * 1024 });
      if (!validation.ok) {
        this.setData({ error: validation.error, hasFile: false });
        return;
      }
      const target = (this.properties.toolId as string).split('-to-')[1] ?? 'png';
      const output = getImageOutputFormat(target);
      this.setData({
        fileName: file.name,
        hasFile: true,
        error: '',
        message: output.supported
          ? `已选择 ${file.name}，可使用 Canvas 导出为 ${output.extension.toUpperCase()}。`
          : `当前微信运行时不支持直接导出 ${target.toUpperCase()}，已保留原文件信息。`,
      });
    },

    clear() {
      this.setData({ fileName: '', message: '请选择图片文件。', error: '', hasFile: false });
    },
  },
});
