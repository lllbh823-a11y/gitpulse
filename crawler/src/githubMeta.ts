import type { EnrichedRepo, RawTrendingRepo, RepoMetaInfo } from './types.js';
import { fetchWithTimeout, runWithConcurrency, sleep } from './utils.js';

export const README_MAX_CHARS = 2500;

export interface GitHubMetaOptions {
  token?: string;
  apiBaseUrl?: string;
  concurrency?: number;
  timeoutMs?: number;
  maxRateLimitWaitMs?: number;
  readmeMaxChars?: number;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'warn' | 'info'>;
}

interface GitHubRepoApiResponse {
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  topics?: unknown;
  license?: {
    spdx_id?: string | null;
    name?: string | null;
  } | null;
}

interface GitHubReadmeJsonResponse {
  content?: string;
  encoding?: string;
}

export function cleanReadmeText(raw: string, maxChars: number = README_MAX_CHARS): string {
  if (!raw) {
    return '';
  }

  let text = raw.replace(/\r\n/g, '\n');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Remove linked badge images [![alt](img)](link) and standalone markdown images ![alt](img)
  text = text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');

  // Convert markdown links [label](url) to label
  text = text.replace(/\[([^\]]+)\]\((?:[^()\s]+|\([^)]*\))*\)/g, '$1');

  // Remove style/script blocks if embedded in README HTML
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Convert block-level HTML tags into newlines, strip remaining HTML tags
  text = text.replace(/<\/?(?:br|p|div|li|tr|h[1-6]|section|article|blockquote|table|thead|tbody|ul|ol)[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Clean lines and remove pure decorative separators / excessive whitespace
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => !/^[-=_*]{3,}$/.test(line));

  const compacted: string[] = [];
  for (const line of lines) {
    if (line === '') {
      if (compacted.length > 0 && compacted[compacted.length - 1] !== '') {
        compacted.push('');
      }
    } else {
      compacted.push(line);
    }
  }

  const joined = compacted.join('\n').trim();
  const chars = Array.from(joined);
  if (chars.length <= maxChars) {
    return joined;
  }
  return chars.slice(0, maxChars).join('').trimEnd();
}

function extractLicense(license: GitHubRepoApiResponse['license']): string {
  if (!license) {
    return 'Unknown';
  }
  const spdx = license.spdx_id?.trim();
  if (spdx && spdx.toUpperCase() !== 'NOASSERTION') {
    return spdx;
  }
  const name = license.name?.trim();
  if (name && name.toLowerCase() !== 'other') {
    return name;
  }
  return 'Unknown';
}

function buildHeaders(token: string | undefined, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'GitPulse-Crawler/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

export class RateLimitTracker {
  exhausted = false;
  constructor(
    private readonly maxWaitMs: number,
    private readonly logger: Pick<Console, 'warn' | 'info'>,
  ) {}

  async handleResponse(response: Response): Promise<'ok' | 'retry' | 'exhausted'> {
    if (response.status !== 403 && response.status !== 429) {
      return 'ok';
    }
    const remaining = response.headers.get('x-ratelimit-remaining');
    const retryAfterHeader = response.headers.get('retry-after');
    const resetHeader = response.headers.get('x-ratelimit-reset');

    const isRateLimit = response.status === 429 || remaining === '0' || Boolean(retryAfterHeader);
    if (!isRateLimit) {
      return 'ok';
    }

    let waitMs = 0;
    if (retryAfterHeader) {
      const retrySec = Number.parseInt(retryAfterHeader, 10);
      if (Number.isFinite(retrySec) && retrySec > 0) {
        waitMs = retrySec * 1_000;
      }
    } else if (resetHeader) {
      const resetEpoch = Number.parseInt(resetHeader, 10);
      if (Number.isFinite(resetEpoch)) {
        waitMs = Math.max(0, resetEpoch * 1_000 - Date.now()) + 500;
      }
    }

    if (waitMs > 0 && waitMs <= this.maxWaitMs) {
      this.logger.warn(`[githubMeta] GitHub API rate limited, waiting ${waitMs}ms before retry...`);
      await sleep(waitMs);
      return 'retry';
    }

    if (!this.exhausted) {
      this.exhausted = true;
      this.logger.warn(
        `[githubMeta] GitHub API rate limit exhausted (reset wait ${waitMs || 'unknown'}ms > ${this.maxWaitMs}ms). Falling back to scraped metadata.`,
      );
    }
    return 'exhausted';
  }
}

async function fetchGitHubWithRateLimit(
  url: string,
  accept: string,
  token: string | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  tracker: RateLimitTracker,
): Promise<Response | null> {
  if (tracker.exhausted) {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: buildHeaders(token, accept),
      },
      timeoutMs,
      fetchImpl,
    );

    const rateAction = await tracker.handleResponse(response);
    if (rateAction === 'retry') {
      continue;
    }
    if (rateAction === 'exhausted') {
      return null;
    }
    if (response.status >= 500 && attempt === 0) {
      await sleep(800);
      continue;
    }
    return response;
  }

  return null;
}

export async function fetchRepoMeta(
  owner: string,
  name: string,
  options: GitHubMetaOptions = {},
  tracker?: RateLimitTracker,
): Promise<RepoMetaInfo> {
  const {
    token,
    apiBaseUrl = 'https://api.github.com',
    timeoutMs = 15_000,
    maxRateLimitWaitMs = 15_000,
    readmeMaxChars = README_MAX_CHARS,
    fetchImpl = fetch,
    logger = console,
  } = options;

  const rateTracker = tracker ?? new RateLimitTracker(maxRateLimitWaitMs, logger);
  const base = apiBaseUrl.replace(/\/+$/, '');
  const repoUrl = `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const readmeUrl = `${repoUrl}/readme`;

  const result: RepoMetaInfo = {
    license: 'Unknown',
    topics: [],
    readmeExcerpt: '',
  };

  try {
    const repoResp = await fetchGitHubWithRateLimit(
      repoUrl,
      'application/vnd.github+json',
      token,
      timeoutMs,
      fetchImpl,
      rateTracker,
    );

    if (repoResp?.ok) {
      const data = (await repoResp.json()) as GitHubRepoApiResponse;
      if (typeof data.description === 'string' && data.description.trim()) {
        result.description = data.description.trim();
      }
      if (typeof data.language === 'string' && data.language.trim()) {
        result.language = data.language.trim();
      }
      if (typeof data.stargazers_count === 'number' && Number.isFinite(data.stargazers_count)) {
        result.stars = data.stargazers_count;
      }
      if (typeof data.forks_count === 'number' && Number.isFinite(data.forks_count)) {
        result.forks = data.forks_count;
      }
      result.license = extractLicense(data.license);
      if (Array.isArray(data.topics)) {
        result.topics = data.topics.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
      }
    }
  } catch (error) {
    logger.warn(`[githubMeta] Failed to fetch repo metadata for ${owner}/${name}: ${(error as Error).message}`);
  }

  try {
    const readmeResp = await fetchGitHubWithRateLimit(
      readmeUrl,
      'application/vnd.github.raw+json',
      token,
      timeoutMs,
      fetchImpl,
      rateTracker,
    );

    if (readmeResp?.ok) {
      const contentType = readmeResp.headers.get('content-type') ?? '';
      let rawReadme = '';
      if (contentType.includes('application/json')) {
        const json = (await readmeResp.json()) as GitHubReadmeJsonResponse;
        if (typeof json.content === 'string') {
          rawReadme =
            json.encoding === 'base64'
              ? Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8')
              : json.content;
        }
      } else {
        rawReadme = await readmeResp.text();
      }
      result.readmeExcerpt = cleanReadmeText(rawReadme, readmeMaxChars);
    }
  } catch (error) {
    logger.warn(`[githubMeta] Failed to fetch README for ${owner}/${name}: ${(error as Error).message}`);
  }

  return result;
}

export function mergeRepoWithMeta(raw: RawTrendingRepo, meta: RepoMetaInfo): EnrichedRepo {
  return {
    ...raw,
    description: meta.description || raw.description || '',
    language: raw.language !== 'Unknown' ? raw.language : (meta.language || 'Unknown'),
    stars: typeof meta.stars === 'number' ? meta.stars : raw.stars,
    forks: typeof meta.forks === 'number' ? meta.forks : raw.forks,
    license: meta.license || 'Unknown',
    topics: meta.topics ?? [],
    readmeExcerpt: meta.readmeExcerpt ?? '',
  };
}

export async function enrichReposWithGitHubMeta(
  repos: readonly RawTrendingRepo[],
  options: GitHubMetaOptions = {},
  metaCache?: Map<string, RepoMetaInfo>,
  sharedTracker?: RateLimitTracker,
): Promise<EnrichedRepo[]> {
  const {
    concurrency = 4,
    maxRateLimitWaitMs = 15_000,
    logger = console,
  } = options;

  const tracker = sharedTracker ?? new RateLimitTracker(maxRateLimitWaitMs, logger);
  const cache = metaCache ?? new Map<string, RepoMetaInfo>();

  return runWithConcurrency(repos, concurrency, async (raw) => {
    const cached = cache.get(raw._id);
    if (cached) {
      return mergeRepoWithMeta(raw, cached);
    }
    const meta = await fetchRepoMeta(raw.owner, raw.name, options, tracker);
    cache.set(raw._id, meta);
    return mergeRepoWithMeta(raw, meta);
  });
}
