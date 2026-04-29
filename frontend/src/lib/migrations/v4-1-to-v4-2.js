// v4.1 -> v4.2 reconciler: pushes the entries from a legacy local
// `data/projects.json` into each owning backend's `projects-manifest.json`,
// extracts per-install UX prefs (active_project_id, default flag) into
// `data/project-prefs.json`, and renames the legacy file to
// `projects.json.legacy-pre-v4.2`. Idempotent: detected via the storage-config
// `v` marker (`v: 2` -> needs reconciler; `v: 3` -> already done).
//
// Like the v3-to-v4 migrator, this module uses raw filesystem ops and
// instantiates drivers directly. It runs INSIDE `ensureMigrationsApplied()`,
// which itself runs inside `getConfig()`'s in-flight promise -- calling
// `getConfig()` (or anything that does, e.g. `withStoreLockOnBackend`) from
// here would deadlock.

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { FileDriver } from '../jsonStore.js';
import { S3Driver } from '../s3Store.js';
import { MongoDriver } from '../mongoStore.js';

// Same path as `lib/projectIndex.js` (post-4.2.1). The reconciler talks to
// drivers directly via FileDriver/S3Driver/MongoDriver so it doesn't reach
// for the higher-level helper, but we keep the rel string in lock-step.
// File driver lands inside `<frontend_root>/data/`; S3/Mongo strip `data/`
// on resolution so the bucket key stays at `<prefix>/projects-manifest.json`.
const MANIFEST_REL = 'data/projects-manifest.json';

function frontendRoot() {
  return process.env.PULSE_FRONTEND_ROOT || process.cwd();
}

function dataDir() {
  return join(frontendRoot(), 'data');
}

async function readJson(rel, fallback) {
  try {
    const text = await fs.readFile(join(dataDir(), rel), 'utf-8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(rel, data) {
  const full = join(dataDir(), rel);
  await fs.mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, full);
  } catch (err) {
    try { await fs.unlink(tmp); } catch {}
    throw err;
  }
}

// Build a one-shot driver from a backend spec. Mirrors `DRIVER_FACTORIES`
// in storage.js but local to the migrator so we don't pay for the recursion
// risk of going through getConfig().
function buildDriver(backend) {
  if (backend.driver === 'file') return new FileDriver(backend.config || {});
  if (backend.driver === 's3') return new S3Driver(backend.config || {});
  if (backend.driver === 'mongo') return new MongoDriver(backend.config || {});
  throw new Error(`Unknown driver: ${backend.driver}`);
}

// Push a single project entry to a backend's manifest. Atomic via the
// driver's own withFileLock. Idempotent: matching id triggers a name update.
async function addProjectToManifestDirect(driver, project) {
  await driver.withFileLock(MANIFEST_REL, async () => {
    const data = await driver.readJsonFile(MANIFEST_REL, { v: 1, projects: [] });
    const projects = Array.isArray(data.projects) ? [...data.projects] : [];
    const now = new Date().toISOString();
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      const prev = projects[idx];
      projects[idx] = {
        ...prev,
        ...project,
        created_at: prev.created_at || project.created_at || now,
        updated_at: now,
      };
    } else {
      projects.push({
        id: project.id,
        name: project.name,
        created_at: project.created_at || now,
        updated_at: now,
      });
    }
    await driver.writeJsonFileAtomic(MANIFEST_REL, { v: 1, projects });
  });
}

// Detect whether the v4.1 -> v4.2 reconciler needs to run. The
// storage-config `v` marker drives the decision: v:2 -> needs reconcile;
// v:3 -> already reconciled. Older shapes (v1, no config) are handled by
// the v3-to-v4 migrator which runs FIRST.
export async function migrate() {
  const config = await readJson('storage-config.json', null);
  if (!config || config.v !== 2 || !Array.isArray(config.backends)) {
    return { ran: false, reason: 'not-v2' };
  }

  const backendsById = new Map(config.backends.map((b) => [b.id, b]));
  // Open every backend up front so failures bubble before we mutate state.
  // Local always exists post-v3->v4; remote backends may already be open
  // elsewhere, but instantiating a parallel client here is harmless because
  // the migrator owns its lifecycle (we close them in the finally block).
  const drivers = new Map();
  try {
    for (const backend of config.backends) {
      const driver = buildDriver(backend);
      await driver.init();
      drivers.set(backend.id, driver);
    }

    const legacy = await readJson('projects.json', null);
    if (legacy && Array.isArray(legacy.projects)) {
      let pushed = 0;
      let skipped = 0;
      for (const project of legacy.projects) {
        const ref = (typeof project?.storage_ref === 'string' && project.storage_ref)
          ? project.storage_ref
          : 'local';
        // Orphan storage_ref pointing at a backend that no longer exists in
        // the config -- treat as local. Logged so users can investigate.
        const targetBackendId = backendsById.has(ref) ? ref : 'local';
        if (targetBackendId !== ref) {
          console.warn(`[migrations:v4.1-to-v4.2] project ${project.id} pointed at unknown backend "${ref}" -- routing to local`);
        }
        const driver = drivers.get(targetBackendId);
        if (!driver) {
          skipped += 1;
          console.warn(`[migrations:v4.1-to-v4.2] no driver for backend ${targetBackendId} -- skipping ${project.id}`);
          continue;
        }
        try {
          await addProjectToManifestDirect(driver, {
            id: project.id,
            name: project.name,
            created_at: project.created_at,
          });
          pushed += 1;
        } catch (err) {
          skipped += 1;
          console.warn(`[migrations:v4.1-to-v4.2] failed to push ${project.id} to backend ${targetBackendId}: ${err?.message || err}`);
        }
      }
      console.log(`[migrations:v4.1-to-v4.2] reconciled ${pushed} project(s) into backend manifests, ${skipped} skipped`);

      // Extract per-install prefs.
      const defaultProject = legacy.projects.find((p) => p?.is_default === true);
      const prefs = {
        active_project_id: typeof legacy.active_project_id === 'string' && legacy.active_project_id
          ? legacy.active_project_id
          : (defaultProject?.id || null),
        default_project_id: defaultProject?.id || null,
      };
      await writeJson('project-prefs.json', prefs);

      // Rename the legacy file as a sidecar backup. `fs.rename` is atomic on
      // the same filesystem -- the file is either gone or renamed.
      try {
        await fs.rename(
          join(dataDir(), 'projects.json'),
          join(dataDir(), 'projects.json.legacy-pre-v4.2'),
        );
      } catch (err) {
        console.warn(`[migrations:v4.1-to-v4.2] could not rename legacy projects.json: ${err?.message || err}`);
      }
    } else {
      // Fresh install (or already-reconciled state without legacy file).
      // Write an empty prefs file so consumers always see a valid shape.
      const existingPrefs = await readJson('project-prefs.json', null);
      if (!existingPrefs) {
        await writeJson('project-prefs.json', { active_project_id: null, default_project_id: null });
      }
    }

    // Bump on-disk config version to mark reconciler done. v:3 is still v2
    // shape internally (same backends/default_backend_id contract); the
    // bump just signals "v4.2 reconciler has run". Writes are atomic.
    await writeJson('storage-config.json', { ...config, v: 3 });

    return { ran: true };
  } finally {
    for (const driver of drivers.values()) {
      try { await driver.close(); } catch {}
    }
  }
}
