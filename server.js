const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const LOCAL_DATA_DIR = path.join(ROOT_DIR, "data", "market-cache");
const MIN_SUPPORTED_DATE = "1985-01-01";
const LOCAL_CACHE_STALE_MS = 5 * 24 * 60 * 60 * 1000;
const REQUEST_FRESH_WINDOW_MS = readPositiveMs(
  process.env.REQUEST_FRESH_WINDOW_MS,
  6 * 60 * 60 * 1000
);
const REQUEST_REFRESH_TIMEOUT_MS = readPositiveMs(
  process.env.REQUEST_REFRESH_TIMEOUT_MS,
  12000
);
const BACKGROUND_REFRESH_INTERVAL_MS = readPositiveMs(
  process.env.BACKGROUND_REFRESH_INTERVAL_MS,
  6 * 60 * 60 * 1000
);
const STARTUP_REFRESH_DELAY_MS = readPositiveMs(
  process.env.STARTUP_REFRESH_DELAY_MS,
  30 * 1000
);
const BACKGROUND_REFRESH_TRIGGER_MS = readPositiveMs(
  process.env.BACKGROUND_REFRESH_TRIGGER_MS,
  2 * 60 * 60 * 1000
);
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";
const CORS_ALLOW_HEADERS = process.env.CORS_ALLOW_HEADERS || "Content-Type";
const CORS_ALLOW_METHODS = "GET,POST,OPTIONS";
const AUTH_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.AUTH_ENABLED || "false").toLowerCase()
);
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "dca_member_session";
const AUTH_SESSION_TTL_MS = readPositiveMs(process.env.AUTH_SESSION_TTL_MS, 24 * 60 * 60 * 1000);
const AUTH_COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || "auto").toLowerCase();
const AUTH_CODE_PEPPER = process.env.AUTH_CODE_PEPPER || "";
const AUTH_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const ACCESS_CONTROL_DIR = path.join(ROOT_DIR, "data", "access-control");
const MEMBER_STORE_PATH = path.join(ACCESS_CONTROL_DIR, "members.json");

const RETURN_MODES = {
  PRICE: "price",
  TOTAL_RETURN: "total_return",
};
const ALL_RETURN_MODES = [RETURN_MODES.PRICE, RETURN_MODES.TOTAL_RETURN];

const ESTIMATED_DIVIDEND_YIELD_BY_ASSET = {
  sp500: [
    { from: "1985-01-01", to: "1999-12-31", annualPct: 2.4 },
    { from: "2000-01-01", to: "2009-12-31", annualPct: 1.9 },
    { from: "2010-01-01", to: "2019-12-31", annualPct: 2.0 },
    { from: "2020-01-01", to: "2099-12-31", annualPct: 1.5 },
  ],
  nasdaq100: [
    { from: "1985-01-01", to: "2003-12-31", annualPct: 0.25 },
    { from: "2004-01-01", to: "2013-12-31", annualPct: 0.8 },
    { from: "2014-01-01", to: "2019-12-31", annualPct: 0.9 },
    { from: "2020-01-01", to: "2099-12-31", annualPct: 0.7 },
  ],
};

const ASSETS = {
  sp500: {
    id: "sp500",
    name: "标普500",
    profiles: {
      [RETURN_MODES.TOTAL_RETURN]: {
        symbol: "SPY.US",
        isProxy: true,
        sources: [
          {
            provider: "Stooq",
            format: "stooq",
            timeoutMs: 140000,
            url: "https://stooq.com/q/d/l/?s=spy.us&i=d",
            resolvedReturnMode: RETURN_MODES.TOTAL_RETURN,
            symbol: "SPY.US",
            isProxy: true,
          },
          {
            provider: "FRED",
            format: "fred",
            timeoutMs: 22000,
            url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500",
            resolvedReturnMode: RETURN_MODES.PRICE,
            symbol: "^SPX",
            isProxy: false,
          },
        ],
      },
      [RETURN_MODES.PRICE]: {
        symbol: "^SPX",
        isProxy: false,
        sources: [
          {
            provider: "Stooq",
            format: "stooq",
            timeoutMs: 240000,
            url: "https://stooq.com/q/d/l/?s=%5Espx&i=d",
            resolvedReturnMode: RETURN_MODES.PRICE,
            symbol: "^SPX",
            isProxy: false,
          },
          {
            provider: "FRED",
            format: "fred",
            timeoutMs: 22000,
            url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500",
            resolvedReturnMode: RETURN_MODES.PRICE,
            symbol: "^SPX",
            isProxy: false,
          },
        ],
      },
    },
  },
  nasdaq100: {
    id: "nasdaq100",
    name: "纳斯达克100",
    profiles: {
      [RETURN_MODES.TOTAL_RETURN]: {
        symbol: "QQQ.US",
        isProxy: true,
        sources: [
          {
            provider: "Stooq",
            format: "stooq",
            timeoutMs: 140000,
            url: "https://stooq.com/q/d/l/?s=qqq.us&i=d&d1=19990101",
            resolvedReturnMode: RETURN_MODES.TOTAL_RETURN,
            symbol: "QQQ.US",
            isProxy: true,
          },
          {
            provider: "FRED",
            format: "fred",
            timeoutMs: 22000,
            url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQ100",
            resolvedReturnMode: RETURN_MODES.PRICE,
            symbol: "^NDX",
            isProxy: false,
          },
        ],
      },
      [RETURN_MODES.PRICE]: {
        symbol: "^NDX",
        isProxy: false,
        sources: [
          {
            provider: "Stooq",
            format: "stooq",
            timeoutMs: 120000,
            url: "https://stooq.com/q/d/l/?s=%5Endx&i=d",
            resolvedReturnMode: RETURN_MODES.PRICE,
            symbol: "^NDX",
            isProxy: false,
          },
          {
            provider: "FRED",
            format: "fred",
            timeoutMs: 22000,
            url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQ100",
            resolvedReturnMode: RETURN_MODES.PRICE,
            symbol: "^NDX",
            isProxy: false,
          },
        ],
      },
    },
  },
};

const inMemorySeries = new Map();
const refreshJobs = new Map();
let autoRefreshTimer = null;
const authSessions = new Map();
let memberStoreCache = {
  mtimeMs: -1,
  members: [],
};

function readPositiveMs(value, fallbackMs) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
}

function normalizeReturnMode(rawMode) {
  return rawMode === RETURN_MODES.PRICE ? RETURN_MODES.PRICE : RETURN_MODES.TOTAL_RETURN;
}

function assetCacheKey(assetId, returnMode) {
  return `${assetId}:${normalizeReturnMode(returnMode)}`;
}

function getAssetProfile(assetId, returnMode) {
  const assetMeta = ASSETS[assetId];
  if (!assetMeta) {
    throw new Error(`不支持的资产：${assetId}`);
  }
  const mode = normalizeReturnMode(returnMode);
  const profile = assetMeta.profiles?.[mode];
  if (!profile) {
    throw new Error(`资产 ${assetId} 不支持回测口径：${mode}`);
  }
  return { assetMeta, profile, returnMode: mode };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": CORS_ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain") {
  res.writeHead(statusCode, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Access-Control-Allow-Origin": CORS_ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  });
  res.end(text);
}

function hashAccessCode(rawCode) {
  return crypto
    .createHash("sha256")
    .update(`${String(rawCode || "").trim()}|${AUTH_CODE_PEPPER}`, "utf8")
    .digest("hex");
}

function secureCompareHex(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  if (!leftText || !rightText || leftText.length !== rightText.length) return false;
  const leftBuf = Buffer.from(leftText, "utf8");
  const rightBuf = Buffer.from(rightText, "utf8");
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function parseCookies(cookieHeader) {
  const result = {};
  const text = String(cookieHeader || "");
  if (!text) return result;
  text.split(";").forEach((chunk) => {
    const index = chunk.indexOf("=");
    if (index <= 0) return;
    const key = chunk.slice(0, index).trim();
    if (!key) return;
    const value = chunk.slice(index + 1).trim();
    result[key] = decodeURIComponent(value);
  });
  return result;
}

function isHttpsRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (forwardedProto.includes("https")) return true;
  if (req.socket && req.socket.encrypted) return true;
  return false;
}

function shouldSetSecureCookie(req) {
  if (AUTH_COOKIE_SECURE === "true" || AUTH_COOKIE_SECURE === "1") return true;
  if (AUTH_COOKIE_SECURE === "false" || AUTH_COOKIE_SECURE === "0") return false;
  return isHttpsRequest(req);
}

function buildSessionCookie(req, tokenValue, maxAgeMs) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(tokenValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ];
  if (shouldSetSecureCookie(req)) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function parseMemberExpiryMs(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T23:59:59+08:00`);
    return parsed.getTime();
  }
  return new Date(text).getTime();
}

function normalizeMemberRecord(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object") return null;
  const memberId = String(
    rawEntry.memberId || rawEntry.id || rawEntry.userId || rawEntry.uid || ""
  ).trim();
  if (!memberId) return null;

  const status = String(rawEntry.status || "active").trim().toLowerCase();
  const expiresAtMs = parseMemberExpiryMs(rawEntry.expiresAt || rawEntry.validUntil || rawEntry.expireAt);
  const accessCodeHash = String(rawEntry.accessCodeHash || "").trim().toLowerCase();
  const accessCodePlain = String(rawEntry.accessCode || "").trim();
  const finalHash = accessCodeHash || (accessCodePlain ? hashAccessCode(accessCodePlain) : "");
  if (!finalHash) return null;

  return {
    memberId,
    displayName: String(rawEntry.displayName || rawEntry.name || "").trim(),
    status,
    expiresAtMs,
    expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : "",
    accessCodeHash: finalHash,
  };
}

function isMemberActive(member, nowMs = Date.now()) {
  if (!member) return false;
  if (member.status !== "active") return false;
  if (!Number.isFinite(member.expiresAtMs)) return false;
  return member.expiresAtMs >= nowMs;
}

async function ensureMemberStoreFile() {
  await fsp.mkdir(ACCESS_CONTROL_DIR, { recursive: true });
  try {
    await fsp.access(MEMBER_STORE_PATH, fs.constants.F_OK);
  } catch {
    const seed = {
      updatedAt: new Date().toISOString(),
      members: [],
    };
    await fsp.writeFile(MEMBER_STORE_PATH, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
}

async function loadMembersFromStore() {
  await ensureMemberStoreFile();
  const stat = await fsp.stat(MEMBER_STORE_PATH);
  if (memberStoreCache.mtimeMs === stat.mtimeMs) {
    return memberStoreCache.members;
  }
  let members = [];
  try {
    const rawText = await fsp.readFile(MEMBER_STORE_PATH, "utf8");
    const parsed = rawText.trim() ? JSON.parse(rawText) : {};
    members = Array.isArray(parsed.members)
      ? parsed.members.map(normalizeMemberRecord).filter(Boolean)
      : [];
  } catch (error) {
    console.error(`[auth] 会员文件解析失败，已回退为空列表：${error.message}`);
    members = [];
  }
  memberStoreCache = {
    mtimeMs: stat.mtimeMs,
    members,
  };
  return members;
}

async function findMember(memberId) {
  const normalized = String(memberId || "").trim();
  if (!normalized) return null;
  const members = await loadMembersFromStore();
  return members.find((item) => item.memberId === normalized) || null;
}

function pruneExpiredSessions(nowMs = Date.now()) {
  for (const [token, session] of authSessions.entries()) {
    if (!session || !Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= nowMs) {
      authSessions.delete(token);
    }
  }
}

async function resolveMemberFromSession(req) {
  if (!AUTH_ENABLED) return null;
  pruneExpiredSessions();
  const cookies = parseCookies(req.headers.cookie || "");
  const token = String(cookies[AUTH_COOKIE_NAME] || "").trim();
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  const member = await findMember(session.memberId);
  if (!isMemberActive(member)) {
    authSessions.delete(token);
    return null;
  }
  return member;
}

function createSession(memberId) {
  const entropy = `${crypto.randomBytes(24).toString("hex")}:${Date.now()}:${Math.random()}`;
  const token = crypto.createHmac("sha256", AUTH_SESSION_SECRET).update(entropy).digest("hex");
  authSessions.set(token, {
    memberId,
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + AUTH_SESSION_TTL_MS,
  });
  return token;
}

function clearSessionByRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = String(cookies[AUTH_COOKIE_NAME] || "").trim();
  if (!token) return;
  authSessions.delete(token);
}

function isPublicAuthRoute(pathname) {
  return (
    pathname === "/login.html" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/me" ||
    pathname === "/healthz"
  );
}

function redirectToLogin(res, nextPath) {
  const encodedNext = encodeURIComponent(nextPath || "/");
  res.writeHead(302, {
    Location: `/login.html?next=${encodedNext}`,
    "Cache-Control": "no-store",
  });
  res.end();
}

function handleHealthz(res) {
  sendJson(res, 200, {
    ok: true,
    service: "dca-lab",
    authEnabled: AUTH_ENABLED,
    now: new Date().toISOString(),
  });
}

function parseIsoDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`日期无效：${isoDate}`);
  }
  return date;
}

function toIsoDate(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function isValidRow(date, close) {
  return (
    typeof date === "string" &&
    date >= MIN_SUPPORTED_DATE &&
    Number.isFinite(close) &&
    close > 0
  );
}

function normalizeRows(rawRows) {
  const parsedRows = [];

  rawRows.forEach((entry) => {
    if (!entry) return;

    let date;
    let close;

    if (Array.isArray(entry)) {
      [date, close] = entry;
    } else {
      date = entry.date;
      close = entry.close;
    }

    const closeValue = Number(close);
    if (!isValidRow(date, closeValue)) return;
    parsedRows.push({ date, close: closeValue });
  });

  parsedRows.sort((a, b) => (a.date < b.date ? -1 : 1));

  const deduped = [];
  for (const row of parsedRows) {
    const last = deduped[deduped.length - 1];
    if (last && last.date === row.date) {
      deduped[deduped.length - 1] = row;
      continue;
    }
    deduped.push(row);
  }

  return deduped.map((row) => ({
    date: row.date,
    dateObj: parseIsoDate(row.date),
    close: row.close,
  }));
}

function buildAssetPayload(assetId, rawRows, options = {}) {
  const assetMeta = ASSETS[assetId];
  const rows = normalizeRows(rawRows);
  if (rows.length === 0) {
    throw new Error(`${assetMeta.name} 无有效历史数据`);
  }

  const requestedReturnMode = normalizeReturnMode(
    options.requestedReturnMode || options.resolvedReturnMode || RETURN_MODES.PRICE
  );
  const resolvedReturnMode = normalizeReturnMode(
    options.resolvedReturnMode || requestedReturnMode
  );
  const defaultSymbol = assetMeta.profiles?.[resolvedReturnMode]?.symbol || "";

  return {
    assetId,
    assetName: assetMeta.name,
    symbol: options.symbol || defaultSymbol,
    requestedReturnMode,
    resolvedReturnMode,
    isProxy: Boolean(options.isProxy),
    isEstimated: Boolean(options.isEstimated),
    provider: options.provider || "Local cache",
    sourceUrl: options.sourceUrl || "",
    fetchedAt: options.fetchedAt || new Date().toISOString(),
    earliestDate: rows[0].date,
    latestDate: rows[rows.length - 1].date,
    rows,
  };
}

function cacheFilePath(assetId, returnMode) {
  const mode = normalizeReturnMode(returnMode);
  const suffix = mode === RETURN_MODES.PRICE ? ".json" : `.${mode}.json`;
  return path.join(LOCAL_DATA_DIR, `${assetId}${suffix}`);
}

async function readLocalCache(assetId, returnMode) {
  const mode = normalizeReturnMode(returnMode);
  const filePath = cacheFilePath(assetId, mode);

  try {
    const rawText = await fsp.readFile(filePath, "utf8");
    const payload = JSON.parse(rawText);
    return buildAssetPayload(assetId, payload.rows, {
      symbol: payload.symbol,
      provider: payload.provider,
      sourceUrl: payload.sourceUrl,
      fetchedAt: payload.fetchedAt,
      requestedReturnMode: payload.requestedReturnMode || mode,
      resolvedReturnMode: payload.resolvedReturnMode || payload.requestedReturnMode || mode,
      isProxy: payload.isProxy,
      isEstimated: payload.isEstimated,
    });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    console.warn(`[data] 本地缓存读取失败 (${assetId}:${mode}): ${error.message}`);
    return null;
  }
}

async function writeLocalCache(assetPayload) {
  await fsp.mkdir(LOCAL_DATA_DIR, { recursive: true });
  const filePath = cacheFilePath(assetPayload.assetId, assetPayload.requestedReturnMode);

  const compactRows = assetPayload.rows.map((row) => [row.date, Number(row.close.toFixed(6))]);
  const serializable = {
    assetId: assetPayload.assetId,
    assetName: assetPayload.assetName,
    symbol: assetPayload.symbol,
    requestedReturnMode: assetPayload.requestedReturnMode,
    resolvedReturnMode: assetPayload.resolvedReturnMode,
    isProxy: assetPayload.isProxy,
    isEstimated: assetPayload.isEstimated,
    provider: assetPayload.provider,
    sourceUrl: assetPayload.sourceUrl,
    fetchedAt: assetPayload.fetchedAt,
    earliestDate: assetPayload.earliestDate,
    latestDate: assetPayload.latestDate,
    rows: compactRows,
  };

  await fsp.writeFile(filePath, JSON.stringify(serializable), "utf8");
}

function isStale(assetPayload) {
  const fetchedMs = Date.parse(assetPayload.fetchedAt);
  if (!Number.isFinite(fetchedMs)) return true;
  return Date.now() - fetchedMs > LOCAL_CACHE_STALE_MS;
}

function payloadAgeMs(assetPayload) {
  if (!assetPayload) return Number.POSITIVE_INFINITY;
  const fetchedMs = Date.parse(assetPayload.fetchedAt);
  if (!Number.isFinite(fetchedMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - fetchedMs);
}

function returnModeLabel(returnMode) {
  return normalizeReturnMode(returnMode) === RETURN_MODES.PRICE ? "价格收益" : "全收益";
}

function estimatedDividendYieldPct(assetId, isoDate) {
  const ranges = ESTIMATED_DIVIDEND_YIELD_BY_ASSET[assetId];
  if (!ranges || ranges.length === 0) {
    return 0;
  }
  const match = ranges.find((item) => isoDate >= item.from && isoDate <= item.to);
  return match ? match.annualPct : ranges[ranges.length - 1].annualPct;
}

function estimateTotalReturnRowsFromPrice(assetId, normalizedRows) {
  if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) {
    return [];
  }

  let totalReturnLevel = normalizedRows[0].close;
  const output = [{ date: normalizedRows[0].date, close: totalReturnLevel }];

  for (let i = 1; i < normalizedRows.length; i += 1) {
    const prev = normalizedRows[i - 1];
    const curr = normalizedRows[i];
    if (!(prev.close > 0) || !(curr.close > 0)) continue;

    const priceFactor = curr.close / prev.close;
    const gapDays = Math.max(1, differenceInDays(prev.dateObj, curr.dateObj));
    const annualYieldPct = estimatedDividendYieldPct(assetId, curr.date);
    const dailyYield = annualYieldPct / 100 / 252;
    const dividendFactor = Math.pow(1 + dailyYield, gapDays);
    totalReturnLevel = totalReturnLevel * priceFactor * dividendFactor;
    output.push({ date: curr.date, close: totalReturnLevel });
  }

  return output;
}

function buildEstimatedTotalReturnPayloadFromPrice(assetPayload) {
  if (!assetPayload) return null;
  if (assetPayload.resolvedReturnMode === RETURN_MODES.TOTAL_RETURN && !assetPayload.isEstimated) {
    return assetPayload;
  }

  const estimatedRows = estimateTotalReturnRowsFromPrice(assetPayload.assetId, assetPayload.rows);
  return buildAssetPayload(assetPayload.assetId, estimatedRows, {
    symbol: `${assetPayload.symbol || ""}`.trim(),
    provider: `${assetPayload.provider} + DividendModel`,
    sourceUrl: assetPayload.sourceUrl,
    fetchedAt: assetPayload.fetchedAt,
    requestedReturnMode: RETURN_MODES.TOTAL_RETURN,
    resolvedReturnMode: RETURN_MODES.TOTAL_RETURN,
    isProxy: true,
    isEstimated: true,
  });
}

function findClosestRowByDate(rows, targetIsoDate) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let left = null;
  let right = null;

  for (const row of rows) {
    if (row.date <= targetIsoDate) {
      left = row;
      continue;
    }
    right = row;
    break;
  }

  if (!left) return right;
  if (!right) return left;

  const targetMs = parseIsoDate(targetIsoDate).getTime();
  const leftDelta = Math.abs(parseIsoDate(left.date).getTime() - targetMs);
  const rightDelta = Math.abs(parseIsoDate(right.date).getTime() - targetMs);
  return leftDelta <= rightDelta ? left : right;
}

function backfillTotalReturnHistory(assetId, totalPayload, pricePayload) {
  if (!totalPayload || !pricePayload) return totalPayload;
  if (totalPayload.earliestDate <= pricePayload.earliestDate) return totalPayload;
  if (!Array.isArray(totalPayload.rows) || totalPayload.rows.length === 0) return totalPayload;
  if (!Array.isArray(pricePayload.rows) || pricePayload.rows.length === 0) return totalPayload;

  const estimatedRows = estimateTotalReturnRowsFromPrice(assetId, pricePayload.rows);
  if (estimatedRows.length < 2) return totalPayload;

  const anchorTotal = totalPayload.rows[0];
  const anchorEstimated = findClosestRowByDate(estimatedRows, anchorTotal.date);
  if (!anchorEstimated || !(anchorEstimated.close > 0) || !(anchorTotal.close > 0)) {
    return totalPayload;
  }

  const scale = anchorTotal.close / anchorEstimated.close;
  const historicalRows = estimatedRows
    .filter((row) => row.date < anchorTotal.date)
    .map((row) => ({
      date: row.date,
      close: row.close * scale,
    }));

  if (historicalRows.length === 0) return totalPayload;

  const mergedRows = [
    ...historicalRows,
    ...totalPayload.rows.map((row) => ({
      date: row.date,
      close: row.close,
    })),
  ];

  return buildAssetPayload(assetId, mergedRows, {
    symbol: totalPayload.symbol,
    provider: `${totalPayload.provider} + HistoryBackfill`,
    sourceUrl: totalPayload.sourceUrl,
    fetchedAt: totalPayload.fetchedAt,
    requestedReturnMode: RETURN_MODES.TOTAL_RETURN,
    resolvedReturnMode: RETURN_MODES.TOTAL_RETURN,
    isProxy: totalPayload.isProxy,
    isEstimated: false,
  });
}

async function getPriceSeriesForBackfill(assetId) {
  const cacheKey = assetCacheKey(assetId, RETURN_MODES.PRICE);
  const memoryPayload = inMemorySeries.get(cacheKey);
  if (memoryPayload) return memoryPayload;

  const localPayload = await readLocalCache(assetId, RETURN_MODES.PRICE);
  if (localPayload) {
    inMemorySeries.set(cacheKey, localPayload);
    return localPayload;
  }

  try {
    return await fetchAssetFromRemote(assetId, RETURN_MODES.PRICE);
  } catch (error) {
    return null;
  }
}

async function ensureTotalReturnHistoryBackfilled(assetId, assetPayload) {
  if (!assetPayload) return assetPayload;
  if (assetPayload.requestedReturnMode !== RETURN_MODES.TOTAL_RETURN) {
    return assetPayload;
  }
  if (assetPayload.resolvedReturnMode !== RETURN_MODES.TOTAL_RETURN) {
    return assetPayload;
  }

  const pricePayload = await getPriceSeriesForBackfill(assetId);
  return backfillTotalReturnHistory(assetId, assetPayload, pricePayload);
}

function shouldRetryTotalReturnUpgrade(assetPayload) {
  if (!assetPayload) return false;
  return (
    assetPayload.requestedReturnMode === RETURN_MODES.TOTAL_RETURN &&
    (assetPayload.resolvedReturnMode !== RETURN_MODES.TOTAL_RETURN || assetPayload.isEstimated)
  );
}

function buildModeFallbackPayload(assetPayload, requestedReturnMode) {
  if (!assetPayload) return null;
  const requestedMode = normalizeReturnMode(requestedReturnMode);
  if (requestedMode === RETURN_MODES.TOTAL_RETURN) {
    if (assetPayload.resolvedReturnMode === RETURN_MODES.TOTAL_RETURN) {
      return assetPayload;
    }
    return buildEstimatedTotalReturnPayloadFromPrice(assetPayload);
  }

  if (assetPayload.requestedReturnMode === requestedMode) {
    return assetPayload;
  }

  return buildAssetPayload(assetPayload.assetId, assetPayload.rows, {
    symbol: assetPayload.symbol,
    provider: assetPayload.provider,
    sourceUrl: assetPayload.sourceUrl,
    fetchedAt: assetPayload.fetchedAt,
    requestedReturnMode: requestedMode,
    resolvedReturnMode: assetPayload.resolvedReturnMode || RETURN_MODES.PRICE,
    isProxy: assetPayload.isProxy,
  });
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await promise;
  }

  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(timeoutMessage || `操作超时（>${timeoutMs}ms）`));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function shouldForceHistoricalRefresh(assetPayload) {
  if (!assetPayload) return true;
  if (
    assetPayload.assetId === "sp500" &&
    assetPayload.requestedReturnMode === RETURN_MODES.PRICE &&
    assetPayload.earliestDate > "1990-01-01"
  ) {
    return true;
  }
  return false;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "dca-compound-lab/1.0",
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

function parseStooqCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const [date, , , , close] = line.split(",");
    const closeValue = Number(close);
    if (!isValidRow(date, closeValue)) continue;
    rows.push({ date, close: closeValue });
  }
  return rows;
}

function parseFredCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const [date, closeText] = line.split(",");
    const closeValue = Number(closeText);
    if (!isValidRow(date, closeValue)) continue;
    rows.push({ date, close: closeValue });
  }
  return rows;
}

function parseByFormat(csvText, format) {
  if (format === "fred") return parseFredCsv(csvText);
  return parseStooqCsv(csvText);
}

async function fetchAssetFromRemote(assetId, returnMode) {
  const { assetMeta, profile, returnMode: requestedReturnMode } = getAssetProfile(assetId, returnMode);
  const errors = [];

  for (const source of profile.sources) {
    try {
      const csv = await fetchText(source.url, source.timeoutMs);
      const rows = parseByFormat(csv, source.format);
      if (rows.length < 200) {
        throw new Error(`数据点过少 (${rows.length})`);
      }

      const payload = buildAssetPayload(assetId, rows, {
        symbol: source.symbol || profile.symbol,
        provider: source.provider,
        sourceUrl: source.url,
        fetchedAt: new Date().toISOString(),
        requestedReturnMode,
        resolvedReturnMode: source.resolvedReturnMode || requestedReturnMode,
        isProxy: source.isProxy ?? profile.isProxy,
      });
      if (requestedReturnMode === RETURN_MODES.TOTAL_RETURN) {
        if (payload.resolvedReturnMode !== RETURN_MODES.TOTAL_RETURN) {
          return buildEstimatedTotalReturnPayloadFromPrice(payload);
        }

        const pricePayload = await getPriceSeriesForBackfill(assetId);
        const stitched = backfillTotalReturnHistory(assetId, payload, pricePayload);
        return stitched;
      }
      return payload;
    } catch (error) {
      errors.push(
        `${source.provider}(${returnModeLabel(source.resolvedReturnMode || requestedReturnMode)}): ${error.message}`
      );
    }
  }

  throw new Error(
    `${assetMeta.name}[${returnModeLabel(requestedReturnMode)}] 上游数据不可用（${errors.join(" | ")}）`
  );
}

function refreshAsset(assetId, returnMode) {
  const mode = normalizeReturnMode(returnMode);
  const cacheKey = assetCacheKey(assetId, mode);

  if (refreshJobs.has(cacheKey)) {
    return refreshJobs.get(cacheKey);
  }

  const job = (async () => {
    const remoteData = await fetchAssetFromRemote(assetId, mode);

    let baseline = inMemorySeries.get(cacheKey);
    if (!baseline) {
      baseline = await readLocalCache(assetId, mode);
      if (baseline) inMemorySeries.set(cacheKey, baseline);
    }

    const baselineIsFallbackAlias =
      baseline &&
      baseline.requestedReturnMode === RETURN_MODES.TOTAL_RETURN &&
      baseline.resolvedReturnMode !== RETURN_MODES.TOTAL_RETURN;

    const comparableBaseline =
      baseline &&
      !baselineIsFallbackAlias &&
      baseline.resolvedReturnMode === remoteData.resolvedReturnMode &&
      Boolean(baseline.isEstimated) === Boolean(remoteData.isEstimated);

    const isDowngradedHistory =
      comparableBaseline &&
      remoteData.earliestDate > baseline.earliestDate &&
      remoteData.rows.length < baseline.rows.length * 0.85;

    if (isDowngradedHistory) {
      console.warn(
        `[data] ${remoteData.assetName} 更新结果历史长度变短，保留现有缓存 (${baseline.earliestDate} -> ${baseline.latestDate})`
      );
      return baseline;
    }

    await writeLocalCache(remoteData);
    inMemorySeries.set(cacheKey, remoteData);
    console.log(
      `[data] ${remoteData.assetName}[${returnModeLabel(mode)}] 已更新，范围 ${remoteData.earliestDate} -> ${remoteData.latestDate} (${remoteData.provider} -> ${returnModeLabel(remoteData.resolvedReturnMode)})`
    );
    return remoteData;
  })()
    .catch((error) => {
      console.warn(`[data] ${ASSETS[assetId].name}[${returnModeLabel(mode)}] 更新失败: ${error.message}`);
      throw error;
    })
    .finally(() => {
      refreshJobs.delete(cacheKey);
    });

  refreshJobs.set(cacheKey, job);
  return job;
}

async function refreshAllAssets(reason = "manual") {
  const jobs = Object.keys(ASSETS).flatMap((assetId) =>
    ALL_RETURN_MODES.map((mode) => refreshAsset(assetId, mode))
  );
  const settled = await Promise.allSettled(jobs);
  const failed = settled.filter((item) => item.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[data] 自动刷新(${reason})完成，失败 ${failed}/${jobs.length}`);
  } else {
    console.log(`[data] 自动刷新(${reason})完成，任务 ${jobs.length} 个`);
  }
}

function scheduleAutoRefresh() {
  if (autoRefreshTimer) return;

  autoRefreshTimer = setInterval(() => {
    void refreshAllAssets("interval").catch((error) => {
      console.warn(`[data] 定时刷新任务异常: ${error.message}`);
    });
  }, BACKGROUND_REFRESH_INTERVAL_MS);

  if (typeof autoRefreshTimer.unref === "function") {
    autoRefreshTimer.unref();
  }

  const startupTimer = setTimeout(() => {
    void refreshAllAssets("startup").catch((error) => {
      console.warn(`[data] 启动后刷新异常: ${error.message}`);
    });
  }, STARTUP_REFRESH_DELAY_MS);

  if (typeof startupTimer.unref === "function") {
    startupTimer.unref();
  }
}

async function getAssetSeries(assetId, options = {}) {
  const assetMeta = ASSETS[assetId];
  if (!assetMeta) {
    throw new Error(`不支持的资产：${assetId}`);
  }
  const requestedReturnMode = normalizeReturnMode(options.returnMode);
  const cacheKey = assetCacheKey(assetId, requestedReturnMode);

  const blockOnStale = options.blockOnStale !== false;
  const refreshTimeoutMs = Number.isFinite(options.refreshTimeoutMs)
    ? Math.max(0, Number(options.refreshTimeoutMs))
    : REQUEST_REFRESH_TIMEOUT_MS;

  let memoryPayload = inMemorySeries.get(cacheKey);
  if (memoryPayload) {
    if (
      requestedReturnMode === RETURN_MODES.TOTAL_RETURN &&
      memoryPayload.resolvedReturnMode !== RETURN_MODES.TOTAL_RETURN
    ) {
      memoryPayload = buildModeFallbackPayload(memoryPayload, requestedReturnMode);
      inMemorySeries.set(cacheKey, memoryPayload);
      void writeLocalCache(memoryPayload).catch(() => {});
    }
    if (requestedReturnMode === RETURN_MODES.TOTAL_RETURN) {
      const backfilled = await ensureTotalReturnHistoryBackfilled(assetId, memoryPayload);
      if (backfilled && backfilled.earliestDate !== memoryPayload.earliestDate) {
        memoryPayload = backfilled;
        inMemorySeries.set(cacheKey, memoryPayload);
        void writeLocalCache(memoryPayload).catch(() => {});
      }
    }

    if (shouldForceHistoricalRefresh(memoryPayload)) {
      if (blockOnStale) {
        try {
          return await withTimeout(
            refreshAsset(assetId, requestedReturnMode),
            refreshTimeoutMs,
            `${assetMeta.name}[${returnModeLabel(requestedReturnMode)}] 历史补全超时`
          );
        } catch (error) {
          console.warn(`[data] ${assetMeta.name} 历史补全失败: ${error.message}`);
          return memoryPayload;
        }
      }
      void refreshAsset(assetId, requestedReturnMode).catch(() => {});
      return memoryPayload;
    }

    const ageMs = payloadAgeMs(memoryPayload);
    const needUpgrade = shouldRetryTotalReturnUpgrade(memoryPayload);
    if (blockOnStale && ageMs > REQUEST_FRESH_WINDOW_MS) {
      try {
        return await withTimeout(
          refreshAsset(assetId, requestedReturnMode),
          refreshTimeoutMs,
          `${assetMeta.name}[${returnModeLabel(requestedReturnMode)}] 更新超时`
        );
      } catch (error) {
        console.warn(`[data] ${assetMeta.name} 请求时刷新失败: ${error.message}`);
      }
    }

    if (isStale(memoryPayload) || ageMs > BACKGROUND_REFRESH_TRIGGER_MS || needUpgrade) {
      void refreshAsset(assetId, requestedReturnMode).catch(() => {});
    }
    return memoryPayload;
  }

  let localPayload = await readLocalCache(assetId, requestedReturnMode);
  if (localPayload) {
    if (
      requestedReturnMode === RETURN_MODES.TOTAL_RETURN &&
      localPayload.resolvedReturnMode !== RETURN_MODES.TOTAL_RETURN
    ) {
      localPayload = buildModeFallbackPayload(localPayload, requestedReturnMode);
      void writeLocalCache(localPayload).catch(() => {});
    }
    if (requestedReturnMode === RETURN_MODES.TOTAL_RETURN) {
      const backfilled = await ensureTotalReturnHistoryBackfilled(assetId, localPayload);
      if (backfilled && backfilled.earliestDate !== localPayload.earliestDate) {
        localPayload = backfilled;
        void writeLocalCache(localPayload).catch(() => {});
      }
    }

    inMemorySeries.set(cacheKey, localPayload);
    if (shouldForceHistoricalRefresh(localPayload)) {
      if (blockOnStale) {
        try {
          return await withTimeout(
            refreshAsset(assetId, requestedReturnMode),
            refreshTimeoutMs,
            `${assetMeta.name}[${returnModeLabel(requestedReturnMode)}] 历史补全超时`
          );
        } catch (error) {
          console.warn(`[data] ${assetMeta.name} 历史补全失败: ${error.message}`);
          return localPayload;
        }
      }
      void refreshAsset(assetId, requestedReturnMode).catch(() => {});
      return localPayload;
    }

    const ageMs = payloadAgeMs(localPayload);
    const needUpgrade = shouldRetryTotalReturnUpgrade(localPayload);
    if (blockOnStale && ageMs > REQUEST_FRESH_WINDOW_MS) {
      try {
        return await withTimeout(
          refreshAsset(assetId, requestedReturnMode),
          refreshTimeoutMs,
          `${assetMeta.name}[${returnModeLabel(requestedReturnMode)}] 更新超时`
        );
      } catch (error) {
        console.warn(`[data] ${assetMeta.name} 请求时刷新失败: ${error.message}`);
      }
    }

    if (isStale(localPayload) || ageMs > BACKGROUND_REFRESH_TRIGGER_MS || needUpgrade) {
      void refreshAsset(assetId, requestedReturnMode).catch(() => {});
    }
    return localPayload;
  }

  if (requestedReturnMode === RETURN_MODES.TOTAL_RETURN) {
    const fallbackKey = assetCacheKey(assetId, RETURN_MODES.PRICE);
    let fallbackPayload = inMemorySeries.get(fallbackKey);
    if (!fallbackPayload) {
      fallbackPayload = await readLocalCache(assetId, RETURN_MODES.PRICE);
      if (fallbackPayload) {
        inMemorySeries.set(fallbackKey, fallbackPayload);
      }
    }
    if (fallbackPayload) {
      const aliased = buildModeFallbackPayload(fallbackPayload, requestedReturnMode);
      inMemorySeries.set(cacheKey, aliased);
      void refreshAsset(assetId, requestedReturnMode).catch((error) => {
        console.warn(`[data] ${assetMeta.name} 全收益口径后台刷新失败: ${error.message}`);
      });
      return aliased;
    }
  }

  return await refreshAsset(assetId, requestedReturnMode);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addOneMonth(dateObj, anchorDay) {
  const year = dateObj.getUTCFullYear();
  const monthIndex = dateObj.getUTCMonth();
  const nextMonthIndex = monthIndex + 1;
  const targetYear = year + Math.floor(nextMonthIndex / 12);
  const targetMonth = nextMonthIndex % 12;
  const targetDay = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, targetDay));
}

function nextContributionDate(currentDate, frequency, anchorDay) {
  if (frequency === "weekly") {
    return new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  if (frequency === "monthly") {
    return addOneMonth(currentDate, anchorDay);
  }
  return new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
}

function differenceInDays(startDateObj, endDateObj) {
  const diffMs = endDateObj.getTime() - startDateObj.getTime();
  return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
}

function stdDev(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => {
      const delta = value - mean;
      return sum + delta * delta;
    }, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function isoWeekKey(dateObj) {
  const temp = new Date(
    Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate())
  );
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((temp - yearStart) / 86400000 + 1) / 7);
  const week = String(weekNo).padStart(2, "0");
  return `${temp.getUTCFullYear()}-W${week}`;
}

function aggregateSnapshots(dailyRows, precision) {
  if (!Array.isArray(dailyRows) || dailyRows.length === 0) return [];

  const toSnapshot = (row) => ({
    periodKey: precision === "weekly" ? isoWeekKey(row.dateObj) : row.date.slice(0, 7),
    date: row.date,
    totalInvested: row.totalInvested,
    accountValue: row.accountValue,
    profitLoss: row.profitLoss,
    totalReturnPct: row.totalReturnPct,
    drawdownPct: row.drawdownPct,
  });

  const bucket = new Map();

  dailyRows.forEach((row) => {
    const periodKey = precision === "weekly" ? isoWeekKey(row.dateObj) : row.date.slice(0, 7);
    bucket.set(periodKey, toSnapshot(row));
  });

  const snapshots = Array.from(bucket.values());
  const firstDailySnapshot = toSnapshot(dailyRows[0]);
  if (snapshots.length === 0 || snapshots[0].date !== firstDailySnapshot.date) {
    snapshots.unshift(firstDailySnapshot);
  }

  return snapshots;
}

function simulateDca(seriesRows, params) {
  const { startDateIso, endDateIso, frequency, amount, precision } = params;

  const startDateObj = parseIsoDate(startDateIso);
  const endDateObj = parseIsoDate(endDateIso);
  const firstDate = seriesRows[0].dateObj;
  const lastDate = seriesRows[seriesRows.length - 1].dateObj;

  if (startDateObj > lastDate) {
    throw new Error("开始日期晚于可用行情结束日");
  }

  const effectiveStartDateObj = startDateObj > firstDate ? startDateObj : firstDate;
  const effectiveEndDateObj = endDateObj < lastDate ? endDateObj : lastDate;
  if (effectiveStartDateObj > effectiveEndDateObj) {
    throw new Error("有效回测区间为空");
  }

  const usableRows = seriesRows.filter(
    (row) => row.dateObj >= effectiveStartDateObj && row.dateObj <= effectiveEndDateObj
  );

  if (usableRows.length === 0) {
    throw new Error("开始日期之后没有可用交易日");
  }

  let shares = 0;
  let totalInvested = 0;
  let totalContributionCount = 0;
  let highWatermark = 0;
  let highWatermarkIndex = 0;
  let maxDrawdownPct = 0;
  let maxDrawdownPeakIndex = 0;
  let maxDrawdownTroughIndex = -1;

  let scheduleDate = effectiveStartDateObj;
  const monthlyAnchorDay = effectiveStartDateObj.getUTCDate();
  const dailyRows = [];

  usableRows.forEach((row) => {
    let contributionCount = 0;

    if (frequency === "daily") {
      contributionCount = 1;
    } else {
      while (row.dateObj >= scheduleDate) {
        contributionCount += 1;
        scheduleDate = nextContributionDate(scheduleDate, frequency, monthlyAnchorDay);
      }
    }

    if (contributionCount > 0) {
      const contributionValue = amount * contributionCount;
      shares += contributionValue / row.close;
      totalInvested += contributionValue;
      totalContributionCount += contributionCount;
    }

    const accountValue = shares * row.close;
    if (accountValue > highWatermark) {
      highWatermark = accountValue;
      highWatermarkIndex = dailyRows.length;
    }

    const drawdownPct = highWatermark > 0 ? ((accountValue - highWatermark) / highWatermark) * 100 : 0;
    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      maxDrawdownPeakIndex = highWatermarkIndex;
      maxDrawdownTroughIndex = dailyRows.length;
    }

    const profitLoss = accountValue - totalInvested;
    const totalReturnPct = totalInvested > 0 ? (profitLoss / totalInvested) * 100 : 0;

    dailyRows.push({
      date: row.date,
      dateObj: row.dateObj,
      close: row.close,
      contributionCount,
      totalInvested,
      accountValue,
      profitLoss,
      totalReturnPct,
      drawdownPct,
    });
  });

  const ending = dailyRows[dailyRows.length - 1];
  const snapshots = aggregateSnapshots(dailyRows, precision);

  let drawdownPeakDate = null;
  let drawdownTroughDate = null;
  let drawdownRecoveryDate = null;
  let drawdownRecoveryDays = null;
  let drawdownPeakToRecoveryDays = null;

  if (maxDrawdownTroughIndex >= 0) {
    drawdownPeakDate = dailyRows[maxDrawdownPeakIndex]?.date || null;
    drawdownTroughDate = dailyRows[maxDrawdownTroughIndex]?.date || null;
    const recoveryTarget = dailyRows[maxDrawdownPeakIndex]?.accountValue || 0;

    let recoveryIndex = -1;
    for (let idx = maxDrawdownTroughIndex + 1; idx < dailyRows.length; idx += 1) {
      if (dailyRows[idx].accountValue >= recoveryTarget) {
        recoveryIndex = idx;
        break;
      }
    }

    if (recoveryIndex >= 0) {
      drawdownRecoveryDate = dailyRows[recoveryIndex].date;
      drawdownRecoveryDays = differenceInDays(
        dailyRows[maxDrawdownTroughIndex].dateObj,
        dailyRows[recoveryIndex].dateObj
      );
      drawdownPeakToRecoveryDays = differenceInDays(
        dailyRows[maxDrawdownPeakIndex].dateObj,
        dailyRows[recoveryIndex].dateObj
      );
    }
  }

  const dailyReturns = [];
  for (let i = 1; i < dailyRows.length; i += 1) {
    const prev = dailyRows[i - 1].accountValue;
    if (prev > 0) {
      dailyReturns.push((dailyRows[i].accountValue - prev) / prev);
    }
  }

  const volatility = stdDev(dailyReturns) * Math.sqrt(252) * 100;

  return {
    effectiveStartDate: toIsoDate(effectiveStartDateObj),
    endDate: ending.date,
    snapshots,
    summary: {
      totalContributions: totalContributionCount,
      totalInvested: ending.totalInvested,
      endingValue: ending.accountValue,
      profitLoss: ending.profitLoss,
      totalReturnPct: ending.totalReturnPct,
      maxDrawdownPct,
      maxDrawdownPeakDate: drawdownPeakDate,
      maxDrawdownTroughDate: drawdownTroughDate,
      drawdownRecoveryDate,
      drawdownRecoveryDays,
      drawdownPeakToRecoveryDays,
      annualizedVolatilityPct: volatility,
    },
  };
}

function validateSimulationPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("请求体必须为 JSON 对象");
  }

  const assets = Array.isArray(payload.assets) ? [...new Set(payload.assets)] : [];
  if (assets.length === 0 || assets.length > 2) {
    throw new Error("请选择 1 到 2 个资产");
  }
  assets.forEach((assetId) => {
    if (!ASSETS[assetId]) {
      throw new Error(`不支持的资产：${assetId}`);
    }
  });

  const frequency = payload.frequency;
  if (!["monthly", "weekly", "daily"].includes(frequency)) {
    throw new Error("frequency 仅支持 monthly / weekly / daily");
  }

  const precision = payload.precision;
  if (!["weekly", "monthly"].includes(precision)) {
    throw new Error("precision 仅支持 weekly / monthly");
  }

  const startDate = payload.startDate;
  if (typeof startDate !== "string") {
    throw new Error("startDate 必须是 YYYY-MM-DD");
  }
  parseIsoDate(startDate);

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount 必须为正数");
  }

  const returnMode = normalizeReturnMode(payload.returnMode);

  return {
    assets,
    returnMode,
    frequency,
    precision,
    startDate,
    amount,
  };
}

async function readRequestBody(req) {
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function handleAuthMe(req, res) {
  if (!AUTH_ENABLED) {
    sendJson(res, 200, { enabled: false, authenticated: true });
    return;
  }
  const member = await resolveMemberFromSession(req);
  if (!member) {
    sendJson(res, 401, { enabled: true, authenticated: false, error: "请先登录星球会员账号" });
    return;
  }
  sendJson(res, 200, {
    enabled: true,
    authenticated: true,
    member: {
      memberId: member.memberId,
      displayName: member.displayName || member.memberId,
      expiresAt: member.expiresAt,
    },
  });
}

async function handleAuthLogin(req, res) {
  if (!AUTH_ENABLED) {
    sendJson(res, 200, { ok: true, enabled: false });
    return;
  }

  try {
    const bodyText = await readRequestBody(req);
    const payload = bodyText ? JSON.parse(bodyText) : {};
    const memberId = String(payload.memberId || "").trim();
    const accessCode = String(payload.accessCode || "").trim();
    if (!memberId || !accessCode) {
      sendJson(res, 400, { error: "请输入会员ID与访问码" });
      return;
    }

    const member = await findMember(memberId);
    if (!member || !isMemberActive(member)) {
      sendJson(res, 403, { error: "会员不存在或已过有效期" });
      return;
    }

    const providedHash = hashAccessCode(accessCode);
    if (!secureCompareHex(providedHash, member.accessCodeHash)) {
      sendJson(res, 401, { error: "访问码错误" });
      return;
    }

    const token = createSession(member.memberId);
    sendJson(
      res,
      200,
      {
        ok: true,
        member: {
          memberId: member.memberId,
          displayName: member.displayName || member.memberId,
          expiresAt: member.expiresAt,
        },
      },
      {
        "Set-Cookie": buildSessionCookie(req, token, AUTH_SESSION_TTL_MS),
      }
    );
  } catch (error) {
    sendJson(res, 400, { error: `登录请求无效：${error.message}` });
  }
}

function handleAuthLogout(req, res) {
  clearSessionByRequest(req);
  sendJson(
    res,
    200,
    { ok: true },
    {
      "Set-Cookie": buildSessionCookie(req, "", 0),
    }
  );
}

async function handleMeta(res, urlObj) {
  try {
    const requestedReturnMode = normalizeReturnMode(urlObj.searchParams.get("returnMode"));
    const assets = await Promise.all(
      Object.keys(ASSETS).map((assetId) =>
        getAssetSeries(assetId, {
          returnMode: requestedReturnMode,
          blockOnStale: false,
        })
      )
    );
    const providers = [...new Set(assets.map((asset) => asset.provider))];
    const warnings = [];
    assets.forEach((asset) => {
      if (asset.resolvedReturnMode !== requestedReturnMode) {
        warnings.push(
          `${asset.assetName} 当前回退为${returnModeLabel(asset.resolvedReturnMode)}（请求为${returnModeLabel(
            requestedReturnMode
          )}）`
        );
      }
    });

    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      request: {
        returnMode: requestedReturnMode,
      },
      assets: assets.map((asset) => ({
        id: asset.assetId,
        name: asset.assetName,
        symbol: asset.symbol,
        requestedReturnMode: asset.requestedReturnMode,
        resolvedReturnMode: asset.resolvedReturnMode,
        isProxy: asset.isProxy,
        isEstimated: asset.isEstimated,
        earliestDate: asset.earliestDate,
        latestDate: asset.latestDate,
        provider: asset.provider,
        fetchedAt: asset.fetchedAt,
      })),
      warnings,
      source: `日线收盘价（${providers.join("/")}），按 ${returnModeLabel(
        requestedReturnMode
      )} 口径回测，缓存于 data/market-cache`,
    });
  } catch (error) {
    sendJson(res, 502, { error: `加载资产元数据失败：${error.message}` });
  }
}

async function handleSimulate(req, res) {
  try {
    const bodyText = await readRequestBody(req);
    const payload = bodyText ? JSON.parse(bodyText) : {};
    const params = validateSimulationPayload(payload);

    const selectedAssets = await Promise.all(
      params.assets.map((assetId) =>
        getAssetSeries(assetId, {
          returnMode: params.returnMode,
        })
      )
    );

    const commonMinDate = selectedAssets
      .map((asset) => asset.earliestDate)
      .reduce((latest, current) => (current > latest ? current : latest));
    const commonMaxDate = selectedAssets
      .map((asset) => asset.latestDate)
      .reduce((earliest, current) => (current < earliest ? current : earliest));

    if (params.startDate > commonMaxDate) {
      throw new Error(`开始日期晚于共同可用区间，请选择不晚于 ${commonMaxDate}`);
    }

    const effectiveStartDate = params.startDate > commonMinDate ? params.startDate : commonMinDate;
    const warnings = [];
    if (effectiveStartDate !== params.startDate) {
      warnings.push(`开始时间已自动调整为 ${effectiveStartDate}（所选资产共同可用起点）`);
    }
    selectedAssets.forEach((asset) => {
      if (asset.resolvedReturnMode !== params.returnMode) {
        warnings.push(
          `${asset.assetName} 当前回退为${returnModeLabel(asset.resolvedReturnMode)}（请求为${returnModeLabel(
            params.returnMode
          )}）`
        );
      }
    });

    const series = selectedAssets.map((asset) => {
      const simulation = simulateDca(asset.rows, {
        startDateIso: effectiveStartDate,
        endDateIso: commonMaxDate,
        frequency: params.frequency,
        amount: params.amount,
        precision: params.precision,
      });

      return {
        assetId: asset.assetId,
        assetName: asset.assetName,
        symbol: asset.symbol,
        requestedReturnMode: asset.requestedReturnMode,
        resolvedReturnMode: asset.resolvedReturnMode,
        isProxy: asset.isProxy,
        isEstimated: asset.isEstimated,
        provider: asset.provider,
        fetchedAt: asset.fetchedAt,
        snapshots: simulation.snapshots,
        summary: simulation.summary,
      };
    });

    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      request: {
        assets: params.assets,
        returnMode: params.returnMode,
        frequency: params.frequency,
        precision: params.precision,
        amount: params.amount,
        inputStartDate: params.startDate,
        effectiveStartDate,
        endDate: commonMaxDate,
      },
      warnings,
      series,
      source: `日线收盘价已同步至 data/market-cache，当前口径为 ${returnModeLabel(
        params.returnMode
      )}。`,
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

const CONTENT_TYPE = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function serveStatic(urlPath, res) {
  const requestPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestPath}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      sendText(res, 404, "Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPE[ext] || "text/plain";
    res.writeHead(200, {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(buffer);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const pathname = urlObj.pathname || "/";

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": CORS_ALLOW_ORIGIN,
        "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
        "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
      });
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      await handleAuthMe(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      await handleAuthLogin(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      handleAuthLogout(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/healthz") {
      handleHealthz(res);
      return;
    }

    if (AUTH_ENABLED) {
      if (req.method === "GET" && pathname === "/login.html") {
        const member = await resolveMemberFromSession(req);
        if (member) {
          res.writeHead(302, { Location: "/" });
          res.end();
          return;
        }
      } else if (!isPublicAuthRoute(pathname)) {
        const member = await resolveMemberFromSession(req);
        if (!member) {
          if (pathname.startsWith("/api/")) {
            sendJson(res, 401, { error: "请先登录星球会员账号" });
            return;
          }
          if (req.method === "GET") {
            redirectToLogin(res, `${pathname}${urlObj.search || ""}`);
            return;
          }
          sendText(res, 401, "Unauthorized");
          return;
        }
      }
    }

    if (req.method === "GET" && pathname === "/api/meta") {
      await handleMeta(res, urlObj);
      return;
    }

    if (req.method === "POST" && pathname === "/api/simulate") {
      await handleSimulate(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(pathname, res);
      return;
    }

    sendText(res, 405, "Method Not Allowed");
  });
}

async function warmupLocalCache() {
  await fsp.mkdir(LOCAL_DATA_DIR, { recursive: true });
  const assetIds = Object.keys(ASSETS);

  await Promise.all(
    assetIds.flatMap((assetId) =>
      ALL_RETURN_MODES.map(async (mode) => {
        let localData = await readLocalCache(assetId, mode);
        if (!localData) return;
        if (
          mode === RETURN_MODES.TOTAL_RETURN &&
          localData.resolvedReturnMode !== RETURN_MODES.TOTAL_RETURN
        ) {
          localData = buildModeFallbackPayload(localData, RETURN_MODES.TOTAL_RETURN);
          if (localData) {
            await writeLocalCache(localData);
          }
        }
        if (mode === RETURN_MODES.TOTAL_RETURN) {
          const backfilled = await ensureTotalReturnHistoryBackfilled(assetId, localData);
          if (backfilled && backfilled.earliestDate !== localData.earliestDate) {
            localData = backfilled;
            await writeLocalCache(localData);
          }
        }
        const cacheKey = assetCacheKey(assetId, mode);
        inMemorySeries.set(cacheKey, localData);
        if (
          isStale(localData) ||
          shouldForceHistoricalRefresh(localData) ||
          shouldRetryTotalReturnUpgrade(localData)
        ) {
          void refreshAsset(assetId, mode).catch(() => {});
        }
      })
    )
  );
}

async function start() {
  if (AUTH_ENABLED) {
    await ensureMemberStoreFile();
  }
  await warmupLocalCache();
  scheduleAutoRefresh();
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`DCA 复利实验室已启动: http://${HOST}:${PORT}`);
    console.log(
      `[data] 自动刷新已启用：interval=${BACKGROUND_REFRESH_INTERVAL_MS}ms, requestFreshWindow=${REQUEST_FRESH_WINDOW_MS}ms`
    );
    if (AUTH_ENABLED) {
      console.log(`[auth] 会员门槛已启用，会员文件：${MEMBER_STORE_PATH}`);
      if (!process.env.AUTH_SESSION_SECRET) {
        console.warn(
          "[auth] 未设置 AUTH_SESSION_SECRET，当前会话密钥为临时值。重启后所有登录会话会失效。"
        );
      }
    } else {
      console.log("[auth] 会员门槛未启用（AUTH_ENABLED=false）");
    }
  });
}

start().catch((error) => {
  console.error(`[fatal] 服务启动失败: ${error.message}`);
  process.exit(1);
});
