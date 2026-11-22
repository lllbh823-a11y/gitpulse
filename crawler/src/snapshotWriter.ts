import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  REPO_CATEGORY_IDS,
  type DailyIssue,
  type RepoItem,
  type SnapshotPayload,
  type TrendingPeriod,
} from './types.js';

export interface IncomingIssueBundle {
  issue: Omit<DailyIssue, 'issueNo'> & { issueNo?: number };
  repos: RepoItem[];
}

export interface MergeSnapshotOptions {
  generatedAt?: string;
  maxDates?: number;
}

const VALID_CATEGORIES = new Set<string>(REPO_CATEGORY_IDS);
const VALID_PERIODS = new Set<string>(['daily', 'weekly']);

function getMaxIssueNoByPeriod(
  issues: Record<string, DailyIssue>,
): Record<TrendingPeriod, number> {
  const maxByPeriod: Record<TrendingPeriod, number> = {
    daily: 0,
    weekly: 0,
  };
  for (const issue of Object.values(issues)) {
    if (issue.period === 'daily' || issue.period === 'weekly') {
      if (issue.issueNo > maxByPeriod[issue.period]) {
        maxByPeriod[issue.period] = issue.issueNo;
      }
    }
  }
  return maxByPeriod;
}

export function mergeSnapshot(
  existing: SnapshotPayload | null,
  bundles: readonly IncomingIssueBundle[],
  options: MergeSnapshotOptions = {},
): SnapshotPayload {
  const {
    generatedAt = new Date().toISOString(),
    maxDates = 14,
  } = options;

  const mergedIssues: Record<string, DailyIssue> = existing ? { ...existing.issues } : {};
  const mergedRepos: Record<string, RepoItem> = existing ? { ...existing.repos } : {};

  const maxIssueNo = getMaxIssueNoByPeriod(mergedIssues);

  // Process bundles in deterministic date order (ascending) so new issueNo increments chronologically.
  // For the same date, process 'weekly' before 'daily' so daily's starsToday takes precedence in mergedRepos.
  const sortedBundles = [...bundles].sort((a, b) => {
    const dateCmp = a.issue.date.localeCompare(b.issue.date);
    if (dateCmp !== 0) {
      return dateCmp;
    }
    if (a.issue.period === b.issue.period) {
      return 0;
    }
    return a.issue.period === 'weekly' ? -1 : 1;
  });

  for (const bundle of sortedBundles) {
    const issueKey = bundle.issue._id || `${bundle.issue.date}_${bundle.issue.period}`;
    const existingIssue = mergedIssues[issueKey];

    let issueNo: number;
    if (typeof bundle.issue.issueNo === 'number' && bundle.issue.issueNo > 0) {
      issueNo = bundle.issue.issueNo;
      if (issueNo > maxIssueNo[bundle.issue.period]) {
        maxIssueNo[bundle.issue.period] = issueNo;
      }
    } else if (existingIssue && existingIssue.issueNo > 0) {
      issueNo = existingIssue.issueNo;
    } else {
      maxIssueNo[bundle.issue.period] += 1;
      issueNo = maxIssueNo[bundle.issue.period];
    }

    mergedIssues[issueKey] = {
      ...bundle.issue,
      _id: issueKey,
      issueNo,
    };

    for (const repo of bundle.repos) {
      mergedRepos[repo._id] = repo;
    }
  }

  // Compute unique availableDates descending and retain up to maxDates
  const dateSet = new Set<string>();
  for (const issue of Object.values(mergedIssues)) {
    dateSet.add(issue.date);
  }
  const availableDates = Array.from(dateSet)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, Math.max(1, maxDates));

  const keptDateSet = new Set(availableDates);
  const prunedIssues: Record<string, DailyIssue> = {};
  const referencedRepoIds = new Set<string>();

  for (const [key, issue] of Object.entries(mergedIssues)) {
    if (keptDateSet.has(issue.date)) {
      prunedIssues[key] = issue;
      for (const repoId of issue.repoIds) {
        referencedRepoIds.add(repoId);
      }
    }
  }

  const prunedRepos: Record<string, RepoItem> = {};
  for (const repoId of referencedRepoIds) {
    const repo = mergedRepos[repoId];
    if (repo) {
      prunedRepos[repoId] = repo;
    }
  }

  return {
    generatedAt,
    availableDates,
    issues: prunedIssues,
    repos: prunedRepos,
  };
}

export function validateSnapshotPayload(payload: unknown): SnapshotPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('SnapshotPayload must be a JSON object');
  }
  const obj = payload as Record<string, unknown>;

  if (typeof obj.generatedAt !== 'string' || Number.isNaN(Date.parse(obj.generatedAt))) {
    throw new Error('SnapshotPayload.generatedAt must be a valid ISO 8601 string');
  }
  if (!Array.isArray(obj.availableDates) || !obj.availableDates.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new Error('SnapshotPayload.availableDates must be an array of YYYY-MM-DD strings');
  }
  if (!obj.issues || typeof obj.issues !== 'object' || Array.isArray(obj.issues)) {
    throw new Error('SnapshotPayload.issues must be a record');
  }
  if (!obj.repos || typeof obj.repos !== 'object' || Array.isArray(obj.repos)) {
    throw new Error('SnapshotPayload.repos must be a record');
  }

  const issues = obj.issues as Record<string, DailyIssue>;
  const repos = obj.repos as Record<string, RepoItem>;

  for (const [key, issue] of Object.entries(issues)) {
    if (key !== `${issue.date}_${issue.period}` || issue._id !== key) {
      throw new Error(`DailyIssue key mismatch: key=${key}, _id=${issue._id}`);
    }
    if (!VALID_PERIODS.has(issue.period)) {
      throw new Error(`Invalid DailyIssue.period: ${issue.period}`);
    }
    if (typeof issue.issueNo !== 'number' || issue.issueNo < 1) {
      throw new Error(`Invalid DailyIssue.issueNo for ${key}: ${issue.issueNo}`);
    }
    if (!VALID_CATEGORIES.has(issue.topCategory)) {
      throw new Error(`Invalid DailyIssue.topCategory for ${key}: ${issue.topCategory}`);
    }
    if (!Array.isArray(issue.repoIds)) {
      throw new Error(`DailyIssue.repoIds must be an array for ${key}`);
    }
    for (const repoId of issue.repoIds) {
      if (!repos[repoId]) {
        throw new Error(`DailyIssue ${key} references missing repoId: ${repoId}`);
      }
    }
  }

  for (const [key, repo] of Object.entries(repos)) {
    const expectedId = `${repo.owner}__${repo.name}`.toLowerCase();
    if (key !== expectedId || repo._id !== expectedId) {
      throw new Error(`RepoItem._id mismatch: key=${key}, _id=${repo._id}, expected=${expectedId}`);
    }
    if (!VALID_CATEGORIES.has(repo.category)) {
      throw new Error(`Invalid RepoItem.category for ${key}: ${repo.category}`);
    }
    if (!Array.isArray(repo.tags) || repo.tags.length < 2 || repo.tags.length > 3) {
      throw new Error(`RepoItem.tags must have 2~3 items for ${key}`);
    }
    if (
      !repo.ai ||
      !Array.isArray(repo.ai.highlights) ||
      repo.ai.highlights.length !== 3 ||
      (repo.ai.aiStatus !== 'ok' && repo.ai.aiStatus !== 'fallback')
    ) {
      throw new Error(`Invalid RepoItem.ai structure for ${key}`);
    }
  }

  return payload as SnapshotPayload;
}

export async function readExistingSnapshot(filePath: string): Promise<SnapshotPayload | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return validateSnapshotPayload(parsed);
  } catch {
    return null;
  }
}

export async function writeSnapshotFile(
  filePath: string,
  bundles: readonly IncomingIssueBundle[],
  options: MergeSnapshotOptions = {},
): Promise<SnapshotPayload> {
  const existing = await readExistingSnapshot(filePath);
  const merged = mergeSnapshot(existing, bundles, options);
  validateSnapshotPayload(merged);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}
