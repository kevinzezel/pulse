// SemVer-lite for Pulse versions: X.Y.Z and X.Y.Z-pre.
//
// Pulse only ships two flavors of tags: stable (`vX.Y.Z`) and preview
// (`vX.Y.Z-pre`). The full SemVer prerelease grammar (alpha.1, rc.2, etc.)
// is intentionally not supported — anything outside the two shapes above is
// either a stable tag or a malformed string we treat as "unknown".

export function stripLeadingV(version) {
  if (typeof version !== 'string') return version;
  return version.startsWith('v') ? version.slice(1) : version;
}

export function isPreviewVersion(version) {
  if (typeof version !== 'string') return false;
  return stripLeadingV(version).endsWith('-pre');
}

function parsePulseVersion(version) {
  if (typeof version !== 'string') return null;
  const raw = stripLeadingV(version);
  const isPreview = raw.endsWith('-pre');
  const core = isPreview ? raw.slice(0, -'-pre'.length) : raw;
  const parts = core.split('.');
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { major: nums[0], minor: nums[1], patch: nums[2], isPreview };
}

// Returns -1, 0, 1. Unparseable inputs sort last (treated as smaller) so
// they never look "newer" than a real version.
export function comparePulseVersions(a, b) {
  const pa = parsePulseVersion(a);
  const pb = parsePulseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  // Same X.Y.Z core: stable > prerelease (so 2.5.0 > 2.5.0-pre).
  if (pa.isPreview === pb.isPreview) return 0;
  return pa.isPreview ? -1 : 1;
}

export function isOlderThan(current, latest) {
  return comparePulseVersions(current, latest) < 0;
}
