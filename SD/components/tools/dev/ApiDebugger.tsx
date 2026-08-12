import React, { useState, useCallback, useRef } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Send, Shield, AlertTriangle, Clock, Copy, Plus, Trash2 } from 'lucide-react';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

interface Header {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface RequestHistory {
  id: string;
  method: HttpMethod;
  url: string;
  status: number;
  duration: number;
  timestamp: number;
}

// SSRF Protection: Block internal/private IPs and dangerous protocols
const SSRF_BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '10.0.0.0', '172.16.0.0', '192.168.0.0',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal', // GCP metadata
  '100.100.100.200', // Alibaba Cloud metadata
];

const SSRF_BLOCKED_PATTERNS = [
  /^10\.\d+\.\d+\.\d+$/,           // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/,          // 192.168.0.0/16
  /^127\.\d+\.\d+\.\d+$/,          // 127.0.0.0/8
  /^0\.\d+\.\d+\.\d+$/,            // 0.0.0.0/8
  /^169\.254\.\d+\.\d+$/,          // 169.254.0.0/16
  /^fc00:/i,                        // IPv6 private
  /^fe80:/i,                        // IPv6 link-local
  /^::1$/,                          // IPv6 loopback
];

const ALLOWED_PROTOCOLS = ['https:', 'http:'];

const validateUrl = (url: string): { valid: boolean; error?: string } => {
  if (!url.trim()) return { valid: false, error: '请输入URL' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'URL格式无效' };
  }

  // Check protocol
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { valid: false, error: `不允许的协议: ${parsed.protocol}，仅支持 http/https` };
  }

  // Check blocked hosts
  const hostname = parsed.hostname.toLowerCase();
  if (SSRF_BLOCKED_HOSTS.includes(hostname)) {
    return { valid: false, error: `安全限制: 不允许访问 ${hostname}` };
  }

  // Check IP patterns
  for (const pattern of SSRF_BLOCKED_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, error: `安全限制: 不允许访问内网地址 ${hostname}` };
    }
  }

  // Block common metadata endpoints
  if (hostname.includes('metadata') || hostname.includes('169.254')) {
    return { valid: false, error: '安全限制: 不允许访问云服务元数据端点' };
  }

  return { valid: true };
};

const generateId = () => Math.random().toString(36).slice(2, 9);

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-green-700 bg-green-50',
  POST: 'text-blue-700 bg-blue-50',
  PUT: 'text-amber-700 bg-amber-50',
  PATCH: 'text-orange-700 bg-orange-50',
  DELETE: 'text-red-700 bg-red-50',
  HEAD: 'text-purple-700 bg-purple-50',
  OPTIONS: 'text-gray-700 bg-gray-50',
};

const ApiDebugger: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Header[]>([
    { id: generateId(), key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState('');
  const [responseHeaders, setResponseHeaders] = useState('');
  const [status, setStatus] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'auth'>('body');
  const [history, setHistory] = useState<RequestHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [ssrfWarning, setSsrfWarning] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const addHeader = () => {
    setHeaders(prev => [...prev, { id: generateId(), key: '', value: '', enabled: true }]);
  };

  const updateHeader = (id: string, field: 'key' | 'value' | 'enabled', val: string | boolean) => {
    setHeaders(prev => prev.map(h => h.id === id ? { ...h, [field]: val } : h));
  };

  const removeHeader = (id: string) => {
    setHeaders(prev => prev.filter(h => h.id !== id));
  };

  const sendRequest = useCallback(async () => {
    setError('');
    setSsrfWarning('');
    setStatus(0);
    setDuration(0);
    setResponse('');
    setResponseHeaders('');

    // SSRF validation
    const validation = validateUrl(url);
    if (!validation.valid) {
      setSsrfWarning(validation.error || 'URL验证失败');
      return;
    }

    setLoading(true);
    const startTime = Date.now();

    try {
      const abortController = new AbortController();
      abortRef.current = abortController;

      const reqHeaders: Record<string, string> = {};
      headers.filter(h => h.enabled && h.key).forEach(h => {
        reqHeaders[h.key] = h.value;
      });

      const fetchOptions: RequestInit = {
        method,
        headers: reqHeaders,
        signal: abortController.signal,
      };

      if (['POST', 'PUT', 'PATCH'].includes(method) && body.trim()) {
        fetchOptions.body = body;
      }

      // No redirect following (security)
      fetchOptions.redirect = 'manual';

      const res = await fetch(url, fetchOptions);
      const elapsed = Date.now() - startTime;
      setDuration(elapsed);
      setStatus(res.status);

      // Handle manual redirect
      if (res.type === 'opaqueredirect') {
        setSsrfWarning('请求被重定向，为安全起见不自动跟随重定向');
        setLoading(false);
        return;
      }

      // Collect response headers
      const respHeaders: string[] = [];
      res.headers.forEach((value, key) => {
        respHeaders.push(`${key}: ${value}`);
      });
      setResponseHeaders(respHeaders.join('\n'));

      // Read response body
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json') || contentType.includes('text') || contentType.includes('xml') || contentType.includes('html')) {
        const text = await res.text();
        // Try to pretty-print JSON
        try {
          const json = JSON.parse(text);
          setResponse(JSON.stringify(json, null, 2));
        } catch {
          setResponse(text);
        }
      } else {
        setResponse(`[二进制内容, Content-Type: ${contentType}, Size: ${res.headers.get('content-length') || 'unknown'}]`);
      }

      // Add to history
      setHistory(prev => [{
        id: generateId(),
        method,
        url,
        status: res.status,
        duration: elapsed,
        timestamp: Date.now(),
      }, ...prev].slice(0, 50));

    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setError('请求已取消');
      } else {
        setError(`请求失败: ${(e as Error).message}`);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [url, method, headers, body]);

  const cancelRequest = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  const loadFromHistory = (item: RequestHistory) => {
    setMethod(item.method);
    setUrl(item.url);
    setShowHistory(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-green-600" />
        <p className="text-sm text-[#8b735c]">API调试工作台 — 内置SSRF防护，禁止访问内网和元数据端点</p>
      </div>

      {/* SSRF Warning */}
      {ssrfWarning && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{ssrfWarning}</span>
        </div>
      )}

      {/* URL bar */}
      <div className="flex gap-2">
        <select value={method} onChange={e => setMethod(e.target.value as HttpMethod)}
          className={`text-xs font-mono font-bold rounded-lg border border-[#ead0ad] px-2 py-2 ${METHOD_COLORS[method]}`}>
          {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as HttpMethod[]).map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input value={url} onChange={e => setUrl(e.target.value)}
          className="flex-1 text-xs font-mono border border-[#ead0ad] rounded-lg px-3 py-2 bg-white focus:border-[#7a421b] focus:outline-none"
          placeholder="https://api.example.com/endpoint" />
        <Btn onClick={sendRequest} disabled={loading || !url.trim()}>
          {loading ? (
            <span className="flex items-center gap-1"><Clock className="w-4 h-4 animate-spin" />发送中</span>
          ) : (
            <span className="flex items-center gap-1"><Send className="w-4 h-4" />发送</span>
          )}
        </Btn>
        {loading && (
          <Btn onClick={cancelRequest} variant="ghost" className="text-red-500">取消</Btn>
        )}
      </div>

      {/* Request tabs */}
      <div className="border border-[#ead0ad] rounded-lg overflow-hidden">
        <div className="flex border-b border-[#ead0ad] bg-[#fff4e6]">
          {(['body', 'headers', 'auth'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs capitalize ${activeTab === tab ? 'bg-white text-[#7a421b] font-medium border-b-2 border-[#7a421b]' : 'text-[#8b735c]'}`}>
              {tab === 'auth' ? '认证' : tab === 'headers' ? '请求头' : '请求体'}
            </button>
          ))}
          <button onClick={() => setShowHistory(!showHistory)} className="ml-auto px-3 py-1.5 text-xs text-[#8b735c] hover:text-[#7a421b]">
            历史 ({history.length})
          </button>
        </div>

        <div className="p-3">
          {activeTab === 'body' && (
            <textarea value={body} onChange={e => setBody(e.target.value)}
              className="w-full h-32 text-xs font-mono border border-[#ead0ad] rounded-lg p-2 bg-white focus:border-[#7a421b] focus:outline-none resize-y"
              placeholder='{"key": "value"}' />
          )}

          {activeTab === 'headers' && (
            <div className="space-y-2">
              {headers.map(h => (
                <div key={h.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={h.enabled} onChange={e => updateHeader(h.id, 'enabled', e.target.checked)}
                    className="w-3 h-3" />
                  <input value={h.key} onChange={e => updateHeader(h.id, 'key', e.target.value)}
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white" placeholder="Header name" />
                  <input value={h.value} onChange={e => updateHeader(h.id, 'value', e.target.value)}
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white" placeholder="Value" />
                  <button onClick={() => removeHeader(h.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              <Btn onClick={addHeader} variant="ghost" className="text-xs">
                <Plus className="w-3 h-3 mr-1" />添加请求头
              </Btn>
            </div>
          )}

          {activeTab === 'auth' && (
            <div className="text-xs text-[#8b735c] space-y-2">
              <p>在 Headers 标签页中手动添加认证头：</p>
              <div className="bg-[#fff4e6] rounded p-2 font-mono text-[10px]">
                <div>Authorization: Bearer {'<token>'}</div>
                <div>Authorization: Basic {'<base64>'}</div>
                <div>API-Key: {'<your-key>'}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History panel */}
      {showHistory && history.length > 0 && (
        <div className="border border-[#ead0ad] rounded-lg max-h-40 overflow-y-auto">
          {history.map(item => (
            <div key={item.id} onClick={() => loadFromHistory(item)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#fff4e6] cursor-pointer border-b border-[#ead0ad] last:border-0">
              <span className={`px-1 rounded font-mono font-bold ${METHOD_COLORS[item.method]}`}>{item.method}</span>
              <span className="flex-1 truncate text-[#6d5a47]">{item.url}</span>
              <span className={`font-mono ${item.status < 300 ? 'text-green-600' : item.status < 400 ? 'text-amber-600' : 'text-red-600'}`}>{item.status}</span>
              <span className="text-[#c79f72]">{item.duration}ms</span>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>
      )}

      {/* Response */}
      {(status > 0 || response) && (
        <div className="border border-[#ead0ad] rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-[#fff4e6] border-b border-[#ead0ad]">
            <span className={`text-sm font-bold font-mono ${status < 300 ? 'text-green-600' : status < 400 ? 'text-amber-600' : 'text-red-600'}`}>
              {status}
            </span>
            <span className="text-xs text-[#8b735c]">{duration}ms</span>
            <button onClick={() => copyToClipboard(response)} className="ml-auto text-xs text-[#7a421b] hover:underline flex items-center gap-1">
              <Copy className="w-3 h-3" />复制响应
            </button>
          </div>
          <pre className="p-3 text-xs font-mono max-h-60 overflow-auto whitespace-pre-wrap bg-white">{response}</pre>
          {responseHeaders && (
            <details className="border-t border-[#ead0ad]">
              <summary className="px-3 py-1 text-xs text-[#8b735c] cursor-pointer hover:text-[#7a421b]">响应头</summary>
              <pre className="px-3 pb-2 text-[10px] font-mono text-[#8b735c] whitespace-pre-wrap">{responseHeaders}</pre>
            </details>
          )}
        </div>
      )}

      {/* SSRF protection info */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
        <div className="flex items-center gap-1 mb-1">
          <Shield className="w-3 h-3 text-green-600" />
          <span className="text-xs font-medium text-green-700">SSRF 安全防护</span>
        </div>
        <ul className="text-[10px] text-green-700 space-y-0.5 ml-4 list-disc">
          <li>仅允许 HTTP/HTTPS 协议</li>
          <li>禁止访问内网地址（10.x / 172.16-31.x / 192.168.x / 127.x）</li>
          <li>禁止访问云服务元数据端点（169.254.169.254 等）</li>
          <li>不自动跟随重定向</li>
        </ul>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default ApiDebugger;