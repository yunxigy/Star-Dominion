import { iconEmoji } from '../../../utils/icons';

Component({
  properties: {
    tool: {
      type: Object,
      value: {},
    },
  },

  data: {
    emoji: '',
  },

  observers: {
    tool(tool: { icon?: string }) {
      this.setData({ emoji: iconEmoji(tool?.icon) });
    },
  },

  methods: {
    onTap() {
      const tool = this.data.tool as { id?: string };
      this.triggerEvent('tap', { id: tool.id ?? '' });
    },
  },
});