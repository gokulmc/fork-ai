import { sanitizeGlmSources, processGlmCitations } from './citations';

describe('GLM citations', () => {
  describe('sanitizeGlmSources', () => {
    it('keeps well-formed http(s) entries and titles', () => {
      const out = sanitizeGlmSources([
        { title: 'EU AI Act', url: 'https://example.com/a' },
        { title: 'Other', url: 'http://example.com/b' },
      ]);
      expect(out).toEqual([
        { title: 'EU AI Act', url: 'https://example.com/a' },
        { title: 'Other', url: 'http://example.com/b' },
      ]);
    });

    it('drops non-http, malformed, and duplicate entries; falls back title→url', () => {
      const out = sanitizeGlmSources([
        { title: 'No url' },
        { url: 'ftp://example.com/x' },
        { url: 'https://example.com/a' },
        { title: 'Dup', url: 'https://example.com/a' },
        { url: 'https://example.com/c' },
      ]);
      expect(out).toEqual([
        { title: 'https://example.com/a', url: 'https://example.com/a' },
        { title: 'https://example.com/c', url: 'https://example.com/c' },
      ]);
    });

    it('returns [] for non-array input', () => {
      expect(sanitizeGlmSources(undefined)).toEqual([]);
      expect(sanitizeGlmSources('nope')).toEqual([]);
    });
  });

  describe('processGlmCitations', () => {
    const sources = [
      { title: 'A', url: 'https://a.com' },
      { title: 'B', url: 'https://b.com' },
      { title: 'C', url: 'https://c.com' },
    ];

    it('converts [N] markers to superscript footnotes and returns only cited sources', () => {
      const { sections, sources: cited } = processGlmCitations(
        [{ heading: 'H', body: 'Fact one [1] and fact two [2].' }],
        sources,
      );
      expect(sections[0].body).toContain('href="https://a.com"');
      expect(sections[0].body).toContain('[1]');
      expect(sections[0].body).toContain('href="https://b.com"');
      expect(sections[0].body).not.toMatch(/\[\d+\](?!<)/); // no bare [N] left
      expect(cited).toEqual([sources[0], sources[1]]);
    });

    it('renumbers by first appearance and dedupes repeated markers', () => {
      const { sections, sources: cited } = processGlmCitations(
        [{ heading: 'H', body: 'X [3] then Y [1] then Z [3] again.' }],
        sources,
      );
      // [3]→footnote 1, [1]→footnote 2
      expect(cited).toEqual([sources[2], sources[0]]);
      expect(sections[0].body.match(/\[1\]/g)?.length).toBe(2); // both [3] occurrences → [1]
      expect(sections[0].body).toContain('[2]');
    });

    it('strips out-of-range markers rather than leaving them dangling', () => {
      const { sections, sources: cited } = processGlmCitations(
        [{ heading: 'H', body: 'Real [1] but dangling [9].' }],
        sources,
      );
      expect(sections[0].body).not.toContain('[9]');
      expect(sections[0].body).toContain('Real');
      expect(cited).toEqual([sources[0]]);
    });

    it('returns no cited sources when nothing is numbered inline', () => {
      const { sources: cited } = processGlmCitations(
        [{ heading: 'H', body: 'No markers here.' }],
        sources,
      );
      expect(cited).toEqual([]);
    });
  });
});
