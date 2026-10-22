// Generates samples/hud.json, the heavier sample template (status card with icons, gauges and a repeated
// party list). Run: node scripts/build-hud.mjs
import { writeFileSync } from 'node:fs';

const TEAL = '#5fd0c0', LINE = '#2c3a52', INK = '#e8eef7', MUTE = '#8b98ad', NAVY = '#141a26';
const T = (x, y, text, o = {}) => ({ type: 'text', x, y, text, size: 16, fill: INK, w: 200, h: 24, ...o });
const card = (name, x, y, w, h) => ({ type: 'shape', name, x, y, w, h, radius: 14, fill: '#1a2233', stroke: LINE, strokeWidth: 1.5 });
const gauge = (label, p, y, fill) => [
  T(384, y, label, { size: 15, fill: MUTE, w: 80 }),
  T(384, y, `{${p}}/100`, { size: 15, w: 612, align: 'right' }),
  { type: 'bar', name: `${label} 게이지`, x: 384, y: y + 26, w: 612, h: 12, radius: 6, value: p, max: 100, track: '#0c111b', fill },
];
const CLASSES = ['none', '전사', '마법사', '궁수', '사제'];

const member = {
  type: 'group', name: '파티원', x: 0, y: 0, children: [
    { type: 'shape', x: 0, y: 0, w: 192, h: 84, radius: 12, fill: '#212b40', stroke: LINE, strokeWidth: 1 },
    T(12, 6, '#$i', { size: 12, fill: MUTE, w: 40, h: 18 }),
    { type: 'group', name: '있을 때', when: { param: 'p$i', ne: 'none' }, children: [
      { type: 'image', asset: 'shield', x: 12, y: 34, w: 32, h: 32 },
      T(52, 28, '{p$i}', { size: 16, weight: 700, fill: TEAL, w: 130, h: 22 }),
      T(52, 52, '{p$in|or:이름 없음}', { size: 16, w: 130, h: 24, maxWidth: 130 }),
    ] },
    T(12, 36, '빈 자리', { name: '없을 때', when: { param: 'p$i', eq: 'none' }, size: 18, fill: MUTE, w: 170, h: 28 }),
  ],
};

const spec = {
  canvas: { w: 1040, h: 500, background: NAVY },
  params: {
    name: { type: 'text', default: '도키', maxLength: 12, alias: ['u'], desc: '캐릭터 이름' },
    title: { type: 'text', default: '', maxLength: 16, desc: '칭호' },
    level: { type: 'number', default: 1, min: 1, max: 99, desc: '레벨' },
    gold: { type: 'number', default: 0, min: 0, max: 9999999, desc: '가진 돈' },
    place: { type: 'text', default: '', maxLength: 16, desc: '지금 있는 곳' },
    hp: { type: 'number', default: 100, min: 0, max: 100, alias: ['health'], desc: '체력 %' },
    mp: { type: 'number', default: 100, min: 0, max: 100, desc: '마나 %' },
    exp: { type: 'number', default: 0, min: 0, max: 100, desc: '경험치 %' },
    p1: { type: 'enum', options: CLASSES, default: 'none', desc: '동료 1 직업' },
    p2: { type: 'enum', options: CLASSES, default: 'none', desc: '동료 2 직업' },
    p3: { type: 'enum', options: CLASSES, default: 'none', desc: '동료 3 직업' },
    p1n: { type: 'text', default: '', maxLength: 10, desc: '동료 1 이름' },
    p2n: { type: 'text', default: '', maxLength: 10, desc: '동료 2 이름' },
    p3n: { type: 'text', default: '', maxLength: 10, desc: '동료 3 이름' },
    quest: { type: 'text', default: '', maxLength: 40, desc: '진행 중인 의뢰' },
  },
  assets: { coin: 'icon-coin.svg', pin: 'icon-pin.svg', shield: 'icon-shield.svg' },
  elements: [
    { type: 'shape', name: '바탕', x: 0, y: 0, w: 1040, h: 500, radius: 20, fill: { gradient: ['#1d2638', '#121722'] }, stroke: TEAL, strokeWidth: 2 },
    // left: profile
    card('프로필 카드', 20, 20, 320, 460),
    { type: 'shape', name: '엠블럼', shape: 'ellipse', x: 120, y: 44, w: 120, h: 120, fill: { gradient: ['#2f6f78', '#1b3440'] }, stroke: TEAL, strokeWidth: 2 },
    { type: 'image', asset: 'shield', x: 150, y: 74, w: 60, h: 60 },
    T(40, 180, '{name}', { size: 30, weight: 700, w: 280, h: 42, align: 'center', maxWidth: 280 }),
    T(40, 224, '{title|or:떠돌이 모험가}', { size: 16, fill: TEAL, w: 280, align: 'center' }),
    { type: 'shape', name: '레벨 알약', x: 130, y: 258, w: 100, h: 30, radius: 15, fill: TEAL },
    T(130, 258, 'Lv.{level}', { size: 15, weight: 700, fill: NAVY, w: 100, h: 30, align: 'center' }),
    { type: 'shape', name: '구분선', shape: 'line', x: 40, y: 312, w: 280, h: 0, stroke: LINE, strokeWidth: 1 },
    { type: 'image', asset: 'coin', x: 48, y: 332, w: 28, h: 28 },
    T(86, 332, '{gold|comma} G', { size: 20, w: 230, h: 28 }),
    { type: 'image', asset: 'pin', x: 48, y: 378, w: 28, h: 28 },
    T(86, 378, '{place|or:알 수 없는 곳}', { size: 18, w: 230, h: 28, maxWidth: 230 }),
    T(48, 426, '상태', { size: 15, fill: MUTE, w: 60, h: 30 }),
    T(110, 422, { steps: 'hp', stops: [{ gte: 60, value: '양호' }, { gte: 30, value: '주의' }], default: '위험' }, {
      size: 24, weight: 700, w: 200, h: 36,
      fill: { steps: 'hp', stops: [{ gte: 60, value: '#7be0a0' }, { gte: 30, value: '#f2c14e' }], default: '#ff6b6b' },
    }),
    // right top: gauges
    card('능력치 카드', 360, 20, 660, 200),
    T(384, 32, '능력치', { size: 18, weight: 700, fill: TEAL, w: 200, h: 30 }),
    ...gauge('HP', 'hp', 72, { steps: 'hp', stops: [{ gte: 60, value: '#4fbf5a' }, { gte: 30, value: '#e0b13c' }], default: '#d6483f' }),
    ...gauge('MP', 'mp', 120, '#5b8def'),
    ...gauge('EXP', 'exp', 168, { gradient: ['#b28dff', '#7b5cff'], dir: 'h' }),
    // right middle: party
    card('파티 카드', 360, 236, 660, 150),
    T(384, 248, '파티', { size: 18, weight: 700, fill: TEAL, w: 200, h: 30 }),
    { type: 'repeat', name: '파티원 3칸', x: 384, y: 288, dx: 210, count: 3, children: [member] },
    // right bottom: quest
    card('의뢰 카드', 360, 402, 660, 78),
    T(384, 412, '진행 중인 의뢰', { size: 15, fill: TEAL, w: 200 }),
    T(384, 436, '{quest|or:없음}', { size: 20, w: 612, h: 32, maxWidth: 612 }),
  ],
};
writeFileSync(new URL('../samples/hud.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
console.log('wrote samples/hud.json');
