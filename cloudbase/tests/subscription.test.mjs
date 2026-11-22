import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMockWxSdk, loadCloudFunction } = require('./helpers/mockWxSdk');

test('subscription manages get, capped increment (1~3), and updatePreference per OPENID', async () => {
  const prevTpl = process.env.SUBSCRIBE_TEMPLATE_ID;
  process.env.SUBSCRIBE_TEMPLATE_ID = 'default-tpl-id';

  try {
    const sdk = createMockWxSdk({ openid: '' });
    const fn = loadCloudFunction('subscription', sdk);

    // Missing OPENID -> 401
    const unauth = await fn.main({ action: 'get' });
    assert.equal(unauth.code, 401);

    sdk.__test.setOpenId('sub-user-1');

    // 1. Default get before any record exists
    const initial = await fn.main({ action: 'get' });
    assert.equal(initial.code, 0);
    assert.deepEqual(initial.data, {
      remainingCount: 0,
      preferredCategory: 'all',
      lastPushedDate: null,
      templateId: 'default-tpl-id',
    });

    // 2. Increment with default delta (=1)
    const inc1 = await fn.main({ action: 'increment' });
    assert.equal(inc1.code, 0);
    assert.equal(inc1.data.remainingCount, 1);
    assert.equal(inc1.data.templateId, 'default-tpl-id');

    // 3. Increment with delta > 3 is strictly capped to 3
    const incCapped = await fn.main({
      action: 'increment',
      delta: 10,
      templateId: 'custom-tpl-999',
    });
    assert.equal(incCapped.code, 0);
    assert.equal(incCapped.data.remainingCount, 4); // 1 + 3
    assert.equal(incCapped.data.templateId, 'custom-tpl-999');

    // 4. Reject delta <= 0 with 400
    const badDeltaZero = await fn.main({ action: 'increment', delta: 0 });
    assert.equal(badDeltaZero.code, 400);
    const badDeltaNeg = await fn.main({ action: 'increment', delta: -2 });
    assert.equal(badDeltaNeg.code, 400);

    // 5. Update preferredCategory preserves remainingCount and templateId
    const prefRes = await fn.main({
      action: 'updatePreference',
      preferredCategory: 'ai-agent',
    });
    assert.equal(prefRes.code, 0);
    assert.deepEqual(prefRes.data, {
      remainingCount: 4,
      preferredCategory: 'ai-agent',
      lastPushedDate: null,
      templateId: 'custom-tpl-999',
    });

    // 6. Invalid preferredCategory -> 400
    const badPref = await fn.main({
      action: 'updatePreference',
      preferredCategory: 'not-a-category',
    });
    assert.equal(badPref.code, 400);

    // 7. New user updating preference first creates record with remainingCount 0
    sdk.__test.setOpenId('sub-user-2');
    const prefFirst = await fn.main({
      action: 'updatePreference',
      preferredCategory: 'open-models',
    });
    assert.equal(prefFirst.code, 0);
    assert.deepEqual(prefFirst.data, {
      remainingCount: 0,
      preferredCategory: 'open-models',
      lastPushedDate: null,
      templateId: 'default-tpl-id',
    });
  } finally {
    if (prevTpl === undefined) delete process.env.SUBSCRIBE_TEMPLATE_ID;
    else process.env.SUBSCRIBE_TEMPLATE_ID = prevTpl;
  }
});
