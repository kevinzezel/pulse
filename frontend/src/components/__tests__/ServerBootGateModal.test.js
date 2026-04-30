import { describe, it, expect, vi } from 'vitest';
import ServerBootGateModal from '../ServerBootGateModal.jsx';

// Walk the React element tree returned by calling the component as a plain
// function and collect every `button`. We don't have jsdom in this repo, so
// invoking the component directly + inspecting its element tree is the
// lightest way to assert which onClick handlers ended up bound to which
// button — and to fire them without a DOM.
function collectButtons(node, acc = []) {
  if (node == null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectButtons(child, acc));
    return acc;
  }
  if (typeof node !== 'object') return acc;
  if (node.type === 'button') acc.push(node);
  if (node.props && node.props.children !== undefined) {
    collectButtons(node.props.children, acc);
  }
  return acc;
}

const T = (key) => key;

const ALL_FAILED_GATE = {
  visible: true,
  checking: false,
  checked: true,
  total: 1,
  onlineCount: 0,
  results: [
    { serverId: 'srv-1', name: 'localhost', ok: false, status: 'done', reason: 'unreachable' },
  ],
};

const CHECKING_GATE = {
  visible: true,
  checking: true,
  checked: false,
  total: 1,
  onlineCount: 0,
  results: [
    { serverId: 'srv-1', name: 'localhost', ok: false, status: 'checking' },
  ],
};

describe('ServerBootGateModal', () => {
  it('renders nothing when gate.visible is false', () => {
    const tree = ServerBootGateModal({
      gate: { visible: false, checking: false, checked: false, total: 0, onlineCount: 0, results: [] },
      t: T,
      onRetry: vi.fn(),
      onOpenSettings: vi.fn(),
      onDismiss: vi.fn(),
    });
    expect(tree).toBeNull();
  });

  it('shows only the retry-style spinner state while still checking (no openSettings/dismiss)', () => {
    const tree = ServerBootGateModal({
      gate: CHECKING_GATE,
      t: T,
      onRetry: vi.fn(),
      onOpenSettings: vi.fn(),
      onDismiss: vi.fn(),
    });
    const buttons = collectButtons(tree);
    expect(buttons).toHaveLength(0);
  });

  it('exposes retry / open-settings / dismiss buttons when every server failed', () => {
    const onRetry = vi.fn();
    const onOpenSettings = vi.fn();
    const onDismiss = vi.fn();
    const tree = ServerBootGateModal({
      gate: ALL_FAILED_GATE,
      t: T,
      onRetry,
      onOpenSettings,
      onDismiss,
    });
    const buttons = collectButtons(tree);
    expect(buttons).toHaveLength(3);

    const byHandler = (fn) => buttons.find((b) => b.props.onClick === fn);
    expect(byHandler(onRetry)).toBeDefined();
    expect(byHandler(onOpenSettings)).toBeDefined();
    expect(byHandler(onDismiss)).toBeDefined();
  });

  it('invoking each button onClick wires through to the right handler', () => {
    const onRetry = vi.fn();
    const onOpenSettings = vi.fn();
    const onDismiss = vi.fn();
    const tree = ServerBootGateModal({
      gate: ALL_FAILED_GATE,
      t: T,
      onRetry,
      onOpenSettings,
      onDismiss,
    });
    const buttons = collectButtons(tree);
    for (const b of buttons) {
      b.props.onClick();
    }
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('disables the retry button while a check is in flight', () => {
    const onRetry = vi.fn();
    const tree = ServerBootGateModal({
      gate: { ...ALL_FAILED_GATE, checking: true },
      t: T,
      onRetry,
      onOpenSettings: vi.fn(),
      onDismiss: vi.fn(),
    });
    const buttons = collectButtons(tree);
    const retry = buttons.find((b) => b.props.onClick === onRetry);
    expect(retry?.props.disabled).toBe(true);
  });
});
