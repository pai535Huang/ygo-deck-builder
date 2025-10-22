const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c.toString('utf8'));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseTablepressGenesys(html) {
  const map = {};
  // find tablepress-genesys tbody
  const tbodyMatch = html.match(/<table[^>]*id="tablepress-genesys"[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return map;
  const tbody = tbodyMatch[1];
  // find rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRegex.exec(tbody)) !== null) {
    const tr = row[1];
    // extract two td columns
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const tds = [];
    let td;
    while ((td = tdRegex.exec(tr)) !== null) {
      let txt = td[1].replace(/<[^>]+>/g, '').trim();
      txt = txt.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
      tds.push(txt);
    }
    if (tds.length >= 2) {
      const name = tds[0];
      const points = Number(tds[1]) || 0;
      if (name) map[name] = points;
    }
  }
  return map;
}

async function main() {
  const url = 'https://www.yugioh-card.com/en/genesys/';
  console.log('Fetching', url);
  try {
    const html = await fetchHtml(url);
    console.log('Parsing GENESYS table...');
    const map = parseTablepressGenesys(html);
    const outPath = path.join(__dirname, '..', 'data', 'genesys_scores.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(map, null, 2), 'utf8');
    console.log('Wrote', outPath, 'entries:', Object.keys(map).length);
  } catch (err) {
    console.error('Failed to fetch/parse GENESYS:', err && err.message ? err.message : err);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
