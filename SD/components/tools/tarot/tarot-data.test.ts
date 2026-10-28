import { describe, expect, it } from 'vitest'

import {
  ALL_CARDS,
  getCardDisplayNumber,
  getCardImagePaths,
} from './tarot-data'

describe('tarot card metadata', () => {
  it('defines 78 uniquely numbered cards with English names', () => {
    expect(ALL_CARDS).toHaveLength(78)
    expect(new Set(ALL_CARDS.map(card => card.number)).size).toBe(78)
    expect(ALL_CARDS.every(card => card.nameEn.length > 0)).toBe(true)
  })

  it('builds stable WebP and SVG paths for major and minor cards', () => {
    expect(getCardImagePaths(ALL_CARDS[0])).toEqual({
      webp: '/assets/tarot/cards/tarot_00_fool.webp',
      svg: '/assets/tarot/cards/tarot_00_fool.svg',
    })
    expect(getCardImagePaths(ALL_CARDS[22])).toEqual({
      webp: '/assets/tarot/cards/tarot_cups_ace.webp',
      svg: '/assets/tarot/cards/tarot_cups_ace.svg',
    })
    expect(getCardImagePaths(ALL_CARDS[77])).toEqual({
      webp: '/assets/tarot/cards/tarot_wands_king.webp',
      svg: '/assets/tarot/cards/tarot_wands_king.svg',
    })
  })

  it('provides the display labels used by the card frame', () => {
    expect(ALL_CARDS[0].nameEn).toBe('The Fool')
    expect(ALL_CARDS[22].nameEn).toBe('Ace of Cups')
    expect(getCardDisplayNumber(ALL_CARDS[0])).toBe('0')
    expect(getCardDisplayNumber(ALL_CARDS[21])).toBe('XXI')
    expect(getCardDisplayNumber(ALL_CARDS[22])).toBe('A')
    expect(getCardDisplayNumber(ALL_CARDS[32])).toBe('侍从')
  })
})
