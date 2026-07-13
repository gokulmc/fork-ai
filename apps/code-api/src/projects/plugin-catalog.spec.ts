import { ALLOWED_PLUGINS, buildInitMd, PLUGIN_CATALOG, pluginLine } from './plugin-catalog';

describe('plugin-catalog', () => {
  it('has exactly 22 entries: 9 skills then 13 harnesses', () => {
    expect(PLUGIN_CATALOG).toHaveLength(22);
    expect(PLUGIN_CATALOG.slice(0, 9).every((p) => p.category === 'skill')).toBe(true);
    expect(PLUGIN_CATALOG.slice(9).every((p) => p.category === 'harness')).toBe(true);
  });

  it('ALLOWED_PLUGINS mirrors the catalog ids in order', () => {
    expect(ALLOWED_PLUGINS).toEqual(PLUGIN_CATALOG.map((p) => p.id));
  });

  describe('pluginLine', () => {
    it('renders icon, name, and instruction for a known id', () => {
      expect(pluginLine('tdd')).toBe('🔴 TDD — For each feature or fix: write a failing test first, make it pass minimally, then refactor.');
    });

    it('falls back to the raw id for an unknown id', () => {
      expect(pluginLine('not-a-real-plugin')).toBe('not-a-real-plugin');
    });
  });

  describe('buildInitMd', () => {
    it('returns null for an empty selection', () => {
      expect(buildInitMd([], 'CLAUDE.md', 'acme/widgets')).toBeNull();
    });

    it('returns null when every id is unknown', () => {
      expect(buildInitMd(['nope', 'also-nope'], 'CLAUDE.md', 'acme/widgets')).toBeNull();
    });

    it('includes only the selected entries, filtering out unknown ids', () => {
      const md = buildInitMd(['graphify', 'nope', 'tdd'], 'CLAUDE.md', 'acme/widgets')!;
      expect(md).toContain('Graphify');
      expect(md).toContain('TDD');
      expect(md).not.toContain('nope');
      expect(md).not.toContain('Caveman');
    });

    it('omits the Harnesses heading when no harness is selected', () => {
      const md = buildInitMd(['graphify'], 'CLAUDE.md', 'acme/widgets')!;
      expect(md).toContain('## Skills');
      expect(md).not.toContain('## Harnesses');
    });

    it('omits the Skills heading when no skill is selected', () => {
      const md = buildInitMd(['tdd'], 'CLAUDE.md', 'acme/widgets')!;
      expect(md).toContain('## Harnesses');
      expect(md).not.toContain('## Skills');
    });

    it('embeds the passed targetFile in the Setup instructions', () => {
      const md = buildInitMd(['tdd'], 'GEMINI.md', 'acme/widgets')!;
      expect(md).toContain('Create GEMINI.md at the repo root');
      expect(md).toContain('keep GEMINI.md current');
    });

    it('contains exactly one opening and one closing markdown fence', () => {
      const md = buildInitMd(['graphify', 'tdd'], 'CLAUDE.md', 'acme/widgets')!;
      expect(md.match(/```markdown/g)).toHaveLength(1);
      expect(md.match(/```/g)).toHaveLength(2);
    });
  });
});
