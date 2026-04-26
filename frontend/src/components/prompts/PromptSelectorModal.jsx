'use client';

import PromptQuickSelectorModal from './PromptQuickSelectorModal';

// Wrapper kept for backward compatibility with TerminalMosaic and any other
// caller. The `currentProjectId` prop is now ignored — the underlying quick
// selector pulls the active project id from `useProjects()` directly so the
// scope is always correct regardless of which screen opens it.
export default function PromptSelectorModal({ sessionId, open, onClose }) {
  return (
    <PromptQuickSelectorModal
      sessionId={sessionId}
      open={open}
      onClose={onClose}
    />
  );
}
