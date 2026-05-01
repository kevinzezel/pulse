# Storage drivers — local files, S3

Pulse persists fifteen synced JSON documents per dashboard: `projects`, `flows`, `flow-groups`, `groups`, `notes`, `prompts`, `prompt-groups`, `servers`, `sessions`, `compose-drafts`, `recent-cwds`, `intelligence-config`, `task-boards`, `task-board-groups`, and `task-attachments`. Per-tab view state and terminal layouts live in browser `sessionStorage`, not in the storage driver. By default the synced documents live in local files under `frontend/data/`. Configure a remote driver to share the same workspace across machines — install Pulse on your desktop, laptop, and a VPS, point each one at the same remote, and the same data appears on all three.

Tasks/Kanban also support real binary attachments — images (PNG, JPEG, GIF, WebP, AVIF), PDFs, and Office documents (Word, Excel, PowerPoint). Up to 20 MB per file and 20 attachments per task. Attachments stream through `/api/task-attachments/<id>/content`; the bytes themselves live next to the project shards (local file driver) or under the same bucket prefix (S3 driver).

Without a remote configured, Pulse works exactly as a single install (local files, no dependency on anything external).

> **v5.0 breaking change:** MongoDB is no longer a supported storage driver. Existing installs that still pointed at MongoDB must export their data and re-import it into S3 or local files before upgrading. The dashboard surfaces a clear `errors.storage.unsupported_driver` if it boots against a config that still references `mongo`.

## Table of contents

1. [When to use each driver](#when-to-use-each-driver)
2. [S3 / S3-compatible setup](#s3--s3-compatible-setup)
3. [Sync local ↔ cloud](#sync-local--cloud)
4. [Behavior notes](#behavior-notes)
5. [Task attachments](#task-attachments)

## When to use each driver

| Driver | Use when | Config |
|---|---|---|
| **Local files** | Default. Single install, no sharing. | (nothing — the absence of cloud config) |
| **S3 / S3-compatible** | You already use AWS, or want zero-ops on Cloudflare R2, or run MinIO on-prem. | Endpoint (optional — blank for AWS), bucket, region, Access Key ID, Secret Access Key, optional prefix. |

The **S3 driver** works with **AWS S3**, **Cloudflare R2** (zero egress), **Google Cloud Storage** (via S3 interoperability), **MinIO** (self-hosted — tick "path-style addressing"), **Backblaze B2**, **DigitalOcean Spaces**, and any other S3-compatible target. Concurrency safety uses the native ETag + `If-Match` — no custom fields added to your objects.

Configure both through **Settings → Storage**: each backend has its own form. Fill the S3 fields, click **Validate & Activate** — the dashboard pings the remote, saves the config, and **swaps the storage backend live**, no restart. The next API call reads from the new driver.

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

To go back to local files from S3: **Settings → Storage → Sync cloud → local** (optional, if you want the current cloud state preserved locally), then **Deactivate remote storage** — the frontend switches back to local files instantly. The local files that were there before activation are untouched and become active again as-is.

Secrets in the UI are always masked; every secret field has a **Copy** button that writes the full plaintext to your clipboard — no toggle exposes them on screen.

## Behavior notes

- **Driver tabs in the UI** — Local / S3 as horizontal tabs. The active driver is marked with `*`. Switching tabs lets you preview / edit another driver's config without activating it.
- **Secrets are masked but copyable** — Access Key, Secret Key are always rendered as `••••••`. Click the Copy button next to any secret to copy the full plaintext value to your clipboard.
- **Hot-reload, no restart** — saving, changing, or deactivating a remote swaps the backend live. In-flight requests finish on the old backend; the old client is drained for 10s in the background, then closed.
- **Fail-fast on outage** — if the remote becomes unreachable at runtime (network loss, credential rotation, server down), every API call returns `503 errors.storage.unavailable` until it comes back. If the frontend boots with a dead remote, same story — open Settings → Storage and deactivate or fix.
- **Concurrent writes** from multiple dashboards against the same remote are serialized per-object via optimistic locks with auto-retry. S3 uses the native ETag + `If-Match` header. No silent write losses; last-writer-wins only on the rare case of two people editing the exact same field simultaneously.
- **Refetch on tab focus** — when a browser tab regains focus, providers silently refetch so changes made on another machine show up without a manual reload.
- **Requirements** — any S3-compatible API. The `data/storage-config.json` file always stays local — it's the config to reach the remote, can't live inside the remote itself.

## Task attachments

Each task can carry up to 20 attachments (max 20 MB per file). Accepted types: PNG, JPEG, GIF, WebP, AVIF, PDF, Word (`.doc` / `.docx`), Excel (`.xls` / `.xlsx`), PowerPoint (`.ppt` / `.pptx`).

- The metadata index lives at `data/projects/<projectId>/task-attachments.json` next to the rest of the project shards.
- The binary bytes live under `data/projects/<projectId>/attachments/<attachmentId>/<safeName>` on whichever backend hosts the project — same path layout for the file driver (under `frontend/data/`) and S3 (under the configured bucket prefix).
- Downloads always flow through `/api/task-attachments/<id>/content` — the route is gated by the dashboard's auth cookie and never returns a presigned S3 URL.
- Project move copies the index and each binary referenced by it to the destination backend before tearing down the source. Project delete drops the entire `attachments/` tree via `deletePrefix` (best-effort).
