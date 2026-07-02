'use client';
import { useEffect } from 'react';
import '../welcome.css';
import { Hero } from './Hero';
import { PersonaIntro } from './PersonaIntro';
import { BranchingDemo } from './BranchingDemo';
import { MindMapDemo } from './MindMapDemo';
import { ModelPickerDemo } from './ModelPickerDemo';
import { WebSearchDemo } from './WebSearchDemo';
import { NotionExportDemo } from './NotionExportDemo';
import { SharingDemo } from './SharingDemo';
import { UseCaseCards } from './UseCaseCards';
import { PricingCalculator } from './PricingCalculator';
import { FAQ } from './FAQ';
import { FinalCTA } from './FinalCTA';

export function WelcomePage() {
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
    <main className="wp-root">
      <Hero />
      <PersonaIntro />
      <BranchingDemo />
      <MindMapDemo />
      <ModelPickerDemo />
      <WebSearchDemo />
      <NotionExportDemo />
      <SharingDemo />
      <UseCaseCards />
      <PricingCalculator />
      <FAQ />
      <FinalCTA />
    </main>
  );
}
