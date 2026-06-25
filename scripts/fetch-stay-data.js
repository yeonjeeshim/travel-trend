const https = require('https');
const fs = require('fs');
const path = require('path');

const API_ID = process.env.NAVER_API_ID;
const API_SECRET = process.env.NAVER_API_SECRET;

const CITIES = [
  '여수','강릉','제주시','경주','전주','부산','속초','통영','순천','서귀포시',
  '안동','군산','춘천','평창','보령','서울','공주','인천','수원','천안'
];
const STAY_TYPES = ['펜션','호텔','리조트','풀빌라','게스트하우스','모텔'];

function getPeriod() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 1);
  const fmt = d => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function callDataLab(keywordGroups) {
  return new Promise((resolve, reject) => {
    const { startDate, endDate } = getPeriod();
    const body = JSON.stringify({ startDate, endDate, timeUnit: 'week', keywordGroups });
    const options = {
      hostname: 'openapi.naver.com',
      path: '/v1/datalab/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Naver-Client-Id': API_ID,
        'X-Naver-Client-Secret': API_SECRET,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseResult(results) {
  return results.map(r => {
    const vals = r.data.map(d => d.ratio);
    const n = vals.length;
    const third = Math.max(1, Math.floor(n / 3));
    const avgFirst = vals.slice(0, third).reduce((a, b) => a + b, 0) / third || 0.1;
    const avgLast = vals.slice(n - third).reduce((a, b) => a + b, 0) / third;
    const score = Math.round(vals.reduce((a, b) => a + b, 0) / n);
    const chg = Math.round(((avgLast - avgFirst) / avgFirst) * 100);
    return { name: r.title, score, chg };
  });
}

async function main() {
  if (!API_ID || !API_SECRET) {
    console.error('NAVER_API_ID, NAVER_API_SECRET 환경변수가 필요합니다');
    process.exit(1);
  }

  const result = {};
  let total = 0, errors = 0;

  for (const type of STAY_TYPES) {
    for (let i = 0; i < CITIES.length; i += 5) {
      const batch = CITIES.slice(i, i + 5);
      const groups = batch.map(city => ({
        groupName: `${city}_${type}`,
        keywords: [`${city} ${type}`]
      }));

      try {
        const data = await callDataLab(groups);
        parseResult(data.results).forEach(r => {
          result[r.name] = { score: r.score, chg: r.chg };
          total++;
        });
        console.log(`✓ ${type} [${batch.join(', ')}]`);
      } catch (e) {
        console.error(`✗ ${type} [${batch.join(', ')}]: ${e.message}`);
        errors++;
      }

      await sleep(300);
    }
  }

  const output = {
    updatedAt: new Date().toISOString().slice(0, 10),
    data: result
  };

  const outPath = path.join(__dirname, '..', 'data', 'stay-cache.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n완료: ${total}개 저장, ${errors}개 실패 → data/stay-cache.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
