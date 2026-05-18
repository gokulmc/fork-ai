'use client';
import { useState, useCallback } from 'react';
import type { Tweaks } from '@/lib/types';

export type SetTweak = (keyOrEdits: keyof Tweaks | Partial<Tweaks>, val?: Tweaks[keyof Tweaks]) => void;

export function useTweaks(defaults: Tweaks): [Tweaks, SetTweak] {
  const [values, setValues] = useState<Tweaks>(defaults);
  const setTweak: SetTweak = useCallback((keyOrEdits, val) => {
    const edits: Partial<Tweaks> =
      typeof keyOrEdits === 'object' && keyOrEdits !== null
        ? (keyOrEdits as Partial<Tweaks>)
        : ({ [keyOrEdits as keyof Tweaks]: val } as Partial<Tweaks>);
    setValues(prev => ({ ...prev, ...edits }));
  }, []);
  return [values, setTweak];
}
