import React, { useState, useRef, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { FileText, ChevronDown, ChevronRight, Send, Copy, AlertCircle } from 'lucide-react';
import { parseOpenApiDocument } from '../featureSupport';

interface ApiEndpoint {
  method: string;
  path: string;
  summary: string;
  description: string;
  parameters: ApiParam[];
  requestBody?: { description: string; content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<string, { description: string }>;
  tags: string[];
}

interface ApiParam {
  name: string;
  in: string;
  required: boolean;
  description: string;
  schema: { type: string; example?: string };
}

const METHOD_COLORS: Record<string, string> = {
  get: 'text-green-700 bg-green-100',
  post: 'text-blue-700 bg-blue-100',
  put: 'text-amber-700 bg-amber-100',
  patch: 'text-orange-700 bg-orange-100',
  delete: 'text-red-700 bg-red-100',
  head: 'text-purple-700 bg-purple-100',
  options: 'text-gray-700 bg-gray-100',
};

const parseOpenApi = (spec: Record<string, unknown>): { title: string; version: string; endpoints: ApiEndpoint[]; servers: string[] } => {
  const info = spec.info as Record<string, string> || {};
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>> || {};
  const servers = (spec.servers as Array<{ url: string }>)?.map(s => s.url) || [];

  const endpoints: ApiEndpoint[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, detail] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) {
        const d = detail as Record<string, unknown>;
        endpoints.push({
          method: method.toUpperCase(),
          path,
          summary: (d.summary as string) || '',
          description: (d.description as string) || '',
          parameters: (d.parameters as ApiParam[]) || [],
          requestBody: d.requestBody as ApiEndpoint['requestBody'],
          responses: (d.responses as Record<string, { description: string }>) || {},
          tags: (d.tags as string[]) || [],
        });
      }
    }
  }

  return {
    title: info.title || 'Unknown API',
    version: info.version || '0.0.0',
    endpoints,
    servers,
  };
};

const OpenApiTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseOpenApi> | null>(null);
  const [error, setError] = useState('');
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string>('all');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [rawInput, setRawInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const file = fl[0];
    try {
      const text = await file.text();
      const json = parseOpenApiDocument(text, file.name);
      setSpec(json);
      const result = parseOpenApi(json);
      setParsed(result);
      setBaseUrl(result.servers[0] || '');
      setError('');
    } catch (e) {
      setError(`解析失败: ${(e as Error).message}`);
    }
  }, []);

  const handlePaste = () => {
    if (!rawInput.trim()) return;
    try {
      const json = JSON.parse(rawInput);
      setSpec(json);
      const result = parseOpenApi(json);
      setParsed(result);
      setBaseUrl(result.servers[0] || '');
      setError('');
    } catch (e) {
      setError(`JSON 解析失败: ${(e as Error).message}`);
    }
  };

  if (!parsed) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#8b735c]">解析 OpenAPI/Swagger 文档，查看 API 端点、参数和响应定义</p>

        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-300 rounded-lg">
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-400 text-yellow-900 rounded">BETA</span>
          <span className="text-xs text-yellow-700">支持 JSON/YAML 文档解析和端点展示；暂不提供在线请求调试</span>
        </div>

        <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".json,.yaml,.yml" label="上传 OpenAPI 文档" sublabel="支持 JSON、YAML" />
        <input ref={inputRef} type="file" className="hidden" accept=".json,.yaml,.yml" onChange={e => handleFile(e.target.files)} />

        <div className="text-center text-xs text-[#c79f72]">或粘贴 JSON 内容</div>

        <textarea value={rawInput} onChange={e => setRawInput(e.target.value)}
          className="w-full h-40 text-xs font-mono border border-[#ead0ad] rounded-lg p-3 bg-white focus:border-[#7a421b] focus:outline-none resize-y"
          placeholder='{"openapi": "3.0.0", "info": {...}, "paths": {...}}' />

        <Btn onClick={handlePaste} disabled={!rawInput.trim()}>
          <FileText className="w-4 h-4 mr-1" />解析文档
        </Btn>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    );
  }

  // Collect all tags
  const allTags = Array.from(new Set(parsed.endpoints.flatMap(e => e.tags))).filter(Boolean);
  const allMethods = Array.from(new Set(parsed.endpoints.map(e => e.method)));

  // Filter endpoints
  const filtered = parsed.endpoints.filter(e => {
    if (filterTag !== 'all' && !e.tags.includes(filterTag)) return false;
    if (filterMethod !== 'all' && e.method !== filterMethod) return false;
    if (filterText && !e.path.toLowerCase().includes(filterText.toLowerCase()) && !e.summary.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  const generateCurl = (ep: ApiEndpoint) => {
    let url = baseUrl + ep.path;
    const queryParams = ep.parameters.filter(p => p.in === 'query');
    if (queryParams.length > 0) {
      url += '?' + queryParams.map(p => `${p.name}=<${p.name}>`).join('&');
    }
    const headerParams = ep.parameters.filter(p => p.in === 'header');
    const headerStr = headerParams.map(p => `-H '${p.name}: <value>'`).join(' \\\n  ');
    let cmd = `curl -X ${ep.method} '${url}'`;
    if (headerStr) cmd += ` \\\n  ${headerStr}`;
    if (ep.requestBody) cmd += ` \\\n  -H 'Content-Type: application/json' \\\n  -d '{}'`;
    return cmd;
  };

  return (
    <div className="space-y-4">
      {/* API Info */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <h3 className="text-sm font-bold text-[#6f3714]">{parsed.title}</h3>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-[#8b735c]">版本: {parsed.version}</span>
          <span className="text-xs text-[#8b735c]">端点: {parsed.endpoints.length}</span>
          {baseUrl && <span className="text-xs text-[#7a421b] font-mono truncate max-w-[200px]">{baseUrl}</span>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input value={filterText} onChange={e => setFilterText(e.target.value)}
          className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 min-w-[120px] bg-white" placeholder="搜索路径或摘要..." />
        <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
          className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
          <option value="all">所有标签</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)}
          className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
          <option value="all">所有方法</option>
          {allMethods.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Endpoints list */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-xs text-[#c79f72] text-center py-4">没有匹配的端点</div>
        ) : (
          filtered.map((ep, i) => {
            const key = `${ep.method}-${ep.path}-${i}`;
            const isExpanded = expandedEndpoint === key;
            return (
              <div key={key} className="border border-[#ead0ad] rounded-lg overflow-hidden">
                <button onClick={() => setExpandedEndpoint(isExpanded ? null : key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#fff4e6]">
                  <span className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded ${METHOD_COLORS[ep.method.toLowerCase()] || 'text-gray-700 bg-gray-100'}`}>
                    {ep.method}
                  </span>
                  <span className="text-xs font-mono text-[#6d5a47] flex-1 truncate">{ep.path}</span>
                  {ep.summary && <span className="text-[10px] text-[#8b735c] truncate max-w-[150px]">{ep.summary}</span>}
                  {isExpanded ? <ChevronDown className="w-3 h-3 text-[#c79f72]" /> : <ChevronRight className="w-3 h-3 text-[#c79f72]" />}
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-[#ead0ad]">
                    {ep.description && <p className="text-xs text-[#8b735c] mt-2">{ep.description}</p>}
                    {ep.tags.length > 0 && (
                      <div className="flex gap-1">
                        {ep.tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[#f1dcc2] text-[#6f3714]">{t}</span>)}
                      </div>
                    )}

                    {/* Parameters */}
                    {ep.parameters.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-[#6d5a47] mb-1">参数</h4>
                        <div className="space-y-1">
                          {ep.parameters.map((p, j) => (
                            <div key={j} className="flex items-center gap-2 text-[10px]">
                              <span className="font-mono font-medium text-[#7a421b]">{p.name}</span>
                              <span className="text-[#c79f72]">({p.in})</span>
                              {p.required && <span className="text-red-500">*必填</span>}
                              <span className="text-[#8b735c] flex-1 truncate">{p.description || p.schema?.type || ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Request Body */}
                    {ep.requestBody && (
                      <div>
                        <h4 className="text-xs font-medium text-[#6d5a47] mb-1">请求体</h4>
                        <p className="text-[10px] text-[#8b735c]">{ep.requestBody.description}</p>
                        <div className="text-[10px] text-[#c79f72]">
                          Content-Type: {Object.keys(ep.requestBody.content).join(', ')}
                        </div>
                      </div>
                    )}

                    {/* Responses */}
                    {Object.keys(ep.responses).length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-[#6d5a47] mb-1">响应</h4>
                        <div className="space-y-0.5">
                          {Object.entries(ep.responses).map(([code, resp]) => (
                            <div key={code} className="text-[10px]">
                              <span className={`font-mono font-bold ${code.startsWith('2') ? 'text-green-600' : code.startsWith('3') ? 'text-amber-600' : 'text-red-600'}`}>{code}</span>
                              <span className="text-[#8b735c] ml-2">{resp.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* cURL command */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-medium text-[#6d5a47]">cURL 命令</h4>
                        <button onClick={() => copyToClipboard(generateCurl(ep))} className="text-[10px] text-[#7a421b] hover:underline flex items-center gap-1">
                          <Copy className="w-3 h-3" />复制
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-[#fff8f0] border border-[#ead0ad] rounded p-2 whitespace-pre-wrap overflow-x-auto">{generateCurl(ep)}</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2">
        <Btn onClick={() => { setSpec(null); setParsed(null); }} variant="ghost">重新加载</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default OpenApiTool;
