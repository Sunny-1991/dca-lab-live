import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const storeDir = path.join(rootDir, 'data', 'access-control');
const storePath = path.join(storeDir, 'members.json');
const pepper = process.env.AUTH_CODE_PEPPER || '';

function usage() {
  console.log(`
Usage:
  node scripts/manage-members.mjs list
  node scripts/manage-members.mjs upsert --member-id <id> --name <name> --expires-at <YYYY-MM-DD|ISO> [--access-code <code>] [--status active|paused]
  node scripts/manage-members.mjs import-csv --file <members.csv>
  node scripts/manage-members.mjs remove --member-id <id>
`);
}

function parseArgs(argv) {
  const command = argv[2] || '';
  const options = {};
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
    options[key] = value;
    if (value) i += 1;
  }
  return { command, options };
}

function hashAccessCode(code) {
  return crypto
    .createHash('sha256')
    .update(`${String(code || '').trim()}|${pepper}`, 'utf8')
    .digest('hex');
}

function normalizeExpiry(input) {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('missing --expires-at');
  }
  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = new Date(`${value}T23:59:59+08:00`);
  } else {
    date = new Date(value);
  }
  if (!Number.isFinite(date.getTime())) {
    throw new Error('invalid --expires-at');
  }
  return date.toISOString();
}

function generateAccessCode() {
  return crypto.randomBytes(5).toString('hex');
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\"') {
      const next = line[i + 1];
      if (inQuotes && next === '\"') {
        current += '\"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

async function readStore() {
  await mkdir(storeDir, { recursive: true });
  try {
    const raw = await readFile(storePath, 'utf8');
    const data = raw.trim() ? JSON.parse(raw) : {};
    const members = Array.isArray(data.members) ? data.members : [];
    return { updatedAt: data.updatedAt || '', members };
  } catch {
    return { updatedAt: '', members: [] };
  }
}

async function writeStore(data) {
  const payload = {
    updatedAt: new Date().toISOString(),
    members: data.members,
  };
  await writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function printMembers(members) {
  if (!members.length) {
    console.log('No members');
    return;
  }
  const rows = members.map((item) => ({
    memberId: item.memberId,
    name: item.displayName || '',
    status: item.status || 'active',
    expiresAt: item.expiresAt || '',
    hasCodeHash: Boolean(item.accessCodeHash),
  }));
  console.table(rows);
}

async function upsertMember(options) {
  const memberId = String(options['member-id'] || '').trim();
  if (!memberId) {
    throw new Error('missing --member-id');
  }

  const displayName = String(options.name || '').trim();
  const expiresAt = normalizeExpiry(options['expires-at']);
  const status = String(options.status || 'active').trim().toLowerCase() || 'active';
  if (!['active', 'paused'].includes(status)) {
    throw new Error('invalid --status, use active|paused');
  }

  let accessCode = String(options['access-code'] || '').trim();
  if (!accessCode) {
    accessCode = generateAccessCode();
  }

  const data = await readStore();
  const accessCodeHash = hashAccessCode(accessCode);
  const nextMember = {
    memberId,
    displayName,
    status,
    expiresAt,
    accessCodeHash,
    updatedAt: new Date().toISOString(),
  };

  const index = data.members.findIndex((item) => String(item.memberId || '').trim() === memberId);
  if (index >= 0) {
    data.members[index] = {
      ...data.members[index],
      ...nextMember,
    };
  } else {
    data.members.push(nextMember);
  }

  data.members.sort((a, b) => String(a.memberId).localeCompare(String(b.memberId), 'en'));
  await writeStore(data);
  console.log(`Saved member: ${memberId}`);
  console.log(`Access code: ${accessCode}`);
  console.log(`Store path : ${storePath}`);
}

async function removeMember(options) {
  const memberId = String(options['member-id'] || '').trim();
  if (!memberId) {
    throw new Error('missing --member-id');
  }
  const data = await readStore();
  const before = data.members.length;
  data.members = data.members.filter((item) => String(item.memberId || '').trim() !== memberId);
  await writeStore(data);
  if (data.members.length === before) {
    console.log(`No member removed: ${memberId}`);
  } else {
    console.log(`Removed member: ${memberId}`);
  }
}

async function importCsv(options) {
  const filePath = String(options.file || '').trim();
  if (!filePath) {
    throw new Error('missing --file');
  }
  const csvText = await readFile(path.resolve(filePath), 'utf8');
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV is empty');
  }

  const header = splitCsvLine(lines[0]).map((item) => item.toLowerCase());
  const idxMemberId = header.indexOf('member_id');
  const idxName = header.indexOf('name');
  const idxExpiresAt = header.indexOf('expires_at');
  const idxAccessCode = header.indexOf('access_code');
  const idxStatus = header.indexOf('status');
  if (idxMemberId < 0 || idxExpiresAt < 0 || idxAccessCode < 0) {
    throw new Error('CSV requires columns: member_id, expires_at, access_code');
  }

  const data = await readStore();
  const map = new Map(
    (Array.isArray(data.members) ? data.members : []).map((item) => [String(item.memberId), item])
  );

  let upserted = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const memberId = String(cols[idxMemberId] || '').trim();
    if (!memberId) continue;

    const expiresAt = normalizeExpiry(cols[idxExpiresAt]);
    const accessCode = String(cols[idxAccessCode] || '').trim();
    if (!accessCode) continue;
    const statusRaw = idxStatus >= 0 ? String(cols[idxStatus] || '').trim().toLowerCase() : 'active';
    const status = ['active', 'paused'].includes(statusRaw) ? statusRaw : 'active';

    map.set(memberId, {
      ...(map.get(memberId) || {}),
      memberId,
      displayName: idxName >= 0 ? String(cols[idxName] || '').trim() : '',
      status,
      expiresAt,
      accessCodeHash: hashAccessCode(accessCode),
      updatedAt: new Date().toISOString(),
    });
    upserted += 1;
  }

  data.members = Array.from(map.values()).sort((a, b) =>
    String(a.memberId).localeCompare(String(b.memberId), 'en')
  );
  await writeStore(data);
  console.log(`Imported rows: ${upserted}`);
  console.log(`Store path   : ${storePath}`);
}

async function main() {
  const { command, options } = parseArgs(process.argv);
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    usage();
    return;
  }

  if (command === 'list') {
    const data = await readStore();
    printMembers(data.members || []);
    return;
  }

  if (command === 'upsert') {
    await upsertMember(options);
    return;
  }

  if (command === 'remove') {
    await removeMember(options);
    return;
  }

  if (command === 'import-csv') {
    await importCsv(options);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exitCode = 1;
});
