import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseCliArgs, runPipeline } from '../src/index.js';
import { validateSnapshotPayload } from '../src/snapshotWriter.js';

const MOCK_HTML = `
<article class="Box-row">
  <h2><a href="/vercel/ai">vercel / ai</a></h2>
  <p>Build AI-powered applications with TypeScript</p>
  <div>
    <span class="repo-language-color" style="background-color: #3178c6"></span>
    <span itemprop="programmingLanguage">TypeScript</span>
    <a href="/vercel/ai/stargazers">12,345</a>
    <a href="/vercel/ai/forks">1,234</a>
    <span class="d-inline-block float-sm-right">456 stars today</span>
  </div>
</article>
`;

describe('CLI & Pipeline orchestration', () => {
  it('parses --dry-run and --out flags accurately', () => {
    const opts = parseCliArgs(['--dry-run', '--out', 'tmp/snap.json', '--date', '2026-11-22']);
    expect(opts.dryRun).toBe(true);
    expect(opts.outPath).toBe('tmp/snap.json');
    expect(opts.date).toBe('2026-11-22');
    expect(opts.periods).toEqual(['daily', 'weekly']);
    expect(opts.dailyLimit).toBe(20);
    expect(opts.weeklyLimit).toBe(10);
  });

  it('runs end-to-end dry-run pipeline and exports valid SnapshotPayload JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gitpulse-e2e-'));
    const outFile = join(dir, 'snapshot.json');

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://github.com/trending')) {
        return new Response(MOCK_HTML, { status: 200 });
      }
      if (url.endsWith('/readme')) {
        return new Response('# Vercel AI SDK\nBuild AI agents fast.', { status: 200 });
      }
      if (url.includes('/repos/vercel/ai')) {
        return new Response(
          JSON.stringify({
            description: 'Build AI-powered applications with TypeScript',
            language: 'TypeScript',
            stargazers_count: 12500,
            forks_count: 1300,
            topics: ['ai', 'typescript', 'sdk'],
            license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    try {
      const cli = parseCliArgs(['--dry-run', '--out', outFile, '--date', '2026-11-22', '--skip-ai']);
      const result = await runPipeline(cli, {}, {
        fetchImpl: fetchMock,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      expect(result.dryRun).toBe(true);
      expect(result.pushResults).toHaveLength(0);
      expect(result.snapshotPath).toBe(outFile);

      const diskPayload = validateSnapshotPayload(JSON.parse(await readFile(outFile, 'utf8')));
      expect(diskPayload.availableDates).toEqual(['2026-11-22']);
      expect(Object.keys(diskPayload.issues).sort()).toEqual(['2026-11-22_daily', '2026-11-22_weekly']);
      expect(diskPayload.repos['vercel__ai']?.license).toBe('Apache-2.0');
      expect(diskPayload.repos['vercel__ai']?.stars).toBe(12500);
      expect(diskPayload.repos['vercel__ai']?.ai.aiStatus).toBe('fallback');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
