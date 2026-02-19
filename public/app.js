const assetInputs = Array.from(document.querySelectorAll('input[name="asset"]'));
const frequencyInputs = Array.from(document.querySelectorAll('input[name="frequency"]'));
const precisionInputs = Array.from(document.querySelectorAll('input[name="precision"]'));
const returnModeInputs = Array.from(document.querySelectorAll('input[name="returnMode"]'));
const startDateInput = document.getElementById("startDateInput");
const dateBoundHint = document.getElementById("dateBoundHint");
const openDatePickerBtn = document.getElementById("openDatePickerBtn");
const dateQuickButtons = Array.from(document.querySelectorAll(".date-quick-btn"));
const amountInput = document.getElementById("amountInput");
const simulateBtn = document.getElementById("simulateBtn");
const statusText = document.getElementById("statusText");
const rangeText = document.getElementById("rangeText");
const summaryCards = document.getElementById("summaryCards");
const chartCanvas = document.getElementById("equityChart");
const timeSliderAligned = document.getElementById("timeSliderAligned");
const timeSliderTrack = document.getElementById("timeSliderTrack");
const rangeStartInput = document.getElementById("rangeStartInput");
const rangeEndInput = document.getElementById("rangeEndInput");
const rangeWindowText = document.getElementById("rangeWindowText");
const resetRangeBtn = document.getElementById("resetRangeBtn");
const runtimeApiBase = String(window.__DCA_API_BASE__ || "")
  .trim()
  .replace(/\/+$/, "");

function buildApiUrl(pathname) {
  if (!runtimeApiBase) return pathname;
  if (pathname.startsWith("/")) return `${runtimeApiBase}${pathname}`;
  return `${runtimeApiBase}/${pathname}`;
}

const colorByAsset = {
  sp500: {
    line: "#2962ff",
    gainFill: "rgba(41, 98, 255, 0.18)",
    principalLine: "#80a3ff",
    principalFill: "rgba(128, 163, 255, 0.1)",
    marker: "#bb3d2d",
  },
  nasdaq100: {
    line: "#f59e0b",
    gainFill: "rgba(245, 158, 11, 0.2)",
    principalLine: "#f6bf61",
    principalFill: "rgba(246, 191, 97, 0.11)",
    marker: "#bb3d2d",
  },
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const state = {
  meta: null,
  metaWarnings: [],
  chart: null,
  chartSource: null,
  dataSourceMode: "api",
  localSeriesCache: new Map(),
};

const ALL_ASSET_IDS = ["sp500", "nasdaq100"];

function isGithubPagesRuntime() {
  return window.location.hostname.endsWith("github.io");
}

function localDataPath(assetId, returnMode) {
  const suffix = returnMode === "total_return" ? ".total_return" : "";
  return `data/market-cache/${assetId}${suffix}.json`;
}

function setStatus(message, type = "info") {
  statusText.textContent = message;
  statusText.classList.remove("error", "success");
  if (type === "error") statusText.classList.add("error");
  if (type === "success") statusText.classList.add("success");
}

function parseIsoDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${percentFormatter.format(value)}%`;
}

function formatDate(isoDate) {
  if (!isoDate) return "-";
  return dateFormatter.format(parseIsoDate(isoDate));
}

function toIsoDate(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function daysInMonthUtc(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function shiftIsoByYears(isoDate, yearsBack) {
  const base = parseIsoDate(isoDate);
  const targetYear = base.getUTCFullYear() - yearsBack;
  const month = base.getUTCMonth();
  const day = Math.min(base.getUTCDate(), daysInMonthUtc(targetYear, month));
  return toIsoDate(new Date(Date.UTC(targetYear, month, day)));
}

function clampIsoDate(isoDate, minDate, maxDate) {
  if (isoDate < minDate) return minDate;
  if (isoDate > maxDate) return maxDate;
  return isoDate;
}

function getQuickDateTarget(action, minDate, maxDate) {
  if (action === "earliest") return minDate;

  const yearMap = {
    y1: 1,
    y3: 3,
    y5: 5,
    y10: 10,
    y15: 15,
    y20: 20,
  };
  const years = yearMap[action];
  if (!years) return clampIsoDate(startDateInput.value || minDate, minDate, maxDate);
  return clampIsoDate(shiftIsoByYears(maxDate, years), minDate, maxDate);
}

function refreshDateQuickButtonState() {
  const minDate = startDateInput.min;
  const maxDate = startDateInput.max;
  const currentDate = startDateInput.value;
  if (!minDate || !maxDate || !currentDate) {
    dateQuickButtons.forEach((btn) => btn.classList.remove("active"));
    return;
  }

  dateQuickButtons.forEach((btn) => {
    const action = btn.dataset.dateAction;
    const target = getQuickDateTarget(action, minDate, maxDate);
    btn.classList.toggle("active", target === currentDate);
  });
}

function applyQuickDate(action) {
  const minDate = startDateInput.min;
  const maxDate = startDateInput.max;
  if (!minDate || !maxDate) return;

  const target = getQuickDateTarget(action, minDate, maxDate);
  startDateInput.value = target;
  refreshDateQuickButtonState();
}

function getSelectedAssets() {
  return assetInputs.filter((item) => item.checked).map((item) => item.value);
}

function getSelectedFrequency() {
  return frequencyInputs.find((item) => item.checked)?.value || "monthly";
}

function getSelectedPrecision() {
  return precisionInputs.find((item) => item.checked)?.value || "monthly";
}

function getSelectedReturnMode() {
  return returnModeInputs.find((item) => item.checked)?.value || "total_return";
}

function formatReturnModeLabel(returnMode) {
  return returnMode === "price" ? "价格收益" : "全收益";
}

function filterVisibleWarnings(warnings) {
  const hiddenPhrase = "当前全收益由价格序列估算（含分红再投资模型）";
  return (Array.isArray(warnings) ? warnings : []).filter(
    (item) => typeof item === "string" && !item.includes(hiddenPhrase)
  );
}

function enforceAssetSelectionLimit(changedInput) {
  const selectedAssets = getSelectedAssets();
  if (selectedAssets.length <= 2) return;
  changedInput.checked = false;
  setStatus("最多只能同时对比两个资产。", "error");
}

function updateStartDateBounds() {
  if (!state.meta) return;

  const selectedAssets = getSelectedAssets();
  if (selectedAssets.length === 0) return;

  const selectedMeta = selectedAssets
    .map((assetId) => state.meta.assets.find((asset) => asset.id === assetId))
    .filter(Boolean);

  if (selectedMeta.length === 0) return;

  const allAssetsMeta = Array.isArray(state.meta.assets) ? state.meta.assets : selectedMeta;
  const minDate = allAssetsMeta
    .map((asset) => asset.earliestDate)
    .reduce((earliest, current) => (current < earliest ? current : earliest));
  const commonStartDate = selectedMeta
    .map((asset) => asset.earliestDate)
    .reduce((latest, current) => (current > latest ? current : latest));
  const maxDate = selectedMeta
    .map((asset) => asset.latestDate)
    .reduce((earliest, current) => (current < earliest ? current : earliest));

  startDateInput.min = minDate;
  startDateInput.max = maxDate;

  if (!startDateInput.value || startDateInput.value < minDate || startDateInput.value > maxDate) {
    startDateInput.value = getQuickDateTarget("y10", minDate, maxDate);
  }

  const hintBase = `可选区间：${formatDate(minDate)} 至 ${formatDate(maxDate)}`;
  if (commonStartDate > minDate) {
    dateBoundHint.textContent = `${hintBase}（共同回测起点：${formatDate(commonStartDate)}）`;
  } else {
    dateBoundHint.textContent = hintBase;
  }
  refreshDateQuickButtonState();
}

function normalizeRows(rawRows) {
  if (!Array.isArray(rawRows)) return [];
  return rawRows
    .map((row) => {
      if (!Array.isArray(row) || row.length < 2) return null;
      const [date, close] = row;
      if (typeof date !== "string" || !Number.isFinite(close) || close <= 0) return null;
      return {
        date,
        close,
        dateObj: parseIsoDate(date),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function loadLocalAssetSeries(assetId, returnMode) {
  const cacheKey = `${assetId}:${returnMode}`;
  if (state.localSeriesCache.has(cacheKey)) {
    return state.localSeriesCache.get(cacheKey);
  }

  const response = await fetch(localDataPath(assetId, returnMode), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`本地数据加载失败：${assetId} ${formatReturnModeLabel(returnMode)}（HTTP ${response.status}）`);
  }

  const payload = await response.json();
  const rows = normalizeRows(payload.rows);
  const parsed = {
    ...payload,
    rows,
    earliestDate: rows[0]?.date || payload.earliestDate,
    latestDate: rows[rows.length - 1]?.date || payload.latestDate,
  };
  state.localSeriesCache.set(cacheKey, parsed);
  return parsed;
}

async function loadMetaFromLocal(returnMode) {
  const assets = await Promise.all(
    ALL_ASSET_IDS.map((assetId) => loadLocalAssetSeries(assetId, returnMode))
  );

  return {
    generatedAt: new Date().toISOString(),
    request: {
      returnMode,
      sourceMode: "local",
    },
    assets: assets.map((asset) => ({
      id: asset.assetId,
      name: asset.assetName,
      symbol: asset.symbol,
      requestedReturnMode: asset.requestedReturnMode || returnMode,
      resolvedReturnMode: asset.resolvedReturnMode || returnMode,
      isProxy: Boolean(asset.isProxy),
      isEstimated: Boolean(asset.isEstimated),
      earliestDate: asset.earliestDate,
      latestDate: asset.latestDate,
      provider: asset.provider || "Local Cache",
      fetchedAt: asset.fetchedAt || null,
    })),
    warnings: [],
    source: "本地静态数据（GitHub Pages 模式）",
  };
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
    const key = precision === "weekly" ? isoWeekKey(row.dateObj) : row.date.slice(0, 7);
    bucket.set(key, toSnapshot(row));
  });

  const snapshots = Array.from(bucket.values());
  const first = toSnapshot(dailyRows[0]);
  if (snapshots.length === 0 || snapshots[0].date !== first.date) {
    snapshots.unshift(first);
  }
  return snapshots;
}

function simulateDcaLocal(seriesRows, params) {
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

async function simulateFromLocal(params) {
  const selectedAssets = await Promise.all(
    params.assets.map((assetId) => loadLocalAssetSeries(assetId, params.returnMode))
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
    const resolved = asset.resolvedReturnMode || params.returnMode;
    if (resolved !== params.returnMode) {
      warnings.push(
        `${asset.assetName} 当前回退为${formatReturnModeLabel(resolved)}（请求为${formatReturnModeLabel(
          params.returnMode
        )}）`
      );
    }
  });

  const series = selectedAssets.map((asset) => {
    const simulation = simulateDcaLocal(asset.rows, {
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
      requestedReturnMode: asset.requestedReturnMode || params.returnMode,
      resolvedReturnMode: asset.resolvedReturnMode || params.returnMode,
      isProxy: Boolean(asset.isProxy),
      isEstimated: Boolean(asset.isEstimated),
      provider: asset.provider || "Local Cache",
      fetchedAt: asset.fetchedAt || null,
      snapshots: simulation.snapshots,
      summary: simulation.summary,
    };
  });

  return {
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
    source: "本地静态数据（GitHub Pages 模式）",
  };
}

function computeAnnualizedReturnPct(series) {
  const summary = series?.summary;
  const snapshots = Array.isArray(series?.snapshots) ? series.snapshots : [];
  if (!summary || snapshots.length < 2) return null;

  const totalInvested = Number(summary.totalInvested);
  const endingValue = Number(summary.endingValue);
  if (!Number.isFinite(totalInvested) || !Number.isFinite(endingValue) || totalInvested <= 0) {
    return null;
  }

  const startDate = snapshots[0]?.date;
  const endDate = snapshots[snapshots.length - 1]?.date;
  if (!startDate || !endDate) return null;

  const startMs = parseIsoDate(startDate).getTime();
  const endMs = parseIsoDate(endDate).getTime();
  const durationDays = (endMs - startMs) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(durationDays) || durationDays <= 0) return null;

  const years = durationDays / 365.25;
  if (years <= 0) return null;

  const totalMultiple = endingValue / totalInvested;
  if (!Number.isFinite(totalMultiple) || totalMultiple <= 0) return null;

  return (Math.pow(totalMultiple, 1 / years) - 1) * 100;
}

function renderSummaryCards(seriesList) {
  summaryCards.innerHTML = "";

  seriesList.forEach((series) => {
    const summary = series.summary;
    const card = document.createElement("article");
    card.className = "summary-card";

    const profitClass = summary.profitLoss >= 0 ? "gain" : "loss";
    const returnClass = summary.totalReturnPct >= 0 ? "gain" : "loss";
    const annualizedReturnPct = computeAnnualizedReturnPct(series);
    const annualizedReturnClass =
      annualizedReturnPct == null ? "" : annualizedReturnPct >= 0 ? "gain" : "loss";
    const annualizedReturnText = formatPercent(annualizedReturnPct);
    const resolvedMode = series.resolvedReturnMode || "price";
    const requestedMode = series.requestedReturnMode || resolvedMode;
    const modeLabel = formatReturnModeLabel(resolvedMode);
    const modeFallbackNote =
      resolvedMode !== requestedMode
        ? `（回退自${formatReturnModeLabel(requestedMode)}）`
        : "";
    const proxyNote = series.isProxy ? "，ETF替代口径" : "";
    const estimatedNote = series.isEstimated ? "，分红再投资估算" : "";

    card.innerHTML = `
      <h3>${series.assetName}</h3>
      <p class="summary-sub">数据源：${series.provider} · ${modeLabel}${modeFallbackNote}${proxyNote}${estimatedNote}</p>
      <ul class="metric-list">
        <li><span>累计投入</span><strong>${moneyFormatter.format(summary.totalInvested)}</strong></li>
        <li><span>账户总资产</span><strong>${moneyFormatter.format(summary.endingValue)}</strong></li>
        <li><span>累计收益</span><strong class="${profitClass}">${moneyFormatter.format(summary.profitLoss)}</strong></li>
        <li><span>累计收益率</span><strong class="${returnClass}">${formatPercent(summary.totalReturnPct)}</strong></li>
        <li><span>年化回报率</span><strong class="${annualizedReturnClass}">${annualizedReturnText}</strong></li>
        <li><span>最大回撤</span><strong class="loss">${formatPercent(summary.maxDrawdownPct)}</strong></li>
        <li><span>年化波动率</span><strong>${formatPercent(summary.annualizedVolatilityPct)}</strong></li>
      </ul>
    `;

    summaryCards.appendChild(card);
  });
}

function createDatasets(seriesList, labels) {
  if (!seriesList.length) return [];

  const principalByDate = new Map();
  seriesList.forEach((series) => {
    series.snapshots.forEach((point) => {
      if (!principalByDate.has(point.date)) {
        principalByDate.set(point.date, point.totalInvested);
      }
    });
  });

  const principalAligned = labels.map((date) =>
    principalByDate.has(date) ? principalByDate.get(date) : null
  );

  const datasets = [
    {
      label: "累计本金",
      role: "principal",
      borderColor: "#8fa3bf",
      backgroundColor: "rgba(143, 163, 191, 0.12)",
      data: principalAligned,
      pointRadius: 0,
      pointHoverRadius: 0,
      borderWidth: 1.4,
      borderDash: [6, 5],
      tension: 0.18,
      fill: "origin",
      spanGaps: true,
      order: 1,
    },
  ];

  seriesList.forEach((series) => {
    const palette = colorByAsset[series.assetId] || {
      line: "#2962ff",
      gainFill: "rgba(41, 98, 255, 0.18)",
      principalLine: "#8fa3bf",
      principalFill: "rgba(143, 163, 191, 0.12)",
      marker: "#bb3d2d",
    };
    const snapshotByDate = new Map(series.snapshots.map((point) => [point.date, point]));
    const aligned = labels.map((date) => snapshotByDate.get(date) || null);

    datasets.push({
      label: `${series.assetName} 增值+本金（总资产）`,
      assetName: series.assetName,
      role: "total",
      borderColor: palette.line,
      backgroundColor: palette.gainFill,
      data: aligned.map((point) => (point ? point.accountValue : null)),
      snapshots: aligned,
      pointRadius: 0,
      borderWidth: 2.2,
      tension: 0.22,
      fill: 0,
      spanGaps: true,
      order: 2,
    });
  });

  return datasets;
}

function buildChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        labels: {
          usePointStyle: true,
          boxWidth: 9,
          color: "#4a5a70",
          filter(item, chartData) {
            const role = chartData.datasets[item.datasetIndex]?.role;
            return role === "principal" || role === "total";
          },
        },
      },
      tooltip: {
        displayColors: false,
        backgroundColor: "rgba(18, 26, 43, 0.92)",
        titleColor: "#f8fbff",
        bodyColor: "#e4ecf8",
        borderColor: "rgba(98, 117, 143, 0.62)",
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title(items) {
            if (!items[0]) return "";
            return formatDate(items[0].label);
          },
          label(context) {
            const dataset = context.dataset;

            const snapshot = dataset.snapshots?.[context.dataIndex];
            if (dataset.role === "principal") {
              const principalValue = Number.isFinite(context.parsed?.y) ? context.parsed.y : null;
              if (principalValue == null) return `${dataset.label}: 无数据`;
              return `累计本金 ${moneyFormatter.format(principalValue)}`;
            }
            if (!snapshot) return `${dataset.label}: 无数据`;

            const gain = snapshot.accountValue - snapshot.totalInvested;
            return `${dataset.assetName} 总资产 ${moneyFormatter.format(
              snapshot.accountValue
            )} | 本金 ${moneyFormatter.format(snapshot.totalInvested)} | 增值 ${moneyFormatter.format(
              gain
            )}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "#5f6f86",
          maxTicksLimit: 10,
        },
        border: {
          color: "rgba(127, 142, 163, 0.42)",
        },
        grid: {
          color: "rgba(122, 138, 160, 0.22)",
        },
      },
      y: {
        ticks: {
          color: "#5f6f86",
          callback(value) {
            return moneyFormatter.format(Number(value));
          },
        },
        border: {
          color: "rgba(127, 142, 163, 0.42)",
        },
        grid: {
          color: "rgba(122, 138, 160, 0.24)",
        },
      },
    },
  };
}

function setRangeControlsEnabled(enabled) {
  rangeStartInput.disabled = !enabled;
  rangeEndInput.disabled = !enabled;
  resetRangeBtn.disabled = !enabled;
}

function syncRangeTrackVisual(startIndex, endIndex, maxIndex) {
  const safeMax = Math.max(maxIndex, 1);
  const startPct = (startIndex / safeMax) * 100;
  const endPct = (endIndex / safeMax) * 100;
  timeSliderTrack.style.setProperty("--range-start", `${startPct}%`);
  timeSliderTrack.style.setProperty("--range-end", `${endPct}%`);
}

function alignSliderToChartAxis() {
  if (!state.chart || !state.chart.chartArea) return;
  const { chartArea, width: renderWidth } = state.chart;
  const scaleX = renderWidth > 0 ? chartCanvas.clientWidth / renderWidth : 1;

  const left = Math.max(0, chartArea.left * scaleX);
  const right = Math.max(0, chartCanvas.clientWidth - chartArea.right * scaleX);

  timeSliderAligned.style.paddingLeft = `${left}px`;
  timeSliderAligned.style.paddingRight = `${right}px`;
}

function getRangeSelection(changedInput = "") {
  const labels = state.chartSource?.labels || [];
  const maxIndex = Math.max(labels.length - 1, 0);

  let startIndex = Math.round(Number(rangeStartInput.value) || 0);
  let endIndex = Math.round(Number(rangeEndInput.value) || 0);

  startIndex = Math.min(Math.max(startIndex, 0), maxIndex);
  endIndex = Math.min(Math.max(endIndex, 0), maxIndex);

  if (startIndex > endIndex) {
    if (changedInput === "start") {
      endIndex = startIndex;
      rangeEndInput.value = String(endIndex);
    } else {
      startIndex = endIndex;
      rangeStartInput.value = String(startIndex);
    }
  }

  return { startIndex, endIndex, maxIndex };
}

function updateRangeWindowText(startIndex, endIndex) {
  const labels = state.chartSource?.labels || [];
  if (labels.length === 0) {
    rangeWindowText.textContent = "显示区间：-";
    return;
  }

  const startLabel = labels[startIndex];
  const endLabel = labels[endIndex];
  const count = endIndex - startIndex + 1;
  rangeWindowText.textContent = `显示区间：${formatDate(startLabel)} 至 ${formatDate(endLabel)}（${count} 个点位）`;
}

function renderChartFromRange(startIndex, endIndex) {
  const source = state.chartSource;
  if (!source) return;

  const labels = source.labels.slice(startIndex, endIndex + 1);
  const datasets = source.datasets.map((dataset) => ({
    ...dataset,
    data: dataset.data.slice(startIndex, endIndex + 1),
    snapshots: dataset.snapshots
      ? dataset.snapshots.slice(startIndex, endIndex + 1)
      : dataset.snapshots,
  }));

  if (!state.chart) {
    state.chart = new Chart(chartCanvas, {
      type: "line",
      data: { labels, datasets },
      options: buildChartOptions(),
    });
  } else {
    state.chart.data.labels = labels;
    state.chart.data.datasets = datasets;
    state.chart.update("none");
  }

  requestAnimationFrame(alignSliderToChartAxis);
}

function applyRangeSelection(changedInput = "") {
  if (!state.chartSource) return;
  const { startIndex, endIndex, maxIndex } = getRangeSelection(changedInput);
  syncRangeTrackVisual(startIndex, endIndex, maxIndex);
  updateRangeWindowText(startIndex, endIndex);
  renderChartFromRange(startIndex, endIndex);
}

function initializeRangeControls(labels) {
  const maxIndex = Math.max(labels.length - 1, 0);
  const hasRange = labels.length > 1;

  rangeStartInput.min = "0";
  rangeEndInput.min = "0";
  rangeStartInput.max = String(maxIndex);
  rangeEndInput.max = String(maxIndex);
  rangeStartInput.value = "0";
  rangeEndInput.value = String(maxIndex);

  setRangeControlsEnabled(hasRange);
  syncRangeTrackVisual(0, maxIndex, maxIndex);
  updateRangeWindowText(0, maxIndex);
  requestAnimationFrame(alignSliderToChartAxis);
}

function renderChart(seriesList) {
  const labelSet = new Set();
  seriesList.forEach((series) => {
    series.snapshots.forEach((snapshot) => labelSet.add(snapshot.date));
  });

  const labels = Array.from(labelSet).sort();
  state.chartSource = {
    labels,
    datasets: createDatasets(seriesList, labels),
  };

  initializeRangeControls(labels);
  applyRangeSelection();
}

async function parseJsonOrThrow(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`接口返回非 JSON 内容（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `接口异常（HTTP ${response.status}）`);
  }

  return payload;
}

async function runSimulation() {
  const assets = getSelectedAssets();
  if (assets.length === 0) {
    setStatus("请至少选择一个资产。", "error");
    return;
  }

  if (!startDateInput.value) {
    setStatus("请选择定投开始日期。", "error");
    return;
  }

  const amount = Number(amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    setStatus("请输入有效的定投金额。", "error");
    return;
  }

  simulateBtn.disabled = true;
  setStatus("正在计算，请稍候...");

  try {
    const returnMode = getSelectedReturnMode();
    const requestPayload = {
      assets,
      returnMode,
      frequency: getSelectedFrequency(),
      precision: getSelectedPrecision(),
      startDate: startDateInput.value,
      amount,
    };
    let payload = null;

    if (state.dataSourceMode === "local") {
      payload = await simulateFromLocal(requestPayload);
    } else {
      try {
        const response = await fetch(buildApiUrl("/api/simulate"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestPayload),
        });
        payload = await parseJsonOrThrow(response);
      } catch (apiError) {
        payload = await simulateFromLocal(requestPayload);
        state.dataSourceMode = "local";
        state.metaWarnings = filterVisibleWarnings([
          `后端接口不可用，已自动切换本地静态模式（${apiError.message}）`,
        ]);
      }
    }

    renderSummaryCards(payload.series);
    renderChart(payload.series);

    const precisionLabel = payload.request.precision === "weekly" ? "周度" : "月度";
    const modeLabel = formatReturnModeLabel(payload.request.returnMode);
    const pointCount = payload.series[0]?.snapshots?.length || 0;
    rangeText.textContent = `回测区间：${payload.request.effectiveStartDate} 至 ${payload.request.endDate}（${modeLabel}，${precisionLabel}点位 ${pointCount} 个）`;

    const visibleWarnings = filterVisibleWarnings(payload.warnings);
    if (visibleWarnings.length > 0) {
      setStatus(visibleWarnings.join("；"), "error");
    } else {
      setStatus("回测完成。尝试更换频率或金额，对比定投节奏差异。", "success");
    }
  } catch (error) {
    setStatus(`计算失败：${error.message}`, "error");
  } finally {
    simulateBtn.disabled = false;
  }
}

async function loadMeta() {
  const returnMode = getSelectedReturnMode();
  let payload = null;

  if (!runtimeApiBase && isGithubPagesRuntime()) {
    payload = await loadMetaFromLocal(returnMode);
    state.dataSourceMode = "local";
  } else {
    try {
      const response = await fetch(
        buildApiUrl(`/api/meta?returnMode=${encodeURIComponent(returnMode)}`)
      );
      payload = await parseJsonOrThrow(response);
      state.dataSourceMode = "api";
    } catch (apiError) {
      payload = await loadMetaFromLocal(returnMode);
      state.dataSourceMode = "local";
      payload.warnings = filterVisibleWarnings([
        ...(Array.isArray(payload.warnings) ? payload.warnings : []),
        `后端接口不可用，已切换本地静态模式（${apiError.message}）`,
      ]);
    }
  }

  if (!Array.isArray(payload.assets) || payload.assets.length === 0) {
    throw new Error("元数据为空");
  }

  state.meta = payload;
  state.metaWarnings = filterVisibleWarnings(payload.warnings);
  updateStartDateBounds();
  return payload;
}

async function init() {
  simulateBtn.disabled = true;
  setStatus("正在加载指数历史数据...");

  try {
    await loadMeta();
    simulateBtn.disabled = false;
    if (state.metaWarnings.length > 0) {
      setStatus(state.metaWarnings.join("；"), "error");
    } else if (state.dataSourceMode === "local") {
      setStatus(
        `数据已就绪（${formatReturnModeLabel(getSelectedReturnMode())}，本地静态模式）。`,
        "success"
      );
    } else {
      setStatus(`数据已就绪（${formatReturnModeLabel(getSelectedReturnMode())}）。`, "success");
    }
  } catch (error) {
    simulateBtn.disabled = true;
    setStatus(`初始化失败：${error.message}。请确认后端已启动。`, "error");
  }
}

assetInputs.forEach((input) => {
  input.addEventListener("change", () => {
    enforceAssetSelectionLimit(input);
    updateStartDateBounds();
  });
});

returnModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    void init();
  });
});

openDatePickerBtn.addEventListener("click", () => {
  if (typeof startDateInput.showPicker === "function") {
    startDateInput.showPicker();
    return;
  }
  startDateInput.focus();
});

dateQuickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyQuickDate(button.dataset.dateAction);
  });
});

startDateInput.addEventListener("change", refreshDateQuickButtonState);
startDateInput.addEventListener("input", refreshDateQuickButtonState);

rangeStartInput.addEventListener("input", () => {
  applyRangeSelection("start");
});

rangeEndInput.addEventListener("input", () => {
  applyRangeSelection("end");
});

resetRangeBtn.addEventListener("click", () => {
  const labels = state.chartSource?.labels || [];
  const maxIndex = Math.max(labels.length - 1, 0);
  rangeStartInput.value = "0";
  rangeEndInput.value = String(maxIndex);
  applyRangeSelection();
});

window.addEventListener("resize", () => {
  if (!state.chartSource) return;
  requestAnimationFrame(alignSliderToChartAxis);
});

simulateBtn.addEventListener("click", runSimulation);

init();
