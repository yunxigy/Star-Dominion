import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'assets', 'tarot', 'cards');

const STYLE_PROMPT = [
  'Ornate occult tarot card illustration, mysterious and richly layered.',
  'Warm antique palette, deep burgundy, umber, bronze gold, smoky teal, parchment highlights.',
  'Complex celestial geometry, astrological circles, sigils, constellation lines, engraved border.',
  'Center symbol should be iconic and readable, surrounded by ritual details and subtle texture.',
  'No photorealism, no modern UI, no plain flat icon, no empty background.',
].join(' ');

const major = [
  [0, '0', 'fool', 'The Fool', 'wandering cliff', 'path', ['#6d4434', '#d9b86f', '#47746a']],
  [1, 'I', 'magician', 'The Magician', 'altar and infinity', 'infinity', ['#823b33', '#e2b75d', '#315b66']],
  [2, 'II', 'high_priestess', 'The High Priestess', 'moon veil', 'moon', ['#263b70', '#d7c6f0', '#7f659e']],
  [3, 'III', 'empress', 'The Empress', 'garden crown', 'flower', ['#8b5339', '#d9b66f', '#58774e']],
  [4, 'IV', 'emperor', 'The Emperor', 'stone throne', 'mountain', ['#773329', '#d2a456', '#46454c']],
  [5, 'V', 'hierophant', 'The Hierophant', 'temple keys', 'keys', ['#5e3866', '#e1c17b', '#365a50']],
  [6, 'VI', 'lovers', 'The Lovers', 'paired stars', 'heart', ['#a8445d', '#f0bd9c', '#637f74']],
  [7, 'VII', 'chariot', 'The Chariot', 'moon chariot', 'chariot', ['#263d68', '#c8a65b', '#87373a']],
  [8, 'VIII', 'strength', 'Strength', 'lion sun', 'lion', ['#9c6630', '#f0cf7b', '#5f653d']],
  [9, 'IX', 'hermit', 'The Hermit', 'lantern peak', 'lantern', ['#344b54', '#d9c589', '#6f5335']],
  [10, 'X', 'wheel_of_fortune', 'Wheel of Fortune', 'turning wheel', 'wheel', ['#58407c', '#d6a84c', '#2f7066']],
  [11, 'XI', 'justice', 'Justice', 'scales sword', 'scales', ['#65313a', '#d3b46e', '#3e5870']],
  [12, 'XII', 'hanged_man', 'The Hanged Man', 'suspended halo', 'halo', ['#315b63', '#d5b05f', '#74503a']],
  [13, 'XIII', 'death', 'Death', 'white rose', 'rose', ['#2b2b33', '#e8e0c7', '#7f3942']],
  [14, 'XIV', 'temperance', 'Temperance', 'two cups river', 'temperance', ['#4f7881', '#e3bd73', '#81618f']],
  [15, 'XV', 'devil', 'The Devil', 'shadow torch', 'flame', ['#3a1e24', '#c05c32', '#765a3d']],
  [16, 'XVI', 'tower', 'The Tower', 'lightning tower', 'tower', ['#29324e', '#d09b42', '#923b32']],
  [17, 'XVII', 'star', 'The Star', 'eight point star', 'star', ['#2c5f7a', '#d8c27a', '#6f9d8b']],
  [18, 'XVIII', 'moon', 'The Moon', 'moon gate', 'moonpath', ['#293c6f', '#d6c6a5', '#6a5b8c']],
  [19, 'XIX', 'sun', 'The Sun', 'radiant sun', 'sun', ['#c4742d', '#f2d36b', '#687f4e']],
  [20, 'XX', 'judgement', 'Judgement', 'trumpet dawn', 'trumpet', ['#674b78', '#e0bc73', '#4d7980']],
  [21, 'XXI', 'world', 'The World', 'cosmic wreath', 'wreath', ['#32695f', '#d8b663', '#824f6d']],
].map(([n, roman, slug, title, symbol, motif, palette]) => ({ n, roman, slug, title, symbol, motif, palette }));

const suits = [
  { slug: 'wands', title: 'Wands', palette: ['#833c2f', '#e0a84f', '#554b32'] },
  { slug: 'cups', title: 'Cups', palette: ['#315f78', '#d4b66c', '#6f5b91'] },
  { slug: 'swords', title: 'Swords', palette: ['#374d68', '#c9d2d7', '#8b5f54'] },
  { slug: 'pentacles', title: 'Pentacles', palette: ['#476a48', '#d0ad57', '#785c37'] },
];

const ranks = [
  ['ace', 'Ace', 'A', 1],
  ['two', 'Two', 'II', 2],
  ['three', 'Three', 'III', 3],
  ['four', 'Four', 'IV', 4],
  ['five', 'Five', 'V', 5],
  ['six', 'Six', 'VI', 6],
  ['seven', 'Seven', 'VII', 7],
  ['eight', 'Eight', 'VIII', 8],
  ['nine', 'Nine', 'IX', 9],
  ['ten', 'Ten', 'X', 10],
  ['page', 'Page', 'P', 4, 'page'],
  ['knight', 'Knight', 'N', 4, 'knight'],
  ['queen', 'Queen', 'Q', 4, 'queen'],
  ['king', 'King', 'K', 4, 'king'],
];

const minor = suits.flatMap(suit =>
  ranks.map(([slug, title, roman, count, court]) => ({
    roman,
    slug: `${suit.slug}_${slug}`,
    file: `tarot_${suit.slug}_${slug}.svg`,
    title: `${title} of ${suit.title}`,
    symbol: `${title} of ${suit.title}`,
    motif: 'minor',
    suit: suit.slug,
    count,
    court,
    palette: suit.palette,
  }))
);

const allCards = [...major, ...minor];

const esc = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function hash(input) {
  let h = 2166136261;
  for (const ch of String(input)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    return ((s >>> 0) / 4294967296);
  };
}

function arcaneBackdrop(card) {
  const r = rand(hash(card.slug));
  const dots = Array.from({ length: 30 }, (_, i) => {
    const x = 100 + r() * 440;
    const y = 165 + r() * 560;
    const size = 1.5 + r() * 3.5;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="#fff0ca" opacity="${(0.18 + r() * 0.48).toFixed(2)}"/>`;
  }).join('');

  const lines = Array.from({ length: 18 }, () => {
    const x1 = 120 + r() * 400;
    const y1 = 180 + r() * 520;
    const x2 = 120 + r() * 400;
    const y2 = 180 + r() * 520;
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#fff0ca" stroke-width=".8" opacity=".16"/>`;
  }).join('');

  const rings = [88, 126, 176, 222].map((radius, i) =>
    `<circle cx="320" cy="430" r="${radius}" fill="none" stroke="#fff0ca" stroke-width="${i === 1 ? 2 : 1}" opacity="${0.16 + i * 0.05}"/>`
  ).join('');

  const ticks = Array.from({ length: 36 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 36;
    const x1 = 320 + Math.cos(angle) * 198;
    const y1 = 430 + Math.sin(angle) * 198;
    const x2 = 320 + Math.cos(angle) * (i % 3 === 0 ? 218 : 208);
    const y2 = 430 + Math.sin(angle) * (i % 3 === 0 ? 218 : 208);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#fff0ca" stroke-width="${i % 3 === 0 ? 2 : 1}" opacity=".32"/>`;
  }).join('');

  return `<g opacity=".95">${rings}${ticks}${lines}${dots}</g>`;
}

function ornateBorder(b) {
  return `<g fill="none" stroke="${b}" stroke-linecap="round" stroke-linejoin="round">
    <rect x="34" y="34" width="572" height="892" rx="30" stroke-width="4" opacity=".62"/>
    <rect x="56" y="56" width="528" height="848" rx="22" stroke-width="1.5" opacity=".56"/>
    <rect x="78" y="78" width="484" height="804" rx="14" stroke-width="1" opacity=".34"/>
    <path d="M112 132h118M410 132h118M112 828h118M410 828h118" stroke-width="2" opacity=".55"/>
    <path d="M112 132c30 28 58 28 88 0M440 132c30 28 58 28 88 0M112 828c30-28 58-28 88 0M440 828c30-28 58-28 88 0" stroke-width="2" opacity=".48"/>
    <path d="M92 230c40-52 40-100 0-152M548 230c-40-52-40-100 0-152M92 730c40 52 40 100 0 152M548 730c-40 52-40 100 0 152" stroke-width="2.5" opacity=".42"/>
  </g>`;
}

function mainMotif(card) {
  const [a, b, c] = card.palette;
  const common = `fill="none" stroke="${b}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"`;
  const thin = `fill="none" stroke="${b}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".86"`;

  switch (card.motif) {
    case 'path':
      return `<path ${common} d="M218 604c-34-78-12-152 56-204 46-34 64-72 45-120"/><circle cx="320" cy="276" r="50" fill="${b}" opacity=".88"/><path ${thin} d="M348 344c44 18 78 56 92 112M280 374c-52 22-88 64-108 124M234 622h174"/>`;
    case 'infinity':
      return `<path ${common} d="M172 386c48-78 108-78 148 0s100 78 148 0-108-78-148 0-100 78-148 0Z"/><path ${thin} d="M320 250v265M230 520h180M260 220h120M244 584h152"/>`;
    case 'moon':
      return `<path fill="${b}" opacity=".92" d="M370 226c-72 48-88 152-28 222 36 42 88 60 138 52-80 66-206 48-264-40-58-88-24-206 80-244 28-10 54-8 74 10Z"/><path ${thin} d="M188 238v356M452 238v356M230 320h180M230 492h180M248 590h144"/>`;
    case 'flower':
      return `<circle cx="320" cy="386" r="52" fill="${b}" opacity=".95"/><g fill="${a}" opacity=".84"><ellipse cx="320" cy="276" rx="38" ry="86"/><ellipse cx="320" cy="496" rx="38" ry="86"/><ellipse cx="210" cy="386" rx="86" ry="38"/><ellipse cx="430" cy="386" rx="86" ry="38"/><ellipse cx="242" cy="308" rx="34" ry="72" transform="rotate(-45 242 308)"/><ellipse cx="398" cy="308" rx="34" ry="72" transform="rotate(45 398 308)"/><ellipse cx="242" cy="464" rx="34" ry="72" transform="rotate(45 242 464)"/><ellipse cx="398" cy="464" rx="34" ry="72" transform="rotate(-45 398 464)"/></g><path ${thin} d="M320 438c-16 92-62 144-144 158M322 438c26 84 78 130 160 148"/>`;
    case 'mountain':
      return `<path fill="${c}" opacity=".96" d="M116 582 266 308l88 148 68-112 108 238H116Z"/><path ${thin} d="M266 308 314 456h40M422 344l-34 112h70M250 590h144"/><rect x="236" y="210" width="168" height="104" rx="18" fill="${b}" opacity=".82"/><path ${thin} d="M268 244h104M286 278h68"/>`;
    case 'keys':
      return `<path ${common} d="M256 510 412 354M386 326a60 60 0 1 0 84 84 60 60 0 0 0-84-84Z"/><path ${common} d="M384 510 228 354M254 326a60 60 0 1 1-84 84 60 60 0 0 1 84-84Z"/><path ${thin} d="M320 202v328M256 250h128M286 596h68"/>`;
    case 'heart':
      return `<path fill="${b}" opacity=".9" d="M320 538S176 450 176 322c0-58 40-98 92-98 31 0 51 14 52 42 1-28 21-42 52-42 52 0 92 40 92 98 0 128-144 216-144 216Z"/><path ${thin} d="M216 582h208M266 250c-58 42-78 102-55 160M374 250c58 42 78 102 55 160"/>`;
    case 'chariot':
      return `<circle cx="218" cy="532" r="56" ${common}/><circle cx="422" cy="532" r="56" ${common}/><path ${common} d="M184 424h272l-44-120H228l-44 120Z"/><path ${thin} d="M320 210v94M248 304l-40-66M392 304l40-66M240 424h160"/>`;
    case 'lion':
      return `<circle cx="320" cy="344" r="106" fill="${b}" opacity=".92"/><circle cx="278" cy="336" r="11" fill="${c}"/><circle cx="362" cy="336" r="11" fill="${c}"/><path ${thin} d="M286 402c26 22 42 22 68 0M216 290c-28-48-20-88 26-120M424 290c28-48 20-88-26-120"/><path ${common} d="M236 572c56-64 112-64 168 0"/>`;
    case 'lantern':
      return `<path ${common} d="M320 198v116M266 342h108l-18 164h-72l-18-164Z"/><circle cx="320" cy="426" r="38" fill="${b}" opacity=".92"/><path ${thin} d="M180 596c66-96 136-154 222-198M230 642h226M280 314h80"/>`;
    case 'wheel':
      return `<circle cx="320" cy="402" r="138" ${common}/><circle cx="320" cy="402" r="44" ${common}/><path ${thin} d="M320 264v276M182 402h276M222 304l196 196M418 304 222 500"/><path ${thin} d="M320 196v44M320 564v44M136 402h44M460 402h44"/>`;
    case 'scales':
      return `<path ${common} d="M320 210v370M226 276h188M238 276l-76 154h152l-76-154ZM402 276l-76 154h152l-76-154Z"/><path ${thin} d="M248 582h144M286 210h68M210 622h220"/>`;
    case 'halo':
      return `<circle cx="320" cy="246" r="66" ${common}/><path ${common} d="M320 312v236M238 392h164M280 548l-58 90M360 548l58 90"/><path ${thin} d="M218 212h204M240 660h160"/>`;
    case 'rose':
      return `<path fill="${b}" opacity=".93" d="M320 288c56 32 84 76 84 130 0 58-38 102-84 102s-84-44-84-102c0-54 28-98 84-130Z"/><path ${thin} d="M320 520v128M320 562c-62-36-110-28-142 30M322 560c62-38 112-30 148 28M274 394c32-46 60-48 92 0"/>`;
    case 'temperance':
      return `<path ${common} d="M202 262h110c0 84-18 132-55 148-37-16-55-64-55-148ZM328 490h110c0 84-18 132-55 148-37-16-55-64-55-148Z"/><path ${thin} d="M257 410v72M383 436v72M276 482c44-24 74-24 108 0M238 670h168"/>`;
    case 'flame':
      return `<path fill="${b}" opacity=".92" d="M322 586c-66-46-88-106-64-176 14-42 48-82 102-124-8 58 20 84 52 128 46 62 20 140-90 172Z"/><path fill="${a}" opacity=".72" d="M316 532c-32-42-24-82 22-122 6 46 48 64 32 114-8 26-32 34-54 8Z"/><path ${thin} d="M210 226c74 54 146 54 220 0M240 634h160"/>`;
    case 'tower':
      return `<path fill="${c}" opacity=".96" d="M244 628h152l-30-304h-92l-30 304Z"/><path fill="${b}" opacity=".96" d="m342 156-82 140h74l-36 128 98-164h-76l22-104Z"/><path ${thin} d="M276 326h88M270 442h100M264 560h112M238 628h164"/>`;
    case 'star':
      return `<path fill="${b}" opacity=".96" d="m320 190 38 122 122-37-86 92 86 92-122-37-38 122-38-122-122 37 86-92-86-92 122 37 38-122Z"/><path ${thin} d="M230 604c54-42 112-42 174 0M186 528c26-20 54-20 84 0M394 528c26-20 54-20 84 0"/>`;
    case 'moonpath':
      return `<path fill="${b}" opacity=".92" d="M384 200c-58 38-70 122-22 174 30 32 70 46 110 40-62 52-160 38-204-28-46-70-18-164 64-194 22-8 40-6 52 8Z"/><path ${thin} d="M194 594c42-76 84-114 126-114s84 38 126 114M206 452h228M242 520h156"/>`;
    case 'sun':
      return `<circle cx="320" cy="376" r="98" fill="${b}" opacity=".96"/><g ${thin}><path d="M320 178v96M320 478v96M122 376h96M422 376h96M180 236l68 68M392 448l68 68M460 236l-68 68M248 448l-68 68"/></g><path ${thin} d="M284 390c24 24 48 24 72 0M236 604h168"/>`;
    case 'trumpet':
      return `<path fill="${b}" opacity=".93" d="M236 338h120l96-58v214l-96-58H236V338Z"/><path ${common} d="M236 338v98M196 362c-38 30-38 54 0 84M320 202v82M256 220l36 62M384 220l-36 62"/><path ${thin} d="M258 620h124"/>`;
    case 'wreath':
      return `<ellipse cx="320" cy="404" rx="146" ry="184" ${common}/><path ${thin} d="M210 280c42 32 58 64 50 94M430 280c-42 32-58 64-50 94M210 526c42-32 58-64 50-94M430 526c-42-32-58-64-50-94"/><circle cx="320" cy="404" r="58" fill="${b}" opacity=".9"/>`;
    case 'minor':
      return minorMotif(card, a, b, c, common, thin);
    default:
      return `<circle cx="320" cy="402" r="122" ${common}/>`;
  }
}

function minorMotif(card, a, b, c, common, thin) {
  const points = [
    [320, 276], [238, 350], [402, 350], [198, 454], [320, 454],
    [442, 454], [238, 564], [402, 564], [292, 652], [348, 652],
  ];
  const pip = (x, y, i) => {
    if (card.suit === 'wands') {
      return `<g transform="translate(${x} ${y}) rotate(${i % 2 ? 18 : -18})"><path d="M0-38v76" stroke="${b}" stroke-width="12" stroke-linecap="round"/><path d="M0-18c18-14 32-14 46 0" stroke="${a}" stroke-width="5" stroke-linecap="round"/></g>`;
    }
    if (card.suit === 'cups') {
      return `<g transform="translate(${x} ${y})"><path d="M-32-26h64c0 52-12 80-32 90-20-10-32-38-32-90Z" fill="${b}" opacity=".94"/><path d="M-24-26c10-20 38-20 48 0" fill="none" stroke="${b}" stroke-width="7" stroke-linecap="round"/></g>`;
    }
    if (card.suit === 'swords') {
      return `<g transform="translate(${x} ${y}) rotate(${i % 2 ? 9 : -9})"><path d="M0-54v108" stroke="${b}" stroke-width="8" stroke-linecap="round"/><path d="M-30 20h60" stroke="${b}" stroke-width="7" stroke-linecap="round"/><path d="M0-66-16-32h32Z" fill="${b}"/></g>`;
    }
    return `<g transform="translate(${x} ${y})"><circle r="36" fill="${b}" opacity=".94"/><path d="m0-26 8 20h22L12 7l7 22L0 16l-19 13 7-22-18-13h22Z" fill="${a}" opacity=".88"/></g>`;
  };

  const court = {
    page: `<path ${common} d="M260 594h120M286 594l-20-160h108l-20 160M320 282v152"/><circle cx="320" cy="240" r="52" fill="${b}" opacity=".88"/><path ${thin} d="M244 636h152"/>`,
    knight: `<path ${common} d="M204 602c40-112 110-164 214-158 30 36 26 84-12 146"/><path ${thin} d="M260 386c42-62 96-88 162-80M202 622h244"/>`,
    queen: `<path ${common} d="M236 604h168l-34-176H270l-34 176Z"/><path fill="${b}" opacity=".9" d="M250 280h140l-32 96h-76l-32-96Z"/><circle cx="320" cy="232" r="44" fill="${b}" opacity=".92"/>`,
    king: `<path ${common} d="M228 612h184l-26-204H254l-26 204Z"/><path fill="${b}" opacity=".92" d="m248 304 46-76 26 62 26-62 46 76H248Z"/><path ${thin} d="M282 410h76M320 304v218"/>`,
  };

  if (card.court) return court[card.court];
  return points.slice(0, card.count).map((point, i) => pip(point[0], point[1], i)).join('');
}

function cardSvg(card) {
  const [a, b, c] = card.palette;
  const title = esc(card.title);
  const roman = esc(card.roman);
  const symbol = esc(card.symbol).toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1152" viewBox="0 0 640 960" role="img" aria-label="${title} tarot card">
  <desc>${esc(STYLE_PROMPT)}</desc>
  <defs>
    <linearGradient id="bg-${card.slug}" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#1e1516"/>
      <stop offset=".24" stop-color="${c}"/>
      <stop offset=".52" stop-color="${a}"/>
      <stop offset=".78" stop-color="#342019"/>
      <stop offset="1" stop-color="#111516"/>
    </linearGradient>
    <radialGradient id="glow-${card.slug}" cx="50%" cy="38%" r="64%">
      <stop offset="0" stop-color="${b}" stop-opacity=".62"/>
      <stop offset=".45" stop-color="${b}" stop-opacity=".16"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain-${card.slug}">
      <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${hash(card.slug) % 97}" result="noise"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 .11"/>
      </feComponentTransfer>
    </filter>
    <filter id="shadow-${card.slug}" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#130c08" flood-opacity=".52"/>
    </filter>
  </defs>

  <rect width="640" height="960" rx="42" fill="#1a1110"/>
  <rect x="24" y="24" width="592" height="912" rx="34" fill="url(#bg-${card.slug})"/>
  <rect x="24" y="24" width="592" height="912" rx="34" filter="url(#grain-${card.slug})"/>
  <circle cx="320" cy="424" r="268" fill="url(#glow-${card.slug})"/>
  ${ornateBorder(b)}
  ${arcaneBackdrop(card)}

  <g opacity=".28" stroke="#fff0ca" stroke-width="1" fill="none">
    <path d="M104 156C180 112 260 112 320 156s140 44 216 0"/>
    <path d="M104 804c76 44 156 44 216 0s140-44 216 0"/>
    <path d="M150 230c-28 110-28 286 0 396M490 230c28 110 28 286 0 396"/>
  </g>

  <g filter="url(#shadow-${card.slug})">${mainMotif(card)}</g>

  <g fill="${b}" opacity=".86">
    <circle cx="102" cy="102" r="8"/><circle cx="538" cy="102" r="8"/><circle cx="102" cy="858" r="8"/><circle cx="538" cy="858" r="8"/>
    <path d="m320 94 10 20 22 3-16 16 4 22-20-10-20 10 4-22-16-16 22-3Z"/>
    <path d="m320 806 10 20 22 3-16 16 4 22-20-10-20 10 4-22-16-16 22-3Z"/>
  </g>

  <text x="320" y="126" text-anchor="middle" fill="#fff2cf" font-size="36" font-family="Georgia, 'Times New Roman', serif" letter-spacing="5">${roman}</text>
  <text x="320" y="794" text-anchor="middle" fill="#fff2cf" font-size="${title.length > 18 ? 31 : 39}" font-family="Georgia, 'Times New Roman', serif" font-weight="700">${title}</text>
  <text x="320" y="842" text-anchor="middle" fill="#f5d59d" opacity=".72" font-size="17" font-family="Georgia, serif" letter-spacing="2.8">${symbol}</text>
</svg>`;
}

function backSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1152" viewBox="0 0 640 960" role="img" aria-label="Tarot card back">
  <desc>${esc(STYLE_PROMPT)}</desc>
  <defs>
    <linearGradient id="back-bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#27151b"/><stop offset=".35" stop-color="#814722"/><stop offset=".7" stop-color="#24372e"/><stop offset="1" stop-color="#151516"/>
    </linearGradient>
    <radialGradient id="back-glow" cx="50%" cy="48%" r="62%">
      <stop offset="0" stop-color="#f2d6a0" stop-opacity=".48"/><stop offset=".58" stop-color="#f2d6a0" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="back-grain">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="29"/>
      <feComponentTransfer><feFuncA type="table" tableValues="0 .12"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="640" height="960" rx="42" fill="#1a1110"/>
  <rect x="24" y="24" width="592" height="912" rx="34" fill="url(#back-bg)"/>
  <rect x="24" y="24" width="592" height="912" rx="34" filter="url(#back-grain)"/>
  <circle cx="320" cy="480" r="274" fill="url(#back-glow)"/>
  ${ornateBorder('#f1dcc2')}
  <g fill="none" stroke="#fff0cb" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="320" cy="480" r="188" stroke-width="8" opacity=".78"/>
    <circle cx="320" cy="480" r="128" stroke-width="3" opacity=".54"/>
    <circle cx="320" cy="480" r="66" stroke-width="3" opacity=".42"/>
    <path d="M320 226v508M66 480h508M140 300l360 360M500 300 140 660" stroke-width="2" opacity=".32"/>
    <path d="m320 312 42 122 130 2-104 78 38 126-106-74-106 74 38-126-104-78 130-2 42-122Z" stroke-width="9" opacity=".9"/>
    <path d="M214 480c54-72 158-72 212 0-54 72-158 72-212 0Z" stroke-width="5" opacity=".66"/>
  </g>
  <text x="320" y="792" text-anchor="middle" fill="#fff2cf" font-size="34" font-family="Georgia, serif" letter-spacing="6">TAROT</text>
</svg>`;
}

await mkdir(outDir, { recursive: true });

for (const card of allCards) {
  const file = card.file || `tarot_${String(card.n).padStart(2, '0')}_${card.slug}.svg`;
  await writeFile(join(outDir, file), cardSvg(card), 'utf8');
}

await writeFile(join(outDir, 'tarot_back.svg'), backSvg(), 'utf8');
console.log(`Generated ${allCards.length + 1} ornate tarot assets in ${outDir}`);
