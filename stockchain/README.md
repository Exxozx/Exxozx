# StockChain

Inventory management for restaurants and multi-branch chains.

- **Tracks stock from the menu and orders.** Every dish has a recipe. Each order deducts the ingredients it uses, and an order is refused if a branch can't make it.
- **Knows whether you have too much or too little.** Demand is forecast from the last 14 days of orders. Each ingredient is marked *out / critical / low / healthy / excess* using the supplier's lead time, safety days and shelf life.
- **Orders from trusted suppliers.** Shortages turn into draft purchase orders, one per supplier. For each item it picks the trusted supplier with the best price after allowing for on-time delivery. Untrusted suppliers can never be ordered from.
- **Moves stock between branches on a blockchain.** Branches send and request stock through a shared, permissioned ledger. Every block is hash-linked and signed with the acting branch's Ed25519 key. It also suggests sending one branch's surplus to another branch's shortage before you buy more.

## Run it

Requires Node.js 18+. There are no dependencies to install.

```bash
cd stockchain
npm start          # http://localhost:3000
npm test           # 12 tests: inventory, purchasing, transfers, ledger tampering, HTTP API
```

On first start it creates demo data for a three-branch chain (Downtown, Marina, Airport T3). That includes 14 days of order history, six suppliers (one untrusted) and some ledger activity. Data is stored in `stockchain/data/`. To start over, delete that folder or call `POST /api/reset`.

Use the **Acting as** selector to switch between branches. Each branch can only sign its own side of a transfer.

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
```

Sending a PO to a supplier is simulated (it returns a confirmation number). `sendPurchaseOrder` in `src/app.js` is where a real EDI/API adapter for each supplier would be plugged in.

## Layout

```
server.js           HTTP server + routes (Node built-ins only)
src/inventory.js    forecasting, status, supplier ranking, transfer matching
src/blockchain.js   signed hash-chained ledger and verification
src/app.js          business logic and persistence
src/seed.js         demo chain data
public/             web UI (vanilla JS)
test/               node:test suite
```
