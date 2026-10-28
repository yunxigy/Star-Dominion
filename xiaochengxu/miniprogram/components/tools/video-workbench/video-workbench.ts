import {
  cancelVideoDownload,
  createVideoDownload,
  formatVideoBytes,
  formatVideoDuration,
  getVideoDownload,
  getVideoHealth,
  parseVideo,
  stageLabel,
  videoDownloadFileUrl,
  videoErrorMessage,
  ParsedVideo,
  VideoJobResponse,
} from '../../../services/video';

type VideoPhase = 'idle' | 'parsing' | 'ready' | 'downloading' | 'completed' | 'error';

function jobIsFinished(job: VideoJobResponse): boolean {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(job.stage);
}

Component({
  properties: {
    toolId: {
      type: String,
      value: 'video-parser-downloader',
    },
  },

  data: {
    url: '',
    phase: 'idle' as VideoPhase,
    video: null as ParsedVideo | null,
    parseToken: '',
    selectedQualityId: '',
    jobId: '',
    job: null as VideoJobResponse | null,
    error: '',
    statusNote: '等待粘贴抖音或哔哩哔哩公开视频链接',
    healthNote: '',
    busy: false,
    polling: false,
  },

  lifetimes: {
    attached() {
      getVideoHealth().then((health) => {
        if (health.status === 'degraded') this.setData({ healthNote: '视频服务当前处于降级状态，部分清晰度可能不可用。' });
      }).catch(() => {
        this.setData({ healthNote: '视频服务暂时不可用，请稍后重试。' });
      });
    },

    detached() {
      this.setData({ polling: false });
    },
  },

  methods: {
    onInput(event: WechatMiniprogram.Input) {
      this.setData({ url: event.detail.value, error: '' });
    },

    async parse() {
      const url = String(this.data.url ?? '').trim();
      if (!url) {
        this.setData({ error: '请输入抖音或 B 站公开视频链接。' });
        return;
      }
      this.setData({ phase: 'parsing', busy: true, error: '', video: null, job: null, jobId: '', statusNote: '正在解析视频信息' });
      try {
        const result = await parseVideo(url);
        this.setData({
          phase: 'ready',
          busy: false,
          parseToken: result.parseToken,
          video: result.video,
          selectedQualityId: result.video.qualities[0]?.id ?? '',
          statusNote: '已识别公开视频，请选择清晰度',
        });
      } catch (error: unknown) {
        this.setData({ phase: 'error', busy: false, error: videoErrorMessage(error), statusNote: '解析失败，请检查链接后重试' });
      }
    },

    selectQuality(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const qualityId = String(event.currentTarget.dataset.qualityId ?? '');
      const video = this.data.video as ParsedVideo | null;
      if (!video?.qualities.some((quality) => quality.id === qualityId)) return;
      this.setData({ selectedQualityId: qualityId, error: '' });
    },

    async startDownload() {
      const parseToken = String(this.data.parseToken ?? '');
      const selectedQualityId = String(this.data.selectedQualityId ?? '');
      if (!parseToken || !selectedQualityId || this.data.busy) return;
      this.setData({ busy: true, error: '', statusNote: '正在创建下载任务' });
      try {
        const created = await createVideoDownload(parseToken, selectedQualityId);
        this.setData({ phase: 'downloading', jobId: created.jobId, polling: true, statusNote: '正在排队' });
        void this.pollJob(created.jobId);
      } catch (error: unknown) {
        this.setData({ phase: 'ready', busy: false, error: videoErrorMessage(error) });
      }
    },

    async pollJob(jobId: string) {
      try {
        const job = await getVideoDownload(jobId);
        if (!this.data.polling || this.data.jobId !== jobId) return;
        this.setData({ job, statusNote: stageLabel(job.stage), busy: !jobIsFinished(job) });
        if (jobIsFinished(job)) {
          this.setData({ polling: false, phase: job.stage === 'completed' ? 'completed' : 'ready', error: job.error?.message ?? '' });
          return;
        }
      } catch (error: unknown) {
        if (!this.data.polling) return;
        this.setData({ polling: false, busy: false, phase: 'ready', error: videoErrorMessage(error), statusNote: '任务状态获取失败，请稍后重试' });
        return;
      }
      setTimeout(() => {
        if (this.data.polling) void this.pollJob(jobId);
      }, 1000);
    },

    async cancel() {
      const jobId = String(this.data.jobId ?? '');
      if (!jobId) return;
      this.setData({ polling: false, busy: true, error: '' });
      try {
        const job = await cancelVideoDownload(jobId);
        this.setData({ job, phase: 'ready', busy: false, statusNote: stageLabel(job.stage), error: job.error?.message ?? '' });
      } catch (error: unknown) {
        this.setData({ busy: false, phase: 'ready', error: videoErrorMessage(error) });
      }
    },

    saveVideo() {
      const jobId = String(this.data.jobId ?? '');
      const job = this.data.job as VideoJobResponse | null;
      if (!jobId || job?.stage !== 'completed') return;
      this.setData({ busy: true, error: '', statusNote: '正在保存视频到相册' });
      wx.downloadFile({
        url: videoDownloadFileUrl(jobId),
        success: (result) => {
          if (result.statusCode !== 200) {
            this.setData({ busy: false, error: `下载失败（${result.statusCode}）` });
            return;
          }
          wx.saveVideoToPhotosAlbum({
            filePath: result.tempFilePath,
            success: () => this.setData({ busy: false, statusNote: '视频已保存到相册' }),
            fail: (error) => this.setData({ busy: false, error: error.errMsg || '保存视频失败，请检查相册权限' }),
          });
        },
        fail: (error) => this.setData({ busy: false, error: error.errMsg || '下载视频失败，请稍后重试' }),
      });
    },

    reset() {
      this.setData({ url: '', phase: 'idle', video: null, parseToken: '', selectedQualityId: '', jobId: '', job: null, error: '', statusNote: '等待粘贴抖音或哔哩哔哩公开视频链接', busy: false, polling: false });
    },

    pasteUrl() {
      wx.getClipboardData({
        success: (result) => {
          if (result.data?.trim()) this.setData({ url: result.data.trim(), error: '' });
          else this.setData({ error: '剪贴板没有可用链接，请手动粘贴。' });
        },
        fail: () => this.setData({ error: '无法读取剪贴板，请手动粘贴链接。' }),
      });
    },

    formatBytes(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      return formatVideoBytes(Number(event.currentTarget.dataset.bytes));
    },

    formatDuration(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      return formatVideoDuration(Number(event.currentTarget.dataset.seconds));
    },
  },
});
