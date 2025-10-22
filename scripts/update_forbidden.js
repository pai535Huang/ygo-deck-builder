#!/usr/bin/env node
// 从官方 OCG 禁限表页面抓取并解析（基于 card cid -> 限制等级）
// 参考了提供的 python 实现：通过检测 div id (list_forbidden/list_limited/list_semi_limited)
// 并匹配隐藏 input 的 cid 提取映射，输出为 data/ocg_forbidden.json（cid -> 日文状态）

const fs = require('fs');
const path = require('path');
const https = require('https');

const URL_JA = 'https://www.db.yugioh-card.com/yugiohdb/forbidden_limited.action?request_locale=ja';
const URL_EN = 'https://www.db.yugioh-card.com/yugiohdb/forbidden_limited.action?request_locale=en';
const URL_AE = 'https://www.db.yugioh-card.com/yugiohdb/forbidden_limited.action?request_locale=ae';
const OUT_PATH_OCG = path.join(__dirname, '..', 'data', 'ocg_forbidden.json');
const OUT_PATH_TCG = path.join(__dirname, '..', 'data', 'tcg_forbidden.json');
const OUT_PATH_AE = path.join(__dirname, '..', 'data', 'ae_forbidden.json');

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error('Status ' + res.statusCode));
      let data = '';
      res.on('data', chunk => data += chunk.toString('utf8'));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseByCid(html, labelMap) {
  // current_status: -1 none, 0 forbidden, 1 limited, 2 semi-limited
  let current_status = -1;
  const mapping = {}; // cid -> japanese text
  const lines = html.split(/\r?\n/);
  for (const line of lines) {
    if (line.indexOf('</div><!-- #list_semi_limited .list_set -->') !== -1) {
      current_status = -1;
    }
    if (line.indexOf('<div id="list_semi_limited" class="list_set">') !== -1) {
      current_status = 2;
    }
    if (line.indexOf('<div id="list_forbidden" class="list_set">') !== -1) {
      current_status = 0;
    }
    if (line.indexOf('<div id="list_limited" class="list_set">') !== -1) {
      current_status = 1;
    }

    const pattern = /<input[^>]*class="link_value"[^>]*value="[^"]*cid=(\d+)"/i;
    const m = pattern.exec(line);
    if (m && current_status >= 0) {
      const cid = m[1];
      mapping[cid] = (labelMap && labelMap[current_status]) ? labelMap[current_status] : String(current_status);
    }
  }

  return mapping;
}

async function fetchAndWrite(url, outPath, labelMap) {
  try {
    console.log('Fetching', url);
    const html = await fetchHtml(url);
    console.log('Parsing by cid...');
    const parsed = parseByCid(html, labelMap);
    console.log('Found', Object.keys(parsed).length, 'entries for', outPath);
    fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
    console.log('Wrote', outPath);
  } catch (err) {
    console.error('Failed to fetch/write', outPath, err && err.message ? err.message : err);
  }
}

async function main() {
  // Japanese labels (OCG)
  const jaLabelMap = { 0: '禁止', 1: '制限', 2: '準制限' };
  // English labels (TCG)
  const enLabelMap = { 0: 'Forbidden', 1: 'Limited', 2: 'Semi-Limited' };
  // AE uses same structure/labels as EN (use English labels)
  const aeLabelMap = enLabelMap;

  await fetchAndWrite(URL_JA, OUT_PATH_OCG, jaLabelMap);
  await fetchAndWrite(URL_EN, OUT_PATH_TCG, enLabelMap);
  await fetchAndWrite(URL_AE, OUT_PATH_AE, aeLabelMap);
}

main();
