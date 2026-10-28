import React, { useEffect, useRef, useState } from 'react';

type AdSlotName =
  | 'home-banner'
  | 'home-mid'
  | 'home-bottom'
  | 'tools-top'
  | 'tools-inline'
  | 'tool-result'
  | 'tool-bottom'
  | 'guide-side'
  | 'test-result';

interface AdSlotProps {
  /** 广告位名称 */
  name: AdSlotName;
  /** 自定义类名 */
  className?: string;
  /** 是否启用（可通过配置控制） */
  enabled?: boolean;
}

/** 广告位尺寸配置 */
const AD_SIZES: Record<AdSlotName, { desktop: string; mobile: string; label: string }> = {
  'home-banner': { desktop: 'h-24', mobile: 'h-16', label: '横幅广告' },
  'home-mid': { desktop: 'h-20', mobile: 'h-16', label: '信息流广告' },
  'home-bottom': { desktop: 'h-24', mobile: 'h-20', label: '底部广告' },
  'tools-top': { desktop: 'h-16', mobile: 'h-14', label: '顶部广告' },
  'tools-inline': { desktop: 'h-20', mobile: 'h-16', label: '列表广告' },
  'tool-result': { desktop: 'h-24', mobile: 'h-20', label: '结果广告' },
  'tool-bottom': { desktop: 'h-20', mobile: 'h-16', label: '底部广告' },
  'guide-side': { desktop: 'h-64', mobile: 'h-20', label: '侧边广告' },
  'test-result': { desktop: 'h-28', mobile: 'h-20', label: '测试结果广告' },
};

/**
 * 统一广告位组件
 *
 * 使用方式：
 * <AdSlot name="home-banner" />
 * <AdSlot name="tool-result" enabled={showAds} />
 *
 * 接入广告平台时，在 AdSlot 内部实现实际的广告加载逻辑。
 * 当前为占位实现，显示友好的降级 UI。
 */
export const AdSlot: React.FC<AdSlotProps> = ({ name, className = '', enabled = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adLoaded, setAdLoaded] = useState(false);
  const [adFailed, setAdFailed] = useState(false);

  const size = AD_SIZES[name] || AD_SIZES['home-banner'];

  useEffect(() => {
    if (!enabled) return;

    // TODO: 接入实际广告平台（如 Google AdSense、百度联盟等）
    // 示例接入代码：
    // const slotId = `ad-${name}`;
    // try {
    //   (window.adsbygoogle = window.adsbygoogle || []).push({});
    //   setAdLoaded(true);
    // } catch (e) {
    //   setAdFailed(true);
    // }

    // 当前为占位模式，标记为已加载
    setAdLoaded(true);
  }, [name, enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      id={`ad-${name}`}
      className={`ad-slot relative w-full rounded-xl overflow-hidden transition-all ${size.desktop} max-sm:${size.mobile} ${className}`}
      data-ad-name={name}
      role="complementary"
      aria-label={`广告: ${size.label}`}
    >
      {/* 广告加载失败降级 */}
      {adFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f1dcc2]/70 border border-[#d8b58e] rounded-xl">
          <span className="text-xs text-[#8b735c]">广告加载失败</span>
        </div>
      )}

      {/* 广告占位（接入广告平台后替换此区域） */}
      {!adFailed && (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-r from-[#f1dcc2]/60 via-[#fff4e6]/70 to-[#dfe5cf]/55 border border-[#d8b58e]/70 rounded-xl">
          {adLoaded ? (
            <span className="text-[10px] text-[#8b735c]/70 select-none">{size.label}</span>
          ) : (
            <div className="w-4 h-4 border-2 border-[#9a5a28] border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      )}
    </div>
  );
};

export default AdSlot;
