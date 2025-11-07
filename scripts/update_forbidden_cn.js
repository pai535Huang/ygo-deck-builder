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

// 从最外层 section.type 推导状态，仅接受：禁止卡/限制卡/准限制卡（兼容“半限制卡”=>“准限制”）
function statusFromSectionType(type) {
  if (!type || typeof type !== 'string') return null;
  const t = type.trim();
  if (t === '禁止卡') return '禁止';
  if (t === '限制卡') return '限制';
  if (t === '准限制卡' || t === '半限制卡') return '准限制';
  // 其它（如“更新卡片”、“解除限制卡片”）忽略
  return null;
}

// 多分组重复出现时的合并规则：选择“更宽松”的结果（准限制 > 限制 > 禁止）
const statusScore = { '禁止': 0, '限制': 1, '准限制': 2 };

async function main() {
  const url = 'https://yxwdbapi.windoent.com/forbiddenCard/forbiddencard/cachelist?groupId=1';
  console.log('Fetching', url);
  const outPath = path.resolve(__dirname, '..', 'data', 'cn_forbidden.json');
  try {
    const json = await fetchJson(url);
    const map = {};
    // 仅读取外层 list 中 type 为 禁止卡/限制卡/准限制卡 的部分
    if (Array.isArray(json.list)) {
      json.list.forEach((section) => {
        const status = statusFromSectionType(section && section.type);
        if (!status) return; // 忽略“更新卡片”与“解除限制卡片”等
        if (Array.isArray(section.list)) {
          section.list.forEach((item) => {
            // cardNo 看起来像是我们项目中使用的 cid/id
            const cardNo = (item && item.cardNo != null)
              ? String(item.cardNo)
              : (item && item.id != null)
                ? String(item.id)
                : null;
            if (cardNo) {
              const prev = map[cardNo];
              if (prev == null || (statusScore[status] ?? -1) > (statusScore[prev] ?? -1)) {
                map[cardNo] = status; // 以“更宽松”的状态覆盖之前的值
              }
            }
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
