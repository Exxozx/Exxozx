# Muratab · مرتب

*Muratab* is Arabic for **neat**. It keeps a restaurant or a whole chain's stock in order.

- **Tracks stock from the menu and orders.** Every dish has a recipe. Each order deducts the ingredients it uses, and an order is refused if a branch can't make it.
- **Knows whether you have too much or too little.** Demand is forecast from the last 14 days of orders. Each ingredient is marked *out / critical / low / healthy / excess* using the supplier's lead time, safety days and shelf life.
- **Orders from trusted suppliers.** Shortages turn into draft purchase orders, one per supplier. For each item it picks the trusted supplier with the best price after allowing for on-time delivery. Untrusted suppliers can never be ordered from.
- **Live prices for everything.** Every supplier quote updates live (streamed to the browser). You see a market price, trend chart and change for each ingredient, and the food cost and margin of every dish at today's prices. Live prices feed straight into supplier choice, purchase-order pricing and stock value.
- **Fully editable.** The *Setup* tab lets you add, edit and delete dishes and their recipes, ingredients, suppliers and their catalogs, and branches. You can rename the business and change the currency, export everything to JSON and import it back, or start from a blank template. The demo data is just a starting point.
- **Moves stock between branches on a blockchain.** Branches send and request stock through a shared, permissioned ledger. Every block is hash-linked and signed with the acting branch's Ed25519 key. It also suggests sending one branch's surplus to another branch's shortage before you buy more.

## First visit: restaurant setup

The first time Muratab opens, a setup wizard asks for everything the platform needs, once:

1. **Welcome**: language (English / العربية, with full right-to-left layout), theme (system / light / dark) and accent colour. Then either start empty or start from the sample restaurant.
2. **Restaurant & manager**: name, cuisine, manager's name and title, contact details, currency.
3. **Locations & tables**: every branch with its address and hours, plus a floor plan of tables (name, seats, area). "Add 6 tables with 4 seats in Terrace" builds them in one click.
4. **Ingredients & stock**: what you cook with and how much is on the shelf at each location.
5. **Menu & favourites**: dishes, prices, categories, recipes, the channels each dish is sold on, and a ★ on your most popular dishes.
6. **Kitchenware & utilities**: counts per location (appliances, cookware, tableware, gas, water filters…) with a minimum that flags shortages.
7. **Ordering channels**: dine-in, takeaway, Talabat, Deliveroo, Careem, your own website, with each platform's store ID per location.
8. **Review & finish**.

Every step saves immediately, so setup can be resumed. Afterwards the **Home** screen greets the manager by name and shows the profile at a glance: locations and tables in use, best sellers and favourites, menu, stock, kitchenware below minimum, channels and today's numbers. Every card has an **Edit** button that reopens the matching step, so changing a menu or a floor plan takes seconds.

## Orders and delivery apps

All orders, whether dine-in (by table), takeaway or from delivery apps, follow one lifecycle on the **kitchen board**:

`received → accepted → preparing → ready → completed` (or `rejected` / `cancelled`)

Ingredients come out of stock when an order is **accepted**. They go back if the order is cancelled before cooking starts. Platform orders can be auto-accepted per channel. If they can't be made (unknown dish, not enough stock), they are rejected with a reason.

**How a delivery app connects** (all platform-specific code is in `src/integrations.js`):

| Direction | What happens |
|---|---|
| App → Muratab | The platform POSTs each order to `/api/integrations/<channel>/orders`. The adapter maps it to the right location (by store ID) and dishes (by item code), and replies in the platform's format. Repeated deliveries of the same order are ignored. If `<CHANNEL>_WEBHOOK_SECRET` is set, requests without it get a 401. |
| Muratab → App | Accept / reject / ready / picked-up changes are sent to the platform's order-status API. When a dish sells out, an availability update is sent too, and "Send menu" pushes the full menu. These calls go out for real when `<CHANNEL>_API_URL` and `<CHANNEL>_API_TOKEN` are set (e.g. `TALABAT_API_URL`, `TALABAT_API_TOKEN`). Otherwise they are recorded as simulated. Every call in either direction appears under *Orders → Delivery apps*. |

> **Before going live with Talabat or Deliveroo:** their integration APIs are only documented for approved partners. The Talabat adapter follows the publicly described shape of Delivery Hero's POS plugin API (order `token`/`code`, `products[].remoteCode`, `platformRestaurant.id`, status values such as `order_accepted`), and the Deliveroo adapter follows its Order API. Both must be checked field by field against the official spec you receive as a partner. Only `src/integrations.js` needs to change.

In the prototype, *Simulate order* builds a realistic platform order and passes it through the same webhook code.

## Try the prototype (no install)

Open **`dist/muratab.html`** in any modern browser (double-click it). That single file is the complete working app: the inventory engine, supplier ordering, live prices and the signed branch ledger all run inside the page. It needs no server and no internet (fonts fall back to system fonts offline). Your changes are saved in that browser. Use *Setup → Business & data* to export them or start again.

## Run it as a server

Requires Node.js 18+. Running the server needs no dependencies.

```bash
cd muratab
npm start          # http://localhost:3000
npm test           # 28 tests: inventory, purchasing, transfers, ledger, live prices, editing, profile, orders, delivery-app webhooks
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
src/profile.js      restaurant profile, locations & tables, kitchenware, home summary
src/orders.js       order lifecycle, kitchen board, platform notifications
src/integrations.js ordering channels + Talabat / Deliveroo / generic adapters
src/crypto.js       signing/hashing (Node)      web/crypto-browser.js  (browser)
src/storage.js      JSON-file storage (Node)    web/storage-browser.js (browser)
web/standalone.js   prototype entry: runs the back end in the page
src/prices.js       live price feed (simulated or HTTP source)
src/inventory.js    forecasting, status, supplier ranking, transfer matching
src/blockchain.js   signed hash-chained ledger and verification
src/app.js          business logic and persistence
src/seed.js         demo chain data
public/             web UI (vanilla JS), used by both: app.js (stock, suppliers, ledger, prices),
                    home.js, wizard.js, orders.js, i18n.js + i18n-ar.js (Arabic), main.js
dist/muratab.html   the built prototype – open it in a browser
test/               node:test suite
```
