import React, { useMemo, useState } from 'react'

import { TarotCardVisual } from './TarotCardVisual'
import { ALL_CARDS, type TarotCard } from './tarot-data'

const matchesSearch = (card: TarotCard, query: string) => {
  const normalizedQuery = query.toLowerCase()

  return (
    card.name.toLowerCase().includes(normalizedQuery) ||
    card.nameEn.toLowerCase().includes(normalizedQuery) ||
    card.keywords.some(keyword => keyword.toLowerCase().includes(normalizedQuery))
  )
}

const TarotGuide: React.FC<{ onClose: () => void }> = ({ onClose: _onClose }) => {
  const [search, setSearch] = useState('')
  const [expandedCard, setExpandedCard] = useState<number | null>(null)

  const filteredCards = useMemo(() => {
    const query = search.trim()
    return query ? ALL_CARDS.filter(card => matchesSearch(card, query)) : ALL_CARDS
  }, [search])

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-slate-400 text-sm">
          78 张塔罗牌牌义详解，点击牌面可放大查看，点击条目可展开正逆位含义
        </p>
      </div>

      <input
        type="text"
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder="搜索牌名或关键词..."
        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
        aria-label="搜索牌名或关键词..."
      />

      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {filteredCards.map(card => {
          const isExpanded = expandedCard === card.number

          return (
            <article
              key={card.number}
              className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
            >
              <div className="flex items-start gap-3 p-3">
                <TarotCardVisual
                  number={card.number}
                  name={card.name}
                  emoji={card.emoji}
                  size="sm"
                  keywords={card.keywords}
                />

                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setExpandedCard(isExpanded ? null : card.number)}
                    className="w-full flex items-start gap-3 text-left hover:bg-slate-700/30 rounded-lg p-1.5 transition-colors"
                    aria-expanded={isExpanded}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-blue-400 text-xs font-mono">{card.number}</span>
                        <span className="text-sm font-medium text-slate-200">{card.name}</span>
                        <span className="text-xs text-slate-500">{card.nameEn}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {card.keywords.slice(0, 3).map(keyword => (
                          <span
                            key={keyword}
                            className="text-xs px-1.5 py-0.5 bg-slate-700/50 text-slate-400 rounded"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-slate-500 text-xs pt-1" aria-hidden="true">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-1.5 pb-1.5 pt-3 space-y-3">
                      <div>
                        <p className="text-xs text-blue-400 mb-1">关键词</p>
                        <div className="flex flex-wrap gap-1">
                          {card.keywords.map(keyword => (
                            <span
                              key={keyword}
                              className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                        <p className="text-xs text-green-400 mb-1">正位含义</p>
                        <p className="text-xs text-green-300/80 mb-2">{card.upright}</p>
                        <p className="text-sm text-slate-300 leading-relaxed">{card.uprightMessage}</p>
                      </div>
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <p className="text-xs text-red-400 mb-1">逆位含义</p>
                        <p className="text-xs text-red-300/80 mb-2">{card.reversed}</p>
                        <p className="text-sm text-slate-300 leading-relaxed">{card.reversedMessage}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
        {filteredCards.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-8">没有找到匹配的牌</p>
        )}
      </div>
    </div>
  )
}

export default TarotGuide
