'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  listNotes, createNote as apiCreateNote, patchNote as apiPatchNote, deleteNote as apiDeleteNote,
} from '@/services/api';
import { useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import {
  BASE_Z, PINNED_BASE_Z, SAVE_DEBOUNCE_MS,
  DEFAULT_COLOR, DEFAULT_WIDTH, DEFAULT_HEIGHT,
  nextCascadePosition, isNoteEmpty,
} from '@/lib/notesConfig';

const NotesContext = createContext(null);

export function NotesProvider({ children }) {
  const pathname = usePathname();
  const showError = useErrorToast();
  const { activeProjectId } = useProjects();
  const [allNotes, setAllNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [savingIds, setSavingIds] = useState({});
  const [zOrder, setZOrder] = useState({});

  const notes = useMemo(
    () => allNotes.filter((n) => n.project_id === activeProjectId),
    [allNotes, activeProjectId]
  );

  const setNotes = useCallback((updater) => {
    setAllNotes((prev) => {
      if (typeof updater !== 'function') return Array.isArray(updater) ? updater : [];
      return updater(prev);
    });
  }, []);

  const zCounter = useRef({ top: BASE_Z, pinnedTop: PINNED_BASE_Z });
  const debounceTimers = useRef({});
  const pendingPatches = useRef({});
  const notesRef = useRef([]);

  useEffect(() => { notesRef.current = notes; }, [notes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const notesData = await listNotes().catch(() => ({ notes: [] }));
      setAllNotes(Array.isArray(notesData?.notes) ? notesData.notes : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pathname === '/login') { setLoading(false); return; }
    load();
  }, [pathname, load]);

  useEffect(() => {
    if (managerOpen) load();
  }, [managerOpen, load]);

  const flushPatch = useCallback(async (id) => {
    const patch = pendingPatches.current[id];
    if (!patch) return;
    delete pendingPatches.current[id];
    setSavingIds((s) => ({ ...s, [id]: true }));
    try {
      const updated = await apiPatchNote(id, patch);
      setNotes((list) => list.map((n) => {
        if (n.id !== id) return n;
        const stillPending = pendingPatches.current[id];
        return stillPending
          ? { ...n, updated_at: updated.updated_at }
          : { ...updated, title: n.title, content: n.content };
      }));
    } catch (err) {
      showError(err);
      load();
    } finally {
      setSavingIds((s) => {
        const c = { ...s }; delete c[id]; return c;
      });
    }
  }, [load, showError]);

  const scheduleDebouncedPatch = useCallback((id, patch) => {
    pendingPatches.current[id] = { ...(pendingPatches.current[id] || {}), ...patch };
    setSavingIds((s) => ({ ...s, [id]: true }));
    const prev = debounceTimers.current[id];
    if (prev) clearTimeout(prev);
    debounceTimers.current[id] = setTimeout(() => {
      delete debounceTimers.current[id];
      flushPatch(id);
    }, SAVE_DEBOUNCE_MS);
  }, [flushPatch]);

  const updateNoteLocal = useCallback((id, patch) => {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const updateNoteContent = useCallback((id, patch) => {
    updateNoteLocal(id, patch);
    scheduleDebouncedPatch(id, patch);
  }, [updateNoteLocal, scheduleDebouncedPatch]);

  const patchNoteImmediate = useCallback(async (id, patch) => {
    updateNoteLocal(id, patch);
    try {
      const updated = await apiPatchNote(id, patch);
      setNotes((list) => list.map((n) => {
        if (n.id !== id) return n;
        const stillPending = pendingPatches.current[id];
        return stillPending
          ? { ...updated, title: n.title, content: n.content }
          : updated;
      }));
    } catch (err) {
      showError(err);
      load();
    }
  }, [updateNoteLocal, load, showError]);

  const bringToFront = useCallback((id) => {
    const note = notesRef.current.find((n) => n.id === id);
    if (!note) return;
    const counter = zCounter.current;
    const newZ = note.pinned ? (counter.pinnedTop += 1) : (counter.top += 1);
    setZOrder((o) => ({ ...o, [id]: newZ }));
  }, []);

  const getZ = useCallback((note) => {
    const custom = zOrder[note.id];
    if (custom != null) return custom;
    return note.pinned ? PINNED_BASE_Z : BASE_Z;
  }, [zOrder]);

  const createNote = useCallback(async (overrides = {}) => {
    const { x, y } = nextCascadePosition(notesRef.current);
    const payload = {
      title: '', content: '', color: DEFAULT_COLOR,
      x, y, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, pinned: false, open: true,
      ...overrides,
    };
    try {
      const created = await apiCreateNote(payload);
      setNotes((list) => [...list, created]);
      return created;
    } catch (err) {
      showError(err);
      load();
      return null;
    }
  }, [load, showError]);

  const deleteNote = useCallback(async (id) => {
    const prev = debounceTimers.current[id];
    if (prev) { clearTimeout(prev); delete debounceTimers.current[id]; }
    delete pendingPatches.current[id];
    setNotes((list) => list.filter((n) => n.id !== id));
    setZOrder((o) => {
      if (!(id in o)) return o;
      const next = { ...o }; delete next[id]; return next;
    });
    try { await apiDeleteNote(id); } catch (err) { showError(err); load(); }
  }, [load, showError]);

  const closeOrDeleteIfEmpty = useCallback((id) => {
    setNotes((currentList) => {
      const note = currentList.find((n) => n.id === id);
      if (!note) return currentList;
      if (isNoteEmpty(note)) {
        Promise.resolve().then(() => deleteNote(id));
        return currentList.filter((n) => n.id !== id);
      }
      Promise.resolve().then(() => patchNoteImmediate(id, { open: false }));
      return currentList.map((n) => (n.id === id ? { ...n, open: false } : n));
    });
  }, [deleteNote, patchNoteImmediate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => {
      const hay = `${n.title} ${n.content}`.toLowerCase();
      return hay.includes(q);
    });
  }, [notes, search]);

  const openNotes = useMemo(() => notes.filter((n) => n.open), [notes]);

  const value = {
    notes, loading, filtered, openNotes,
    managerOpen, setManagerOpen,
    search, setSearch,
    savingIds,
    reload: load,
    createNote, deleteNote, closeOrDeleteIfEmpty,
    updateNoteContent, patchNoteImmediate,
    bringToFront, getZ,
  };

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes must be used within NotesProvider');
  return ctx;
}
