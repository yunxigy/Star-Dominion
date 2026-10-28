/** 塔罗牌完整数据 — 78 张牌（22 大阿卡纳 + 56 小阿卡纳） */

export type TarotSuit = 'cups' | 'pentacles' | 'swords' | 'wands'

export interface TarotCard {
  number: number
  name: string
  nameEn: string
  emoji: string
  suit?: TarotSuit
  keywords: string[]
  upright: string
  reversed: string
  uprightMessage: string
  reversedMessage: string
}

// ── 大阿卡纳 (Major Arcana) ──────────────────────────────────

const MAJOR_META = [
  ['The Fool', 'fool'],
  ['The Magician', 'magician'],
  ['The High Priestess', 'high_priestess'],
  ['The Empress', 'empress'],
  ['The Emperor', 'emperor'],
  ['The Hierophant', 'hierophant'],
  ['The Lovers', 'lovers'],
  ['The Chariot', 'chariot'],
  ['Strength', 'strength'],
  ['The Hermit', 'hermit'],
  ['Wheel of Fortune', 'wheel_of_fortune'],
  ['Justice', 'justice'],
  ['The Hanged Man', 'hanged_man'],
  ['Death', 'death'],
  ['Temperance', 'temperance'],
  ['The Devil', 'devil'],
  ['The Tower', 'tower'],
  ['The Star', 'star'],
  ['The Moon', 'moon'],
  ['The Sun', 'sun'],
  ['Judgement', 'judgement'],
  ['The World', 'world'],
] as const

const MAJOR_ROMAN = [
  '0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI',
] as const

const MAJOR_ARCANA_BASE: Omit<TarotCard, 'nameEn'>[] = [
  { number: 0, name: '愚者', emoji: '🃏', keywords: ['新开始', '冒险', '自由'], upright: '新开始/冒险/自由', reversed: '鲁莽/不计后果/停滞', uprightMessage: '今天是开启新旅程的绝佳时机。保持开放的心态，勇敢地迈出第一步。', reversedMessage: '今天需要谨慎行事，避免冲动决定。' },
  { number: 1, name: '魔术师', emoji: '🎩', keywords: ['创造力', '意志力', '技能'], upright: '创造力/意志力/技能', reversed: '操控/欺骗/能力不足', uprightMessage: '你拥有实现目标所需的一切资源和能力。集中精力，化想法为现实。', reversedMessage: '今天可能会感到力不从心，重新审视自己的目标和方法。' },
  { number: 2, name: '女祭司', emoji: '🌙', keywords: ['直觉', '潜意识', '神秘'], upright: '直觉/潜意识/神秘', reversed: '忽视直觉/表面化/秘密', uprightMessage: '倾听内心的声音，你的直觉今天格外准确。', reversedMessage: '你可能忽略了内心的警告信号。' },
  { number: 3, name: '皇后', emoji: '👑', keywords: ['丰收', '母性', '自然'], upright: '丰收/母性/自然', reversed: '依赖/过度保护/创造力受阻', uprightMessage: '今天充满丰盛与美好。享受生活的乐趣，关爱自己和身边的人。', reversedMessage: '注意不要过度照顾他人而忽略自己。' },
  { number: 4, name: '皇帝', emoji: '🏛️', keywords: ['权威', '结构', '领导力'], upright: '权威/结构/领导力', reversed: '专制/僵化/控制欲', uprightMessage: '今天适合展现领导力和决断力。建立秩序，制定规则。', reversedMessage: '避免过于强硬或控制他人。' },
  { number: 5, name: '教皇', emoji: '📿', keywords: ['传统', '信仰', '教育'], upright: '传统/信仰/教育', reversed: '叛逆/非传统/教条主义', uprightMessage: '遵循传统智慧和既定规则会带来指引。', reversedMessage: '质疑旧有观念，寻找适合自己的道路。' },
  { number: 6, name: '恋人', emoji: '💕', keywords: ['爱情', '选择', '和谐'], upright: '爱情/选择/和谐', reversed: '不和谐/价值观冲突/错误选择', uprightMessage: '爱与和谐弥漫在今天的关系中。做出忠于内心的选择。', reversedMessage: '审视关系中的不平衡，坦诚沟通才能化解分歧。' },
  { number: 7, name: '战车', emoji: '🏇', keywords: ['胜利', '意志', '决心'], upright: '胜利/意志/决心', reversed: '失控/挫败/缺乏方向', uprightMessage: '坚定的意志力将带你走向胜利。勇往直前！', reversedMessage: '感觉失去方向或控制。停下来重新调整目标。' },
  { number: 8, name: '力量', emoji: '🦁', keywords: ['勇气', '耐心', '内在力量'], upright: '勇气/耐心/内在力量', reversed: '自我怀疑/脆弱/缺乏勇气', uprightMessage: '你内心拥有无比强大的力量。用温柔而坚定的方式面对挑战。', reversedMessage: '今天可能感到不安或自我怀疑。给自己一些温柔。' },
  { number: 9, name: '隐者', emoji: '🏔️', keywords: ['内省', '孤独', '智慧'], upright: '内省/孤独/智慧', reversed: '孤立/逃避/固执', uprightMessage: '今天适合独处和深度思考。远离喧嚣，向内探索。', reversedMessage: '不要过度孤立自己。适度社交同样重要。' },
  { number: 10, name: '命运之轮', emoji: '🎡', keywords: ['命运', '转变', '机遇'], upright: '命运/转变/机遇', reversed: '抗拒改变/坏运气/失控', uprightMessage: '命运之轮正在转动，变化和机遇即将来临。保持灵活。', reversedMessage: '目前可能处于低潮期，但这也只是暂时的。' },
  { number: 11, name: '正义', emoji: '⚖️', keywords: ['公平', '真相', '因果'], upright: '公平/真相/因果', reversed: '不公正/逃避责任/偏见', uprightMessage: '真相和公正今天会显现。诚实地面对自己和他人。', reversedMessage: '审视自己是否承担了应有的责任。' },
  { number: 12, name: '倒吊人', emoji: '🔄', keywords: ['牺牲', '放手', '新视角'], upright: '牺牲/放手/新视角', reversed: '拖延/无谓牺牲/固执', uprightMessage: '换个角度看问题，你会有全新的领悟。', reversedMessage: '检查是否有不必要的牺牲。不要拖延改变。' },
  { number: 13, name: '死神', emoji: '🦋', keywords: ['结束', '转变', '重生'], upright: '结束/转变/重生', reversed: '抗拒结束/恐惧改变/停滞', uprightMessage: '一个阶段的结束意味着新阶段的开始。拥抱转变。', reversedMessage: '你可能在抗拒必要的改变。接受结束是新开始的前提。' },
  { number: 14, name: '节制', emoji: '⏳', keywords: ['平衡', '耐心', '调和'], upright: '平衡/耐心/调和', reversed: '失衡/过度/缺乏耐心', uprightMessage: '今天需要在各方面找到平衡。耐心调和不同的元素。', reversedMessage: '生活中某些方面可能失衡了。重新审视优先级。' },
  { number: 15, name: '恶魔', emoji: '😈', keywords: ['束缚', '欲望', '物质'], upright: '束缚/欲望/物质', reversed: '解脱/打破束缚/觉醒', uprightMessage: '警惕物质欲望和不良习惯的束缚。', reversedMessage: '你正在摆脱某种束缚。拥抱自由。' },
  { number: 16, name: '塔', emoji: '⚡', keywords: ['突变', '混乱', '觉醒'], upright: '突变/混乱/觉醒', reversed: '逃避灾难/恐惧改变/延迟', uprightMessage: '突如其来的变化可能会打乱计划，但这也是破旧立新的契机。', reversedMessage: '可能避免了一场灾难，或在延迟不可避免的改变。' },
  { number: 17, name: '星星', emoji: '⭐', keywords: ['希望', '灵感', '宁静'], upright: '希望/灵感/宁静', reversed: '绝望/失去信心/创意枯竭', uprightMessage: '希望的星光照亮前路。保持信念，灵感和宁静正在治愈你。', reversedMessage: '暂时看不到希望，但星光从未消失。' },
  { number: 18, name: '月亮', emoji: '🌕', keywords: ['幻象', '恐惧', '潜意识'], upright: '幻象/恐惧/潜意识', reversed: '克服恐惧/真相显现/困惑消散', uprightMessage: '今天的某些事情可能并非如表面所见。信任直觉。', reversedMessage: '困惑正在消散，真相逐渐明朗。' },
  { number: 19, name: '太阳', emoji: '☀️', keywords: ['快乐', '成功', '活力'], upright: '快乐/成功/活力', reversed: '暂时受挫/过度乐观/延迟的成功', uprightMessage: '阳光灿烂的一天！快乐、成功和活力充满你的生活。', reversedMessage: '快乐和成功可能暂时被遮蔽，但阳光终会普照。' },
  { number: 20, name: '审判', emoji: '📯', keywords: ['觉醒', '重生', '召唤'], upright: '觉醒/重生/召唤', reversed: '自我怀疑/拒绝觉醒/逃避审视', uprightMessage: '内心的召唤正在唤醒你。审视过去，接受评判。', reversedMessage: '你可能在逃避自我审视。勇敢面对内心的声音。' },
  { number: 21, name: '世界', emoji: '🌍', keywords: ['完成', '整合', '成就'], upright: '完成/整合/成就', reversed: '未完成/缺乏闭合/短视', uprightMessage: '一个重要的循环即将圆满完成。庆祝你的成就。', reversedMessage: '感觉差一步就能完成。审视还有什么需要收尾。' },
]

export const MAJOR_ARCANA: TarotCard[] = MAJOR_ARCANA_BASE.map(card => ({
  ...card,
  nameEn: MAJOR_META[card.number][0],
}))

// ── 小阿卡纳 (Minor Arcana) ──────────────────────────────────

const SUIT_DATA: Record<TarotSuit, {
  name: string
  nameEn: string
  emoji: string
  theme: string
}> = {
  cups: { name: '圣杯', nameEn: 'Cups', emoji: '🏆', theme: '情感/直觉/关系' },
  pentacles: { name: '金币', nameEn: 'Pentacles', emoji: '🪙', theme: '物质/财富/健康' },
  swords: { name: '宝剑', nameEn: 'Swords', emoji: '⚔️', theme: '思维/冲突/真相' },
  wands: { name: '权杖', nameEn: 'Wands', emoji: '🪄', theme: '行动/创造/激情' },
}

const RANK_DATA = {
  ace:    { name: 'A', nameEn: 'Ace', slug: 'ace', num: 1, keywords: ['新开始', '潜力', '机会'] },
  two:    { name: '2', nameEn: 'Two', slug: 'two', num: 2, keywords: ['选择', '平衡', '决定'] },
  three:  { name: '3', nameEn: 'Three', slug: 'three', num: 3, keywords: ['成长', '合作', '创造力'] },
  four:   { name: '4', nameEn: 'Four', slug: 'four', num: 4, keywords: ['稳定', '基础', '休息'] },
  five:   { name: '5', nameEn: 'Five', slug: 'five', num: 5, keywords: ['冲突', '变化', '挑战'] },
  six:    { name: '6', nameEn: 'Six', slug: 'six', num: 6, keywords: ['和谐', '给予', '平衡'] },
  seven:  { name: '7', nameEn: 'Seven', slug: 'seven', num: 7, keywords: ['反思', '选择', '内在'] },
  eight:  { name: '8', nameEn: 'Eight', slug: 'eight', num: 8, keywords: ['行动', '变化', '进展'] },
  nine:   { name: '9', nameEn: 'Nine', slug: 'nine', num: 9, keywords: ['完成', '满足', '收获'] },
  ten:    { name: '10', nameEn: 'Ten', slug: 'ten', num: 10, keywords: ['结束', '循环', '圆满'] },
  page:   { name: '侍从', nameEn: 'Page', slug: 'page', num: 11, keywords: ['消息', '学习', '好奇'] },
  knight: { name: '骑士', nameEn: 'Knight', slug: 'knight', num: 12, keywords: ['行动', '追求', '变化'] },
  queen:  { name: '王后', nameEn: 'Queen', slug: 'queen', num: 13, keywords: ['智慧', '关怀', '直觉'] },
  king:   { name: '国王', nameEn: 'King', slug: 'king', num: 14, keywords: ['权威', '掌控', '成熟'] },
} as const

const RANK_MESSAGES: Record<string, { upright: string; reversed: string }> = {
  ace:    { upright: '新的机会正在出现。把握当下，勇敢迈出第一步。', reversed: '机会可能被错过，或你还没准备好迎接它。' },
  two:    { upright: '面临重要选择。权衡利弊，相信直觉。', reversed: '犹豫不决可能让你错失良机。' },
  three:  { upright: '合作带来成长。与他人携手，创造更大价值。', reversed: '团队合作可能出现摩擦，需要沟通。' },
  four:   { upright: '享受当下的稳定。适当休息，为下一步积蓄力量。', reversed: '可能过于安逸，需要打破舒适区。' },
  five:   { upright: '挑战带来成长。面对困难，你会变得更强大。', reversed: '冲突可能正在消耗你的精力。寻找和解之道。' },
  six:    { upright: '和谐与平衡。给予和接受之间找到美好平衡。', reversed: '付出与回报可能不对等。重新审视关系。' },
  seven:  { upright: '深入反思。表面之下有更深层的真相等待发现。', reversed: '可能在逃避现实。勇敢面对内心的声音。' },
  eight:  { upright: '快速行动的时机。保持专注，持续推进。', reversed: '可能行动过快或方向不对。慢下来重新规划。' },
  nine:   { upright: '接近完成。你的努力即将收获丰硕成果。', reversed: '可能感到不满足或缺少什么。审视真正的需要。' },
  ten:    { upright: '一个周期即将结束。庆祝成就，准备新的开始。', reversed: '负担过重。学会放手，不必独自承担一切。' },
  page:   { upright: '好消息即将到来。保持好奇心和学习态度。', reversed: '可能缺乏经验或方向。多学习，少冲动。' },
  knight: { upright: '勇往直前的时刻。大胆行动，追求目标。', reversed: '可能过于冲动或鲁莽。三思而后行。' },
  queen:  { upright: '用智慧和关怀处理事务。信任你的直觉。', reversed: '可能过于情绪化或忽视理性。寻找平衡。' },
  king:   { upright: '展现领导力和掌控力。你的经验是宝贵财富。', reversed: '可能过于专制或固执。倾听他人意见。' },
}

// Generate full Minor Arcana
function generateMinorArcana(): TarotCard[] {
  const cards: TarotCard[] = []
  const suits = Object.entries(SUIT_DATA) as [
    TarotSuit,
    (typeof SUIT_DATA)[TarotSuit],
  ][]
  const ranks = Object.entries(RANK_DATA)
  let number = 22 // Start after Major Arcana

  for (const [suitKey, suit] of suits) {
    for (const [rankKey, rank] of ranks) {
      const messages = RANK_MESSAGES[rankKey]
      cards.push({
        number,
        name: `${suit.name}${rank.name}`,
        nameEn: `${rank.nameEn} of ${suit.nameEn}`,
        emoji: suit.emoji,
        suit: suitKey,
        keywords: [...rank.keywords, suit.theme.split('/')[0]],
        upright: `${suit.theme.split('/')[0]}/${rank.keywords.join('/')}`,
        reversed: `阻碍/延迟/失衡`,
        uprightMessage: messages.upright,
        reversedMessage: messages.reversed,
      })
      number++
    }
  }

  return cards
}

export const MINOR_ARCANA: TarotCard[] = generateMinorArcana()

// ── 全部 78 张 ──────────────────────────────────────────

export const ALL_CARDS: TarotCard[] = [...MAJOR_ARCANA, ...MINOR_ARCANA]

// ── 显示标签与图片路径 ─────────────────────────────────────

export function getCardDisplayNumber(card: TarotCard): string {
  if (card.number <= 21) return MAJOR_ROMAN[card.number]
  const rankIndex = (card.number - 22) % 14
  return Object.values(RANK_DATA)[rankIndex].name
}

export function getCardImagePaths(card: TarotCard): { webp: string; svg: string } {
  let baseName: string

  if (card.number <= 21) {
    baseName = `tarot_${String(card.number).padStart(2, '0')}_${MAJOR_META[card.number][1]}`
  } else {
    if (!card.suit) throw new Error(`Minor Arcana card ${card.number} has no suit`)
    const rankIndex = (card.number - 22) % 14
    const rank = Object.values(RANK_DATA)[rankIndex]
    baseName = `tarot_${card.suit}_${rank.slug}`
  }

  const root = `/assets/tarot/cards/${baseName}`
  return { webp: `${root}.webp`, svg: `${root}.svg` }
}

export function getCardImagePath(card: TarotCard): string {
  return getCardImagePaths(card).svg
}
