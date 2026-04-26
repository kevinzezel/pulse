# Storage drivers — local files, MongoDB, S3

Pulse persists eleven synced JSON documents per dashboard: `projects`, `flows`, `flow-groups`, `groups`, `notes`, `prompts`, `servers`, `sessions`, `compose-drafts`, `recent-cwds`, and `intelligence-config`. Per-tab view state and terminal layouts live in browser `sessionStorage`, not in the storage driver. By default the synced documents live in local files under `frontend/data/`. Configure a remote driver to share the same workspace across machines — install Pulse on your desktop, laptop, and a VPS, point each one at the same remote, and the same data appears on all three.

Without a remote configured, Pulse works exactly as a single install (local files, no dependency on anything external).

## Table of contents

1. [When to use each driver](#when-to-use-each-driver)
2. [MongoDB setup](#mongodb-setup)
3. [S3 / S3-compatible setup](#s3--s3-compatible-setup)
4. [Sync local ↔ cloud](#sync-local--cloud)
5. [Behavior notes](#behavior-notes)

## When to use each driver

| Driver | Use when | Config |
|---|---|---|
| **Local files** | Default. Single install, no sharing. | (nothing — the absence of cloud config) |
| **MongoDB** | You have a Mongo instance or want Atlas free tier. | `mongodb://` or `mongodb+srv://` URI, optional database name. |
| **S3 / S3-compatible** | You already use AWS, or want zero-ops on Cloudflare R2, or run MinIO on-prem. | Endpoint (optional — blank for AWS), bucket, region, Access Key ID, Secret Access Key, optional prefix. |

The **S3 driver** works with **AWS S3**, **Cloudflare R2** (zero egress), **Google Cloud Storage** (via S3 interoperability), **MinIO** (self-hosted — tick "path-style addressing"), **Backblaze B2**, **DigitalOcean Spaces**, and any other S3-compatible target. Concurrency safety uses the native ETag + `If-Match` — no custom fields added to your objects.

Configure all three through **Settings → Storage**: three horizontal tabs (Local / MongoDB / S3), each with its own form. Paste the URI or fill the S3 fields, click **Validate & Activate** — the dashboard pings the remote, saves the config, and **swaps the storage backend live**, no restart. The next API call reads from the new driver.

## MongoDB setup

If you already run Mongo or want Atlas free tier:

1. In the MongoDB tab, paste a `mongodb://…` URI and optionally a database name (defaults to `pulse`).
2. Save. The dashboard runs `ping` + `listCollections` with a 3s timeout, writes `data/storage-config.json`, and hot-swaps the backend — from the next API call on, every read/write goes to MongoDB. **No restart required.**
3. Click **Sync local → cloud** once to seed MongoDB from the current local files (destructive on the Mongo side — requires typing `sync` to confirm).

## S3 / S3-compatible setup

AWS S3, Cloudflare R2, Google Cloud Storage, MinIO, Backblaze B2, DO Spaces:

1. In the S3 tab, fill: **endpoint** (leave empty for AWS, or full URL for R2/GCS/MinIO — e.g. `https://<account>.r2.cloudflarestorage.com`), **bucket**, **region** (`us-east-1` default, `auto` for R2), **Access Key ID**, **Secret Access Key**, optional **prefix** (useful to share a bucket with other apps), and **path-style addressing** checkbox (required for MinIO).
2. Save. The dashboard runs `HeadBucket` with a 3s timeout to confirm the credentials can reach the bucket, writes `data/storage-config.json`, and hot-swaps.
3. Click **Sync local → cloud** to seed objects into the bucket.

## Sync local ↔ cloud

Two destructive sync buttons let you migrate in either direction:

- **Sync local → cloud** — push the current local files to the active remote (for hooking up a new machine, or seeding the cloud the first time).
- **Sync cloud → local** — pull the cloud back to local files (before deactivating, or to take a local snapshot).

Both require typing the word `sync` into a confirm modal because they overwrite the destination side.

To go back to local files from either driver: **Settings → Storage → Sync cloud → local** (optional, if you want the current cloud state preserved locally), then **Deactivate remote storage** — the frontend switches back to local files instantly. The local files that were there before activation are untouched and become active again as-is.

Secrets in the UI are always masked; every secret field has a **Copy** button that writes the full plaintext to your clipboard — no toggle exposes them on screen.

## Behavior notes

- **Driver tabs in the UI** — Local / MongoDB / S3 as three horizontal tabs. The active driver is marked with `*`. Switching tabs lets you preview / edit another driver's config without activating it.
- **Secrets are masked but copyable** — URI, Access Key, Secret Key are always rendered as `••••••`. Click the Copy button next to any secret to copy the full plaintext value to your clipboard.
- **Hot-reload, no restart** — saving, changing, or deactivating a remote swaps the backend live. In-flight requests finish on the old backend; the old client is drained for 10s in the background, then closed.
- **Fail-fast on outage** — if the remote becomes unreachable at runtime (network loss, credential rotation, server down), every API call returns `503 errors.storage.unavailable` until it comes back. If the frontend boots with a dead remote, same story — open Settings → Storage and deactivate or fix.
- **Concurrent writes** from multiple dashboards against the same remote are serialized per-object via optimistic locks with auto-retry. Mongo uses a `_version` integer field; S3 uses the native ETag + `If-Match` header. No silent write losses; last-writer-wins only on the rare case of two people editing the exact same field simultaneously.
- **Refetch on tab focus** — when a browser tab regains focus, providers silently refetch so changes made on another machine show up without a manual reload.
- **Requirements** — MongoDB 4.2+ (driver `mongodb@7.x`) or any S3-compatible API. The `data/storage-config.json` file always stays local — it's the config to reach the remote, can't live inside the remote itself.
- **Legacy** — if upgrading from v1.5.x, the existing `data/mongo-config.json` is auto-migrated on first boot to the new unified `data/storage-config.json` and the legacy file is removed. Zero user action needed.
