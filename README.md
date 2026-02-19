# 复利实验室（DCA Lab）

一个面向普通投资者的定投回测网页工具，用来直观看到“长期定投 + 复利”的效果。

你可以用它回答这些问题：

- 同样每月投 500 美元，标普 500 和纳斯达克 100 差别有多大？
- 全收益（含分红再投资）和价格收益（不含分红）差别有多大？
- 不同定投频率（每月/每周/每日）会怎样影响回撤和收益？

---

## 核心功能

- 支持两个资产同图对比（标普 500、纳斯达克 100）
- 支持三种定投频率：每月、每周、每个交易日
- 支持两种回测口径：
  - 全收益（分红再投资，使用 ETF 替代口径）
  - 价格收益（不含分红）
- 支持时间快捷选择（近 1/3/5/10/15/20 年等）和区间滑块
- 图表显示：
  - 累计资产
  - 累计本金（单独一条公共本金线）
  - 支持区间缩放与重置
- 结果概览显示：
  - 累计投入
  - 账户总资产
  - 累计收益
  - 累计收益率
  - 年化回报率
  - 最大回撤
  - 年化波动率

---

## 目录结构（相对路径）

- `public/`：前端源码（页面、样式、交互逻辑）
- `docs/`：GitHub Pages 发布目录（由脚本自动生成）
- `data/market-cache/`：本地缓存数据（JSON）
- `scripts/`：数据与发布辅助脚本
- `server.js`：Node 后端（可选，用于 API 模式）

---

## 数据来源与更新机制

### 数据来源

- 主要来源：Stooq 日线数据
- 回测基于交易日收盘价

### 自动更新（已内置）

仓库内置 GitHub Actions，会定时更新数据并同步到 Pages：

- 工作流：`.github/workflows/update-market-data.yml`
- 频率：每 6 小时一次（同时支持手动触发）
- 更新内容：
  1. 拉取最新市场数据到 `data/market-cache/`
  2. 同步前端与数据到 `docs/`
  3. 自动提交并触发 Pages 发布

这意味着：用户打开网页时，读到的是仓库中“自动刷新后的最新快照数据”。

---

## 运行方式

### 方式 A：只用 GitHub Pages（推荐，最省心）

无需单独后端，页面可直接运行回测（使用仓库中的缓存数据）。

1. 开启仓库 Pages：`main` 分支 + `/docs` 目录
2. 等待 Actions 与 Pages 发布完成
3. 访问你的 Pages 链接

### 方式 B：前后端分离（可选）

如果你希望 API 在线服务化（例如自定义跨域、服务端刷新策略），可以部署 `server.js` 到 Render 等平台。

- 前端通过 `public/config.js` / `docs/config.js` 配置 API 地址：

```js
window.__DCA_API_BASE__ = "https://your-api-domain.example.com";
```

- 为空字符串时，前端会优先尝试同域 API，不可用时回退到仓库缓存数据。

---

## 星球会员访问门槛（已内置）

你提出的目标是：仅“处于有效期的知识星球会员”可以进入网页。  
本项目已加入服务端门槛能力（登录页 + 会员有效期校验 + 会话 Cookie）。

### 先说关键限制

如果只使用 GitHub Pages（纯静态托管），无法做到真正的权限控制。  
要实现会员门槛，必须使用后端模式（部署 `server.js`）。

### 门槛方案（当前实现）

- 访问任意业务页面时，未登录会自动跳转到 `/login.html`
- 登录需要：
  - `memberId`（会员ID）
  - `accessCode`（访问码）
- 服务端校验：
  - 会员是否存在
  - `status` 是否为 `active`
  - 当前时间是否仍在 `expiresAt` 有效期内
  - 访问码哈希是否匹配
- 通过后签发 HttpOnly 会话 Cookie，过期后需重新登录

> 说明：知识星球没有通用的第三方 OAuth 网页授权流程可直接给你站点做“官方登录态映射”，
> 当前实现采用你可控、可落地的会员库方式来保证访问权限。

### 快速配置步骤

1. 启用后端门槛（生产环境变量）

```bash
AUTH_ENABLED=true
AUTH_SESSION_SECRET=请设置一个长度足够的随机字符串
AUTH_CODE_PEPPER=可选_用于加强访问码哈希
```

2. 管理会员名单（含有效期）

```bash
node scripts/manage-members.mjs upsert --member-id 10001 --name 张三 --expires-at 2027-01-31 --access-code your_code_here
node scripts/manage-members.mjs list
```

3. 启动服务并访问

```bash
node server.js
```

未登录将进入登录页，登录成功后可访问主功能页。

4. 会员过期处理

- 到达 `expiresAt` 后自动拒绝访问（新请求即生效）
- 可用脚本手动更新续费会员有效期：

```bash
node scripts/manage-members.mjs upsert --member-id 10001 --expires-at 2028-01-31 --status active
```

---

## 可立即发的上线方案（无需买域名）

目标：你只发一个链接，用户打开后先走会员门槛，再进入主页面。

### 推荐部署方式：Render 免费子域名（同域前后端）

1. 在 Render 选择 `New +` -> `Blueprint`
2. 连接该 GitHub 仓库，使用仓库内 `render.yaml`
3. 在 Render 环境变量里设置：
   - `AUTH_SESSION_SECRET`（必须，随机长字符串）
   - `AUTH_CODE_PEPPER`（建议）
4. 部署完成后会得到：`https://<你的服务名>.onrender.com`
5. 发给读者的入口链接：
   - `https://<你的服务名>.onrender.com/login.html`

### 为什么不建议把登录入口放在 GitHub Pages

- GitHub Pages 只有静态托管，没有后端会话
- 会员鉴权依赖 `/api/auth/*`，必须由后端提供
- 所以正式入口应使用 Render 子域名，而非 `github.io` 页面

## 本地开发

### 1) 启动后端

```bash
node server.js
```

默认地址：`http://127.0.0.1:8787`

### 2) 打开页面

直接访问上面的地址即可。

---

## 常用脚本

### 同步发布目录（public -> docs + data）

```bash
node scripts/sync-pages.mjs
```

作用：

- 同步前端文件到 `docs/`
- 同步缓存数据到 `docs/data/market-cache/`
- 写入 `docs/.nojekyll`

### 手动更新市场数据

```bash
node scripts/fetch-market-data.mjs
```

作用：

- 从数据源抓取最新价格
- 更新 `data/market-cache/*.json`

### 管理会员名单（门槛功能）

```bash
node scripts/manage-members.mjs list
node scripts/manage-members.mjs upsert --member-id 10001 --name 张三 --expires-at 2027-01-31 --access-code your_code_here
node scripts/manage-members.mjs import-csv --file ./members.csv
node scripts/manage-members.mjs remove --member-id 10001
```

会员数据文件：`data/access-control/members.json`

`import-csv` 需要列名：`member_id,name,expires_at,access_code,status`（其中 `status` 可选，默认 `active`）。

---

## API（后端模式下）

- `GET /healthz`：部署平台探活（无需登录）
- `GET /api/meta`：返回资产可用区间、数据源信息
- `POST /api/simulate`：执行回测并返回图表/指标数据
- `GET /api/auth/me`：查询当前登录态
- `POST /api/auth/login`：会员登录
- `POST /api/auth/logout`：退出登录

---

## 环境变量（后端模式）

- `HOST`：监听地址（默认 `127.0.0.1`）
- `PORT`：监听端口（默认 `8787`）
- `CORS_ALLOW_ORIGIN`：跨域允许源（默认 `*`）
- `REQUEST_FRESH_WINDOW_MS`：请求触发同步刷新阈值
- `REQUEST_REFRESH_TIMEOUT_MS`：同步刷新超时
- `BACKGROUND_REFRESH_INTERVAL_MS`：后台刷新间隔
- `BACKGROUND_REFRESH_TRIGGER_MS`：触发异步刷新的缓存年龄阈值
- `STARTUP_REFRESH_DELAY_MS`：启动后首次刷新延迟
- `AUTH_ENABLED`：是否启用会员门槛（默认 `true`）
- `AUTH_SESSION_SECRET`：登录会话签发密钥（生产环境必须设置）
- `AUTH_SESSION_TTL_MS`：会话有效期毫秒（默认 `86400000`）
- `AUTH_COOKIE_NAME`：会话 Cookie 名称
- `AUTH_COOKIE_SECURE`：Cookie Secure 策略（`auto` / `true` / `false`）
- `AUTH_CODE_PEPPER`：访问码哈希附加盐（可选，推荐设置）

---

## 常见问题

### 1) 页面提示“接口返回非 JSON 内容（HTTP 404）”

通常是页面在请求 `/api/*`，但当前域名没有后端接口。

可选处理：

- 直接使用内置缓存模式（推荐）
- 或配置 `window.__DCA_API_BASE__` 指向有效后端

### 2) 为什么网页不是“每次打开瞬间抓取并写回服务器”？

GitHub Pages 是静态托管，不运行常驻后端进程。  
本项目采用“定时自动刷新 + 页面读取最新缓存”的方式，兼顾稳定性和可维护性。

---

## 许可与声明

- 本项目用于学习与策略研究，不构成任何投资建议。
- 历史回测不代表未来表现。
