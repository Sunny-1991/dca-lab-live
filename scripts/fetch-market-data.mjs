import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'data', 'market-cache');
const MIN_SUPPORTED_DATE = '1985-01-01';

const SOURCES = [
  {
    assetId: 'sp500',
    assetName: '标普500',
    symbol: '^SPX',
    returnMode: 'price',
    isProxy: false,
    url: 'https://stooq.com/q/d/l/?s=%5Espx&i=d',
  },
  {
    assetId: 'sp500',
    assetName: '标普500',
    symbol: 'SPY.US',
    returnMode: 'total_return',
    isProxy: true,
    url: 'https://stooq.com/q/d/l/?s=spy.us&i=d',
  },
  {
    assetId: 'nasdaq100',
    assetName: '纳斯达克100',
    symbol: '^NDX',
    returnMode: 'price',
    isProxy: false,
    url: 'https://stooq.com/q/d/l/?s=%5Endx&i=d',
  },
  {
    assetId: 'nasdaq100',
    assetName: '纳斯达克100',
    symbol: 'QQQ.US',
    returnMode: 'total_return',
    isProxy: true,
    url: 'https://stooq.com/q/d/l/?s=qqq.us&i=d',
  },
];

function parseCsvRows(csvText) {
  const lines = String(csvText)
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;

    const date = cols[0];
    const close = Number(cols[4]);
    if (typeof date !== 'string' || date < MIN_SUPPORTED_DATE) continue;
    if (!Number.isFinite(close) || close <= 0) continue;

    rows.push([date, Number(close.toFixed(6))]);
  }

  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows;
}

async function fetchCsv(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'dca-lab-data-updater/1.0',
        Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function updateOne(source) {
  console.log(`[fetching] ${source.assetId} ${source.returnMode} from ${source.url}`);
  const csvText = await fetchCsv(source.url);
  const rows = parseCsvRows(csvText);
  if (rows.length < 3000) {
    throw new Error(`${source.assetId} ${source.returnMode} rows too few: ${rows.length}`);
  }

  const payload = {
    assetId: source.assetId,
    assetName: source.assetName,
    symbol: source.symbol,
    requestedReturnMode: source.returnMode,
    resolvedReturnMode: source.returnMode,
    isProxy: source.isProxy,
    isEstimated: false,
    provider: 'Stooq',
    sourceUrl: source.url,
    fetchedAt: new Date().toISOString(),
    earliestDate: rows[0][0],
    latestDate: rows[rows.length - 1][0],
    rows,
  };

  const filename =
    source.returnMode === 'total_return'
      ? `${source.assetId}.total_return.json`
      : `${source.assetId}.json`;
  const outputPath = path.join(outputDir, filename);
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(
    `[updated] ${filename}: ${payload.earliestDate} -> ${payload.latestDate} (${rows.length} rows)`
  );
}

await mkdir(outputDir, { recursive: true });
for (const source of SOURCES) {
  await updateOne(source);
}

console.log('market data refresh complete');
