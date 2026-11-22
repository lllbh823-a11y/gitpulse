import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMockWxSdk, loadCloudFunction, makeSampleRepo } = require('./helpers/mockWxSdk');

test('sendDailyPush truncates thing fields strictly <= 20 chars without breaking surrogate pairs', () => {
  const sdk = createMockWxSdk();
  const fn = loadCloudFunction('sendDailyPush', sdk);
  const { truncateThing, formatDateFieldValue } = fn._internal;

  // Short string stays intact
  assert.equal(truncateThing('claude-code +1280★', 20), 'claude-code +1280★');

  // Long Chinese tagline truncates to exactly <= 20 chars with ellipsis
  const longZh = '这是一个非常非常非常非常长的一句话开源项目深度核心价值总结说明文案';
  const truncatedZh = truncateThing(longZh, 20);
  assert.ok(truncatedZh.length <= 20);
  assert.ok(Array.from(truncatedZh).length <= 20);
  assert.ok(truncatedZh.endsWith('…'));

  // Emoji / surrogate pair string does not produce broken UTF-16 surrogates and stays <= 20 code units
  const emojiStr = '🚀🔥开源神器超长标题测试abcdefghijklmnop';
  const truncatedEmoji = truncateThing(emojiStr, 20);
  assert.ok(truncatedEmoji.length <= 20);
  // Ensure no lone high/low surrogate exists
  assert.equal(/[\uD800-\uDFFF]/.test(truncatedEmoji.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), false);

  // Empty string uses fallback
  assert.equal(truncateThing('   ', 20, '默认文案'), '默认文案');

  // Date/time formatting by key type
  assert.equal(formatDateFieldValue('2026-11-22', 'time3'), '2026年11月22日 08:30');
  assert.equal(formatDateFieldValue('2026-11-22', 'date4'), '2026-11-22');

  // Beijing timezone boundary (UTC 16:30 = CST next day 00:30)
  assert.equal(
    fn._internal.getBeijingDateString(new Date('2026-11-21T16:30:00.000Z')),
    '2026-11-22'
  );

  // Custom env variable field keys
  const customPayload = fn._internal.buildSubscribePayload({
    repo: makeSampleRepo({ name: 'demo-repo', starsToday: 500 }),
    issue: { summary: 'test' },
    today: '2026-11-22',
    env: {
      PUSH_KEY_TITLE: 'thing4',
      PUSH_KEY_DESC: 'thing5',
      PUSH_KEY_DATE: 'date2',
    },
  });
  assert.deepEqual(Object.keys(customPayload), ['thing4', 'thing5', 'date2']);
  assert.equal(customPayload.date2.value, '2026-11-22');
  assert.ok(customPayload.thing4.value.length <= 20);
  assert.ok(customPayload.thing5.value.length <= 20);
});

test('sendDailyPush safely exits without deducting quotas when daily issue is not ingested yet', async () => {
  const sdk = createMockWxSdk();
  const fn = loadCloudFunction('sendDailyPush', sdk);

  sdk.__test.seed('push_subscriptions', [
    {
      _id: 'u-waiting',
      remainingCount: 2,
      preferredCategory: 'all',
      lastPushedDate: null,
      templateId: 'tpl-001',
    },
  ]);

  const res = await fn.main({ date: '2026-11-22' });
  assert.equal(res.code, 0);
  assert.equal(res.data.skipped, true);
  assert.equal(res.data.sent, 0);
  assert.equal(sdk.__test.getSentMessages().length, 0);
  assert.equal(sdk.__test.getById('push_subscriptions', 'u-waiting').remainingCount, 2);
});

test('sendDailyPush picks preferred category Top 1, deducts quota on success, zeroes on 43101, and isolates transient errors across >50-user batches', async () => {
  const prevEnv = {
    SUBSCRIBE_TEMPLATE_ID: process.env.SUBSCRIBE_TEMPLATE_ID,
    PUSH_KEY_TITLE: process.env.PUSH_KEY_TITLE,
    PUSH_KEY_DESC: process.env.PUSH_KEY_DESC,
    PUSH_KEY_DATE: process.env.PUSH_KEY_DATE,
  };
  process.env.SUBSCRIBE_TEMPLATE_ID = 'tpl-prod-01';
  process.env.PUSH_KEY_TITLE = 'thing1';
  process.env.PUSH_KEY_DESC = 'thing2';
  process.env.PUSH_KEY_DATE = 'time3';

  try {
    const sdk = createMockWxSdk();
    const fn = loadCloudFunction('sendDailyPush', sdk);

    const topOverall = makeSampleRepo({
      owner: 'anthropics',
      name: 'claude-code-super-long-repository-name',
      category: 'ai-agent',
      starsToday: 2450,
      ai: {
        tagline: '超长终端编程智能体自动规划并执行跨文件研发任务的开源项目介绍',
        whyHot: 'hot',
        highlights: ['a', 'b', 'c'],
        targetAudience: 'dev',
        aiStatus: 'ok',
      },
    });
    const topFrontend = makeSampleRepo({
      owner: 'vercel',
      name: 'v0-ui',
      category: 'frontend',
      starsToday: 980,
      ai: {
        tagline: '零配置现代前端组件生成工具',
        whyHot: 'hot',
        highlights: ['a', 'b', 'c'],
        targetAudience: 'fe',
        aiStatus: 'ok',
      },
    });

    sdk.__test.seed('repos', [topOverall, topFrontend]);
    sdk.__test.seed('daily_issues', [
      {
        _id: '2026-11-22_daily',
        date: '2026-11-22',
        period: 'daily',
        issueNo: 12,
        summary: 'AI 与前端齐头并进',
        topCategory: 'ai-agent',
        repoIds: [topOverall._id, topFrontend._id],
        publishedAt: '2026-11-22T00:00:00.000Z',
      },
    ]);

    // Seed 65 subscribers (2 batches: 50 + 15) + 1 already pushed today + 1 with 0 count
    const subs = [];
    for (let i = 1; i <= 65; i += 1) {
      const id = `user_${String(i).padStart(3, '0')}`;
      subs.push({
        _id: id,
        openid: id,
        remainingCount: 2,
        preferredCategory: i === 2 ? 'frontend' : i === 3 ? 'backend-infra' : 'all',
        lastPushedDate: '2026-11-21',
        templateId: 'tpl-prod-01',
      });
    }
    subs.push({
      _id: 'user_already_pushed',
      openid: 'user_already_pushed',
      remainingCount: 3,
      preferredCategory: 'all',
      lastPushedDate: '2026-11-22',
      templateId: 'tpl-prod-01',
    });
    subs.push({
      _id: 'user_zero_quota',
      openid: 'user_zero_quota',
      remainingCount: 0,
      preferredCategory: 'all',
      lastPushedDate: null,
      templateId: 'tpl-prod-01',
    });
    sdk.__test.seed('push_subscriptions', subs);

    // Simulate: user_004 -> 43101 refused; user_005 -> transient error; all others -> ok
    sdk.__test.setSendHandler(async (params) => {
      if (params.touser === 'user_004') {
        const err = new Error('openapi.subscribeMessage.send:fail user refuse to accept the msg');
        err.errCode = 43101;
        throw err;
      }
      if (params.touser === 'user_005') {
        const err = new Error('network timeout');
        err.errCode = -1;
        throw err;
      }
      return { errCode: 0, errMsg: 'ok' };
    });

    const res = await fn.main({ date: '2026-11-22' });
    assert.equal(res.code, 0);
    assert.deepEqual(res.data, {
      date: '2026-11-22',
      skipped: false,
      totalProcessed: 65,
      sent: 63,
      disabled: 1,
      failed: 1,
    });

    // Verify all sent payloads obey <= 20 char limit on thing1/thing2 and point to today's page
    const sentMsgs = sdk.__test.getSentMessages();
    assert.equal(sentMsgs.length, 65);
    for (const msg of sentMsgs) {
      assert.equal(msg.page, 'pages/today/index?date=2026-11-22');
      assert.ok(msg.data.thing1.value.length <= 20);
      assert.ok(msg.data.thing2.value.length <= 20);
      assert.equal(msg.data.time3.value, '2026年11月22日 08:30');
    }

    // user_002 preferred frontend -> received v0-ui
    const msgUser2 = sentMsgs.find((m) => m.touser === 'user_002');
    assert.ok(msgUser2.data.thing1.value.startsWith('v0-ui'));
    assert.equal(msgUser2.data.thing2.value, '零配置现代前端组件生成工具');

    // user_003 preferred backend-infra (none today) -> fell back to overall Top 1
    const msgUser3 = sentMsgs.find((m) => m.touser === 'user_003');
    assert.ok(msgUser3.data.thing1.value.startsWith('claude-code'));

    // Verify DB mutations
    const u1 = sdk.__test.getById('push_subscriptions', 'user_001');
    assert.equal(u1.remainingCount, 1);
    assert.equal(u1.lastPushedDate, '2026-11-22');

    // 43101 self-healed to 0
    const u4 = sdk.__test.getById('push_subscriptions', 'user_004');
    assert.equal(u4.remainingCount, 0);

    // Transient failure left quota & lastPushedDate untouched
    const u5 = sdk.__test.getById('push_subscriptions', 'user_005');
    assert.equal(u5.remainingCount, 2);
    assert.equal(u5.lastPushedDate, '2026-11-21');

    // Already-pushed user untouched
    const uAlready = sdk.__test.getById('push_subscriptions', 'user_already_pushed');
    assert.equal(uAlready.remainingCount, 3);

    // Re-running on same day only retries user_005 (does NOT double-push the 63 succeeded users!)
    sdk.__test.clearSentMessages();
    sdk.__test.setSendHandler(async () => ({ errCode: 0, errMsg: 'ok' }));
    const retryRes = await fn.main({ date: '2026-11-22' });
    assert.equal(retryRes.code, 0);
    assert.equal(retryRes.data.totalProcessed, 1);
    assert.equal(retryRes.data.sent, 1);
    assert.equal(sdk.__test.getById('push_subscriptions', 'user_005').remainingCount, 1);
    assert.equal(sdk.__test.getById('push_subscriptions', 'user_005').lastPushedDate, '2026-11-22');
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
