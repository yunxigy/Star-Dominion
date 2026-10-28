import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import TarotGuide from './TarotGuide'

describe('TarotGuide', () => {
  it('renders all 78 new WebP card fronts', () => {
    const markup = renderToStaticMarkup(<TarotGuide onClose={() => undefined} />)

    expect(markup).toContain('/assets/tarot/cards/tarot_00_fool.webp')
    expect(markup).toContain('/assets/tarot/cards/tarot_wands_king.webp')
    expect(markup.match(/data-tarot-labels="true"/g)).toHaveLength(78)
    expect(markup).not.toContain('22张大阿卡纳牌义详解')
  })
})
