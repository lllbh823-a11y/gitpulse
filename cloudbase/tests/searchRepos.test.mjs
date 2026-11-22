import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMockWxSdk, loadCloudFunction, makeSampleRepo } = require('./helpers/mockWxSdk');

test('searchRepos supports keyword (with regex escaping), category, language, pagination, and bookmarkedIds', async () => {
  const sdk = createMockWxSdk({ openid: 'search-user' });
  const fn = loadCloudFunction('searchRepos', sdk);

  sdk.__test.seed('repos', [
    makeSampleRepo({
      owner: 'ggml-org',
      name: 'llama.cpp',
      category: 'open-models',
      language: 'C++',
      tags: ['LLM', 'C++', '本地推理'],
      starsToday: 900,
      latestDate: '2026-11-22',
      ai: {
        tagline: '纯 C++ 实现的大模型本地量化推理引擎',
        whyHot: '消费级笔记本即可流畅运行开源大模型。',
        highlights: ['零外部依赖', '支持 Apple Silicon', '多量化格式'],
        targetAudience: 'AI 工程师',
        aiStatus: 'ok',
      },
    }),
    makeSampleRepo({
      owner: 'vercel',
      name: 'next.js',
      category: 'frontend',
      language: 'TypeScript',
      tags: ['React', 'SSR'],
      starsToday: 600,
      latestDate: '2026-11-22',
      ai: {
        tagline: 'React 全栈 Web 应用框架',
        whyHot: '持续引领现代 React 服务端渲染生态。',
        highlights: ['App Router', 'Turbopack', '边缘部署'],
        targetAudience: '前端开发者',
        aiStatus: 'ok',
      },
    }),
    makeSampleRepo({
      owner: 'anthropics',
      name: 'claude-code',
      category: 'ai-agent',
      language: 'TypeScript',
      tags: ['AI Agent', 'CLI'],
      starsToday: 1500,
      latestDate: '2026-11-22',
    }),
    makeSampleRepo({
      owner: 'astral-sh',
      name: 'uv',
      category: 'dev-tools',
      language: 'Rust',
      tags: ['Python', '包管理'],
      starsToday: 700,
      latestDate: '2026-11-21',
    }),
  ]);

  sdk.__test.seed('user_bookmarks', [
    { openid: 'search-user', repoId: 'ggml-org__llama.cpp', createdAt: '2026-11-22T01:00:00.000Z' },
  ]);

  // 1. Keyword with regex special characters ("c++") matches llama.cpp safely
  const cppRes = await fn.main({ keyword: 'c++' });
  assert.equal(cppRes.code, 0);
  assert.equal(cppRes.data.total, 1);
  assert.equal(cppRes.data.items[0]._id, 'ggml-org__llama.cpp');
  assert.deepEqual(cppRes.data.bookmarkedIds, ['ggml-org__llama.cpp']);

  // 2. Language filter (case-insensitive) + category filter
  const tsFrontend = await fn.main({ language: 'typescript', category: 'frontend' });
  assert.equal(tsFrontend.code, 0);
  assert.equal(tsFrontend.data.total, 1);
  assert.equal(tsFrontend.data.items[0]._id, 'vercel__next.js');

  // 3. Pagination & sort order (latestDate DESC, starsToday DESC)
  const page1 = await fn.main({ page: 1, pageSize: 2 });
  assert.equal(page1.code, 0);
  assert.equal(page1.data.total, 4);
  assert.equal(page1.data.hasMore, true);
  assert.deepEqual(
    page1.data.items.map((i) => i._id),
    ['anthropics__claude-code', 'ggml-org__llama.cpp']
  );

  const page2 = await fn.main({ page: 2, pageSize: 2 });
  assert.equal(page2.code, 0);
  assert.equal(page2.data.hasMore, false);
  assert.deepEqual(
    page2.data.items.map((i) => i._id),
    ['vercel__next.js', 'astral-sh__uv']
  );

  // 4. Keyword matches Chinese ai.tagline & language="全部" acts as unfiltered + pageSize capped at 30
  const zhRes = await fn.main({ keyword: '量化推理', language: '全部', pageSize: 99 });
  assert.equal(zhRes.code, 0);
  assert.equal(zhRes.data.total, 1);
  assert.equal(zhRes.data.items[0]._id, 'ggml-org__llama.cpp');

  // 5. Invalid category returns 400
  const badCat = await fn.main({ category: 'invalid-cat' });
  assert.equal(badCat.code, 400);
});
