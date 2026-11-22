import { describe, expect, it, vi } from 'vitest';
import {
  README_MAX_CHARS,
  cleanReadmeText,
  enrichReposWithGitHubMeta,
} from '../src/githubMeta.js';
import type { RawTrendingRepo } from '../src/types.js';

function makeRawRepo(overrides: Partial<RawTrendingRepo> = {}): RawTrendingRepo {
  return {
    _id: 'openai__codex',
    fullName: 'openai/codex',
    owner: 'openai',
    name: 'codex',
    url: 'https://github.com/openai/codex',
    description: 'Scraped description',
    language: 'Rust',
    languageColor: '#dea584',
    stars: 1000,
    starsToday: 200,
    forks: 100,
    period: 'daily',
    rank: 1,
    ...overrides,
  };
}

describe('githubMeta', () => {
  it('cleans markdown/HTML noise from README and strictly truncates to 2500 chars', () => {
    const noisy = `
      <!-- hidden comment -->
      <p align="center"><img src="logo.png" alt="logo" /></p>
      [![Build](https://img.shields.io/badge/build-passing-green)](https://ci.example.com)
      # Codex CLI
      Read [the docs](https://example.com/docs) for details.
      ---
      ${'A'.repeat(3000)}
    `;
    const cleaned = cleanReadmeText(noisy);
    expect(cleaned).not.toContain('hidden comment');
    expect(cleaned).not.toContain('shields.io');
    expect(cleaned).not.toContain('<img');
    expect(cleaned).toContain('Read the docs for details.');
    expect(Array.from(cleaned).length).toBeLessThanOrEqual(README_MAX_CHARS);
  });

  it('enriches license, exact counts, topics, and README via GitHub REST API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/readme')) {
        return new Response('# Hello Codex\nFast terminal coding agent.', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      return new Response(
        JSON.stringify({
          description: 'Lightweight coding agent that runs in your terminal',
          language: 'Rust',
          stargazers_count: 15432,
          forks_count: 1234,
          topics: ['ai', 'cli', 'agent'],
          license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const enriched = await enrichReposWithGitHubMeta([makeRawRepo()], {
      token: 'ghp_test',
      fetchImpl: fetchMock,
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    expect(enriched).toHaveLength(1);
    expect(enriched[0]).toMatchObject({
      license: 'Apache-2.0',
      stars: 15432,
      forks: 1234,
      description: 'Lightweight coding agent that runs in your terminal',
      topics: ['ai', 'cli', 'agent'],
      readmeExcerpt: '# Hello Codex\nFast terminal coding agent.',
    });
  });

  it('gracefully degrades when GitHub API rate limit is exhausted', async () => {
    const warnMock = vi.fn();
    const farFutureReset = String(Math.floor(Date.now() / 1000) + 3600);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': farFutureReset,
        },
      }),
    );

    const enriched = await enrichReposWithGitHubMeta(
      [makeRawRepo(), makeRawRepo({ _id: 'foo__bar', owner: 'foo', name: 'bar', fullName: 'foo/bar' })],
      {
        concurrency: 1,
        maxRateLimitWaitMs: 5_000,
        fetchImpl: fetchMock,
        logger: { warn: warnMock, info: vi.fn() },
      },
    );

    // Stops hammering API once rate limit is marked exhausted
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalled();
    expect(enriched[0]?.license).toBe('Unknown');
    expect(enriched[0]?.stars).toBe(1000);
    expect(enriched[1]?.license).toBe('Unknown');
  });
});
