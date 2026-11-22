import { describe, expect, it, vi } from 'vitest';
import {
  computeTopCategory,
  generateIssueSummary,
  parseAndValidateRepoAIResponse,
  summarizeRepos,
  summarizeSingleRepo,
} from '../src/aiSummarizer.js';
import type { EnrichedRepo, RepoItem } from '../src/types.js';

function makeEnrichedRepo(overrides: Partial<EnrichedRepo> = {}): EnrichedRepo {
  return {
    _id: 'anthropics__claude-code',
    fullName: 'anthropics/claude-code',
    owner: 'anthropics',
    name: 'claude-code',
    url: 'https://github.com/anthropics/claude-code',
    description: 'Agentic coding tool that lives in your terminal',
    language: 'TypeScript',
    languageColor: '#3178c6',
    stars: 45820,
    starsToday: 1420,
    forks: 3210,
    period: 'daily',
    rank: 1,
    license: 'MIT',
    topics: ['ai-agent', 'cli', 'typescript'],
    readmeExcerpt: 'Claude Code is an agentic coding tool living in your terminal.',
    ...overrides,
  };
}

const VALID_LLM_JSON = JSON.stringify({
  compliant: true,
  category: 'ai-agent',
  tags: ['AI Agent', 'CLI', 'TypeScript'],
  tagline: '终端原生 AI 编程智能体，直接理解代码库并自动改代码',
  whyHot: '打破传统 IDE 插件局限，可在命令行端到端执行检索、编辑、测试与 Git 提交，工程提效显著。',
  highlights: [
    '深度理解整仓上下文，跨文件重构更精准',
    '内置命令执行与测试闭环，自动定位并修复报错',
    '支持 MCP 协议扩展外部工具，融入团队工作流',
  ],
  targetAudience: '追求高效终端工作流的研发工程师与技术团队',
});

describe('aiSummarizer', () => {
  it('validates strict JSON and markdown-fenced JSON responses', () => {
    const repo = makeEnrichedRepo();
    const parsed = parseAndValidateRepoAIResponse(`\`\`\`json\n${VALID_LLM_JSON}\n\`\`\``, repo);

    expect(parsed.category).toBe('ai-agent');
    expect(parsed.tags).toEqual(['AI Agent', 'CLI', 'TypeScript']);
    expect(parsed.ai.aiStatus).toBe('ok');
    expect(parsed.ai.highlights).toHaveLength(3);
  });

  it('requires an explicit boolean compliance decision', () => {
    for (const compliant of [undefined, 'false', null]) {
      const raw = JSON.stringify({ ...JSON.parse(VALID_LLM_JSON), compliant });
      expect(() => parseAndValidateRepoAIResponse(raw, makeEnrichedRepo())).toThrow(/compliant/);
    }
  });

  it('rejects invalid category or insufficient highlights', () => {
    const repo = makeEnrichedRepo();
    expect(() =>
      parseAndValidateRepoAIResponse(
        JSON.stringify({
          compliant: true,
          category: 'invalid-cat',
          tags: ['AI'],
          tagline: '一句话测试',
          whyHot: '测试爆火原因字段长度满足要求的内容',
          highlights: ['亮点一描述足够长', '亮点二描述足够长', '亮点三描述足够长'],
          targetAudience: '所有前端后端开发者',
        }),
        repo,
      ),
    ).toThrow(/Invalid category/);

    expect(() =>
      parseAndValidateRepoAIResponse(
        JSON.stringify({
          compliant: true,
          category: 'ai-agent',
          tags: ['AI', 'CLI'],
          tagline: '一句话测试',
          whyHot: '测试爆火原因字段长度满足要求的内容',
          highlights: ['只有一条亮点描述'],
          targetAudience: '所有前端后端开发者',
        }),
        repo,
      ),
    ).toThrow(/highlights/);
  });

  it('retries 2 times on transient failures and succeeds on the 3rd attempt', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: VALID_LLM_JSON } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const result = await summarizeSingleRepo(makeEnrichedRepo(), {
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: fetchMock,
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.ai.aiStatus).toBe('ok');
    expect(result.category).toBe('ai-agent');
  });

  it('degrades cleanly to aiStatus="fallback" after 2 retries fail without blocking batch', async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      callCount += 1;
      const bodyStr = String(init?.body ?? '');
      if (bodyStr.includes('broken/repo')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"broken": true}' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: VALID_LLM_JSON } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const brokenRepo = makeEnrichedRepo({
      _id: 'broken__repo',
      fullName: 'broken/repo',
      owner: 'broken',
      name: 'repo',
      description: 'Kubernetes ingress proxy and distributed gateway',
      language: 'Go',
      topics: ['kubernetes', 'gateway'],
      readmeExcerpt: 'High-performance Kubernetes ingress gateway written in Go.',
    });
    const okRepo = makeEnrichedRepo();

    const results = await summarizeRepos([brokenRepo, okRepo], {
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      concurrency: 2,
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: fetchMock,
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    // 3 attempts for brokenRepo + 1 attempt for okRepo
    expect(callCount).toBe(4);

    const brokenSummary = results.get('broken__repo');
    const okSummary = results.get('anthropics__claude-code');

    expect(brokenSummary?.ai.aiStatus).toBe('fallback');
    expect(brokenSummary?.category).toBe('backend-infra');
    expect(brokenSummary?.tags.length).toBeGreaterThanOrEqual(2);
    expect(brokenSummary?.ai.highlights).toHaveLength(3);

    expect(okSummary?.ai.aiStatus).toBe('ok');
    expect(okSummary?.category).toBe('ai-agent');
  });

  it('computes topCategory and generates fallback issue summary when LLM is skipped or fails', async () => {
    const sampleItems: RepoItem[] = [
      {
        ...makeEnrichedRepo(),
        category: 'ai-agent',
        tags: ['AI Agent', 'CLI'],
        ai: {
          tagline: '终端 AI 编程工具',
          whyHot: '近期热度极高的终端编程智能体项目',
          highlights: ['亮点一描述文本', '亮点二描述文本', '亮点三描述文本'],
          targetAudience: '工程师',
          aiStatus: 'ok',
        },
        latestDate: '2026-11-22',
        updatedAt: '2026-11-22T00:00:00.000Z',
      },
      {
        ...makeEnrichedRepo({ _id: 'a__b', owner: 'a', name: 'b', fullName: 'a/b', starsToday: 500 }),
        category: 'frontend',
        tags: ['React', 'UI'],
        ai: {
          tagline: '前端组件库',
          whyHot: '极简高性能组件库',
          highlights: ['亮点一描述文本', '亮点二描述文本', '亮点三描述文本'],
          targetAudience: '前端开发者',
          aiStatus: 'ok',
        },
        latestDate: '2026-11-22',
        updatedAt: '2026-11-22T00:00:00.000Z',
      },
    ];

    expect(computeTopCategory(sampleItems)).toBe('ai-agent');

    const issueSummary = await generateIssueSummary('2026-11-22', 'daily', sampleItems, {
      skipAI: true,
    });
    expect(issueSummary.topCategory).toBe('ai-agent');
    expect(issueSummary.summary.length).toBeGreaterThanOrEqual(15);
    expect(issueSummary.summary.length).toBeLessThanOrEqual(48);
  });
});
