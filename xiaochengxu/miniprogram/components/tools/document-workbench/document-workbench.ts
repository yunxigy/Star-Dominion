import {
  detectCsvDelimiter,
  diffTableRows,
  formatCitation,
  htmlToPlainText,
  markdownToHtml,
  parseCsv,
  parsePageRange,
  pickPrivacyFields,
} from '../../../services/document';
import { readText, SelectedFile, validateSelectedFile } from '../../../services/file';

function lines(input: string): string[] {
  return input.split(/\r?\n/);
}

Component({
  properties: {
    toolId: {
      type: String,
      value: 'markup-converter',
    },
  },

  data: {
    input: '',
    secondaryInput: '',
    output: '',
    error: '',
    fileName: '',
    filePath: '',
    formatMode: 'markdown-html',
    pageRange: '1',
    pageCount: '1',
    citationAuthor: '',
    citationTitle: '',
    citationYear: '',
    citationSource: '',
    requiresFile: false,
    isCitation: false,
    isPdfRange: false,
    isSpreadsheetDiff: false,
    isPrivacy: false,
    extensions: ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt', 'md', 'json'],
  },

  lifetimes: {
    attached() {
      const toolId = this.properties.toolId as string;
      this.setData({
        requiresFile: toolId.startsWith('pdf-') || toolId.includes('file') || toolId.includes('document'),
        isCitation: toolId === 'reference-workbench',
        isPdfRange: toolId === 'pdf-page-numbers' || toolId === 'pdf-reorder-pages',
        isSpreadsheetDiff: toolId === 'spreadsheet-diff' || toolId === 'document-diff',
        isPrivacy: toolId === 'privacy-cleaner',
      });
    },
  },

  methods: {
    async onFileSelect(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const files = event.detail.files as SelectedFile[] | undefined;
      const file = files?.[0];
      if (!file) return;
      const validation = validateSelectedFile(file, { maxBytes: 50 * 1024 * 1024 });
      if (!validation.ok) {
        this.setData({ error: validation.error });
        return;
      }
      this.setData({ fileName: file.name, filePath: file.path, error: '', output: '' });
      const extension = file.name.split('.').pop()?.toLocaleLowerCase() ?? '';
      if (['txt', 'md', 'csv', 'json'].includes(extension)) {
        try {
          const input = await readText(file.path);
          this.setData({ input });
        } catch (error: unknown) {
          this.setData({ error: error instanceof Error ? error.message : '读取文件失败' });
        }
      } else {
        this.setData({ input: `已选择文件：${file.name}` });
      }
    },

    onInput(event: WechatMiniprogram.Input | WechatMiniprogram.TextareaInput) {
      const field = String(event.currentTarget.dataset.field ?? 'input');
      this.setData({ [field]: event.detail.value, error: '', output: '' });
    },

    onFormatMode(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      this.setData({ formatMode: String(event.currentTarget.dataset.mode), output: '', error: '' });
    },

    run() {
      const toolId = this.properties.toolId as string;
      const input = this.data.input as string;
      let output = '';
      let error = '';

      try {
        if (toolId === 'markup-converter' || toolId === 'format-converter') {
          output = this.data.formatMode === 'html-markdown' ? htmlToPlainText(input) : markdownToHtml(input);
        } else if (toolId === 'reference-workbench') {
          output = formatCitation({
            author: this.data.citationAuthor as string,
            title: this.data.citationTitle as string,
            year: this.data.citationYear as string,
            source: this.data.citationSource as string,
          }, 'gbt7714');
        } else if (toolId === 'pdf-page-numbers' || toolId === 'pdf-reorder-pages') {
          const result = parsePageRange(this.data.pageRange as string, Number(this.data.pageCount));
          if (!result.ok) error = result.error;
          else output = `处理页码：${result.value.join(', ')}`;
        } else if (toolId === 'pdf-metadata' || toolId === 'document-metadata') {
          output = '已读取文件入口。微信小程序当前不直接修改 PDF 元数据，后续可通过受控服务端转换。';
        } else if (toolId === 'excel-csv-workbench') {
          const parsed = parseCsv(input);
          output = JSON.stringify({ delimiter: detectCsvDelimiter(input), headers: parsed.headers, rowCount: parsed.rows.length }, null, 2);
        } else if (toolId === 'spreadsheet-diff' || toolId === 'document-diff') {
          const left = parseCsv(input);
          const right = parseCsv(this.data.secondaryInput as string);
          const keyIndex = left.headers.indexOf(left.headers[0]);
          const leftRows = left.rows.map((row) => ({ key: row[keyIndex] ?? '', value: row.join('|') }));
          const rightRows = right.rows.map((row) => ({ key: row[keyIndex] ?? '', value: row.join('|') }));
          output = JSON.stringify(diffTableRows(leftRows, rightRows, 'key'), null, 2);
        } else if (toolId === 'privacy-cleaner') {
          const parsed = JSON.parse(input) as Record<string, unknown>;
          const allowed = (this.data.secondaryInput as string).split(/[,，\s]+/).map((field) => field.trim()).filter(Boolean);
          output = JSON.stringify(pickPrivacyFields(parsed, allowed), null, 2);
        } else if (toolId === 'remove-blank-lines') {
          output = lines(input).filter((line) => line.trim()).join('\n');
        } else if (toolId === 'dedupe-lines') {
          output = [...new Set(lines(input))].join('\n');
        } else if (toolId === 'sort-lines') {
          output = [...lines(input)].sort((left, right) => left.localeCompare(right, 'zh-CN')).join('\n');
        } else if (toolId === 'line-number-tool') {
          output = lines(input).map((line, index) => `${index + 1}. ${line}`).join('\n');
        } else if (toolId === 'entity-extractor') {
          output = JSON.stringify({
            emails: input.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [],
            urls: input.match(/https?:\/\/[^\s]+/g) ?? [],
            ips: input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [],
          }, null, 2);
        } else {
          output = input;
        }
      } catch (caught: unknown) {
        error = caught instanceof Error ? caught.message : '处理失败，请检查输入';
      }
      this.setData({ output, error });
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
      this.setData({ input: '', secondaryInput: '', output: '', error: '', fileName: '', filePath: '' });
    },
  },
});
