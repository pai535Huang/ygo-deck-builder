// 渲染卡组内容
export function renderDeckRow(deck, deckType, removeCard) {
  // 使用占位容器包裹卡片，使卡片位于占位区内
  let html = `<div class="deck-empty"
      ondragover="window.handleGridDragOver('${deckType}', event)"
      ondrop="window.handleGridDrop('${deckType}', event)">`;
  html += `<div class="deck-grid">`;
  if (deck && deck.length > 0) {
    for (let i = 0; i < deck.length; i++) {
      const c = deck[i];
      const thumbSrc = (c && c.pic) ? c.pic : `https://cdn.233.momobako.com/ygopro/pics/${c.id}.jpg`;
      html += `
        <div class="deck-card" draggable="true"
             ondragstart="window.handleDragStart('${deckType}', ${i}, event)"
             ondragover="window.handleDragOver('${deckType}', ${i}, event)"
             ondrop="window.handleDrop('${deckType}', ${i}, event)"
             ondragend="window.handleDragEnd(event)"
             onmouseenter="window.showDeckPreview('${deckType}', ${i}, event)"
             onmousemove="window.moveDeckPreview(event)"
             onmouseleave="window.hideDeckPreview()">
    <img class="deck-thumb" src="${thumbSrc}" 
      width="50" height="73" 
               alt="${c && (c.cn_name || c.name) ? (c.cn_name || c.name) : ''}"
               onerror="this.onerror=null; this.src='https://cdn.233.momobako.com/ygopro/pics/${c.id}.jpg';"
               onclick="window.handleThumbClick('${deckType}', ${i})">
        </div>
      `;
    }
  }
  html += `</div>`; // end .deck-grid
  html += `</div>`; // end .deck-empty wrapper
  return html;
}

// 渲染所有卡组
export function renderDecks(mainDeck, extraDeck, sideDeck) {
  // 兼容调用方未传参的情况，保证为数组
  mainDeck = Array.isArray(mainDeck) ? mainDeck : [];
  extraDeck = Array.isArray(extraDeck) ? extraDeck : [];
  sideDeck = Array.isArray(sideDeck) ? sideDeck : [];

  // 主卡组
  document.getElementById('mainDeck').innerHTML = renderDeckRow(mainDeck, 'main');
  document.getElementById('mainDeckCount').textContent = `(${mainDeck.length})`;

  // 额外卡组
  document.getElementById('extraDeck').innerHTML = renderDeckRow(extraDeck, 'extra');
  document.getElementById('extraDeckCount').textContent = `(${extraDeck.length})`;

  // 副卡组
  document.getElementById('sideDeck').innerHTML = renderDeckRow(sideDeck, 'side');
  document.getElementById('sideDeckCount').textContent = `(${sideDeck.length})`;
}

// 解析ydk文件
export async function parseYDKFile(file) {
  if (!file) return null;

  const text = await file.text();
  const main = [], extra = [], side = [];
  let section = '';

  text.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (line === '#main') section = 'main';
    else if (line === '#extra') section = 'extra';
    else if (line === '!side') section = 'side';
    else if (/^\d+$/.test(line)) {
      if (section === 'main') main.push(line);
      else if (section === 'extra') extra.push(line);
      else if (section === 'side') side.push(line);
    }
  });

  return { main, extra, side };
}

// 获取卡片信息
export async function fetchCardInfo(cardIds) {
  const idToCard = {};
  
  try {
    for (let i = 0; i < cardIds.length; i += 1) {
      const batch = cardIds.slice(i, i + 1);
      const res = await fetch(`https://ygocdb.com/api/v0/?search=${batch.join(' ')}`);
      const data = await res.json();
      if (data.result) {
        data.result.forEach(card => { 
          idToCard[String(card.id)] = card;
        });
      }
    }
    return idToCard;
  } catch (err) {
    console.error('获取卡片信息失败:', err);
    return null;
  }
}