import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeSnapshot,
  validateSnapshotPayload,
  writeSnapshotFile,
  type IncomingIssueBundle,
} from '../src/snapshotWriter.js';
import type { RepoItem } from '../src/types.js';

function makeRepo(owner: string, name: string, starsToday: number, date: string): RepoItem {
  return {
    _id: `${owner}__${name}`.toLowerCase(),
    fullName: `${owner}/${name}`,
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
    description: `${name} repository`,
    language: 'TypeScript',
    languageColor: '#3178c6',
    stars: 5000 + starsToday,
    starsToday,
    forks: 300,
    license: 'MIT',
    category: 'ai-agent',
    tags: ['AI Agent', 'TypeScript'],
    ai: {
      tagline: `${name}：高质量开源项目速览`,
      whyHot: `${name} 解决了开发者的核心痛点，社区增长迅速。`,
      highlights: ['开箱即用的工具链体验', '模块化架构便于二次扩展', '社区活跃文档完善'],
      targetAudience: '全栈与 AI 应用开发者',
      aiStatus: 'ok',
    },
    latestDate: date,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

describe('snapshotWriter', () => {
  it('merges daily and weekly bundles, increments issueNo idempotently, and prefers daily starsToday on overlap', () => {
    const sharedDaily = makeRepo('org', 'shared', 420, '2026-11-21');
    const sharedWeekly = makeRepo('org', 'shared', 2800, '2026-11-21');
    const weeklyOnly = makeRepo('org', 'weekly-only', 1900, '2026-11-21');

    const day1Bundles: IncomingIssueBundle[] = [
      {
        issue: {
          _id: '2026-11-21_daily',
          date: '2026-11-21',
          period: 'daily',
          summary: '21日热榜聚焦 AI Agent 生态爆发。',
          topCategory: 'ai-agent',
          repoIds: [sharedDaily._id],
          publishedAt: '2026-11-21T00:00:00.000Z',
        },
        repos: [sharedDaily],
      },
      {
        issue: {
          _id: '2026-11-21_weekly',
          date: '2026-11-21',
          period: 'weekly',
          summary: '本周热榜 AI 与工程效率双线升温。',
          topCategory: 'ai-agent',
          repoIds: [sharedWeekly._id, weeklyOnly._id],
          publishedAt: '2026-11-21T00:00:00.000Z',
        },
        repos: [sharedWeekly, weeklyOnly],
      },
    ];

    const snap1 = mergeSnapshot(null, day1Bundles, { generatedAt: '2026-11-21T00:05:00.000Z' });
    validateSnapshotPayload(snap1);

    expect(snap1.availableDates).toEqual(['2026-11-21']);
    expect(snap1.issues['2026-11-21_daily']?.issueNo).toBe(1);
    expect(snap1.issues['2026-11-21_weekly']?.issueNo).toBe(1);
    // Daily starsToday wins for overlapping repo
    expect(snap1.repos['org__shared']?.starsToday).toBe(420);

    // Day 2 merge + re-run day 1 daily (should preserve day 1 issueNo=1 and assign day 2 issueNo=2)
    const day2Repo = makeRepo('org', 'next-gen', 980, '2026-11-22');
    const snap2 = mergeSnapshot(
      snap1,
      [
        {
          issue: {
            _id: '2026-11-21_daily',
            date: '2026-11-21',
            period: 'daily',
            summary: '21日热榜更新版摘要。',
            topCategory: 'ai-agent',
            repoIds: [sharedDaily._id],
            publishedAt: '2026-11-21T01:00:00.000Z',
          },
          repos: [sharedDaily],
        },
        {
          issue: {
            _id: '2026-11-22_daily',
            date: '2026-11-22',
            period: 'daily',
            summary: '22日热榜新秀崛起。',
            topCategory: 'ai-agent',
            repoIds: [day2Repo._id],
            publishedAt: '2026-11-22T00:00:00.000Z',
          },
          repos: [day2Repo],
        },
      ],
      { generatedAt: '2026-11-22T00:05:00.000Z' },
    );

    validateSnapshotPayload(snap2);
    expect(snap2.availableDates).toEqual(['2026-11-22', '2026-11-21']);
    expect(snap2.issues['2026-11-21_daily']?.issueNo).toBe(1);
    expect(snap2.issues['2026-11-22_daily']?.issueNo).toBe(2);
    expect(Object.keys(snap2.repos)).toHaveLength(3);
  });

  it('prunes dates beyond maxDates and drops unreferenced repos', () => {
    const r1 = makeRepo('org', 'old', 100, '2026-11-20');
    const r2 = makeRepo('org', 'mid', 200, '2026-11-21');
    const r3 = makeRepo('org', 'new', 300, '2026-11-22');

    const snapshot = mergeSnapshot(
      null,
      [
        {
          issue: {
            _id: '2026-11-20_daily',
            date: '2026-11-20',
            period: 'daily',
            summary: 'old',
            topCategory: 'ai-agent',
            repoIds: [r1._id],
            publishedAt: '2026-11-20T00:00:00.000Z',
          },
          repos: [r1],
        },
        {
          issue: {
            _id: '2026-11-21_daily',
            date: '2026-11-21',
            period: 'daily',
            summary: 'mid',
            topCategory: 'ai-agent',
            repoIds: [r2._id],
            publishedAt: '2026-11-21T00:00:00.000Z',
          },
          repos: [r2],
        },
        {
          issue: {
            _id: '2026-11-22_daily',
            date: '2026-11-22',
            period: 'daily',
            summary: 'new',
            topCategory: 'ai-agent',
            repoIds: [r3._id],
            publishedAt: '2026-11-22T00:00:00.000Z',
          },
          repos: [r3],
        },
      ],
      { maxDates: 2 },
    );

    expect(snapshot.availableDates).toEqual(['2026-11-22', '2026-11-21']);
    expect(snapshot.issues['2026-11-20_daily']).toBeUndefined();
    expect(snapshot.repos['org__old']).toBeUndefined();
    expect(snapshot.repos['org__new']).toBeDefined();
  });

  it('writes and incrementally merges snapshot JSON on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gitpulse-snap-'));
    const filePath = join(dir, 'nested', 'snapshot.json');

    try {
      const repoA = makeRepo('acme', 'alpha', 500, '2026-11-21');
      await writeSnapshotFile(filePath, [
        {
          issue: {
            _id: '2026-11-21_daily',
            date: '2026-11-21',
            period: 'daily',
            summary: '第一期测试快照。',
            topCategory: 'ai-agent',
            repoIds: [repoA._id],
            publishedAt: '2026-11-21T00:00:00.000Z',
          },
          repos: [repoA],
        },
      ]);

      const repoB = makeRepo('acme', 'beta', 700, '2026-11-22');
      await writeSnapshotFile(filePath, [
        {
          issue: {
            _id: '2026-11-22_daily',
            date: '2026-11-22',
            period: 'daily',
            summary: '第二期测试快照。',
            topCategory: 'ai-agent',
            repoIds: [repoB._id],
            publishedAt: '2026-11-22T00:00:00.000Z',
          },
          repos: [repoB],
        },
      ]);

      const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      const validated = validateSnapshotPayload(raw);
      expect(validated.availableDates).toEqual(['2026-11-22', '2026-11-21']);
      expect(validated.issues['2026-11-22_daily']?.issueNo).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
