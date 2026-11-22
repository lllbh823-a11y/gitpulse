import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLOUDBASE_ROOT = path.resolve(__dirname, '..');

const EXPECTED_FUNCTIONS = [
  'ingestIssue',
  'getDailyIssue',
  'searchRepos',
  'bookmark',
  'subscription',
  'sendDailyPush',
];

const EXPECTED_COLLECTIONS = [
  'daily_issues',
  'repos',
  'user_bookmarks',
  'push_subscriptions',
  'moderation_pending',
];

test('cloudbaserc.json parses cleanly and declares all 6 functions', () => {
  const rcPath = path.join(CLOUDBASE_ROOT, 'cloudbaserc.json');
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
  assert.equal(rc.functionRoot, './cloudfunctions');
  assert.ok(Array.isArray(rc.functions));

  const names = rc.functions.map((f) => f.name);
  assert.deepEqual(names, EXPECTED_FUNCTIONS);

  const pushFn = rc.functions.find((f) => f.name === 'sendDailyPush');
  assert.ok(pushFn.triggers && pushFn.triggers.length === 1);
  assert.equal(pushFn.triggers[0].config, '0 30 8 * * * *');
});

test('database/collections.json declares all 5 collections with ADMINONLY permissions and indexes', () => {
  const schemaPath = path.join(CLOUDBASE_ROOT, 'database', 'collections.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.ok(Array.isArray(schema.collections));

  const names = schema.collections.map((c) => c.collectionName);
  assert.deepEqual(names, EXPECTED_COLLECTIONS);

  for (const col of schema.collections) {
    assert.equal(col.aclTag, 'ADMINONLY');
    assert.deepEqual(col.securityRule, { read: false, write: false });
    assert.ok(Array.isArray(col.indexes) && col.indexes.length >= 1);
  }
});

test('every cloud function directory is self-contained with valid package.json, config.json, and no cross-directory requires', () => {
  for (const fnName of EXPECTED_FUNCTIONS) {
    const fnDir = path.join(CLOUDBASE_ROOT, 'cloudfunctions', fnName);
    const pkgPath = path.join(fnDir, 'package.json');
    const cfgPath = path.join(fnDir, 'config.json');
    const entryPath = path.join(fnDir, 'index.js');

    assert.ok(fs.existsSync(pkgPath), `Missing package.json in ${fnName}`);
    assert.ok(fs.existsSync(cfgPath), `Missing config.json in ${fnName}`);
    assert.ok(fs.existsSync(entryPath), `Missing index.js in ${fnName}`);

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.main, 'index.js');
    assert.ok(pkg.dependencies && pkg.dependencies['wx-server-sdk'], `${fnName} must depend on wx-server-sdk`);

    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.ok(cfg.permissions && Array.isArray(cfg.permissions.openapi));

    if (fnName === 'ingestIssue') {
      assert.ok(cfg.permissions.openapi.includes('security.msgSecCheck'));
    }

    if (fnName === 'sendDailyPush') {
      assert.ok(cfg.permissions.openapi.includes('subscribeMessage.send'));
      assert.ok(Array.isArray(cfg.triggers) && cfg.triggers.length === 1);
      assert.equal(cfg.triggers[0].type, 'timer');
      assert.equal(cfg.triggers[0].config, '0 30 8 * * * *');
    }

    const source = fs.readFileSync(entryPath, 'utf8');
    // Forbid cross-directory relative require('../...') that breaks standalone CloudBase uploads
    const crossDirRequire = /require\s*\(\s*['"]\.\.\//;
    assert.equal(
      crossDirRequire.test(source),
      false,
      `${fnName}/index.js must not have cross-directory relative require()`
    );
  }
});
