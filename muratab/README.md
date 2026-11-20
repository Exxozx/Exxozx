# Muratab · مرتب

*Muratab* is Arabic for **neat**. It keeps a restaurant or a whole chain's stock in order.

- **Tracks stock from the menu and orders.** Every dish has a recipe. Each order deducts the ingredients it uses, and an order is refused if a branch can't make it.
- **Knows whether you have too much or too little.** Demand is forecast from the last 14 days of orders. Each ingredient is marked *out / critical / low / healthy / excess* using the supplier's lead time, safety days and shelf life.
- **Orders from trusted suppliers.** Shortages turn into draft purchase orders, one per supplier. For each item it picks the trusted supplier with the best price after allowing for on-time delivery. Untrusted suppliers can never be ordered from.
- **Live prices for everything.** Every supplier quote updates live (streamed to the browser). You see a market price, trend chart and change for each ingredient, and the food cost and margin of every dish at today's prices. Live prices feed straight into supplier choice, purchase-order pricing and stock value.
- **Fully editable.** The *Setup* tab lets you add, edit and delete dishes and their recipes, ingredients, suppliers and their catalogs, and branches. You can rename the business and change the currency, export everything to JSON and import it back, or start from a blank template. The demo data is just a starting point.
- **Moves stock between branches on a blockchain.** Branches send and request stock through a shared, permissioned ledger. Every block is hash-linked and signed with the acting branch's Ed25519 key. It also suggests sending one branch's surplus to another branch's shortage before you buy more.

## Try the prototype (no install)

Open **`dist/muratab.html`** in any modern browser (double-click it). That single file is the complete working app: the inventory engine, supplier ordering, live prices and the signed branch ledger all run inside the page. It needs no server and no internet (fonts fall back to system fonts offline). Your changes are saved in that browser. Use *Setup → Business & data* to export them or start again.

## Run it as a server

Requires Node.js 18+. Running the server needs no dependencies.

```bash
cd muratab
npm start          # http://localhost:3000
npm test           # 19 tests: inventory, purchasing, transfers, ledger tampering, live prices, editing, import/export, HTTP + SSE
npm install && npm run build   # rebuild dist/muratab.html after changing the code
```

### One codebase, two ways to run

The business logic in `src/` is shared. Only two small modules differ:

| Module | Server (`src/`) | Prototype (`web/`) |
|---|---|---|
| `crypto` | Node's built-in Ed25519 + SHA-256 | `@noble/ed25519` + `@noble/hashes` (audited, pure JS) |
| `storage` | JSON files in `data/` | the browser's `localStorage` |

`src/routes.js` defines the API once. The HTTP server serves it over the network, and the prototype calls it directly inside the page (`window.MuratabLocal`). `npm run build` bundles everything with esbuild into the single `dist/muratab.html`. Data from one doesn't carry over to the other except through *Export / Import*. The two use different key formats, so an import starts a fresh ledger either way.

On first start it creates demo data for a three-branch chain (Downtown, Marina, Airport T3). That includes 14 days of order history, six suppliers (one untrusted) and some ledger activity. Data is stored in `muratab/data/`. To start over, delete that folder or call `POST /api/reset`.

Use the **Acting as** selector to switch between branches. Each branch can only sign its own side of a transfer.

## Live prices

Each supplier catalog item has a **list price** (what you set up in Setup) and a **live price**. Every few seconds the price feed fetches new quotes and writes them into the catalog, so every calculation uses the live price. Purchase orders lock in the price at the moment they're created.

| Setting | Effect |
|---|---|
| *(default)* | Simulated market: each quote drifts randomly but is pulled back toward its list price (kept between 60% and 160% of it). Fresh produce and seafood move more than dry goods. |
| `PRICE_FEED_URL=https://…` | Real feed: the server GETs this URL each tick and expects `[{ "supplierId", "ingredientId", "price" }]`. Point it at a supplier API, a market-data service or a small proxy in front of them. Items not in the response keep their last price. |
| `PRICE_INTERVAL_MS=5000` | How often prices update. |
| `LIVE_PRICES=off` | Start with the feed paused (it can be resumed from the Live prices screen). |

"Market price" is the median of all quotes, including untrusted suppliers. Food cost uses the best *trusted* price.

## Working with your own data

Everything is editable from **Setup**:

- **Menu & recipes**: dishes, prices, and how much of each ingredient a portion uses.
- **Ingredients**: unit, category, shelf life. An ingredient can't be deleted while a dish uses it or an order/transfer for it is open.
- **Suppliers**: contact, rating, on-time %, trusted flag, and their catalog (list price, lead time, minimum order).
- **Branches**: adding one gives it its own signing key, and HQ registers it on the ledger with a `MEMBER_ADD` block. Branches can't be deleted, because the ledger history refers to them.
- **Business & data**: name and currency; **Export JSON** / **Import JSON**; **Start from blank**; **Restore demo data**.

Importing keeps all master data, stock, orders and purchase orders, but starts a **fresh ledger**. Private keys are never exported, so old blocks can't be re-signed.

## How the numbers work

For each ingredient at a branch:

| Value | Formula |
|---|---|
| Daily usage | ingredient used by orders in the last 14 days ÷ days |
| Target cover (days) | `min(lead time + targetDays, shelf life)` |
| Reorder point | usage × `min(lead time + safetyDays, target days)` |
| Excess above | usage × `max(target × 1.2, min(maxDays, shelf life))` |
| **Critical** | stock won't last until a supplier delivery arrives |
| Suggested order | `target − on hand − inbound`, rounded up to the supplier's minimum order |

"Inbound" counts open purchase orders plus transfers already in transit, so the same shortage is never ordered twice. `safetyDays`, `targetDays` and `maxDays` can be set per branch (*Inventory → Thresholds*).

## The branch ledger

- **Genesis block**: signed by HQ. It registers each branch's public key, which makes HQ the trust anchor.
- **Transfer lifecycle**: `TRANSFER_REQUEST` (signed by receiver) → `TRANSFER_DISPATCH` (signed by sender; stock leaves the sender) → `TRANSFER_RECEIVE` (signed by receiver; stock arrives). Requests can also be rejected by the sender (`TRANSFER_REJECT`) or cancelled by the requester (`TRANSFER_CANCEL`).
- **Rules are enforced in the chain itself.** A branch can't sign another branch's action, and invalid state changes (e.g. receiving twice) are refused.
- **Transfer state comes from the chain.** It is rebuilt by replaying the chain, not stored separately. `GET /api/ledger/verify` re-checks every hash, link, signature and state change. Editing any past block is detected.

> This demo runs every branch "node" in one process and keeps all private keys in `data/keys.json`. In a real deployment each branch would run its own node with only its own key (HSM/KMS) and copy blocks to the others.

## API (selected)

```
GET  /api/overview                         chain-wide status, suggestions, ledger health
GET  /api/branches/:id/inventory           per-ingredient forecast & status
POST /api/branches/:id/orders              { items: [{ menuItemId, qty }] }
POST /api/branches/:id/inventory/adjust    { ingredientId, countedQty | delta, reason }
POST /api/branches/:id/purchase-orders/auto
POST /api/purchase-orders/:id/send|receive|cancel
POST /api/transfers/request                { branchId, fromBranchId, lines }
POST /api/transfers/dispatch               { branchId, toBranchId, lines } | { branchId, transferId }
POST /api/transfers/:id/receive|reject|cancel   { branchId }
GET  /api/ledger  ·  GET /api/ledger/verify
GET  /api/prices                           live price snapshot (ingredients, quotes, menu food cost)
GET  /api/prices/stream                    Server-Sent Events: a `prices` event on every tick
POST /api/prices/tick|start|stop
POST|PUT|DELETE /api/menu[/:id]  ·  /api/ingredients[/:id]  ·  /api/suppliers[/:id]
POST /api/branches  ·  PATCH /api/branches/:id  ·  PATCH /api/meta
GET  /api/export  ·  POST /api/import
```

Sending a PO to a supplier is simulated (it returns a confirmation number). `sendPurchaseOrder` in `src/app.js` is where a real EDI/API adapter for each supplier would be plugged in.

## Layout

```
server.js           HTTP server (Node built-ins only)
build.js            builds the standalone prototype into dist/
src/routes.js       the API, shared by server and prototype
src/crypto.js       signing/hashing (Node)      web/crypto-browser.js  (browser)
src/storage.js      JSON-file storage (Node)    web/storage-browser.js (browser)
web/standalone.js   prototype entry: runs the back end in the page
src/prices.js       live price feed (simulated or HTTP source)
src/inventory.js    forecasting, status, supplier ranking, transfer matching
src/blockchain.js   signed hash-chained ledger and verification
src/app.js          business logic and persistence
src/seed.js         demo chain data
public/             web UI (vanilla JS), used by both
dist/muratab.html   the built prototype – open it in a browser
test/               node:test suite
```
