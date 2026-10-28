import { NativeTarotCard, drawTarotCards, tarotReading } from '../../../data/tarotData';

interface TarotDisplayCard extends NativeTarotCard {
  isReversed: boolean;
  reading: string;
  keywordText: string;
}

Component({
  properties: {
    toolId: {
      type: String,
      value: 'daily-tarot',
    },
  },

  data: {
    drawCount: 1,
    cards: [] as TarotDisplayCard[],
    error: '',
  },

  lifetimes: {
    attached() {
      const toolId = this.properties.toolId as string;
      this.setData({ drawCount: toolId === 'three-card-tarot' ? 3 : 1 });
    },
  },

  methods: {
    draw() {
      const cards = drawTarotCards(this.data.drawCount as number).map((card) => {
        const reversed = Math.random() < 0.5;
        return { ...card, isReversed: reversed, reading: tarotReading(card, reversed), keywordText: card.keywords.join(' · ') };
      });
      this.setData({ cards, error: '' });
    },

    copyResult() {
      const cards = this.data.cards as TarotDisplayCard[];
      if (cards.length === 0) return;
      const text = cards.map((card, index) => `${index + 1}. ${card.name}（${card.isReversed ? '逆位' : '正位'}）\n${card.reading}`).join('\n');
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    },

    clear() {
      this.setData({ cards: [], error: '' });
    },
  },
});
