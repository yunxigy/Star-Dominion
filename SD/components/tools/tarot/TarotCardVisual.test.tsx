import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import * as TarotCardVisualModule from './TarotCardVisual'
import { TarotCardVisual } from './TarotCardVisual'

describe('TarotCardVisual', () => {
  it('renders a Major Arcana WebP with its number and bilingual labels', () => {
    const markup = renderToStaticMarkup(
      <TarotCardVisual number={0} name="愚者" emoji="🃏" />,
    )

    expect(markup).toContain('/assets/tarot/cards/tarot_00_fool.webp')
    expect(markup).toContain('>0<')
    expect(markup).toContain('愚者')
    expect(markup).toContain('The Fool')
  })

  it('resolves Minor Arcana from the card number when suit is omitted', () => {
    const markup = renderToStaticMarkup(
      <TarotCardVisual number={22} name="圣杯A" emoji="🏆" />,
    )

    expect(markup).toContain('/assets/tarot/cards/tarot_cups_ace.webp')
    expect(markup).toContain('>A<')
    expect(markup).toContain('圣杯A')
    expect(markup).toContain('Ace of Cups')
  })

  it('keeps a face-down card on the SVG back without face labels', () => {
    const markup = renderToStaticMarkup(
      <TarotCardVisual number={0} name="愚者" emoji="🃏" faceDown />,
    )

    expect(markup).toContain('/assets/tarot/cards/tarot_back.svg')
    expect(markup).not.toContain('The Fool')
    expect(markup).not.toContain('>愚者<')
  })

  it('rotates the artwork for a reversed card while keeping labels upright', () => {
    const markup = renderToStaticMarkup(
      <TarotCardVisual number={0} name="愚者" emoji="🃏" reversed />,
    )

    expect(markup).toMatch(/<img[^>]+class="[^"]*rotate-180[^"]*"/)
    expect(markup).toMatch(/data-tarot-labels="true"/)
    expect(markup).not.toMatch(/data-tarot-labels="true"[^>]+rotate-180/)
  })

  it('switches a failed WebP to its SVG fallback only once', () => {
    const moduleWithFallback = TarotCardVisualModule as unknown as {
      applyTarotImageFallback?: (
        image: { src: string; dataset: Record<string, string | undefined> },
        fallbackSrc: string,
      ) => void
    }

    expect(typeof moduleWithFallback.applyTarotImageFallback).toBe('function')
    if (!moduleWithFallback.applyTarotImageFallback) return

    const image = {
      src: '/assets/tarot/cards/tarot_00_fool.webp',
      dataset: {},
    }

    moduleWithFallback.applyTarotImageFallback(
      image,
      '/assets/tarot/cards/tarot_00_fool.svg',
    )
    expect(image.src).toBe('/assets/tarot/cards/tarot_00_fool.svg')

    image.src = '/changed-after-fallback.svg'
    moduleWithFallback.applyTarotImageFallback(
      image,
      '/assets/tarot/cards/tarot_00_fool.svg',
    )
    expect(image.src).toBe('/changed-after-fallback.svg')
  })
})
