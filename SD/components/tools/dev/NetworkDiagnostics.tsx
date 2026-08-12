import React, { useState, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Globe, Clock, AlertCircle, CheckCircle, XCircle, Search, Download } from 'lucide-react';

interface DiagnosticResult {
  type: 'dns' | 'ping' | 'port' | 'headers' | 'ssl' | 'whois';
  target: string;
  status: 'success' | 'error' | 'info';
  data: Record<string, string>;
  duration: number;
  timestamp: number;
}

const NetworkDiagnostics: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [target, setTarget] = useState('');
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<'dns' | 'ping' | 'port' | 'headers' | 'ssl' | 'whois'>('dns');
  const [portNumber, setPortNumber] = useState('443');

  const tools = [
    { id: 'dns' as const, name: 'DNS 查询', icon: '🔍', desc: '查询域名DNS记录' },
    { id: 'ping' as const, name: '连通性检测', icon: '📡', desc: '检测目标是否可达' },
    { id: 'port' as const, name: '端口检测', icon: '🔌', desc: '检测端口是否开放' },
    { id: 'headers' as const, name: 'HTTP 头', icon: '📋', desc: '获取HTTP响应头' },
    { id: 'ssl' as const, name: 'SSL/TLS', icon: '🔒', desc: '检查SSL证书信息' },
    { id: 'whois' as const, name: 'Whois', icon: '🌐', desc: '查询域名注册信息' },
  ];

  const runDiagnostic = useCallback(async () => {
    if (!target.trim()) return;
    setLoading(true);
    const startTime = Date.now();
    let result: DiagnosticResult;

    try {
      // Normalize target
      let url = target.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const parsed = new URL(url);
      const hostname = parsed.hostname;

      switch (activeTool) {
        case 'dns': {
          // Use DNS-over-HTTPS (Cloudflare)
          const resp = await fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
            headers: { 'Accept': 'application/dns-json' },
          });
          const data = await resp.json();
          const answers = data.Answer || [];
          result = {
            type: 'dns',
            target: hostname,
            status: answers.length > 0 ? 'success' : 'error',
            data: {
              '查询域名': hostname,
              '记录类型': 'A',
              'DNS服务器': 'Cloudflare DoH (1.1.1.1)',
              ...(answers.length > 0
                ? { '解析结果': answers.map((a: { data: string; ttl: number }) => `${a.data} (TTL: ${a.ttl}s)`).join(', ') }
                : { '错误': '未找到A记录' }),
              '状态码': String(data.Status),
              ...(data.Answer?.some((a: { type: number }) => a.type === 5) ? { 'CNAME': answers.filter((a: { type: number }) => a.type === 5).map((a: { data: string }) => a.data).join(', ') } : {}),
            },
            duration: Date.now() - startTime,
            timestamp: Date.now(),
          };
          break;
        }

        case 'ping': {
          // Browser can't do real ICMP ping, use fetch as connectivity check
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          try {
            const resp = await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            clearTimeout(timeout);
            result = {
              type: 'ping',
              target: hostname,
              status: 'success',
              data: {
                '目标': hostname,
                '状态': '可达 (HTTP HEAD)',
                '响应类型': resp.type === 'opaque' ? '跨域(无法读取响应)' : '同源',
                '协议': parsed.protocol,
              },
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          } catch (e) {
            clearTimeout(timeout);
            result = {
              type: 'ping',
              target: hostname,
              status: 'error',
              data: {
                '目标': hostname,
                '状态': '不可达或超时',
                '错误': (e as Error).message,
                '提示': '浏览器受CORS限制，此结果仅供参考',
              },
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          }
          break;
        }

        case 'port': {
          // Browser can't directly check ports, try fetching
          const port = portNumber || '443';
          const testUrl = `${parsed.protocol}//${hostname}:${port}`;
          const controller2 = new AbortController();
          const timeout2 = setTimeout(() => controller2.abort(), 3000);
          try {
            await fetch(testUrl, { method: 'HEAD', mode: 'no-cors', signal: controller2.signal });
            clearTimeout(timeout2);
            result = {
              type: 'port',
              target: `${hostname}:${port}`,
              status: 'success',
              data: {
                '目标': hostname,
                '端口': port,
                '状态': '可能开放',
                '提示': '浏览器无法精确检测端口状态，此结果仅供参考',
              },
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          } catch {
            clearTimeout(timeout2);
            result = {
              type: 'port',
              target: `${hostname}:${port}`,
              status: 'error',
              data: {
                '目标': hostname,
                '端口': port,
                '状态': '可能关闭或被阻止',
                '提示': '浏览器受安全策略限制，无法精确检测端口',
              },
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          }
          break;
        }

        case 'headers': {
          try {
            const resp = await fetch(url, { method: 'GET' });
            const headers: Record<string, string> = {};
            resp.headers.forEach((value, key) => { headers[key] = value; });
            result = {
              type: 'headers',
              target: hostname,
              status: 'success',
              data: {
                '目标': url,
                '状态码': String(resp.status),
                '状态文本': resp.statusText,
                ...Object.fromEntries(
                  Object.entries(headers).slice(0, 20).map(([k, v]) => [k, v])
                ),
              },
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          } catch (e) {
            result = {
              type: 'headers',
              target: hostname,
              status: 'error',
              data: {
                '错误': (e as Error).message,
                '提示': 'CORS限制可能阻止读取响应头',
              },
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          }
          break;
        }

        case 'ssl': {
          // Browser can access some cert info via the connection
          try {
            const resp = await fetch(url);
            const certInfo: Record<string, string> = {
              '目标': hostname,
              '协议': parsed.protocol,
              '连接状态': 'SSL连接成功',
            };
            // Try to get timing info
            const timing = (resp as unknown as { timing?: Record<string, number> }).timing;
            if (timing) {
              certInfo['DNS解析'] = `${timing.dnsLookup || 0}ms`;
              certInfo['TCP连接'] = `${timing.tcpConnection || 0}ms`;
              certInfo['TLS握手'] = `${timing.tlsHandshake || 0}ms`;
            }
            // Get security info from headers
            const strictTransport = resp.headers.get('strict-transport-security');
            if (strictTransport) certInfo['HSTS'] = strictTransport;
            const contentSecurity = resp.headers.get('content-security-policy');
            if (contentSecurity) certInfo['CSP'] = '已设置';
            certInfo['提示'] = '浏览器无法直接访问证书详情，建议使用 openssl s_client 命令获取完整证书信息';
            result = {
              type: 'ssl',
              target: hostname,
              status: 'success',
              data: certInfo,
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          } catch (e) {
            result = {
              type: 'ssl',
              target: hostname,
              status: 'error',
              data: {
                '错误': (e as Error).message,
                '提示': 'SSL连接失败或CORS限制',
              },
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
          }
          break;
        }

        case 'whois': {
          // Browser can't directly do WHOIS, provide guidance
          result = {
            type: 'whois',
            target: hostname,
            status: 'info',
            data: {
              '目标': hostname,
              '提示': '浏览器无法直接执行 WHOIS 查询',
              '替代方案1': `https://who.is/whois/${hostname}`,
              '替代方案2': `https://www.whois.com/whois/${hostname}`,
              '替代方案3': `命令行: whois ${hostname}`,
            },
            duration: Date.now() - startTime,
            timestamp: Date.now(),
          };
          break;
        }

        default:
          result = {
            type: activeTool,
            target: hostname,
            status: 'error',
            data: { '错误': '未知工具类型' },
            duration: Date.now() - startTime,
            timestamp: Date.now(),
          };
      }
    } catch (e) {
      result = {
        type: activeTool,
        target: target,
        status: 'error',
        data: { '错误': (e as Error).message },
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }

    setResults(prev => [result, ...prev].slice(0, 20));
    setLoading(false);
  }, [target, activeTool, portNumber]);

  const exportResults = () => {
    const text = results.map(r => {
      const statusIcon = r.status === 'success' ? '✓' : r.status === 'error' ? '✗' : 'ℹ';
      return `[${statusIcon}] ${r.type.toUpperCase()} - ${r.target} (${r.duration}ms)\n${Object.entries(r.data).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`;
    }).join('\n\n');
    copyToClipboard(`网络诊断报告\n${'='.repeat(40)}\n\n${text}`);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">网络诊断工具集 — DNS查询、连通性检测、端口检查、HTTP头分析、SSL检查</p>

      {/* Tool selector */}
      <div className="grid grid-cols-3 gap-2">
        {tools.map(tool => (
          <button key={tool.id} onClick={() => setActiveTool(tool.id)}
            className={`p-2 rounded-lg border text-left transition-colors ${activeTool === tool.id ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad] hover:border-[#c79f72]'}`}>
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{tool.icon}</span>
              <span className="text-xs font-medium">{tool.name}</span>
            </div>
            <div className={`text-[10px] mt-0.5 ${activeTool === tool.id ? 'text-white/70' : 'text-[#c79f72]'}`}>{tool.desc}</div>
          </button>
        ))}
      </div>

      {/* Target input */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#c79f72]" />
          <input value={target} onChange={e => setTarget(e.target.value)}
            className="w-full text-xs font-mono border border-[#ead0ad] rounded-lg pl-9 pr-3 py-2 bg-white focus:border-[#7a421b] focus:outline-none"
            placeholder="example.com 或 https://example.com" />
        </div>
        {activeTool === 'port' && (
          <input value={portNumber} onChange={e => setPortNumber(e.target.value)}
            className="w-20 text-xs font-mono border border-[#ead0ad] rounded-lg px-2 py-2 bg-white focus:border-[#7a421b] focus:outline-none"
            placeholder="端口" />
        )}
        <Btn onClick={runDiagnostic} disabled={loading || !target.trim()}>
          {loading ? <Clock className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
          {loading ? '检测中' : '执行'}
        </Btn>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#6d5a47]">诊断结果</span>
            <button onClick={exportResults} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
              <Download className="w-3 h-3" />导出报告
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {results.map((r, i) => (
              <div key={i} className={`rounded-lg border p-3 ${r.status === 'success' ? 'border-green-200 bg-green-50' : r.status === 'error' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {r.status === 'success' ? <CheckCircle className="w-4 h-4 text-green-500" /> : r.status === 'error' ? <XCircle className="w-4 h-4 text-red-500" /> : <AlertCircle className="w-4 h-4 text-amber-500" />}
                  <span className="text-xs font-medium">{r.type.toUpperCase()}</span>
                  <span className="text-xs font-mono text-[#6d5a47]">{r.target}</span>
                  <span className="text-[10px] text-[#c79f72] ml-auto">{r.duration}ms</span>
                </div>
                <div className="space-y-0.5">
                  {Object.entries(r.data).map(([key, value]) => (
                    <div key={key} className="text-xs flex">
                      <span className="text-[#8b735c] min-w-[100px]">{key}:</span>
                      <span className="text-[#6d5a47] font-mono break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：浏览器环境受CORS和安全策略限制，部分检测功能（ping、端口扫描、WHOIS、SSL证书详情）结果仅供参考。如需精确结果，请使用命令行工具（curl、dig、nmap、openssl）。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default NetworkDiagnostics;