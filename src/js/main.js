import { mainDeck, extraDeck, sideDeck, addCardToDeck, removeCard, clearAllDecks, exportYDK, sortDecks } from './deck.js';
import { searchCard, renderSearchResults, loadForbidden, getForbiddenLabelForCard } from './search.js';
import { renderDecks, parseYDKFile, fetchCardInfo } from './ui.js';

// 全局搜索结果存储
window.searchResults = [];

// 全局错误/未处理 promise 捕获，便于调试页面加载问题
window.addEventListener('error', (e) => {
  try { console.error('Global error:', e.message || e); } catch (_) {}
  try { alert('脚本错误：' + (e.message || e)); } catch (_) {}
});
window.addEventListener('unhandledrejection', (e) => {
  try { console.error('Unhandled rejection:', e.reason); } catch (_) {}
  try { alert('未处理的 Promise 错误：' + (e.reason && e.reason.message ? e.reason.message : e.reason)); } catch (_) {}
});

console.log('main.js loaded');

// 初始化
async function init() {
  try {
  // 预加载禁限表（如果存在）
  try { await loadForbidden(); } catch (e) { /* ignore */ }
  // 预加载 GENESYS 分值表与 name->id map
  let genesysScores = null;
  let nameIdMap = null;
  let genesysByIdLocal = null;
  let genesysIndexLocal = null; // 规范化的名称索引，用于搜索展示兜底
  const buildGenesysFrom = (scores, nameMap) => {
    const byId = {};
    const idx = {};
    try {
      const normalize = (s) => String(s||'').toLowerCase().replace(/&amp;/g,'and').replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
      // 名称索引
      for (const k of Object.keys(scores||{})) idx[normalize(k)] = scores[k];
      // id 映射
      for (const srcName of Object.keys(nameMap||{})) {
        const entry = nameMap[srcName];
        const candidateNames = [srcName, entry && entry.name].filter(Boolean);
        let score = null;
        for (const cn of candidateNames) {
          if (!cn) continue;
          if (scores && scores[cn] !== undefined) { score = scores[cn]; break; }
          const nk = normalize(cn);
          if (idx[nk] !== undefined) { score = idx[nk]; break; }
        }
        if (score !== null) {
          if (entry && entry.id) byId[String(entry.id)] = score;
          if (entry && entry.cid) byId[String(entry.cid)] = score;
        }
      }
    } catch (_) {}
    return { byId, idx };
  };
  try {
    const p1 = new Promise((resolve) => {
      const xhr = new XMLHttpRequest(); xhr.open('GET', '/data/genesys_scores.json', true);
      xhr.onreadystatechange = function () { if (xhr.readyState!==4) return; try { genesysScores = xhr.status>=200&&xhr.status<300?JSON.parse(xhr.responseText||'{}'):{} } catch(e){ genesysScores = {} } resolve(genesysScores); };
      xhr.send();
    });
    const p2 = new Promise((resolve) => {
      const xhr = new XMLHttpRequest(); xhr.open('GET', '/data/name_id_map.json', true);
      xhr.onreadystatechange = function () { if (xhr.readyState!==4) return; try { nameIdMap = xhr.status>=200&&xhr.status<300?JSON.parse(xhr.responseText||'{}'):{} } catch(e){ nameIdMap = {} } resolve(nameIdMap); };
      xhr.send();
    });
    await Promise.all([p1,p2]);
    // build mapping and index
    const built = buildGenesysFrom(genesysScores, nameIdMap);
    genesysByIdLocal = built.byId || {};
    genesysIndexLocal = built.idx || {};
  } catch (e) { genesysScores = nameIdMap = genesysByIdLocal = null; }
  // 渲染初始卡组
  renderDecks(mainDeck, extraDeck, sideDeck);

  // 模式选择器（OCG/TCG/CN/AE/GENESYS）
  try {
    const modeSelect = document.getElementById('modeSelect');
    const saved = localStorage.getItem('ygo_mode') || 'OCG';
    window.currentMode = saved;
    if (modeSelect) {
      modeSelect.value = saved;
      modeSelect.addEventListener('change', (e) => {
        window.currentMode = e.target.value;
        localStorage.setItem('ygo_mode', window.currentMode);
        // update genesys total display when switching modes
        try { window.updateGenesysTotal(); } catch (_) {}
        // 若切换到 GENESYS 模式，刷新分值缓存并重渲染当前搜索结果，确保显示为最新
        try {
          if (window.currentMode === 'GENESYS' && typeof window.refreshGenesysCache === 'function') {
            window.refreshGenesysCache().then(() => {
              try {
                if (Array.isArray(window.searchResults) && window.searchResults.length) {
                  // 切换到 GENESYS 后立即过滤灵摆/连接
                  const filtered = window.searchResults.filter((c) => {
                    try {
                      const t1 = String(c && c.type != null ? c.type : '').toLowerCase();
                      const t2 = String(c && c.text && c.text.types ? c.text.types : '').toLowerCase();
                      const banned = t1.includes('pendulum') || t1.includes('link') || t2.includes('灵摆') || t2.includes('连接');
                      return !banned;
                    } catch (_) { return true; }
                  });
                  window.searchResults = filtered;
                  const el = document.getElementById('result');
                  if (el) el.innerHTML = renderSearchResults(window.searchResults);
                }
              } catch (_) {}
            });
          }
        } catch (_) {}
      });
    }
  } catch (err) {
    // ignore if DOM not ready
  }

  // expose updateGenesysTotal to compute score based on current decks
  window._genesysByIdLocal = genesysByIdLocal || {};
  window._genesysIndex = genesysIndexLocal || {};
  // 提供刷新 GENESYS 缓存的函数（带 cache bust）
  window.refreshGenesysCache = async () => {
    try {
      const [scoresRes, nameMapRes] = await Promise.all([
        fetch('/data/genesys_scores.json?ts=' + Date.now(), { cache: 'reload' }).catch(() => null),
        fetch('/data/name_id_map.json?ts=' + Date.now(), { cache: 'reload' }).catch(() => null),
      ]);
      const newScores = scoresRes && scoresRes.ok ? (await scoresRes.json()) : genesysScores || {};
      const newNameMap = nameMapRes && nameMapRes.ok ? (await nameMapRes.json()) : nameIdMap || {};
      const built = buildGenesysFrom(newScores, newNameMap);
      genesysScores = newScores;
      nameIdMap = newNameMap;
      window._genesysByIdLocal = built.byId || {};
      window._genesysIndex = built.idx || {};
    } catch (_) { /* ignore refresh errors */ }
  };
  window.updateGenesysTotal = () => {
    const el = document.getElementById('genesysTotal');
    if (!el) return;
    if (window.currentMode !== 'GENESYS') { el.textContent = '0'; el.parentElement.style.display = 'none'; return; }
    el.parentElement.style.display = '';
    try {
      const all = [...mainDeck, ...extraDeck, ...sideDeck];
      let sum = 0;
      for (const c of all) {
        const idStr = c && (c.cid || c.id) ? String(c.cid || c.id) : null;
        if (idStr && window._genesysByIdLocal[idStr] !== undefined) {
          sum += Number(window._genesysByIdLocal[idStr]) || 0;
        }
      }
      el.textContent = String(sum);
    } catch (e) { el.textContent = '0'; }
  };

  // 绑定搜索表单
  const searchForm = document.getElementById('searchForm');
  if (searchForm) {
    // GENESYS 模式过滤：灵摆/连接 怪兽不显示
    const isGenesysBannedType = (card) => {
      try {
        const t1 = String(card && card.type != null ? card.type : '').toLowerCase();
        const t2 = String(card && card.text && card.text.types ? card.text.types : '').toLowerCase();
        if (t1.includes('pendulum') || t1.includes('link')) return true;
        if (t2.includes('灵摆') || t2.includes('连接')) return true;
      } catch (_) {}
      return false;
    };
    const maybeFilterForGenesys = (arr) => {
      try {
        if (window.currentMode === 'GENESYS' && Array.isArray(arr)) {
          return arr.filter((c) => !isGenesysBannedType(c));
        }
      } catch (_) {}
      return arr;
    };
    searchForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('cardName').value;
      document.getElementById('result').innerHTML = '查询中...';
      
  // 在每次搜索前，刷新 GENESYS 分值缓存，确保展示使用最新数据
  try { await window.refreshGenesysCache(); } catch (_) {}
  const resultsRaw = await searchCard(name);
      if (resultsRaw === null) {
        document.getElementById('result').innerHTML = '查询失败，请稍后重试。';
        return;
      }
      let results = Array.isArray(resultsRaw) ? resultsRaw : [];
      // GENESYS 模式：过滤灵摆/连接
      results = maybeFilterForGenesys(results);

      // 尝试合并 pre-release 索引（优先显示）
      try {
        const preRes = await fetch('/data/pre-release/index.json');
        if (preRes && preRes.ok) {
          const preArr = await preRes.json();
          if (Array.isArray(preArr) && preArr.length) {
            const q = name.trim();
            const isNumeric = /^\d+$/.test(q);
            const seen = new Set();
            const matches = [];
            for (const item of preArr) {
              if (!item || !item.id) continue;
              if (!item.pic) continue; // ensure we only include entries with actual images
              if (isNumeric) {
                if (String(item.id) === q) {
                  const key = 'pre-' + String(item.id);
                  if (!seen.has(key)) { seen.add(key); matches.push(Object.assign({ source: 'pre' }, item)); }
                }
              } else {
                const s = (item.cn_name || item.name || '').toLowerCase();
                if (s && s.includes(q.toLowerCase())) {
                  const key = 'pre-' + String(item.id);
                  if (!seen.has(key)) { seen.add(key); matches.push(Object.assign({ source: 'pre' }, item)); }
                }
              }
            }
            if (matches.length) {
              const combined = [...matches, ...(Array.isArray(results) ? results : [])];
              window.searchResults = maybeFilterForGenesys(combined);
              document.getElementById('result').innerHTML = renderSearchResults(window.searchResults);
              return;
            }
          }
        }
      } catch (e) { /* ignore pre-release merge errors */ }

      window.searchResults = results;
      document.getElementById('result').innerHTML = renderSearchResults(results);
    };
  try { if (window.updateGenesysTotal) window.updateGenesysTotal(); } catch (_) {}
  }

  // 简易通知（避免 alert 在自动化浏览器中被拦截）
  function ensureToastContainer() {
    let c = document.querySelector('.ygotoast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'ygotoast-container';
      (document.body || document.documentElement).appendChild(c);
    }
    return c;
  }

  function notify(msg, type) {
    const run = () => {
      try {
        const container = ensureToastContainer();
        const el = document.createElement('div');
        el.className = 'ygotoast' + (type === 'error' ? ' error' : '');
        el.textContent = String(msg || '');
        el.addEventListener('click', () => { try { el.remove(); } catch (_) {} });
        container.appendChild(el);
        const alive = type === 'error' ? 6000 : 3000;
        setTimeout(() => { try { el.classList.add('hide'); } catch (_) {} }, alive - 300);
        setTimeout(() => { try { el.remove(); } catch (_) {} }, alive);
      } catch (_) {
        try { alert(String(msg || '')); } catch (_) {}
      }
    };
    try {
      if (document.readyState === 'loading') {
        const handler = () => { try { run(); } finally { document.removeEventListener('DOMContentLoaded', handler); } };
        document.addEventListener('DOMContentLoaded', handler);
      } else if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 0);
      }
    } catch (_) {
      try { run(); } catch (_) {}
    }
  }
  try { if (!window.notify) window.notify = notify; } catch (_) {}

  // 绑定“更新先行卡”按钮
  try {
    const btn = document.getElementById('refreshPreBtn');
    const showAllBtn = document.getElementById('showPreAllBtn');
    if (btn) {
      btn.addEventListener('click', async () => {
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = '更新中...';
        try {
          const ev = new EventSource('/__update_prerelease_stream');
          let finished = false;
          let exitCode = 0;
          let lastErr = '';
          let notified = false;
          const handleResult = () => {
            if (notified) return; notified = true;
            if (exitCode === 0) {
              notify('先行卡已更新', 'success');
            } else {
              notify('更新失败：' + (lastErr || '请检查网络或 mycard 页面结构变化'), 'error');
            }
          };
          ev.onmessage = (evt) => {
            try {
              const data = JSON.parse(evt.data || '{}');
              if (data.type === 'done') {
                finished = true;
                exitCode = typeof data.code === 'number' ? data.code : 0;
                ev.close();
                // 立即提示结果，避免后续流程中断导致无提示
                handleResult();
              } else if (data.type === 'error') {
                // 服务器主动报错（例如 busy），立即终止等待并提示
                lastErr = String((data && data.message) || lastErr || 'server error');
                finished = true; exitCode = 1;
                try { ev.close(); } catch (_) {}
                handleResult();
              } else if (data.type === 'skipped') {
                // 远端未更新，视为成功完成
                finished = true; exitCode = 0;
                try { ev.close(); } catch (_) {}
                handleResult();
              } else if (data.type === 'log') {
                if ((data.level === 'error') || /Failed to prepare pre-release/i.test(String(data.text||''))) {
                  lastErr = String(data.text || '');
                }
              }
            } catch (_) {}
          };
          ev.onerror = () => { try { if (!finished) ev.close(); } catch(_){} };
          // 轮询等待结束（简易超时保护）
          const waitDone = async () => {
            const t0 = Date.now();
            while (!finished && Date.now() - t0 < 5 * 60 * 1000) { await new Promise(r => setTimeout(r, 200)); }
          };
          await waitDone();
          // 刷新 index.json
          try { await fetch('/data/pre-release/index.json?ts=' + Date.now(), { cache: 'reload' }); } catch (_) {}
          // 兜底提示（如已提示会自动跳过）
          handleResult();
        } catch (e) {
          const msg = '更新失败：' + (e && e.message ? e.message : e);
          notify(msg, 'error');
        } finally {
          btn.disabled = false; btn.textContent = orig;
        }
      });
    }
    if (showAllBtn) {
      showAllBtn.addEventListener('click', async () => {
        const orig = showAllBtn.textContent;
        showAllBtn.disabled = true; showAllBtn.textContent = '加载中...';
        try {
          // 拉取最新 index.json
          const res = await fetch('/data/pre-release/index.json?ts=' + Date.now(), { cache: 'reload' });
          if (!res.ok) {
            window.notify && window.notify('加载先行卡失败', 'error');
            return;
          }
          let arr = await res.json();
          if (!Array.isArray(arr)) arr = [];
          // Genesys 模式过滤灵摆/连接
          const isGenesys = (window.currentMode === 'GENESYS');
          if (isGenesys) {
            arr = arr.filter((c) => {
              try {
                const t1 = String(c && c.type != null ? c.type : '').toLowerCase();
                const t2 = String(c && c.text && c.text.types ? c.text.types : '').toLowerCase();
                const banned = t1.includes('pendulum') || t1.includes('link') || t2.includes('灵摆') || t2.includes('连接');
                return !banned;
              } catch (_) { return true; }
            });
          }
          // 排序：按 id 升序（先行卡通常按发布时间或 pack 展现，简单 id 排序即可）
          arr.sort((a,b) => {
            const ia = Number(a && a.id); const ib = Number(b && b.id); return ia - ib; });
          window.searchResults = arr;
          const el = document.getElementById('result');
          if (el) el.innerHTML = renderSearchResults(window.searchResults);
          window.notify && window.notify('显示全部先行卡，共 ' + arr.length + ' 张', 'success');
        } catch (e) {
          window.notify && window.notify('显示先行卡失败: ' + (e && e.message ? e.message : e), 'error');
        } finally {
          showAllBtn.disabled = false; showAllBtn.textContent = orig;
        }
      });
    }
  } catch (_) {}

  // 绑定文件输入
  const ydkInput = document.getElementById('ydkFileInput');
  if (ydkInput) {
    ydkInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const deckData = await parseYDKFile(file);
      if (!deckData) return;

      // 全部id（含重复，顺序不变）
      const allIdsRaw = [...deckData.main, ...deckData.extra, ...deckData.side].map(id => String(Number(id)));
      // 去重后查卡
      const allIdsUnique = Array.from(new Set(allIdsRaw));
      const idToCard = await fetchCardInfo(allIdsUnique);
      
      if (!idToCard) {
        alert('卡片信息获取失败');
        return;
      }
      

      // 填充卡组
      mainDeck.length = 0;
      extraDeck.length = 0;
      sideDeck.length = 0;

      deckData.main.forEach(id => {
        if (idToCard[String(Number(id))]) mainDeck.push(idToCard[String(Number(id))]);
      });
      deckData.extra.forEach(id => {
        if (idToCard[String(Number(id))]) extraDeck.push(idToCard[String(Number(id))]);
      });
      deckData.side.forEach(id => {
        if (idToCard[String(Number(id))]) sideDeck.push(idToCard[String(Number(id))]);
      });
      // 渲染加载后的卡组并刷新分数
      try { renderDecks(mainDeck, extraDeck, sideDeck); } catch (err) { console.error('渲染卡组失败:', err); }
      try { if (window.updateGenesysTotal) window.updateGenesysTotal(); } catch (_) {}
      // 重置文件选择器，便于连续导入同一文件
      try { e.target.value = ''; } catch (_) {}
      
    }); // <-- end of ydkInput change handler
  }

  // 页面内按钮绑定
  const clearBtn = document.getElementById('clearBtn');
  const exportBtn = document.getElementById('exportBtn');
  const openYdkBtn = document.getElementById('openYdkBtn');
  const sortBtn = document.getElementById('sortBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => clearAllDecks());
  if (exportBtn) exportBtn.addEventListener('click', () => exportYDK());
  if (openYdkBtn && ydkInput) openYdkBtn.addEventListener('click', () => ydkInput.click());
  if (sortBtn) sortBtn.addEventListener('click', () => sortDecks());
  } catch (err) {
    console.error('init failed:', err);
    alert('初始化失败：' + (err && err.message ? err.message : err));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


// 暴露给HTML的全局函数
window.handleAddCard = (idx, deck) => addCardToDeck(window.searchResults[idx], deck);
window.handleRemoveCard = (deck, idx) => removeCard(deck, idx);
window.clearAllDecks = clearAllDecks;
window.exportYDK = exportYDK;

// 新增：点击缩略图移除 & 拖拽排序
window.handleThumbClick = (deckType, index) => {
  removeCard(deckType, index);
};

let _dragState = { deckType: null, fromIndex: -1 };
window.handleDragStart = (deckType, index, ev) => {
  _dragState.deckType = deckType;
  _dragState.fromIndex = index;
  try { ev.dataTransfer.setData('text/plain', String(index)); } catch (_) {}
  try { ev.dataTransfer.effectAllowed = 'move'; } catch (_) {}
};

window.handleDragOver = (deckType, index, ev) => {
  ev.preventDefault();
  try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
};

window.handleDrop = (deckType, index, ev) => {
  ev.preventDefault();
  if (_dragState.deckType !== deckType || _dragState.fromIndex === -1) return;
  const from = _dragState.fromIndex;
  const to = index;
  let arr = null;
  if (deckType === 'main') arr = mainDeck;
  else if (deckType === 'extra') arr = extraDeck;
  else if (deckType === 'side') arr = sideDeck;
  if (!arr || from === to) return;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  _dragState.deckType = null;
  _dragState.fromIndex = -1;
  renderDecks(mainDeck, extraDeck, sideDeck);
};

window.handleDragEnd = (ev) => {
  _dragState.deckType = null;
  _dragState.fromIndex = -1;
};

// 容器级拖拽（支持跨卡组）
window.handleGridDragOver = (targetDeckType, ev) => {
  ev.preventDefault();
  try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
};

window.handleGridDrop = (targetDeckType, ev) => {
  ev.preventDefault();
  const sourceDeckType = _dragState.deckType;
  const fromIndex = _dragState.fromIndex;
  if (fromIndex === -1 || !sourceDeckType) return;

  // 禁止主<->额外 互相移动
  if ((sourceDeckType === 'main' && targetDeckType === 'extra') ||
      (sourceDeckType === 'extra' && targetDeckType === 'main')) {
    _dragState.deckType = null; _dragState.fromIndex = -1; return;
  }

  // 允许 main<->side, extra<->side 交互
  const getArr = (t) => t === 'main' ? mainDeck : (t === 'extra' ? extraDeck : sideDeck);
  const srcArr = getArr(sourceDeckType);
  const dstArr = getArr(targetDeckType);
  if (!srcArr || !dstArr) return;

  // 若拖放到空白区域或容器底部，认为是插入到尾部
  let insertIndex = dstArr.length;
  // 如果事件来自某个 deck-card，可尝试近似定位（可选增强：命中最近元素）
  try {
    const cardEl = ev.target && ev.target.closest ? ev.target.closest('.deck-card') : null;
    if (cardEl && cardEl.parentElement) {
      const nodes = Array.from(cardEl.parentElement.children);
      const idx = nodes.indexOf(cardEl);
      if (idx >= 0) insertIndex = idx;
    }
  } catch (_) {}

  const [moved] = srcArr.splice(fromIndex, 1);
  dstArr.splice(insertIndex, 0, moved);
  _dragState.deckType = null;
  _dragState.fromIndex = -1;
  renderDecks(mainDeck, extraDeck, sideDeck);
};

// ====== 悬浮预览（卡组区域） ======
(() => {
  let previewEl = null;
  const ensurePreviewEl = () => {
    if (previewEl && document.body.contains(previewEl)) return previewEl;
    previewEl = document.createElement('div');
    previewEl.className = 'deck-card-preview';
    previewEl.style.position = 'fixed';
    previewEl.style.zIndex = '9999';
    previewEl.style.pointerEvents = 'none';
    previewEl.style.display = 'none';
    document.body.appendChild(previewEl);
    return previewEl;
  };
  const buildPreviewHtml = (card) => {
    if (!card) return '';
    const imgSrc = card.pic ? card.pic : `https://cdn.233.momobako.com/ygopro/pics/${card.id}.jpg`;
    const preTag = card.source === 'pre' ? `<span class="pre-badge">先行</span>` : '';
    const name = (card.cn_name || card.name || '')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const types = card.text && card.text.types ? card.text.types : '';
    const desc = card.text && card.text.desc ? card.text.desc.replace(/\n/g,'<br>') : '';
    const mode = window.currentMode || 'OCG';
    let forbidden = '';
    try { forbidden = getForbiddenLabelForCard(card, mode) || ''; } catch (_) {}
    // Genesys 分数（与搜索结果一致的策略）
    const genesysPoint = (() => {
      try {
        const mapById = (window && window._genesysByIdLocal) ? window._genesysByIdLocal : null;
        if (mapById) {
          if (card.cid != null && mapById[String(card.cid)] !== undefined) return mapById[String(card.cid)];
          if (card.id != null && mapById[String(card.id)] !== undefined) return mapById[String(card.id)];
        }
      } catch (_) {}
      try {
        const idx = (window && window._genesysIndex) ? window._genesysIndex : null;
        if (idx) {
          const normalize = (s) => String(s || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
          const candidates = [];
          if (card.cn_name) candidates.push(card.cn_name);
          if (card.name) candidates.push(card.name);
          if (card.jp_name) candidates.push(card.jp_name);
          for (const cand of candidates) { const nk = normalize(cand); if (nk && idx[nk] !== undefined) return idx[nk]; }
        }
      } catch (_) {}
      return 0;
    })();
    const lines = [];
    if (types) lines.push(`<div class="type-line">${types}</div>`);
    if (mode === 'GENESYS') lines.push(`<div class="genesys">Genesys: ${genesysPoint}</div>`);
    else if (forbidden) lines.push(`<div class="forbidden">${mode}: ${forbidden}</div>`);
    return `
      <div class="preview-inner">
        <div class="preview-media"><img src="${imgSrc}" alt="${name}" onerror="this.onerror=null; this.src='https://cdn.233.momobako.com/ygopro/pics/${card.id}.jpg';"></div>
        <div class="preview-info">
          <div class="title">${preTag}${name}</div>
          ${lines.join('')}
          <div class="desc">${desc}</div>
        </div>
      </div>
    `;
  };
  const place = (ev) => {
    const el = ensurePreviewEl();
    const pad = 12; // offset from cursor
    const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
    const vh = window.innerHeight || document.documentElement.clientHeight || 768;
    const rect = el.getBoundingClientRect();
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + rect.width + pad > vw) x = Math.max(8, ev.clientX - rect.width - pad);
    if (y + rect.height + pad > vh) y = Math.max(8, ev.clientY - rect.height - pad);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };

  window.showDeckPreview = (deckType, index, ev) => {
    try {
      // 拖拽中或按下鼠标时不展示预览
      if ((ev && ev.buttons === 1) || (typeof _dragState !== 'undefined' && _dragState.fromIndex !== -1)) return;
      const arr = deckType === 'main' ? mainDeck : (deckType === 'extra' ? extraDeck : sideDeck);
      const card = (arr && arr[index]) ? arr[index] : null;
      const el = ensurePreviewEl();
      el.innerHTML = buildPreviewHtml(card);
      el.style.display = card ? 'block' : 'none';
      if (card) place(ev);
    } catch (_) {}
  };
  window.moveDeckPreview = (ev) => {
    try {
      if (ev && ev.buttons === 1) { window.hideDeckPreview(); return; }
      const el = ensurePreviewEl();
      if (el.style.display !== 'none') place(ev);
    } catch (_) {}
  };
  window.hideDeckPreview = () => {
    try { const el = ensurePreviewEl(); el.style.display = 'none'; } catch (_) {}
  };
})();
