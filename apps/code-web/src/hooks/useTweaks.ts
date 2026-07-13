'use client';
import { useState, useCallback } from 'react';
import type { Tweaks } from '@/lib/types';

const STORAGE_KEY = 'forkai-code.tweaks';

function loadFromStorage(defaults: Tweaks): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const merged: Tweaks = { ...defaults, ...JSON.parse(raw) };
    // Dark is disabled until the full dark theme ships — a previously stored
    // 'dark' preference is intentionally ignored here, not migrated away.
    if (merged.theme === 'dark') merged.theme = 'light';
    return merged;
  } catch {
    return defaults;
  }
}

export type SetTweak = (keyOrEdits: keyof Tweaks | Partial<Tweaks>, val?: Tweaks[keyof Tweaks]) => void;

export function useTweaks(defaults: Tweaks): [Tweaks, SetTweak] {
  const [values, setValues] = useState<Tweaks>(() => loadFromStorage(defaults));
  const setTweak: SetTweak = useCallback((keyOrEdits, val) => {
    const edits: Partial<Tweaks> =
      typeof keyOrEdits === 'object' && keyOrEdits !== null
        ? (keyOrEdits as Partial<Tweaks>)
        : ({ [keyOrEdits as keyof Tweaks]: val } as Partial<Tweaks>);
    setValues(prev => {
      const next = { ...prev, ...edits };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);
  return [values, setTweak];
}
