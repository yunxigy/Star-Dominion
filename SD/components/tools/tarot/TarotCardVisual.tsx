import React, { useState } from 'react'

import {
  ALL_CARDS,
  getCardDisplayNumber,
  getCardImagePaths,
} from './tarot-data'

interface TarotCardVisualProps {
  number: number
  name: string
  emoji: string
  suit?: string
  reversed?: boolean
  faceDown?: boolean
  size?: 'sm' | 'md' | 'lg'
  keywords?: string[]
  onClick?: () => void
}

type TarotFallbackImage = Pick<HTMLImageElement, 'src' | 'dataset'>

export function applyTarotImageFallback(
  image: TarotFallbackImage,
  fallbackSrc: string,
): void {
  if (image.dataset.tarotFallbackApplied === 'true') return

  image.dataset.tarotFallbackApplied = 'true'
  image.src = fallbackSrc
}

const CARD_BY_NUMBER = new Map(ALL_CARDS.map(card => [card.number, card]))

const sizeClasses = {
  sm: 'h-48 w-32',
  md: 'h-64 w-44',
  lg: 'h-96 w-64',
}

const emojiSizes = {
  sm: 'text-2xl',
  md: 'text-4xl',
  lg: 'text-5xl',
}

const labelSizeClasses = {
  sm: {
    number: 'text-[9px]',
    name: 'text-[10px]',
    nameEn: 'text-[7px]',
    bottom: 'px-2 pb-2 pt-7',
  },
  md: {
    number: 'text-[10px]',
    name: 'text-xs',
    nameEn: 'text-[9px]',
    bottom: 'px-3 pb-3 pt-9',
  },
  lg: {
    number: 'text-xs',
    name: 'text-base',
    nameEn: 'text-[11px]',
    bottom: 'px-4 pb-4 pt-12',
  },
}

interface CardFaceLabelsProps {
  displayNumber: string
  name: string
  nameEn: string
  size: 'sm' | 'md' | 'lg'
}

const CardFaceLabels: React.FC<CardFaceLabelsProps> = ({
  displayNumber,
  name,
  nameEn,
  size,
}) => {
  const classes = labelSizeClasses[size]

  return (
    <div
      data-tarot-labels="true"
      className="pointer-events-none absolute inset-0 z-10 text-[#fff4e6]"
    >
      <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-[#e5c28d]/45 bg-[#17100c]/75 px-2 py-0.5 shadow-md backdrop-blur-sm">
        <span className={`${classes.number} font-serif font-semibold tracking-[0.18em]`}>
          {displayNumber}
        </span>
      </div>
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#120c09] via-[#17100c]/90 to-transparent text-center ${classes.bottom}`}
      >
        <div className={`${classes.name} font-medium tracking-[0.12em] text-[#fff7ea]`}>
          {name}
        </div>
        <div className={`${classes.nameEn} mt-0.5 font-serif uppercase tracking-[0.14em] text-[#e4c89f]`}>
          {nameEn}
        </div>
      </div>
    </div>
  )
}

export const TarotCardVisual: React.FC<TarotCardVisualProps> = ({
  number,
  name,
  emoji,
  reversed = false,
  faceDown = false,
  size = 'md',
  keywords,
  onClick,
}) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const card = CARD_BY_NUMBER.get(number)
  const imagePaths = card ? getCardImagePaths(card) : null
  const imageSrc = faceDown ? '/assets/tarot/cards/tarot_back.svg' : imagePaths?.webp
  const fallbackSrc = faceDown ? null : imagePaths?.svg
  const displayNumber = card ? getCardDisplayNumber(card) : String(number)
  const displayName = name || card?.name || displayNumber
  const displayNameEn = card?.nameEn || ''
  const previewTitle = faceDown
    ? '塔罗牌背面'
    : `${displayName}${displayNameEn ? ` · ${displayNameEn}` : ''}${reversed ? ' · 逆位' : ''}`

  const openPreview = () => {
    if (imageSrc) setIsPreviewOpen(true)
    onClick?.()
  }

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (fallbackSrc) applyTarotImageFallback(event.currentTarget, fallbackSrc)
  }

  if (imageSrc) {
    return (
      <>
        <button
          type="button"
          onClick={openPreview}
          className={`${sizeClasses[size]} group relative shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-[#211713] p-0 text-left transition-all hover:scale-[1.035] hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-[#9a5a28]/25`}
          style={{ boxShadow: '0 18px 42px rgba(58, 34, 18, 0.28)' }}
          aria-label={`放大查看${previewTitle}`}
        >
          <img
            src={imageSrc}
            alt={faceDown ? 'Tarot card back' : `${displayName} · ${displayNameEn} tarot card`}
            className={`h-full w-full object-cover transition-transform duration-500 ${reversed && !faceDown ? 'rotate-180' : ''}`}
            draggable={false}
            onError={handleImageError}
          />
          {!faceDown && (
            <CardFaceLabels
              displayNumber={displayNumber}
              name={displayName}
              nameEn={displayNameEn}
              size={size}
            />
          )}
          <div className="pointer-events-none absolute inset-0 z-20 rounded-xl ring-1 ring-[#f1dcc2]/20 transition group-hover:ring-[#f1dcc2]/55" />
          <div className="pointer-events-none absolute right-2 top-2 z-30 rounded-full border border-[#f1dcc2]/45 bg-[#2f241b]/75 px-2 py-0.5 text-[10px] font-medium tracking-wider text-[#fff4e6] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            放大
          </div>
          {reversed && !faceDown && (
            <div className="absolute left-2 top-2 z-30 rounded-full border border-red-300/60 bg-red-950/70 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-red-100 shadow-lg">
              逆位
            </div>
          )}
        </button>

        {isPreviewOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#241811]/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={previewTitle}
            onClick={() => setIsPreviewOpen(false)}
          >
            <div
              className="relative aspect-[2/3] max-h-[92vh] w-full max-w-[min(78vw,520px)] overflow-hidden rounded-2xl border border-[#d8b58e]/70 shadow-2xl"
              onClick={event => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="absolute right-3 top-3 z-40 rounded-full border border-[#d8b58e] bg-[#fff4e6] px-3 py-1 text-sm font-semibold text-[#6f3714] shadow-lg hover:bg-[#f1dcc2]"
                aria-label="关闭放大卡牌"
              >
                关闭
              </button>
              <img
                src={imageSrc}
                alt={previewTitle}
                className={`h-full w-full object-cover ${reversed && !faceDown ? 'rotate-180' : ''}`}
                draggable={false}
                onError={handleImageError}
              />
              {!faceDown && (
                <CardFaceLabels
                  displayNumber={displayNumber}
                  name={displayName}
                  nameEn={displayNameEn}
                  size="lg"
                />
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`${sizeClasses[size]} relative flex shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border-2 border-[#c79f72] bg-[#2f241b] transition-all hover:scale-105 hover:shadow-lg`}
      style={{ boxShadow: '0 18px 42px rgba(58, 34, 18, 0.28)' }}
    >
      <div className="pb-1 pt-2 text-center">
        <span className="font-serif text-xs tracking-widest text-[#d8b58e]/80">
          {displayNumber}
        </span>
      </div>
      <div className="mx-3 h-px bg-gradient-to-r from-transparent via-[#d8b58e]/50 to-transparent" />
      <div className="px-2 py-1 text-center">
        <span className="text-xs font-medium tracking-wider text-[#fff4e6]">{displayName}</span>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-20 w-20 rounded-full bg-[#d8b58e]/20" />
        </div>
        <span className={`${emojiSizes[size]} relative z-10 drop-shadow-lg`}>{emoji}</span>
      </div>
      {size !== 'sm' && keywords && keywords.length > 0 && (
        <div className="px-2 py-1.5 text-center">
          <div className="flex flex-wrap justify-center gap-1">
            {keywords.slice(0, 3).map(keyword => (
              <span key={keyword} className="rounded bg-[#9a5a28]/30 px-1 py-0.5 text-[9px] text-[#f1dcc2]">
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}
      {reversed && (
        <div className="absolute left-2 top-2 rounded-full bg-red-950/70 px-2 py-0.5 text-[10px] text-red-100">
          逆位
        </div>
      )}
    </div>
  )
}

export const TarotCardBack: React.FC<{
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
}> = ({ size = 'md', onClick }) => (
  <TarotCardVisual number={0} name="" emoji="" faceDown size={size} onClick={onClick} />
)
