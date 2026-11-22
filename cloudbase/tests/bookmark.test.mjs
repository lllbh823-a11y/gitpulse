import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMockWxSdk, loadCloudFunction, makeSampleRepo } = require('./helpers/mockWxSdk');

test('bookmark requires OPENID and isolates toggle & list per user', async () => {
  const sdk = createMockWxSdk({ openid: '' });
  const fn = loadCloudFunction('bookmark', sdk);

  const unauthRes = await fn.main({ action: 'list' });
  assert.equal(unauthRes.code, 401);

  sdk.__test.seed('repos', [
    makeSampleRepo({ owner: 'a', name: 'one' }),
    makeSampleRepo({ owner: 'b', name: 'two' }),
    makeSampleRepo({ owner: 'c', name: 'three' }),
  ]);

  // User 1 toggles on a__one and b__two
  sdk.__test.setOpenId('openid-u1');
  const t1 = await fn.main({ action: 'toggle', repoId: 'A__ONE' });
  assert.equal(t1.code, 0);
  assert.deepEqual(t1.data, { bookmarked: true });

  // Wait 2ms so createdAt ordering is strictly deterministic
  await new Promise((r) => setTimeout(r, 5));
  const t2 = await fn.main({ action: 'toggle', repoId: 'b__two' });
  assert.equal(t2.code, 0);
  assert.deepEqual(t2.data, { bookmarked: true });

  // User 2 toggles on c__three
  sdk.__test.setOpenId('openid-u2');
  const t3 = await fn.main({ action: 'toggle', repoId: 'c__three' });
  assert.equal(t3.code, 0);
  assert.deepEqual(t3.data, { bookmarked: true });

  // User 1 lists bookmarks -> ordered by createdAt DESC (b__two then a__one), isolated from user 2
  sdk.__test.setOpenId('openid-u1');
  const listPage1 = await fn.main({ action: 'list', page: 1, pageSize: 1 });
  assert.equal(listPage1.code, 0);
  assert.equal(listPage1.data.total, 2);
  assert.equal(listPage1.data.hasMore, true);
  assert.deepEqual(
    listPage1.data.items.map((r) => r._id),
    ['b__two']
  );

  const listPage2 = await fn.main({ action: 'list', page: 2, pageSize: 1 });
  assert.equal(listPage2.code, 0);
  assert.equal(listPage2.data.hasMore, false);
  assert.deepEqual(
    listPage2.data.items.map((r) => r._id),
    ['a__one']
  );

  // User 1 toggles off b__two
  const tOff = await fn.main({ action: 'toggle', repoId: 'b__two' });
  assert.equal(tOff.code, 0);
  assert.deepEqual(tOff.data, { bookmarked: false });

  const afterRemove = await fn.main({ action: 'list' });
  assert.equal(afterRemove.data.total, 1);
  assert.deepEqual(
    afterRemove.data.items.map((r) => r._id),
    ['a__one']
  );

  // Invalid inputs -> 400
  const badAction = await fn.main({ action: 'deleteAll' });
  assert.equal(badAction.code, 400);
  const emptyId = await fn.main({ action: 'toggle', repoId: '   ' });
  assert.equal(emptyId.code, 400);
});
