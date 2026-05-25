'use client';
import { useState, useCallback } from 'react';
import type { Tweaks } from '@/lib/types';

const STORAGE_KEY = 'fork.ai.tweaks';

function loadFromStorage(defaults: Tweaks): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
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
