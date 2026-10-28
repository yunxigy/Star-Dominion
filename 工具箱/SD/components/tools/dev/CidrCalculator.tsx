import React, { useState, useMemo } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Copy, CheckCircle } from 'lucide-react';

const ipToInt = (ip: string): number => {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
};

const intToIp = (num: number): string => {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
};

const isValidIp = (ip: string): boolean => {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
};

const getCidrInfo = (cidr: string) => {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr);

  if (!isValidIp(ip) || isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  const ipInt = ipToInt(ip);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  const broadcastInt = (networkInt | ~mask) >>> 0;
  const firstHostInt = prefix === 32 ? networkInt : (networkInt + 1) >>> 0;
  const lastHostInt = prefix === 32 ? networkInt : (broadcastInt - 1) >>> 0;
  const totalHosts = Math.pow(2, 32 - prefix);
  const usableHosts = prefix === 32 ? 1 : prefix === 31 ? 2 : totalHosts - 2;

  return {
    ip: ip,
    prefix: prefix,
    subnetMask: intToIp(mask),
    networkAddress: intToIp(networkInt),
    broadcastAddress: intToIp(broadcastInt),
    firstHost: intToIp(firstHostInt),
    lastHost: intToIp(lastHostInt),
    totalHosts: totalHosts,
    usableHosts: usableHosts,
    ipClass: getIpClass(ipInt),
    isPrivate: isPrivateIp(ipInt),
    ipType: prefix === 32 ? '主机地址' : prefix === 31 ? '点对点链路' : '网络地址',
    binaryMask: mask.toString(2).padStart(32, '0').replace(/(.{8})/g, '$1 ').trim(),
    wildcardMask: intToIp((~mask) >>> 0),
  };
};

const getIpClass = (ipInt: number): string => {
  const firstOctet = (ipInt >>> 24) & 255;
  if (firstOctet < 128) return 'A';
  if (firstOctet < 192) return 'B';
  if (firstOctet < 224) return 'C';
  if (firstOctet < 240) return 'D (组播)';
  return 'E (保留)';
};

const isPrivateIp = (ipInt: number): boolean => {
  const first = (ipInt >>> 24) & 255;
  const second = (ipInt >>> 16) & 255;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
};

const splitSubnet = (cidr: string, newPrefix: number): string[] | null => {
  const info = getCidrInfo(cidr);
  if (!info) return null;
  if (newPrefix <= info.prefix) return null;
  if (newPrefix > 30) return null;

  const count = Math.pow(2, newPrefix - info.prefix);
  const networkInt = ipToInt(info.networkAddress);
  const subnetSize = Math.pow(2, 32 - newPrefix);

  const subnets: string[] = [];
  for (let i = 0; i < Math.min(count, 256); i++) {
    const subnetStart = (networkInt + i * subnetSize) >>> 0;
    subnets.push(`${intToIp(subnetStart)}/${newPrefix}`);
  }

  return subnets;
};

const supernet = (cidrs: string[]): string | null => {
  if (cidrs.length === 0) return null;
  const infos = cidrs.map(getCidrInfo);
  if (infos.some(i => i === null)) return null;

  // Find common prefix
  const minPrefix = Math.min(...infos.map(i => i!.prefix));
  const networkInts = infos.map(i => ipToInt(i!.networkAddress));

  let commonPrefix = 0;
  for (let bit = 31; bit >= 0; bit--) {
    const bitValues = networkInts.map(n => (n >>> bit) & 1);
    if (bitValues.every(v => v === bitValues[0])) {
      commonPrefix = 31 - bit;
    } else {
      break;
    }
  }

  const supernetPrefix = Math.min(commonPrefix, minPrefix);
  const mask = supernetPrefix === 0 ? 0 : (~0 << (32 - supernetPrefix)) >>> 0;
  const supernetNetwork = (networkInts[0] & mask) >>> 0;

  return `${intToIp(supernetNetwork)}/${supernetPrefix}`;
};

const COMMON_SUBNETS = [
  { cidr: '/0', hosts: '4,294,967,296', desc: '全部地址' },
  { cidr: '/8', hosts: '16,777,216', desc: 'A类' },
  { cidr: '/16', hosts: '65,536', desc: 'B类' },
  { cidr: '/24', hosts: '256', desc: 'C类' },
  { cidr: '/25', hosts: '128', desc: '半C类' },
  { cidr: '/26', hosts: '64', desc: '1/4 C类' },
  { cidr: '/27', hosts: '32', desc: '1/8 C类' },
  { cidr: '/28', hosts: '16', desc: '1/16 C类' },
  { cidr: '/29', hosts: '8', desc: '1/32 C类' },
  { cidr: '/30', hosts: '4', desc: '点对点' },
  { cidr: '/31', hosts: '2', desc: 'RFC 3021' },
  { cidr: '/32', hosts: '1', desc: '主机地址' },
];

const CidrCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [cidrInput, setCidrInput] = useState('192.168.1.0/24');
  const [splitPrefix, setSplitPrefix] = useState('26');
  const [supernetInput, setSupernetInput] = useState('192.168.1.0/24\n192.168.2.0/24');
  const [copiedField, setCopiedField] = useState('');

  const info = useMemo(() => getCidrInfo(cidrInput), [cidrInput]);

  const splitResults = useMemo(() => {
    const newPrefix = parseInt(splitPrefix);
    if (isNaN(newPrefix)) return null;
    return splitSubnet(cidrInput, newPrefix);
  }, [cidrInput, splitPrefix]);

  const supernetResult = useMemo(() => {
    const cidrs = supernetInput.split('\n').map(s => s.trim()).filter(Boolean);
    if (cidrs.length < 2) return null;
    return supernet(cidrs);
  }, [supernetInput]);

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 2000);
  };

  const CopyBtn = ({ text, field }: { text: string; field: string }) => (
    <button onClick={() => handleCopy(text, field)} className="text-[#7a421b] hover:text-[#6f3714] ml-1">
      {copiedField === field ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">CIDR/子网计算器 — 子网划分、超网聚合、IP范围计算</p>

      {/* CIDR input */}
      <div>
        <label className="text-xs text-[#8b735c] mb-1 block">CIDR 地址</label>
        <input value={cidrInput} onChange={e => setCidrInput(e.target.value)}
          className="w-full text-sm font-mono border border-[#ead0ad] rounded-lg px-3 py-2 bg-white focus:border-[#7a421b] focus:outline-none"
          placeholder="192.168.1.0/24" />
      </div>

      {/* Results */}
      {info && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-[#6d5a47]">计算结果</h4>
          <div className="bg-white border border-[#ead0ad] rounded-lg divide-y divide-[#ead0ad]">
            {[
              ['网络地址', info.networkAddress],
              ['广播地址', info.broadcastAddress],
              ['子网掩码', info.subnetMask],
              ['通配符掩码', info.wildcardMask],
              ['第一个可用主机', info.firstHost],
              ['最后一个可用主机', info.lastHost],
              ['总地址数', info.totalHosts.toLocaleString()],
              ['可用主机数', info.usableHosts.toLocaleString()],
              ['IP类别', info.ipClass],
              ['地址类型', info.ipType],
              ['私有地址', info.isPrivate ? '是' : '否'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center px-3 py-1.5 text-xs">
                <span className="text-[#8b735c] min-w-[120px]">{label}</span>
                <span className="font-mono text-[#6d5a47] flex-1">{value}</span>
                <CopyBtn text={String(value)} field={label} />
              </div>
            ))}
          </div>
          <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-2">
            <div className="text-[10px] text-[#8b735c] mb-0.5">二进制掩码</div>
            <code className="text-[10px] font-mono text-[#6d5a47] break-all">{info.binaryMask}</code>
          </div>
        </div>
      )}

      {!info && cidrInput && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
          无效的CIDR格式，请使用如 192.168.1.0/24 的格式
        </div>
      )}

      {/* Subnet split */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <h4 className="text-xs font-medium text-[#6f3714] mb-2">子网划分</h4>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-[10px] text-[#8b735c]">新前缀长度</label>
            <input value={splitPrefix} onChange={e => setSplitPrefix(e.target.value)}
              className="w-full text-xs font-mono border border-[#ead0ad] rounded px-2 py-1 bg-white" placeholder="26" />
          </div>
        </div>
        {splitResults && (
          <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] text-[#8b735c]">划分为 {splitResults.length} 个子网：</div>
            {splitResults.map((subnet, i) => {
              const subnetInfo = getCidrInfo(subnet);
              return (
                <div key={i} className="text-xs font-mono text-[#6d5a47] flex items-center gap-2">
                  <span className="text-[#c79f72] w-4">{i + 1}.</span>
                  <span>{subnet}</span>
                  {subnetInfo && <span className="text-[10px] text-[#8b735c]">({subnetInfo.usableHosts} 主机)</span>}
                </div>
              );
            })}
          </div>
        )}
        {splitPrefix && parseInt(splitPrefix) <= (info?.prefix || 0) && (
          <div className="text-[10px] text-red-500 mt-1">新前缀必须大于当前前缀 /{info?.prefix}</div>
        )}
      </div>

      {/* Supernet */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <h4 className="text-xs font-medium text-[#6f3714] mb-2">超网聚合</h4>
        <textarea value={supernetInput} onChange={e => setSupernetInput(e.target.value)}
          className="w-full h-16 text-xs font-mono border border-[#ead0ad] rounded px-2 py-1 bg-white resize-y"
          placeholder="每行一个CIDR地址" />
        {supernetResult && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-[#8b735c]">聚合结果:</span>
            <span className="text-xs font-mono font-bold text-[#7a421b]">{supernetResult}</span>
            <CopyBtn text={supernetResult} field="supernet" />
          </div>
        )}
      </div>

      {/* Common subnets reference */}
      <div>
        <h4 className="text-xs font-medium text-[#6d5a47] mb-1">常用子网参考</h4>
        <div className="grid grid-cols-3 gap-1">
          {COMMON_SUBNETS.map(s => (
            <button key={s.cidr} onClick={() => {
              const base = cidrInput.split('/')[0] || '192.168.1.0';
              setCidrInput(`${base.split('.').slice(0, 3).join('.')}.0${s.cidr}`);
            }}
              className="text-left px-2 py-1 rounded border text-xs bg-white border-[#ead0ad] hover:border-[#c79f72]">
              <span className="font-mono font-bold text-[#7a421b]">{s.cidr}</span>
              <span className="text-[10px] text-[#8b735c] ml-1">{s.hosts}</span>
              <span className="text-[10px] text-[#c79f72] ml-1">{s.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default CidrCalculator;