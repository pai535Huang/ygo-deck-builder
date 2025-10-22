const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function normalizeStatus(text) {
  if (!text) return '';
  if (text.includes('禁止')) return '禁止';
  if (text.includes('限制') || text.includes('限')) return '限制';
  if (text.includes('准') || text.includes('半')) return '半限制';
  return text || '';
}

async function main() {
  const url = 'https://yxwdbapi.windoent.com/forbiddenCard/forbiddencard/cachelist?groupId=1';
  console.log('Fetching', url);
  const outPath = path.resolve(__dirname, '..', 'data', 'cn_forbidden.json');
  try {
    const json = await fetchJson(url);
    const map = {};
    // json.list 是一个数组，每个元素含有 list 字段
    if (Array.isArray(json.list)) {
      json.list.forEach((section) => {
        if (Array.isArray(section.list)) {
          section.list.forEach((item) => {
            // cardNo 看起来像是我们项目中使用的 cid/id
            const cardNo = String(item.cardNo || item.cardNo === 0 ? item.cardNo : item.id);
            const raw = item.forbiddenCardType || item.forbiddenIcon || '';
            const normalized = normalizeStatus(raw);
            if (cardNo) map[cardNo] = normalized;
          });
        }
      });
    }

    // ensure data dir exists
    const dir = path.dirname(outPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(map, null, 2), 'utf8');
    console.log('Wrote', outPath, 'entries:', Object.keys(map).length);
  } catch (err) {
    console.error('Error fetching or writing CN forbidden list:', err && err.message ? err.message : err);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
