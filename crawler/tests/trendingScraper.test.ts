import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LANGUAGE_COLOR,
  parseTrendingHtml,
  scrapeTrending,
} from '../src/trendingScraper.js';

const SAMPLE_TRENDING_HTML = `
<html>
  <body>
    <main>
      <article class="Box-row">
        <h2 class="h3 lh-condensed">
          <a href="/Anthropics/Claude-Code">
            <span>Anthropics /</span> Claude-Code
          </a>
        </h2>
        <p class="col-9 color-fg-muted my-1 pr-4">
          Agentic coding tool that lives in your terminal and understands your codebase.
        </p>
        <div class="f6 color-fg-muted mt-2">
          <span class="d-inline-block ml-0 mr-3">
            <span class="repo-language-color" style="background-color: #3178c6"></span>
            <span itemprop="programmingLanguage">TypeScript</span>
          </span>
          <a href="/Anthropics/Claude-Code/stargazers"> 45,820 </a>
          <a href="/Anthropics/Claude-Code/forks"> 3,210 </a>
          <span class="d-inline-block float-sm-right">
            1,420 stars today
          </span>
        </div>
      </article>

      <article class="Box-row">
        <h2 class="h3 lh-condensed">
          <a href="/awesome-org/no-lang-repo">awesome-org / no-lang-repo</a>
        </h2>
        <div class="f6 color-fg-muted mt-2">
          <a href="/awesome-org/no-lang-repo/stargazers"> 2.5k </a>
          <a href="/awesome-org/no-lang-repo/network/members"> 180 </a>
          <span class="d-inline-block float-sm-right">
            356 stars this week
          </span>
        </div>
      </article>

      <article class="Box-row">
        <h2 class="h3 lh-condensed">
          <a href="/Anthropics/Claude-Code">Duplicate Entry</a>
        </h2>
        <p>Should be deduplicated</p>
      </article>
    </main>
  </body>
</html>
`;

describe('trendingScraper', () => {
  it('parses repo identity, language, color, stars, forks, and period stars accurately', () => {
    const repos = parseTrendingHtml(SAMPLE_TRENDING_HTML, 'daily', 20);
    expect(repos).toHaveLength(2);

    expect(repos[0]).toEqual({
      _id: 'anthropics__claude-code',
      fullName: 'Anthropics/Claude-Code',
      owner: 'Anthropics',
      name: 'Claude-Code',
      url: 'https://github.com/Anthropics/Claude-Code',
      description: 'Agentic coding tool that lives in your terminal and understands your codebase.',
      language: 'TypeScript',
      languageColor: '#3178c6',
      stars: 45820,
      starsToday: 1420,
      forks: 3210,
      period: 'daily',
      rank: 1,
    });

    expect(repos[1]).toEqual({
      _id: 'awesome-org__no-lang-repo',
      fullName: 'awesome-org/no-lang-repo',
      owner: 'awesome-org',
      name: 'no-lang-repo',
      url: 'https://github.com/awesome-org/no-lang-repo',
      description: '',
      language: 'Unknown',
      languageColor: DEFAULT_LANGUAGE_COLOR,
      stars: 2500,
      starsToday: 356,
      forks: 180,
      period: 'daily',
      rank: 2,
    });
  });

  it('respects daily Top 20 and weekly Top 10 limits', () => {
    const manyArticles = Array.from({ length: 25 }, (_, i) => `
      <article class="Box-row">
        <h2><a href="/org${i}/repo-${i}">org${i} / repo-${i}</a></h2>
        <p>Repo description ${i}</p>
        <div>
          <span class="repo-language-color" style="background-color: #3572A5"></span>
          <span itemprop="programmingLanguage">Python</span>
          <a href="/org${i}/repo-${i}/stargazers">${1000 + i}</a>
          <a href="/org${i}/repo-${i}/forks">${100 + i}</a>
          <span class="d-inline-block float-sm-right">${50 + i} stars today</span>
        </div>
      </article>
    `).join('\n');

    const daily = parseTrendingHtml(manyArticles, 'daily');
    const weekly = parseTrendingHtml(manyArticles, 'weekly');

    expect(daily).toHaveLength(20);
    expect(weekly).toHaveLength(10);
    expect(daily[19]?.rank).toBe(20);
    expect(weekly[9]?.rank).toBe(10);
  });

  it('retries once on transient 503 response when scraping live URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(SAMPLE_TRENDING_HTML, { status: 200 }));

    const repos = await scrapeTrending('weekly', {
      limit: 10,
      retries: 2,
      retryDelayMs: 1,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://github.com/trending?since=weekly');
    expect(repos).toHaveLength(2);
    expect(repos[0]?.period).toBe('weekly');
  });
});
