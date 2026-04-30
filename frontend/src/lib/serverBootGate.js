// Pure helpers backing the dashboard's "no servers responded" gate. Kept here
// so the URL-building rule is unit-testable without loading the page module.

// Builds the URL for the "Open settings" button when every server is offline.
// When there's exactly one server we deep-link straight into its edit form so
// the user can fix protocol/host/port/key without an extra click — that's the
// most common case when `pulse config tls on` flipped a single client to
// https. Anything else falls back to the servers tab listing.
export function buildSettingsTargetUrl(results) {
  if (Array.isArray(results) && results.length === 1 && results[0]?.serverId) {
    return `/settings?tab=servers&edit=${encodeURIComponent(results[0].serverId)}`;
  }
  return '/settings?tab=servers';
}
