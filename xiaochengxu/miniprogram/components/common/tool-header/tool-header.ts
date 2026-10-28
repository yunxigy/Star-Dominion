Component({
  properties: {
    title: {
      type: String,
      value: '工具详情',
    },
    description: {
      type: String,
      value: '',
    },
  },

  methods: {
    goBack() {
      this.triggerEvent('back');
    },
  },
});
