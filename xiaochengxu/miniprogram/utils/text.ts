export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  paragraphs: number;
  chineseChars: number;
  englishWords: number;
  readingTime: number;
}

export function countText(text: string): TextStats {
  if (!text) {
    return {
      characters: 0,
      charactersNoSpaces: 0,
      words: 0,
      lines: 0,
      paragraphs: 0,
      chineseChars: 0,
      englishWords: 0,
      readingTime: 0,
    };
  }

  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  const englishWords = text.match(/[a-zA-Z]+/g)?.length || 0;
  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    words: text.trim().split(/\s+/).filter((word) => word.length > 0).length,
    lines: text.split('\n').length,
    paragraphs: text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0).length,
    chineseChars,
    englishWords,
    readingTime: Math.ceil(chineseChars / 400 + englishWords / 200),
  };
}

export type CaseMode = 'upper' | 'lower' | 'capitalize' | 'sentence' | 'toggle';

export function convertCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (character) => character.toUpperCase());
    case 'sentence':
      return text
        .split(/([.!?]\s*)/)
        .map((part, index) => {
          if (index % 2 === 1) return part;
          return part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join('');
    case 'toggle':
      return text
        .split('')
        .map((character) => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase())
        .join('');
  }
}
