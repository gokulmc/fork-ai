'use client';
import { useEffect } from 'react';
import '../welcome.css';
import { StoryProvider } from './StoryContext';
import { ChapterClock } from './ChapterClock';
import { Constellation } from './Constellation';
import { Prologue } from './scenes/Prologue';
import { SceneQuestion } from './scenes/SceneQuestion';
import { SceneFork } from './scenes/SceneFork';
import { SceneModels } from './scenes/SceneModels';
import { SceneSources } from './scenes/SceneSources';
import { ScenePullback } from './scenes/ScenePullback';
import { SceneMix } from './scenes/SceneMix';
import { SceneMorning } from './scenes/SceneMorning';
import { Epilogue } from './scenes/Epilogue';

export function StoryPage() {
  // globals.css fixes <html>/<body> to a non-scrolling app shell
  // (overflow:hidden, height:100%) for the workspace layout. This route is a
  // long scrollable document, so scope the override to a class toggled on
  // <html> for the lifetime of this page only — same pattern App.tsx already
  // uses for data-theme/data-density.
  useEffect(() => {
    document.documentElement.classList.add('wp-scroll');
    return () => document.documentElement.classList.remove('wp-scroll');
  }, []);

  return (
    <StoryProvider>
      <main className="wp-root wp-td">
        <ChapterClock />
        <Constellation />
        <Prologue />
        <SceneQuestion />
        <SceneFork />
        <SceneModels />
        <SceneSources />
        <ScenePullback />
        <SceneMix />
        <SceneMorning />
        <Epilogue />
      </main>
    </StoryProvider>
  );
}
