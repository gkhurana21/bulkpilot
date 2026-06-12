# BulkPilot — Bulk Price Editor with One-Click Rollback

An embedded Shopify app that lets merchants bulk-edit variant prices across their catalog — with a live preview before anything is written, and a snapshot-based rollback for every operation after.

Editing prices one variant at a time in the Shopify admin doesn't scale past a handful of products. Existing bulk editors apply changes blindly; if a 500-variant markdown goes wrong, there's no undo. BulkPilot treats bulk edits like database migrations: **preview → apply → (optionally) roll back**.

## Features

- **Search & filter** the catalog using Shopify's native search syntax (`vendor:Acme`, `tag:sale`, free text)
- **Six adjustment modes**: set price, increase/decrease by percent or amount, round to `.99` endings
- **Live preview** — the table shows current → new price for every selected variant before applying
- **Snapshot every write** — each applied change records the prior price in SQLite via Prisma
- **One-click rollback** from the History page restores every variant to its exact pre-edit price
- **Partial-failure handling** — per-variant success/failure tracking; failed items surface with their API error, and rollbacks only replay successfully-applied changes

## Stack

| Layer | Tech |
| --- | --- |
| Framework | React Router 7 (Shopify's official app template) |
| UI | Polaris web components + App Bridge |
| API | Shopify GraphQL Admin API (`productVariantsBulkUpdate`, cost-budgeted paginated product queries) |
| Persistence | Prisma + SQLite (operation snapshots, sessions) |
| Auth | OAuth via `@shopify/shopify-app-react-router` |

## How rollback works

Every bulk apply creates a `BulkOperation` row plus one `OperationItem` per variant holding `{oldValue, newValue, status}`. Applies run grouped by product and chunked to the API's 250-variant mutation limit, with `allowPartialUpdates` so one bad variant doesn't sink the batch. Rollback replays the snapshots in reverse — only for items that actually applied — and the operation is marked `ROLLED_BACK` only if every restore succeeds.

## Development

```bash
npm install
npm run dev        # shopify app dev — handles auth, tunnels, and hot reload
```

Requires a [Shopify Partner account](https://partners.shopify.com) and a development store. Scopes: `write_products`.

```bash
npm run typecheck  # react-router typegen + tsc
npm run build
```
