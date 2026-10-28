import { chooseFile } from '../../../services/file';

Component({
  properties: {
    type: {
      type: String,
      value: 'file',
    },
    count: {
      type: Number,
      value: 1,
    },
    extensions: {
      type: Array,
      value: [] as string[],
    },
    label: {
      type: String,
      value: '选择文件',
    },
  },

  data: {
    busy: false,
    error: '',
  },

  methods: {
    async choose() {
      this.setData({ busy: true, error: '' });
      try {
        const files = await chooseFile({
          type: this.properties.type as 'all' | 'video' | 'image' | 'file',
          count: this.properties.count as number,
          extensions: this.properties.extensions as string[],
        });
        this.triggerEvent('select', { files });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '选择文件失败';
        this.setData({ error: message });
        this.triggerEvent('error', { message });
      } finally {
        this.setData({ busy: false });
      }
    },
  },
});
