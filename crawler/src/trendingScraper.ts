import { load } from 'cheerio';
import type { RawTrendingRepo, TrendingPeriod } from './types.js';
import {
  fetchWithTimeout,
  isValidHexColor,
  makeRepoId,
  normalizeWhitespace,
  parseCompactNumber,
  sleep,
} from './utils.js';

export const DEFAULT_TRENDING_LIMITS: Record<TrendingPeriod, number> = {
  daily: 20,
  weekly: 10,
};

export const DEFAULT_LANGUAGE_COLOR = '#8C949C';

const FALLBACK_LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Vue: '#41b883',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#663399',
  Dart: '#00B4AB',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Zig: '#ec915c',
};

export interface ScrapeTrendingOptions {
  limit?: number;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

function extractColorFromStyle(style: string | undefined, language: string): string {
  if (style) {
    const match = style.match(/background-color\s*:\s*(#[0-9a-fA-F]{3,8})/i);
    if (match?.[1] && isValidHexColor(match[1])) {
      return match[1];
    }
  }
  return FALLBACK_LANGUAGE_COLORS[language] ?? DEFAULT_LANGUAGE_COLOR;
}

function extractOwnerAndName(href: string | undefined): { owner: string; name: string } | null {
  if (!href) {
    return null;
  }
  const pathOnly = href.split(/[?#]/)[0] ?? '';
  const segments = pathOnly
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const owner = segments[0];
  const name = segments[1];
  if (!owner || !name) {
    return null;
  }
  return { owner, name };
}

export function parseTrendingHtml(
  html: string,
  period: TrendingPeriod,
  limit: number = DEFAULT_TRENDING_LIMITS[period],
): RawTrendingRepo[] {
  const $ = load(html);
  const results: RawTrendingRepo[] = [];
  const seen = new Set<string>();

  $('article.Box-row').each((_, element) => {
    if (results.length >= limit) {
      return false;
    }

    const $row = $(element);
    const titleHref = $row.find('h2 a').first().attr('href');
    const parsedPath = extractOwnerAndName(titleHref);
    if (!parsedPath) {
      return;
    }

    const { owner, name } = parsedPath;
    const _id = makeRepoId(owner, name);
    if (seen.has(_id)) {
      return;
    }
    seen.add(_id);

    const description = normalizeWhitespace($row.find('p').first().text());
    const rawLanguage = normalizeWhitespace($row.find('span[itemprop="programmingLanguage"]').first().text());
    const language = rawLanguage || 'Unknown';
    const style = $row.find('span.repo-language-color').first().attr('style');
    const languageColor = extractColorFromStyle(style, language);

    const starsText = normalizeWhitespace($row.find('a[href$="/stargazers"]').first().text());
    const forksText = normalizeWhitespace(
      $row.find('a[href$="/forks"], a[href$="/network/members"]').first().text(),
    );

    let periodStarsText = normalizeWhitespace($row.find('span.d-inline-block.float-sm-right').first().text());
    if (!periodStarsText) {
      $row.find('span').each((__, spanEl) => {
        const text = normalizeWhitespace($(spanEl).text());
        if (/\d[\d.,]*\s*[kKmM]?\s*stars?\s+(today|this\s+week|this\s+month)/i.test(text)) {
          periodStarsText = text;
          return false;
        }
        return undefined;
      });
    }

    const fullName = `${owner}/${name}`;
    results.push({
      _id,
      fullName,
      owner,
      name,
      url: `https://github.com/${fullName}`,
      description,
      language,
      languageColor,
      stars: parseCompactNumber(starsText),
      starsToday: parseCompactNumber(periodStarsText),
      forks: parseCompactNumber(forksText),
      period,
      rank: results.length + 1,
    });

    return undefined;
  });

  return results;
}

export async function scrapeTrending(
  period: TrendingPeriod,
  options: ScrapeTrendingOptions = {},
): Promise<RawTrendingRepo[]> {
  const {
    limit = DEFAULT_TRENDING_LIMITS[period],
    baseUrl = 'https://github.com/trending',
    timeoutMs = 20_000,
    retries = 2,
    retryDelayMs = 1_000,
    fetchImpl = fetch,
  } = options;

  const url = `${baseUrl}?since=${encodeURIComponent(period)}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
        timeoutMs,
        fetchImpl,
      );

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const err = new Error(`GitHub Trending HTTP ${response.status} for ${url}`);
        if (!retryable || attempt === retries) {
          throw err;
        }
        lastError = err;
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }

      const html = await response.text();
      return parseTrendingHtml(html, period, limit);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to scrape GitHub Trending (${period})`);
}
