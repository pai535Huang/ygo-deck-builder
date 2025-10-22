import { renderDecks } from './ui.js';
import { getForbiddenLabelForCard } from './search.js';

function safeAlert(message, type) {
  try {
    if (typeof window !== 'undefined' && typeof window.notify === 'function') {
      window.notify(String(message || ''), type === 'error' ? 'error' : 'success');
      return;
    }
  } catch (_) {}
  // 本地最简 Toast 兜底，避免阻塞性 alert
  try {
    const ensureContainer = () => {
      let c = document.querySelector('.ygotoast-container');
      if (!c) {
        c = document.createElement('div');
        c.className = 'ygotoast-container';
        (document.body || document.documentElement).appendChild(c);
      }
      return c;
    };
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = 'ygotoast' + (type === 'error' ? ' error' : '');
    el.textContent = String(message || '');
    el.addEventListener('click', () => { try { el.remove(); } catch (_) {} });
    container.appendChild(el);
    setTimeout(() => { try { el.classList.add('hide'); } catch (_) {} }, 2600);
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 3000);
  } catch (_) {
    try { alert(String(message || '')); } catch (_) {}
  }
}

// 卡组数据结构
export const mainDeck = [];
export const extraDeck = [];
export const sideDeck = [];

// 工具：安全获取字符串并判断包含
function has(str, keyword) {
  return String(str || '').includes(keyword);
}

// 提取用于排序的关键属性
function getCardTypeTags(card) {
  const types = (card && card.text && card.text.types) ? card.text.types : '';
  return types;
}

// 判断是否为额外卡组怪兽
function isExtraMonster(card) {
  const t = getCardTypeTags(card);
  return /融合|同调|超量|连接/.test(t);
}

// 大类：主/副卡组中的优先级（怪兽-魔法-陷阱）
function mainSidePrimaryOrder(card) {
  const t = getCardTypeTags(card);
  if (/怪兽/.test(t)) return 0;
  if (/魔法/.test(t)) return 1;
  if (/陷阱/.test(t)) return 2;
  return 9;
}

// 额外卡组内大类（融合-同调-超量-连接）
function extraPrimaryOrder(card) {
  const t = getCardTypeTags(card);
  if (/融合/.test(t)) return 0;
  if (/同调/.test(t)) return 1;
  if (/超量/.test(t)) return 2;
  if (/连接/.test(t)) return 3;
  return 9;
}

// 怪兽子类（通常-效果-灵摆）
function monsterSubOrder(card) {
  const t = getCardTypeTags(card);
  // 先判断是否为灵摆怪兽，使其位于子序最后
  // 新顺序：通常 -> 效果 -> 仪式 -> 灵摆 -> 其他
  if (/通常/.test(t)) return 0;
  // 判定为效果怪兽时排除同时为 仪式 或 灵摆 的卡片
  if (/效果/.test(t) && !(/仪式/.test(t) || /灵摆/.test(t))) return 1;
  if (/仪式/.test(t)) return 2;
  if (/灵摆/.test(t)) return 3;
  return 9;
}

// 魔法子类（通常-速攻-永续-场地）
function spellSubOrder(card) {
  const t = getCardTypeTags(card);
  // 新顺序：通常(仅魔法) -> 仪式 -> 速攻 -> 永续 -> 场地 -> 其他
  // 仅当 types 字符串不包含其他关键词时视为“通常魔法”
  if (/仪式/.test(t)) return 1;
  if (/速攻/.test(t)) return 2;
  if (/永续/.test(t)) return 3;
  if (/场地/.test(t)) return 4;
  // 兜底：当 types 包含“魔法”但不包含上述特殊类型时视为通常魔法
  if (/魔法/.test(t) && !/仪式|速攻|永续|场地/.test(t)) return 0;
  return 9;
}

// 陷阱子类（通常-永续-反击）
function trapSubOrder(card) {
  const t = getCardTypeTags(card);
  if (/永续/.test(t)) return 1;
  if (/反击/.test(t)) return 2;
  // 兜底：通常陷阱
  if (/通常/.test(t) || /陷阱/.test(t)) return 0;
  return 9;
}

// 怪兽等级/星级（降序），如果是连接怪兽则使用连接标记数（升序）
function getMonsterLevel(card) {
  // 优先从搜索结果的 data.level 读取（它包含所有怪兽的星级/阶级/连接标记数），
  // 兼容数字或字符串形式；随后回退到若干常见字段或描述解析。
  const dataLevel = card && card.data && (card.data.level ?? card.data.lvl ?? card.data.rank ?? card.data.rk);
  if (dataLevel != null) {
    const n = Number(dataLevel);
    if (!Number.isNaN(n)) return n;
  }
  // 可能的字段：level、lvl、rank、rk、星级、阶等；优先使用数值字段（包括字符串数字)
  const raw = card && (card.level ?? card.lvl ?? card.rank ?? card.rk);
  if (raw != null) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  const desc = (card && card.text && card.text.desc) ? String(card.text.desc) : '';
  let m = desc.match(/[★☆]\s*(\d{1,2})/);
  if (m) return Number(m[1]);
  m = desc.match(/等级\s*(\d{1,2})/);
  if (m) return Number(m[1]);
  m = desc.match(/阶\s*(\d{1,2})/);
  if (m) return Number(m[1]);
  return 0;
}

function getLinkMarkers(card) {
  const raw = card && (card.linkval || card.link || card.linkvalCount);
  if (typeof raw === 'number') return raw;
  const types = getCardTypeTags(card);
  if (!/连接/.test(types)) return Infinity; // 非连接时用 Infinity，便于按小到大排
  // 尝试从描述解析“连接 数字”或 “LINK-n”
  const desc = (card && card.text && card.text.desc) ? String(card.text.desc) : '';
  let m = desc.match(/LINK[-\s]?(\d+)/i);
  if (m) return Number(m[1]);
  m = desc.match(/连接\s*(\d{1,2})/);
  if (m) return Number(m[1]);
  return Infinity;
}

// 获取怪兽的主要数值：连接怪兽使用连接标记数，否则使用等级；返回数值（默认0）
function getMonsterPrimaryStat(card) {
  // 搜索结果中的 `level` 字段已经包含：
  // - 普通怪兽/效果怪兽的星级
  // - 超量怪兽的阶
  // - 连接怪兽的连接标记数
  // 因此直接使用 getMonsterLevel 返回的数值作为主要比较值。
  const v = getMonsterLevel(card);
  return Number(v) || 0;
}

function byId(card) {
  const id = card && (card.id || card.cid);
  return typeof id === 'number' ? id : Number(id) || 0;
}

function byCidFirst(card) {
  // 对怪兽：优先使用 cid；没有 cid 时回退到 id，保证稳定
  if (card && card.cid != null) return Number(card.cid) || 0;
  if (card && card.id != null) return Number(card.id) || 0;
  return 0;
}

// 主/副卡组排序比较器
function compareMainSide(a, b) {
  const pa = mainSidePrimaryOrder(a);
  const pb = mainSidePrimaryOrder(b);
  // 保证同大类的卡片在一起；若大类不同，使用原先的大类顺序
  if (pa !== pb) return pa - pb;

  // 同大类内按小分类分组（例如：通常怪兽/效果怪兽/灵摆，或速攻魔法/永续魔法等）
  const t = getCardTypeTags(a);
  if (/怪兽/.test(t)) {
    // 先比较怪兽的子类别顺序（通常->效果->仪式->灵摆）
    const sa = monsterSubOrder(a);
    const sb = monsterSubOrder(b);
    if (sa !== sb) return sa - sb;
    // 在子类别相同的情况下，再按 level 降序
    const la = getMonsterLevel(a);
    const lb = getMonsterLevel(b);
    if (la !== lb) return lb - la;
    // level 相同时，把同 id 的卡片放在一起（作为小类内的最终 tie-breaker）
    return byId(a) - byId(b);
  }
  if (/魔法/.test(t)) {
    const sa = spellSubOrder(a);
    const sb = spellSubOrder(b);
    if (sa !== sb) return sa - sb;
    return 0;
  }
  if (/陷阱/.test(t)) {
    const sa = trapSubOrder(a);
    const sb = trapSubOrder(b);
    if (sa !== sb) return sa - sb;
    return 0;
  }
  return 0;
}

// 额外卡组排序比较器
function compareExtra(a, b) {
  const pExtraA = extraPrimaryOrder(a);
  const pExtraB = extraPrimaryOrder(b);
  if (pExtraA !== pExtraB) return pExtraA - pExtraB;
  // 同类内：怪兽子类次序（通常/效果/灵摆），然后等级降序、连接标记升序，最后 id
  // 额外卡组：先按大类（融合/同调/超量/连接），在同一大类内按 level 降序
  const la = getMonsterLevel(a);
  const lb = getMonsterLevel(b);
  if (la !== lb) return lb - la;
  return byId(a) - byId(b);
}

export function sortDecks() {
  try {
    // 主/副卡组：怪兽-魔法-陷阱；子序和等级等
    mainDeck.sort(compareMainSide);
    sideDeck.sort(compareMainSide);
    // 额外卡组：融合-同调-超量-连接；子序和等级等
    extraDeck.sort(compareExtra);
    renderDecks(mainDeck, extraDeck, sideDeck);
    try { if (window.updateGenesysTotal) window.updateGenesysTotal(); } catch (_) {}
  } catch (e) {
    console.error('排序失败:', e);
    alert('整理失败：' + (e && e.message ? e.message : e));
  }
}

// 判断卡片能加入哪些卡组
export function getCardGroups(card) {
  const types = card.text.types || '';
  if (/融合|同调|超量|连接/.test(types)) {
    return ['extra', 'side'];
  } else if (/怪兽/.test(types)) {
    return ['main', 'side'];
  } else {
    return ['main', 'side'];
  }
}

// 统计卡组中同名卡数量
export function countCardInDecks(card) {
  const id = card.id;
  let count = 0;
  count += mainDeck.filter(c => c.id === id).length;
  count += extraDeck.filter(c => c.id === id).length;
  count += sideDeck.filter(c => c.id === id).length;
  return count;
}

// 添加卡片到卡组
export function addCardToDeck(card, deck) {
  // 首先检查禁限表（基于全局 currentMode）
  try {
    const mode = window.currentMode || 'TCG';
    const label = getForbiddenLabelForCard(card, mode);
    const sameCount = countCardInDecks(card);
    if (label === '禁止') { safeAlert('此卡在当前模式下为禁止卡，不能加入卡组', 'error'); return; }
    if (label === '限制' && sameCount >= 1) { safeAlert('此卡在当前模式下为限制卡，卡组中只能加入1张（主/额外/副卡组合计）', 'error'); return; }
    if (label === '准限制' && sameCount >= 2) { safeAlert('此卡在当前模式下为准限制卡，卡组中只能加入2张（主/额外/副卡组合计）', 'error'); return; }
    // 原有的通用限制：同名卡不能超过3张
    if (sameCount >= 3) { safeAlert('同名卡不能超过3张（主/额外/副卡组合计）', 'error'); return; }
  } catch (e) {
    // 如果查询过程中出现异常，退回到原有的同名卡限制逻辑
    const sameCount = countCardInDecks(card);
    if (sameCount >= 3) {
      alert('同名卡不能超过3张（主/额外/副卡组合计）');
      return;
    }
  }

  if (deck === 'main') {
    if (mainDeck.length >= 60) { safeAlert('主卡组不能超过60张', 'error'); return; }
    mainDeck.push(card);
  }
  if (deck === 'extra') {
    if (extraDeck.length >= 15) { safeAlert('额外卡组不能超过15张', 'error'); return; }
    extraDeck.push(card);
  }
  if (deck === 'side') {
    if (sideDeck.length >= 15) { safeAlert('副卡组不能超过15张', 'error'); return; }
    sideDeck.push(card);
  }
  renderDecks(mainDeck, extraDeck, sideDeck);
  try { if (window.updateGenesysTotal) window.updateGenesysTotal(); } catch (_) {}
}

// 移除卡片
export function removeCard(deck, idx) {
  if (deck === 'main') mainDeck.splice(idx, 1);
  if (deck === 'extra') extraDeck.splice(idx, 1);
  if (deck === 'side') sideDeck.splice(idx, 1);
  renderDecks(mainDeck, extraDeck, sideDeck);
  try { if (window.updateGenesysTotal) window.updateGenesysTotal(); } catch (_) {}
}

// 清空所有卡组
export function clearAllDecks() {
  if (confirm('确定要清空所有卡组吗？')) {
    mainDeck.length = 0;
    extraDeck.length = 0;
    sideDeck.length = 0;
    renderDecks(mainDeck, extraDeck, sideDeck);
    try { if (window.updateGenesysTotal) window.updateGenesysTotal(); } catch (_) {}
  }
}

// 导出卡组为ydk文件
export function exportYDK() {
  if (extraDeck.length > 15) {
    alert('额外卡组不能超过15张');
    return;
  }
  if (sideDeck.length > 15) {
    alert('副卡组不能超过15张');
    return;
  }

  let content = '#created by ygo查卡器\n';
  content += '#main\n';
  mainDeck.forEach(card => { content += card.id + '\n'; });
  content += '#extra\n';
  extraDeck.forEach(card => { content += card.id + '\n'; });
  content += '!side\n';
  sideDeck.forEach(card => { content += card.id + '\n'; });
  
  const blob = new Blob([content], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deck.ydk';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}