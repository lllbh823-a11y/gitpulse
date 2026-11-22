import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMockWxSdk, loadCloudFunction, makeSampleRepo } = require('./helpers/mockWxSdk');

process.env.MSG_SEC_CHECK_OPENID = 'mock-openid';
const TEST_SECRET = 'super-secret-ingest-key-2026';

function signBody(secret, timestamp, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

function makeHttpEvent(payload, { secret = TEST_SECRET, timestamp, signature, method = 'POST', base64 = false } = {}) {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const ts = timestamp !== undefined ? String(timestamp) : String(Math.floor(Date.now() / 1000));
  const sig = signature !== undefined ? signature : signBody(secret, ts, rawBody);
  return {
    httpMethod: method,
    headers: {
      'Content-Type': 'application/json',
      'X-GitPulse-Timestamp': ts,
      'X-GitPulse-Signature': sig,
    },
    body: base64 ? Buffer.from(rawBody, 'utf8').toString('base64') : rawBody,
    isBase64Encoded: base64,
  };
}

test('ingestIssue rejects missing secret, invalid signature, tampered body, and replay outside +/-300s', async () => {
  const sdk = createMockWxSdk();
  const fn = loadCloudFunction('ingestIssue', sdk);
  const samplePayload = {
    date: '2026-11-22',
    period: 'daily',
    summary: 'AI Agent 工具链持续领跑今日开源榜。',
    topCategory: 'ai-agent',
    repos: [makeSampleRepo()],
  };

  // Missing INGEST_SECRET fails closed with 500
  const prevSecret = process.env.INGEST_SECRET;
  delete process.env.INGEST_SECRET;
  try {
    const noSecretRes = await fn.main(makeHttpEvent(samplePayload));
    assert.equal(noSecretRes.statusCode, 500);
    assert.equal(JSON.parse(noSecretRes.body).code, 500);
  } finally {
    process.env.INGEST_SECRET = TEST_SECRET;
  }

  try {
    // Non-POST method returns 405
    const getRes = await fn.main(makeHttpEvent(samplePayload, { method: 'GET' }));
    assert.equal(getRes.statusCode, 405);

    // Expired timestamp (-301s) -> 401
    const oldTs = Math.floor(Date.now() / 1000) - 301;
    const oldRes = await fn.main(makeHttpEvent(samplePayload, { timestamp: oldTs }));
    assert.equal(oldRes.statusCode, 401);
    assert.equal(JSON.parse(oldRes.body).code, 401);

    // Future timestamp (+301s) -> 401
    const futureTs = Math.floor(Date.now() / 1000) + 301;
    const futureRes = await fn.main(makeHttpEvent(samplePayload, { timestamp: futureTs }));
    assert.equal(futureRes.statusCode, 401);

    // Wrong signature -> 401
    const wrongSigRes = await fn.main(
      makeHttpEvent(samplePayload, { signature: 'a'.repeat(64) })
    );
    assert.equal(wrongSigRes.statusCode, 401);

    // Tampered body after signing -> 401
    const event = makeHttpEvent(samplePayload);
    event.body = JSON.stringify({ ...samplePayload, summary: 'tampered' });
    const tamperedRes = await fn.main(event);
    assert.equal(tamperedRes.statusCode, 401);

    // Nothing persisted in DB
    assert.equal(sdk.__test.getAll('daily_issues').length, 0);
    assert.equal(sdk.__test.getAll('repos').length, 0);
  } finally {
    if (prevSecret === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = prevSecret;
  }
});

test('ingestIssue performs idempotent upsert, auto-increments issueNo per period, and supports base64 HTTP bodies', async () => {
  const sdk = createMockWxSdk();
  const fn = loadCloudFunction('ingestIssue', sdk);
  const prevSecret = process.env.INGEST_SECRET;
  process.env.INGEST_SECRET = TEST_SECRET;

  try {
    const repo1 = makeSampleRepo({ owner: 'Anthropic', name: 'Claude-Code', starsToday: 1200 });
    const repo2 = makeSampleRepo({
      owner: 'vercel',
      name: 'ai',
      category: 'frontend',
      language: 'TypeScript',
      starsToday: 850,
    });

    const day1Payload = {
      date: '2026-11-21',
      period: 'daily',
      summary: '首期 AI 编程与前端框架齐发力。',
      topCategory: 'ai-agent',
      repos: [repo1, repo2, repo1], // duplicate repo1 should be deduplicated
    };

    // 1. First ingest -> issueNo = 1
    const res1 = await fn.main(makeHttpEvent(day1Payload, { base64: true }));
    assert.equal(res1.statusCode, 200);
    const body1 = JSON.parse(res1.body);
    assert.equal(body1.code, 0);
    assert.deepEqual(body1.data, {
      issueId: '2026-11-21_daily',
      issueNo: 1,
      upsertedRepos: 2,
      summary: day1Payload.summary,
      topCategory: day1Payload.topCategory,
      repoIds: [repo1._id, repo2._id],
    });

    const storedIssue1 = sdk.__test.getById('daily_issues', '2026-11-21_daily');
    assert.equal(storedIssue1.issueNo, 1);
    assert.deepEqual(storedIssue1.repoIds, ['anthropic__claude-code', 'vercel__ai']);
    const originalPublishedAt = storedIssue1.publishedAt;

    // 2. Re-ingest same date + period with updated summary & star count -> issueNo stays 1 (idempotent!)
    const updatedDay1 = {
      ...day1Payload,
      summary: '修正后的首期风向总结。',
      repos: [{ ...repo1, starsToday: 1350 }, repo2],
    };
    const res1Repeat = await fn.main(makeHttpEvent(updatedDay1));
    assert.equal(res1Repeat.statusCode, 200);
    const body1Repeat = JSON.parse(res1Repeat.body);
    assert.equal(body1Repeat.data.issueNo, 1);

    const refreshedIssue1 = sdk.__test.getById('daily_issues', '2026-11-21_daily');
    assert.equal(refreshedIssue1.summary, '修正后的首期风向总结。');
    assert.equal(refreshedIssue1.publishedAt, originalPublishedAt);
    assert.equal(sdk.__test.getById('repos', 'anthropic__claude-code').starsToday, 1350);

    // 3. Second day daily issue -> issueNo auto-increments to 2
    const day2Payload = {
      date: '2026-11-22',
      period: 'daily',
      summary: '第二期开源热点速览。',
      topCategory: 'frontend',
      repos: [repo2],
    };
    const res2 = await fn.main(makeHttpEvent(day2Payload));
    assert.equal(JSON.parse(res2.body).data.issueNo, 2);

    // 4. Weekly period maintains its own sequence starting at 1
    const weeklyPayload = {
      date: '2026-11-22',
      period: 'weekly',
      summary: '本周最受关注开源项目盘点。',
      topCategory: 'ai-agent',
      repos: [repo1],
    };
    const resWeekly = await fn.main(makeHttpEvent(weeklyPayload));
    assert.deepEqual(JSON.parse(resWeekly.body).data, {
      issueId: '2026-11-22_weekly',
      issueNo: 1,
      upsertedRepos: 1,
      summary: weeklyPayload.summary,
      topCategory: weeklyPayload.topCategory,
      repoIds: [repo1._id],
    });
  } finally {
    if (prevSecret === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = prevSecret;
  }
});

test('ingestIssue validates payload schema and returns 400 on invalid inputs', async () => {
  const sdk = createMockWxSdk();
  const fn = loadCloudFunction('ingestIssue', sdk);
  const prevSecret = process.env.INGEST_SECRET;
  process.env.INGEST_SECRET = TEST_SECRET;

  try {
    const badJson = await fn.main(makeHttpEvent('{not-json'));
    assert.equal(badJson.statusCode, 400);

    const badDate = await fn.main(
      makeHttpEvent({
        date: '2026/11/22',
        period: 'daily',
        summary: 'test',
        topCategory: 'ai-agent',
        repos: [makeSampleRepo()],
      })
    );
    assert.equal(badDate.statusCode, 400);

    const emptyRepos = await fn.main(
      makeHttpEvent({
        date: '2026-11-22',
        period: 'daily',
        summary: 'test',
        topCategory: 'ai-agent',
        repos: [],
      })
    );
    assert.equal(emptyRepos.statusCode, 400);
  } finally {
    if (prevSecret === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = prevSecret;
  }
});

test('ingestIssue filters non-compliant repos via hard blocklist and WeChat msgSecCheck without affecting legitimate infra repos', async () => {
  const sdk = createMockWxSdk();
  const fn = loadCloudFunction('ingestIssue', sdk);
  const prevSecret = process.env.INGEST_SECRET;
  process.env.INGEST_SECRET = TEST_SECRET;

  sdk.__test.setMsgSecHandler(async (params) => {
    if (String(params.content || '').includes('WX_FLAGGED_TOKEN')) {
      return { errCode: 87014, errMsg: 'risky content' };
    }
    return { errCode: 0, result: { suggest: 'pass' } };
  });

  try {
    const cleanInfraRepo = makeSampleRepo({
      owner: 'traefik',
      name: 'traefik',
      description: 'The Cloud Native Application Reverse Proxy and API Gateway',
      category: 'backend-infra',
      tags: ['Go', 'Reverse Proxy', 'Cloud Native'],
    });
    const proxyBypassRepo = makeSampleRepo({
      owner: 'clash-verge-rev',
      name: 'clash-verge-rev',
      description: 'A modern Clash Meta GUI proxy client based on Tauri',
      category: 'dev-tools',
      tags: ['Clash', 'Proxy'],
    });
    const wxFlaggedRepo = makeSampleRepo({
      owner: 'example',
      name: 'flagged-demo',
      description: 'Contains WX_FLAGGED_TOKEN in text',
      category: 'other',
    });

    const payload = {
      date: '2026-11-22',
      period: 'daily',
      summary: '今日精选免费节点与开源工具汇总。', // should be replaced with safe fallback summary
      topCategory: 'backend-infra',
      repos: [cleanInfraRepo, proxyBypassRepo, wxFlaggedRepo],
    };

    const res = await fn.main(makeHttpEvent(payload));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 0);
    assert.equal(body.data.upsertedRepos, 1);
    assert.equal(body.data.filteredRepos.length, 2);
    assert.deepEqual(
      body.data.filteredRepos.map((item) => item.fullName),
      ['clash-verge-rev/clash-verge-rev', 'example/flagged-demo']
    );

    // Only the legitimate repo is persisted
    assert.ok(sdk.__test.getById('repos', 'traefik__traefik'));
    assert.equal(sdk.__test.getById('repos', 'clash-verge-rev__clash-verge-rev'), null);
    assert.equal(sdk.__test.getById('repos', 'example__flagged-demo'), null);

    // Unsafe summary was replaced by safe fallback
    const storedIssue = sdk.__test.getById('daily_issues', '2026-11-22_daily');
    assert.deepEqual(storedIssue.repoIds, ['traefik__traefik']);
    assert.equal(storedIssue.summary.includes('免费节点'), false);

    // If ALL repos are blocked, return 400 and do not persist an empty issue
    const allBlockedRes = await fn.main(
      makeHttpEvent({
        date: '2026-11-23',
        period: 'daily',
        summary: '测试全拦截',
        topCategory: 'dev-tools',
        repos: [proxyBypassRepo],
      })
    );
    assert.equal(allBlockedRes.statusCode, 422);
    assert.equal(sdk.__test.getById('daily_issues', '2026-11-23_daily'), null);
  } finally {
    if (prevSecret === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = prevSecret;
  }
});

test('publication requires an explicit WeChat pass', async () => {
  const payload = { date: '2026-11-22', period: 'daily', summary: 'Daily digest', topCategory: 'other', repos: [makeSampleRepo()] };
  const prior = process.env.INGEST_SECRET;
  process.env.INGEST_SECRET = TEST_SECRET;
  try {
    for (const [handler, expected] of [
      [() => ({ errCode: 0, result: { suggest: 'review' } }), 422],
      [() => ({ errCode: 40003 }), 500],
      [() => { throw new Error('timeout'); }, 500],
      [null, 500],
    ]) {
      const sdk = createMockWxSdk();
      if (handler) sdk.__test.setMsgSecHandler(handler);
      else delete sdk.openapi.security;
      const res = await loadCloudFunction('ingestIssue', sdk).main(makeHttpEvent(payload));
      assert.equal(res.statusCode, expected);
      assert.equal(sdk.__test.getAll('moderation_pending').length, 1);
      assert.equal(sdk.__test.getById('daily_issues', '2026-11-22_daily'), null);
      assert.equal(sdk.__test.getById('repos', payload.repos[0]._id), null);
      if (handler) {
        sdk.__test.setMsgSecHandler(async () => ({ errCode: 0, result: { suggest: 'pass' } }));
        const retry = await loadCloudFunction('ingestIssue', sdk).main(makeHttpEvent(payload));
        assert.equal(retry.statusCode, 200);
        assert.equal(sdk.__test.getAll('moderation_pending')[0].status, 'passed');
      }
    }
  } finally {
    if (prior === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = prior;
  }
});

test('only the checked summary is published, including for oversized input', async () => {
  const previous = process.env.INGEST_SECRET;
  process.env.INGEST_SECRET = TEST_SECRET;
  try {
    for (const summary of ['A'.repeat(2401), 'Please review this digest']) {
      const sdk = createMockWxSdk();
      sdk.__test.setMsgSecHandler(async ({ content }) => ({
        errCode: 0, result: { suggest: content === summary ? 'review' : 'pass' },
      }));
      const repo = makeSampleRepo({ owner: 'nginx', name: 'nginx', description: 'Reverse proxy with VPN integration' });
      const payload = { date: '2026-11-22', period: 'daily', summary, topCategory: 'other', repos: [repo] };
      const response = await loadCloudFunction('ingestIssue', sdk).main(makeHttpEvent(payload));
      assert.equal(response.statusCode, 200);
      const stored = sdk.__test.getById('daily_issues', '2026-11-22_daily');
      assert.notEqual(stored.summary, summary);
      assert.ok(sdk.__test.getMsgSecChecks().some(({content}) => content === stored.summary));
      assert.deepEqual(stored.repoIds, [repo._id]);
    }
  } finally {
    if (previous === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = previous;
  }
});
