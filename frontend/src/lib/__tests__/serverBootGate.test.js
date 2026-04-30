import { describe, it, expect } from 'vitest';
import { buildSettingsTargetUrl } from '../serverBootGate.js';

describe('buildSettingsTargetUrl', () => {
  it('returns the bare servers tab URL when there are no results', () => {
    expect(buildSettingsTargetUrl([])).toBe('/settings?tab=servers');
  });

  it('returns the bare servers tab URL when input is missing or invalid', () => {
    expect(buildSettingsTargetUrl(null)).toBe('/settings?tab=servers');
    expect(buildSettingsTargetUrl(undefined)).toBe('/settings?tab=servers');
    expect(buildSettingsTargetUrl('not-an-array')).toBe('/settings?tab=servers');
  });

  it('deep-links to the edit form when there is exactly one server', () => {
    expect(buildSettingsTargetUrl([{ serverId: 'srv-1' }])).toBe(
      '/settings?tab=servers&edit=srv-1',
    );
  });

  it('encodes ids that contain URL-unsafe characters', () => {
    expect(buildSettingsTargetUrl([{ serverId: 'srv with spaces & quirks' }])).toBe(
      '/settings?tab=servers&edit=srv%20with%20spaces%20%26%20quirks',
    );
  });

  it('falls back to the bare URL when more than one server is listed', () => {
    expect(buildSettingsTargetUrl([
      { serverId: 'a' },
      { serverId: 'b' },
    ])).toBe('/settings?tab=servers');
  });

  it('falls back to the bare URL when the single result has no serverId', () => {
    expect(buildSettingsTargetUrl([{ name: 'orphan' }])).toBe('/settings?tab=servers');
  });
});
