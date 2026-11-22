import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMockWxSdk, loadCloudFunction, makeSampleRepo } = require('./helpers/mockWxSdk');

test('getDailyIssue returns latest issue, preserves rank order, caps availableDates to 14, filters category, and includes bookmarks & subscription', async () => {
  const sdk = createMockWxSdk({ openid: 'user-alpha' });
  const fn = loadCloudFunction('getDailyIssue', sdk);

  const repoA = makeSampleRepo({ owner: 'org', name: 'alpha', category: 'ai-agent' });
  const repoB = makeSampleRepo({ owner: 'org', name: 'beta', category: 'frontend' });
  const repoC = makeSampleRepo({ owner: 'org', name: 'gamma', category: 'ai-agent' });
  sdk.__test.seed('repos', [repoA, repoB, repoC]);

  // Seed 16 daily issues to test 14-issue cap on availableDates
  const issues = [];
  for (let day = 1; day <= 16; day += 1) {
    const date = `2026-11-${String(day).padStart(2, '0')}`;
    issues.push({
      _id: `${date}_daily`,
      date,
      period: 'daily',
      issueNo: day,
      summary: `第 ${day} 期速览`,
      topCategory: 'ai-agent',
      repoIds: day === 16 ? ['org__gamma', 'org__beta', 'org__alpha'] : ['org__alpha'],
      publishedAt: `${date}T00:00:00.000Z`,
    });
  }
  sdk.__test.seed('daily_issues', issues);

  sdk.__test.seed('user_bookmarks', [
    { openid: 'user-alpha', repoId: 'org__beta', createdAt: '2026-11-16T01:00:00.000Z' },
    { openid: 'user-other', repoId: 'org__gamma', createdAt: '2026-11-16T01:00:00.000Z' },
  ]);

  sdk.__test.seed('push_subscriptions', [
    {
      _id: 'user-alpha',
      openid: 'user-alpha',
      remainingCount: 3,
      preferredCategory: 'frontend',
      lastPushedDate: '2026-11-15',
      templateId: 'tpl-123',
    },
  ]);

  // 1. Default call -> latest daily issue (2026-11-16)
  const latestRes = await fn.main({});
  assert.equal(latestRes.code, 0);
  assert.equal(latestRes.data.issue._id, '2026-11-16_daily');
  // Must preserve exact repoIds rank order: gamma -> beta -> alpha
  assert.deepEqual(
    latestRes.data.repos.map((r) => r._id),
    ['org__gamma', 'org__beta', 'org__alpha']
  );
  assert.equal(latestRes.data.availableDates.length, 14);
  assert.equal(latestRes.data.availableDates[0], '2026-11-16');
  assert.equal(latestRes.data.availableDates[13], '2026-11-03');
  assert.deepEqual(latestRes.data.bookmarkedIds, ['org__beta']);
  assert.deepEqual(latestRes.data.subscription, {
    remainingCount: 3,
    preferredCategory: 'frontend',
    lastPushedDate: '2026-11-15',
    templateId: 'tpl-123',
  });

  // 2. Category filter -> only ai-agent repos in exact rank order (gamma -> alpha)
  const filteredRes = await fn.main({ date: '2026-11-16', period: 'daily', category: 'ai-agent' });
  assert.equal(filteredRes.code, 0);
  assert.deepEqual(
    filteredRes.data.repos.map((r) => r._id),
    ['org__gamma', 'org__alpha']
  );
  assert.deepEqual(filteredRes.data.bookmarkedIds, []);

  // 3. Nonexistent date returns issue: null gracefully
  const missingRes = await fn.main({ date: '2025-01-01', period: 'daily' });
  assert.equal(missingRes.code, 0);
  assert.equal(missingRes.data.issue, null);
  assert.deepEqual(missingRes.data.repos, []);

  // 4. Invalid params -> 400
  const badPeriod = await fn.main({ period: 'monthly' });
  assert.equal(badPeriod.code, 400);
  const badDate = await fn.main({ date: 'bad-date' });
  assert.equal(badDate.code, 400);
});
