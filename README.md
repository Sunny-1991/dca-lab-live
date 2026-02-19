# 复利实验室

一个本地可运行的网页应用，帮助用户理解：

- 指数定投（标普500 / 纳斯达克100）
- 不同定投频率（月 / 周 / 每个交易日）
- 复利增长、最大回撤与回撤恢复时间

## 功能

- 资产选择：标普500、纳斯达克100（支持双资产同图对比）
- 参数输入：开始日期、单次定投金额（USD）、定投频率
- 数据精度：图表可切换为周度或月度点位
- 回测口径：
  - 全收益（分红再投资）：使用 `SPY.US` / `QQQ.US` 作为代理口径
  - 价格收益（不含分红）：使用 `^SPX` / `^NDX` 指数口径
  - 若全收益上游短时不可用，会自动基于价格序列叠加分红再投资模型估算全收益，避免与价格收益完全一致
- 核心输出：
  - 账户总资产走势图
  - 累计投入、累计收益、收益率
  - 年化回报率（基于累计投入、期末总资产、回测总时长）
  - 最大回撤
  - 回撤恢复时间长度（天 / 月 / 年）

## 数据与本地化缓存

- 回测以交易日收盘价为基准
- 后端优先拉取 Stooq，失败回退 FRED
- 拉取后自动写入本地缓存：
  - `/Users/coattail/Documents/New project/dca-compound-lab/data/market-cache/sp500.json`
  - `/Users/coattail/Documents/New project/dca-compound-lab/data/market-cache/sp500.total_return.json`
  - `/Users/coattail/Documents/New project/dca-compound-lab/data/market-cache/nasdaq100.json`
  - `/Users/coattail/Documents/New project/dca-compound-lab/data/market-cache/nasdaq100.total_return.json`
- 自动更新策略（确保后续用户在任意时间尽量拿到最新回测数据）：
  - 服务启动后会自动执行一次后台刷新
  - 服务运行中会按固定间隔自动刷新全部资产
  - 请求 `api/meta` / `api/simulate` 时，若缓存超过新鲜阈值，会优先尝试同步刷新（含超时保护）
  - 若上游短时不可用，会回退到本地缓存，保证服务可用

可选环境变量（单位毫秒）：

- `BACKGROUND_REFRESH_INTERVAL_MS`：后台定时刷新间隔（默认 `21600000`，即 6 小时）
- `REQUEST_FRESH_WINDOW_MS`：请求触发同步刷新阈值（默认 `21600000`，即 6 小时）
- `REQUEST_REFRESH_TIMEOUT_MS`：请求同步刷新超时（默认 `12000`）
- `BACKGROUND_REFRESH_TRIGGER_MS`：触发后台异步刷新的缓存年龄阈值（默认 `7200000`，即 2 小时）
- `STARTUP_REFRESH_DELAY_MS`：启动后首次自动刷新延迟（默认 `30000`）
- `CORS_ALLOW_ORIGIN`：前端跨域白名单（默认 `*`，生产建议填 `https://你的用户名.github.io`）

## 运行

```bash
cd "/Users/coattail/Documents/New project/dca-compound-lab"
node server.js
```

打开：`http://127.0.0.1:8787`

## 接口

- `GET /api/meta`：资产可用区间和数据源信息
- `POST /api/simulate`：执行定投回测并返回曲线与指标

## 上线方案（GitHub Pages + Render）

推荐使用“同仓库双部署”：

- 后端 API：部署到 Render（启动命令 `node server.js`）
- 前端静态站：发布 `docs/` 到 GitHub Pages

### 1) 准备 Pages 文件

项目提供一键同步脚本：

```bash
node scripts/sync-pages.mjs
```

会把 `public/` 同步到 `docs/`，并写入 `docs/.nojekyll`。

### 2) 部署后端（Render）

- 仓库根目录已提供 `render.yaml`
- 创建 Web Service 后，把 `CORS_ALLOW_ORIGIN` 设为你的 Pages 域名（例如 `https://sunny-1991.github.io`）

### 3) 配置前端 API 地址

前端通过 `config.js` 注入 API 基础地址：

- 本地开发：`public/config.js` 可保持空字符串（默认走同域 `/api`）
- Pages 部署：把 `docs/config.js` 改为你的 Render 域名，例如：

```js
window.__DCA_API_BASE__ = "https://dca-lab-api.onrender.com";
```

> 若不配置后端，GitHub Pages 会自动启用“本地静态模式”（读取 `docs/data/market-cache/*.json`）并可正常回测，但无法自动拉取最新行情。

### 4) 开启 GitHub Pages

- Repository Settings -> Pages
- Source 选 `Deploy from a branch`
- Branch 选 `main`，Folder 选 `/docs`

### 5) 自动同步 docs（可选）

已提供工作流 `.github/workflows/sync-pages-docs.yml`：

- 当 `public/` 变更时，自动执行 `scripts/sync-pages.mjs`
- 自动提交最新 `docs/`
