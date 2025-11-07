// 搜索卡片
let ocgForbidden = null;
let tcgForbidden = null;
let cnForbidden = null;
let aeForbidden = null;
let genesysScores = null;
let genesysIndex = null;
// normalize forbidden labels from various sources into simplified Chinese labels
function normalizeForbiddenLabel(raw, source) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  // CN (中文) - map 半限制 to 准限制, 保持 禁止/限制
  if (source === 'CN') {
    if (s.includes('禁止')) return '禁止';
    // 先匹配“准限制”（以及容错：包含“准”字）再匹配“限制”
    if (s.includes('准限制') || s.includes('准')) return '准限制';
    if (s.includes('半') && s.includes('限')) return '准限制';
    if (s.includes('限制')) return '限制';
    return s;
  }
  // OCG (日本) - look for Japanese keywords
  if (source === 'OCG') {
    if (s.includes('禁止')) return '禁止';
    if (s.includes('準') || s.includes('准') || s.includes('準制限') || s.includes('准制限')) return '准限制';
    if (s.includes('制限')) return '限制';
    return s;
  }
  // TCG/AE (English)
  if (source === 'TCG' || source === 'AE') {
    if (lower.includes('forbid')) return '禁止';
    if (lower.includes('semi') || lower.includes('semi-lim') || lower.includes('semi limit')) return '准限制';
    if (lower.includes('limit')) return '限制';
    return s;
  }
  // fallback: try generic checks
  if (lower.includes('forbid') || s.includes('禁止')) return '禁止';
  if (lower.includes('semi') || s.includes('半')) return '准限制';
  if (lower.includes('limit') || s.includes('限制') || s.includes('制限')) return '限制';
  return s;
}

function applyNormalizeToMap(map, source) {
  if (!map || typeof map !== 'object') return map;
  const out = {};
  for (const k of Object.keys(map)) {
    const v = map[k];
    out[k] = normalizeForbiddenLabel(v, source) || '';
  }
  return out;
}
let nameIdMap = null;
let genesysById = null;
let preReleaseIndex = null; // { id: { id, name, text, picUrl, source: 'pre' } }

// Load both OCG and TCG forbidden lists via XMLHttpRequest
export function loadForbidden() {
  const p1 = new Promise((resolve) => {
    if (ocgForbidden !== null) return resolve(ocgForbidden);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/data/ocg_forbidden.json', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
  try { ocgForbidden = xhr.status >= 200 && xhr.status < 300 ? applyNormalizeToMap(JSON.parse(xhr.responseText || '{}'), 'OCG') : {}; } catch (e) { ocgForbidden = {}; }
        resolve(ocgForbidden);
      };
      xhr.send();
    } catch (err) { ocgForbidden = {}; resolve(ocgForbidden); }
  });

  const p2 = new Promise((resolve) => {
    if (tcgForbidden !== null) return resolve(tcgForbidden);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/data/tcg_forbidden.json', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
  try { tcgForbidden = xhr.status >= 200 && xhr.status < 300 ? applyNormalizeToMap(JSON.parse(xhr.responseText || '{}'), 'TCG') : {}; } catch (e) { tcgForbidden = {}; }
        resolve(tcgForbidden);
      };
      xhr.send();
    } catch (err) { tcgForbidden = {}; resolve(tcgForbidden); }
  });

  const p3 = new Promise((resolve) => {
    if (cnForbidden !== null) return resolve(cnForbidden);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/data/cn_forbidden.json', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
  try { cnForbidden = xhr.status >= 200 && xhr.status < 300 ? applyNormalizeToMap(JSON.parse(xhr.responseText || '{}'), 'CN') : {}; } catch (e) { cnForbidden = {}; }
        resolve(cnForbidden);
      };
      xhr.send();
    } catch (err) { cnForbidden = {}; resolve(cnForbidden); }
  });

  const p4 = new Promise((resolve) => {
    if (aeForbidden !== null) return resolve(aeForbidden);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/data/ae_forbidden.json', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
  try { aeForbidden = xhr.status >= 200 && xhr.status < 300 ? applyNormalizeToMap(JSON.parse(xhr.responseText || '{}'), 'AE') : {}; } catch (e) { aeForbidden = {}; }
        resolve(aeForbidden);
      };
      xhr.send();
    } catch (err) { aeForbidden = {}; resolve(aeForbidden); }
  });

  const p5 = new Promise((resolve) => {
    if (genesysScores !== null) return resolve(genesysScores);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/data/genesys_scores.json', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        try { genesysScores = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText || '{}') : {}; } catch (e) { genesysScores = {}; }
        // build a normalized index for better name matching
        try {
          genesysIndex = {};
          const normalize = (s) => String(s || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
          for (const k of Object.keys(genesysScores)) {
            const nk = normalize(k);
            if (nk) genesysIndex[nk] = genesysScores[k];
          }
        } catch (e) { genesysIndex = {}; }
        resolve(genesysScores);
      };
      xhr.send();
    } catch (err) { genesysScores = {}; resolve(genesysScores); }
  });

  const p6 = new Promise((resolve) => {
    if (nameIdMap !== null) return resolve(nameIdMap);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/data/name_id_map.json', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        try { nameIdMap = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText || '{}') : {}; } catch (e) { nameIdMap = {}; }
        resolve(nameIdMap);
      };
      xhr.send();
    } catch (err) { nameIdMap = {}; resolve(nameIdMap); }
  });
  return Promise.all([p1, p2, p3, p4, p5, p6]).then(() => {
    // build genesysById mapping: map card id and cid -> genesys score when possible
    genesysById = {};
    try {
      const normalize = (s) => String(s || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const genesysKeys = Object.keys(genesysScores || {});
      const genesysNormIndex = {};
      for (const k of genesysKeys) genesysNormIndex[normalize(k)] = genesysScores[k];

      for (const srcName of Object.keys(nameIdMap || {})) {
        const entry = nameIdMap[srcName];
        const candidateNames = [srcName, entry && entry.name].filter(Boolean);
        let score = null;
        for (const cn of candidateNames) {
          if (!cn) continue;
          if (genesysScores && genesysScores[cn] !== undefined) { score = genesysScores[cn]; break; }
          const nk = normalize(cn);
          if (genesysNormIndex[nk] !== undefined) { score = genesysNormIndex[nk]; break; }
        }
        if (score !== null) {
          if (entry && entry.id) genesysById[String(entry.id)] = score;
          if (entry && entry.cid) genesysById[String(entry.cid)] = score;
        }
      }
    } catch (e) { genesysById = {}; }

    return ({ ocg: ocgForbidden, tcg: tcgForbidden, cn: cnForbidden, ae: aeForbidden, genesys: genesysScores });
  });
}

// Load pre-release data prepared under /data/pre-release
export async function loadPreRelease() {
  if (preReleaseIndex !== null) return preReleaseIndex;
  preReleaseIndex = {};
  try {
    const res = await fetch('/data/pre-release/index.json');
    if (!res.ok) return preReleaseIndex;
    const arr = await res.json();
    for (const item of arr) {
      if (!item || !item.id) continue;
      preReleaseIndex[String(item.id)] = Object.assign({ source: 'pre' }, item);
    }
  } catch (e) {
    // ignore
  }
  return preReleaseIndex;
}

// 同步查找某张卡在指定模式下的禁限标签（"禁止" / "限制" / "准限制" / ''）
// 该函数依赖于内存中的禁限表（ocgForbidden, tcgForbidden, cnForbidden, aeForbidden）
// 如果禁限表尚未加载，函数会返回空字符串，请在必要时先调用 loadForbidden()
export function getForbiddenLabelForCard(card, mode) {
  if (mode === 'NO_FORBIDDEN') return '';
  const mapByMode = {
    'OCG': ocgForbidden,
    'TCG': tcgForbidden,
    'CN': cnForbidden,
    'AE': aeForbidden,
  };
  const map = (mode && mapByMode[mode]) ? mapByMode[mode] : null;
  if (!map) return '';

  const findStatus = (m) => {
    if (!m) return '';
    if (card.cid && m[String(card.cid)]) return m[String(card.cid)];
    if (card.id && m[String(card.id)]) return m[String(card.id)];
    const candidates = [];
    if (card.jp_name) candidates.push(card.jp_name);
    if (card.name) candidates.push(card.name);
    if (card.cn_name) candidates.push(card.cn_name);
    for (const cand of candidates) if (cand && m[cand]) return m[cand];
    for (const key of Object.keys(m)) {
      for (const cand of candidates) {
        if (!cand) continue;
        if (key.includes(cand) || cand.includes(key)) return m[key];
      }
    }
    return '';
  };

  return findStatus(map) || '';
}

export async function searchCard(name) {
  if (!name.trim()) return null;
  try {
    const res = await fetch(`https://ygocdb.com/api/v0/?search=${encodeURIComponent(name)}`);
    const data = await res.json();
    // 异步确保禁限表开始加载
    loadForbidden().catch(() => {});
    // 同步加载先行卡数据（异步完成并不阻塞 API 请求）
    const prePromise = loadPreRelease().catch(() => ({}));
    return data.result || [];
  } catch (err) {
    console.error('搜索卡片失败:', err);
    return null;
  }
}

// 渲染搜索结果
export function renderSearchResults(results, addCardToDeck) {
  if (!results || results.length === 0) return '未找到相关卡片。';

  // 尝试加载本地禁限表（非阻塞）
  loadForbidden().catch(() => {});

  return results.map((card, idx) => {
    const groups = getCardGroups(card);
    let btns = '';
    if (groups.includes('main')) btns += `<button class="btn" onclick="window.handleAddCard(${idx}, &apos;main&apos;)">加入主卡组</button> `;
    if (groups.includes('extra')) btns += `<button class="btn" onclick="window.handleAddCard(${idx}, &apos;extra&apos;)">加入额外卡组</button> `;
    if (groups.includes('side')) btns += `<button class="btn" onclick="window.handleAddCard(${idx}, &apos;side&apos;)">加入副卡组</button>`;

    const findStatus = (map) => {
      if (!map) return '';
      if (card.cid && map[String(card.cid)]) return map[String(card.cid)];
      if (card.id && map[String(card.id)]) return map[String(card.id)];
      const candidates = [];
      if (card.jp_name) candidates.push(card.jp_name);
      if (card.name) candidates.push(card.name);
      if (card.cn_name) candidates.push(card.cn_name);
      for (const cand of candidates) if (cand && map[cand]) return map[cand];
      for (const key of Object.keys(map)) {
        for (const cand of candidates) {
          if (!cand) continue;
          if (key.includes(cand) || cand.includes(key)) return map[key];
        }
      }
      return '';
    };

  const forbiddenOCG = findStatus(ocgForbidden);
  const forbiddenTCG = findStatus(tcgForbidden);
  const forbiddenCN = findStatus(cnForbidden);
  const forbiddenAE = findStatus(aeForbidden);
    const genesysPoint = (() => {
      // 1) 以 id 映射为准（由 main.js 构建与刷新）
      try {
        const mapById = (window && window._genesysByIdLocal) ? window._genesysByIdLocal : null;
        if (mapById) {
          if (card.cid != null && mapById[String(card.cid)] !== undefined) return mapById[String(card.cid)];
          if (card.id != null && mapById[String(card.id)] !== undefined) return mapById[String(card.id)];
        }
      } catch (_) {}

      // 2) 名称索引仅做“规范化后精确匹配”，避免部分包含造成误判
      try {
        const idx = (window && window._genesysIndex) ? window._genesysIndex : null;
        if (idx) {
          const normalize = (s) => String(s || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
          const candidates = [];
          if (card.cn_name) candidates.push(card.cn_name);
          if (card.name) candidates.push(card.name);
          if (card.jp_name) candidates.push(card.jp_name);
          for (const cand of candidates) {
            if (!cand) continue;
            const nk = normalize(cand);
            if (nk && idx[nk] !== undefined) return idx[nk];
          }
        }
      } catch (_) {}

      // 3) 未匹配则为 0 分
      return 0;
    })();

    const imgSrc = card.pic ? card.pic : `https://cdn.233.momobako.com/ygopro/pics/${card.id}.jpg`;
    const preTag = card.source === 'pre' ? `<span style="color:#a64; font-weight:bold; margin-right:8px;">[先行]</span>` : '';
    return `
      <div class="card">
        <img src="${imgSrc}" width="160" height="232" alt="${card.cn_name}"
             onerror="this.onerror=null; this.src='https://cdn.233.momobako.com/ygopro/pics/${card.id}.jpg';">
        <div class="card-info">
          <h2>${preTag}${card.cn_name}</h2>
          ${card.text && card.text.types ? `<div>${card.text.types}</div>` : ''}
          ${window.currentMode === 'OCG' && forbiddenOCG ? `<div style="color:#c33;margin-top:6px;">OCG: ${forbiddenOCG}</div>` : ''}
          ${window.currentMode === 'TCG' && forbiddenTCG ? `<div style="color:#06b; margin-top:4px;">TCG: ${forbiddenTCG}</div>` : ''}
          ${window.currentMode === 'CN' && forbiddenCN ? `<div style="color:#080; margin-top:4px;">CN: ${forbiddenCN}</div>` : ''}
          ${window.currentMode === 'AE' && forbiddenAE ? `<div style="color:#800080; margin-top:4px;">AE: ${forbiddenAE}</div>` : ''}
          ${(() => { const gp = genesysPoint; const show = (window.currentMode === 'GENESYS') && (gp !== '' && gp !== null && gp !== undefined); return show ? `<div style="color:#e67e22; margin-top:4px;">Genesys: ${gp}</div>` : ''; })()}
          <div class="card-desc">${card.text && card.text.desc ? card.text.desc.replace(/\n/g, '<br>') : ''}</div>
          <div style="margin-top:8px;">${btns}</div>
        </div>
      </div>
    `;
  }).join('');
}

function getCardGroups(card) {
  const types = card.text && card.text.types ? card.text.types : '';
  if (/融合|同调|超量|连接/.test(types)) return ['extra', 'side'];
  if (/怪兽/.test(types)) return ['main', 'side'];
  return ['main', 'side'];
}
