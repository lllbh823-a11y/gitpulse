import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildFallbackIssueSummary,
  generateIssueSummary,
  summarizeRepos,
  type AISummarizerConfig,
} from './aiSummarizer.js';
import { IssueFilteredError, pushIssueToCloud } from './cloudPusher.js';
import {
  buildComplianceOptionsFromEnv,
  evaluateRepoCompliance,
  evaluateTextCompliance,
  filterCompliantRepos,
} from './complianceFilter.js';
import {
  RateLimitTracker,
  enrichReposWithGitHubMeta,
  type GitHubMetaOptions,
} from './githubMeta.js';
import {
  writeSnapshotFile,
  type IncomingIssueBundle,
} from './snapshotWriter.js';
import {
  DEFAULT_TRENDING_LIMITS,
  scrapeTrending,
} from './trendingScraper.js';
import type {
  ComplianceDecision,
  IngestIssueRequest,
  IngestIssueResponseData,
  RawTrendingRepo,
  RepoAIEnrichment,
  RepoItem,
  RepoMetaInfo,
  SnapshotPayload,
  TrendingPeriod,
} from './types.js';
import { getBeijingDateString, parsePositiveIntEnv } from './utils.js';

export interface CliOptions {
  dryRun: boolean;
  outPath?: string;
  date: string;
  periods: TrendingPeriod[];
  dailyLimit: number;
  weeklyLimit: number;
  skipAI: boolean;
  help: boolean;
}

export interface BlockedRepoRecord {
  period: TrendingPeriod;
  fullName: string;
  stage: 'pre-ai' | 'post-ai';
  decision: ComplianceDecision;
}

export interface PipelineResult {
  date: string;
  dryRun: boolean;
  bundles: IncomingIssueBundle[];
  pushResults: Array<{ period: TrendingPeriod; data: IngestIssueResponseData }>;
  blockedRepos: BlockedRepoRecord[];
  snapshotPath?: string;
  snapshot?: SnapshotPayload;
}

const USAGE_TEXT = `
GitPulse Crawler - GitHub Trending + AI Digest Pipeline

Usage:
  pnpm sync [options]
  pnpm dry-run [--out <path>]

Options:
  --dry-run             Skip CloudBase push and export SnapshotPayload JSON locally
  --out <path>          Write merged SnapshotPayload JSON to <path> (default: ./output/snapshot.json in --dry-run)
  --date <YYYY-MM-DD>   Override Beijing issue date (default: today in Asia/Shanghai)
  --periods <list>      Comma-separated periods: daily,weekly (default: daily,weekly)
  --daily-limit <n>     Number of daily trending repos (default: 20)
  --weekly-limit <n>    Number of weekly trending repos (default: 10)
  --skip-ai             Skip LLM API calls and use deterministic Chinese fallback summaries
  -h, --help            Show this help message
`.trim();

function parsePeriods(raw: string | undefined): TrendingPeriod[] {
  if (!raw?.trim()) {
    return ['daily', 'weekly'];
  }
  const items = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  const periods: TrendingPeriod[] = [];
  for (const item of items) {
    if (item !== 'daily' && item !== 'weekly') {
      throw new Error(`Invalid period "${item}". Expected "daily" or "weekly".`);
    }
    if (!periods.includes(item)) {
      periods.push(item);
    }
  }
  return periods.length > 0 ? periods : ['daily', 'weekly'];
}

export function parseCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      date: { type: 'string' },
      periods: { type: 'string' },
      'daily-limit': { type: 'string' },
      'weekly-limit': { type: 'string' },
      'skip-ai': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const date = values.date?.trim() || getBeijingDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date "${date}". Expected YYYY-MM-DD.`);
  }

  const dryRun = Boolean(values['dry-run']);
  const outPath = values.out?.trim() || (dryRun ? 'output/snapshot.json' : undefined);

  return {
    dryRun,
    outPath,
    date,
    periods: parsePeriods(values.periods),
    dailyLimit: parsePositiveIntEnv(
      values['daily-limit'] ?? env.DAILY_LIMIT,
      DEFAULT_TRENDING_LIMITS.daily,
    ),
    weeklyLimit: parsePositiveIntEnv(
      values['weekly-limit'] ?? env.WEEKLY_LIMIT,
      DEFAULT_TRENDING_LIMITS.weekly,
    ),
    skipAI: Boolean(values['skip-ai']),
    help: Boolean(values.help),
  };
}

export async function runPipeline(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    fetchImpl?: typeof fetch;
    logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  } = {},
): Promise<PipelineResult> {
  const logger = deps.logger ?? console;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = parsePositiveIntEnv(env.HTTP_TIMEOUT_MS, 20_000);
  const githubConcurrency = parsePositiveIntEnv(env.GITHUB_CONCURRENCY, 4);
  const llmConcurrency = parsePositiveIntEnv(env.LLM_CONCURRENCY, 3);

  const publishedAt = new Date().toISOString();
  logger.info(
    `[gitpulse] Starting sync for date=${options.date}, periods=${options.periods.join(',')}, dryRun=${options.dryRun}`,
  );

  // 1. Scrape GitHub Trending pages
  const scrapedByPeriod = new Map<TrendingPeriod, RawTrendingRepo[]>();
  await Promise.all(
    options.periods.map(async (period) => {
      const limit = period === 'daily' ? options.dailyLimit : options.weeklyLimit;
      const rawRepos = await scrapeTrending(period, {
        limit,
        timeoutMs,
        fetchImpl,
      });
      scrapedByPeriod.set(period, rawRepos);
      logger.info(`[gitpulse] Scraped ${rawRepos.length} ${period} trending repos.`);
    }),
  );

  // 2. Enrich with GitHub REST metadata + README excerpt (shared cache & rate-limit state across periods)
  const metaOptions: GitHubMetaOptions = {
    token: env.GITHUB_TOKEN,
    concurrency: githubConcurrency,
    timeoutMs,
    fetchImpl,
    logger,
  };
  const metaCache = new Map<string, RepoMetaInfo>();
  const sharedRateTracker = new RateLimitTracker(15_000, logger);

  // Push order: weekly first, then daily, so daily's starsToday takes precedence on overlap.
  const orderedPeriods: TrendingPeriod[] = [...options.periods].sort((a, b) => {
    if (a === b) return 0;
    return a === 'weekly' ? -1 : 1;
  });

  const complianceOptions = buildComplianceOptionsFromEnv(env);
  const blockedRepos: BlockedRepoRecord[] = [];

  const enrichedByPeriod = new Map<TrendingPeriod, Awaited<ReturnType<typeof enrichReposWithGitHubMeta>>>();
  for (const period of orderedPeriods) {
    const rawList = scrapedByPeriod.get(period) ?? [];
    const enriched = await enrichReposWithGitHubMeta(rawList, metaOptions, metaCache, sharedRateTracker);
    const { allowed, blocked } = filterCompliantRepos(enriched, complianceOptions);
    for (const item of blocked) {
      blockedRepos.push({
        period,
        fullName: item.repo.fullName,
        stage: 'pre-ai',
        decision: item.decision,
      });
      logger.warn(
        `[gitpulse][compliance] ${options.date} Pre-AI blocked ${item.repo.fullName} (${period}): ${item.decision.matchedRule} ${item.decision.reason ?? item.decision.matchedRule}`,
      );
    }
    enrichedByPeriod.set(period, allowed);
    logger.info(
      `[gitpulse] Enriched ${enriched.length} ${period} repos via GitHub REST API (${allowed.length} compliant, ${blocked.length} blocked).`,
    );
  }

  // 3. Summarize repos via OpenAI-compatible Chat Completions (shared cache across periods; daily first so overlapping copy aligns with daily stats)
  const aiConfig: AISummarizerConfig = {
    baseUrl: env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL || 'deepseek-chat',
    concurrency: llmConcurrency,
    timeoutMs: Math.max(timeoutMs, 30_000),
    skipAI: options.skipAI,
    fetchImpl,
    logger,
  };

  if (options.skipAI || !aiConfig.apiKey?.trim()) {
    logger.info(
      '[gitpulse] LLM_API_KEY not set or --skip-ai enabled; generating deterministic Chinese fallback summaries.',
    );
  }

  const aiCache = new Map<string, RepoAIEnrichment>();
  const aiOrderPeriods: TrendingPeriod[] = [...orderedPeriods].reverse();
  const allEnriched = aiOrderPeriods.flatMap((p) => enrichedByPeriod.get(p) ?? []);
  await summarizeRepos(allEnriched, aiConfig, aiCache);

  // 4. Assemble RepoItem[] & DailyIssue per period (with post-AI compliance verification)
  const bundles: IncomingIssueBundle[] = [];
  const pushResults: Array<{ period: TrendingPeriod; data: IngestIssueResponseData }> = [];

  for (const period of orderedPeriods) {
    const enrichedList = enrichedByPeriod.get(period) ?? [];
    let repoItems: RepoItem[] = [];

    for (const repo of enrichedList) {
      const aiData = aiCache.get(repo._id);
      if (!aiData) {
        throw new Error(`Missing AI enrichment for ${repo._id}`);
      }

      if (aiData.compliance && !aiData.compliance.allowed) {
        blockedRepos.push({
          period,
          fullName: repo.fullName,
          stage: 'post-ai',
          decision: aiData.compliance,
        });
        logger.warn(
          `[gitpulse][compliance] ${options.date} AI gate blocked ${repo.fullName} (${period}): ${aiData.compliance.matchedRule} ${aiData.compliance.reason ?? 'ai-flagged'}`,
        );
        continue;
      }

      const item: RepoItem = {
        _id: repo._id,
        fullName: repo.fullName,
        owner: repo.owner,
        name: repo.name,
        url: repo.url,
        description: repo.description,
        language: repo.language,
        languageColor: repo.languageColor,
        stars: repo.stars,
        starsToday: repo.starsToday,
        forks: repo.forks,
        license: repo.license,
        category: aiData.category,
        tags: aiData.tags,
        ai: aiData.ai,
        latestDate: options.date,
        updatedAt: publishedAt,
      };

      // Re-verify generated Chinese copy against hard blocklist
      const postCheck = evaluateRepoCompliance(item, complianceOptions);
      if (!postCheck.allowed) {
        blockedRepos.push({
          period,
          fullName: repo.fullName,
          stage: 'post-ai',
          decision: postCheck,
        });
        logger.warn(
          `[gitpulse][compliance] ${options.date} Post-AI text check blocked ${repo.fullName} (${period}): ${postCheck.matchedRule} ${postCheck.reason ?? postCheck.matchedRule}`,
        );
        continue;
      }

      repoItems.push(item);
    }

    if (repoItems.length === 0) {
      logger.warn(`[gitpulse][compliance] Skipping ${period} issue: 0 compliant repositories remaining.`);
      continue;
    }

    const fallbackCount = repoItems.filter((r) => r.ai.aiStatus === 'fallback').length;
    const summaryResult = await generateIssueSummary(
      options.date,
      period,
      repoItems,
      aiConfig,
    );
    let topCategory = summaryResult.topCategory;
    const summaryCompliance = evaluateTextCompliance(summaryResult.summary, complianceOptions);
    let summary = summaryCompliance.allowed
      ? summaryResult.summary
      : buildFallbackIssueSummary(period, topCategory, repoItems);

    if (!summaryCompliance.allowed) {
      logger.warn(
        `[gitpulse][compliance] Replaced non-compliant ${period} issue summary with safe fallback (${summaryCompliance.reason}).`,
      );
    }

    logger.info(
      `[gitpulse] Prepared ${period} issue (${repoItems.length} repos, topCategory=${topCategory}, fallback=${fallbackCount}): ${summary}`,
    );

    let assignedIssueNo: number | undefined;

    // 5. Push to CloudBase unless --dry-run
    if (!options.dryRun) {
      const ingestUrl = env.CLOUDBASE_INGEST_URL;
      const ingestSecret = env.INGEST_SECRET;
      if (!ingestUrl || !ingestSecret) {
        throw new Error(
          'CLOUDBASE_INGEST_URL and INGEST_SECRET must be set unless running with --dry-run',
        );
      }

      const requestBody: IngestIssueRequest = {
        date: options.date,
        period,
        summary,
        topCategory,
        repos: repoItems,
      };

      let pushed;
      try {
        pushed = await pushIssueToCloud(requestBody, {
          ingestUrl,
          ingestSecret,
          apiKey: env.CLOUDBASE_API_KEY,
          timeoutMs: Math.max(timeoutMs, 60_000),
          fetchImpl,
        });
      } catch (error) {
        if (!(error instanceof IssueFilteredError)) throw error;
        logger.warn('[gitpulse][compliance] Skipping ' + options.date + ' ' + period + ': ' + error.message);
        continue;
      }
      if (!Array.isArray(pushed.repoIds) || !pushed.summary || !pushed.topCategory) {
        throw new Error('云端未返回审核后的期刊，请同步更新 ingestIssue');
      }
      const accepted = new Set(pushed.repoIds);
      repoItems = repoItems.filter((item) => accepted.has(item._id));
      summary = pushed.summary;
      topCategory = pushed.topCategory;
      assignedIssueNo = pushed.issueNo;
      pushResults.push({ period, data: pushed });
      logger.info(
        `[gitpulse] Pushed ${period} issue to CloudBase: issueId=${pushed.issueId}, issueNo=${pushed.issueNo}, upsertedRepos=${pushed.upsertedRepos}`,
      );
    }

    bundles.push({
      issue: {
        _id: `${options.date}_${period}`,
        date: options.date,
        period,
        issueNo: assignedIssueNo,
        summary,
        topCategory,
        repoIds: repoItems.map((r) => r._id),
        publishedAt,
      },
      repos: repoItems,
    });
  }

  // 6. Write merged SnapshotPayload when --dry-run or --out is provided
  let snapshotPath: string | undefined;
  let snapshot: SnapshotPayload | undefined;
  if (options.outPath) {
    snapshotPath = resolve(process.cwd(), options.outPath);
    snapshot = await writeSnapshotFile(snapshotPath, bundles, {
      generatedAt: publishedAt,
    });
    logger.info(
      `[gitpulse] Wrote validated SnapshotPayload (${Object.keys(snapshot.issues).length} issues, ${Object.keys(snapshot.repos).length} repos) to ${snapshotPath}`,
    );
  }

  return {
    date: options.date,
    dryRun: options.dryRun,
    bundles,
    pushResults,
    blockedRepos,
    snapshotPath,
    snapshot,
  };
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(USAGE_TEXT);
    return;
  }
  await runPipeline(cli);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((error) => {
    console.error('[gitpulse] Fatal pipeline error:', error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
