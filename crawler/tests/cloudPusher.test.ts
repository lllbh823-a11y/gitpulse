import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  computeHmacSignature,
  createSignedHeaders,
  pushIssueToCloud,
} from '../src/cloudPusher.js';
import type { IngestIssueRequest } from '../src/types.js';

const SAMPLE_INGEST_PAYLOAD: IngestIssueRequest = {
  date: '2026-11-22',
  period: 'daily',
  summary: '今日热榜聚焦 AI Agent 与终端工程提效，多款开源工具持续领跑。',
  topCategory: 'ai-agent',
  repos: [
    {
      _id: 'anthropics__claude-code',
      fullName: 'anthropics/claude-code',
      owner: 'anthropics',
      name: 'claude-code',
      url: 'https://github.com/anthropics/claude-code',
      description: 'Agentic coding tool',
      language: 'TypeScript',
      languageColor: '#3178c6',
      stars: 45820,
      starsToday: 1420,
      forks: 3210,
      license: 'MIT',
      category: 'ai-agent',
      tags: ['AI Agent', 'CLI', 'TypeScript'],
      ai: {
        tagline: '终端原生 AI 编程智能体',
        whyHot: '端到端理解整仓代码并直接执行测试修复闭环。',
        highlights: ['整仓上下文理解', '自动运行命令验证', '支持 MCP 扩展'],
        targetAudience: '全栈与后端开发者',
        aiStatus: 'ok',
      },
      latestDate: '2026-11-22',
      updatedAt: '2026-11-22T00:00:00.000Z',
    },
  ],
};

describe('cloudPusher', () => {
  it('computes HMAC-SHA256 hex signature matching Section 5.3 specification', () => {
    const secret = 'super-secret-key';
    const rawBody = '{"hello":"world"}';
    const ts = 1795320000;

    const headers = createSignedHeaders(rawBody, secret, ts);
    const expected = createHmac('sha256', secret)
      .update(`${ts}.${rawBody}`, 'utf8')
      .digest('hex');

    expect(headers['x-gitpulse-timestamp']).toBe('1795320000');
    expect(headers['x-gitpulse-signature']).toBe(expected);
    expect(computeHmacSignature('1795320000', rawBody, secret)).toBe(expected);
  });

  it('POSTs signed raw body and parses CloudResponse data', async () => {
    const secret = 'test-ingest-secret';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            issueId: '2026-11-22_daily',
            issueNo: 12,
            upsertedRepos: 1,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const data = await pushIssueToCloud(SAMPLE_INGEST_PAYLOAD, {
      ingestUrl: 'https://cloudbase.example.com/ingestIssue',
      ingestSecret: secret,
      nowSeconds: () => 1795321234,
      fetchImpl: fetchMock,
    });

    expect(data).toEqual({
      issueId: '2026-11-22_daily',
      issueNo: 12,
      upsertedRepos: 1,
    });

    const expectedSig = computeHmacSignature('1795321234', capturedBody, secret);
    expect(capturedHeaders['x-gitpulse-timestamp']).toBe('1795321234');
    expect(capturedHeaders['x-gitpulse-signature']).toBe(expectedSig);
    expect(JSON.parse(capturedBody)).toEqual(SAMPLE_INGEST_PAYLOAD);
  });

  it('reports an entirely filtered issue without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 422 }), { status: 422 }));
    await expect(pushIssueToCloud(SAMPLE_INGEST_PAYLOAD, {
      ingestUrl: 'https://example.invalid', ingestSecret: 'test', fetchImpl: fetchMock,
    })).rejects.toThrow(/复核/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry HTTP 401 signature failure and retries transient HTTP 502', async () => {
    const unauthorizedFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ code: 401, message: 'invalid signature' }), { status: 401 }),
    );

    await expect(
      pushIssueToCloud(SAMPLE_INGEST_PAYLOAD, {
        ingestUrl: 'https://cloudbase.example.com/ingestIssue',
        ingestSecret: 'wrong',
        maxRetries: 2,
        retryDelayMs: 1,
        fetchImpl: unauthorizedFetch,
      }),
    ).rejects.toThrow(/HTTP 401/);
    expect(unauthorizedFetch).toHaveBeenCalledTimes(1);

    const flakyFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            data: { issueId: '2026-11-22_daily', issueNo: 1, upsertedRepos: 1 },
          }),
          { status: 200 },
        ),
      );

    const recovered = await pushIssueToCloud(SAMPLE_INGEST_PAYLOAD, {
      ingestUrl: 'https://cloudbase.example.com/ingestIssue',
      ingestSecret: 'ok',
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: flakyFetch,
    });
    expect(flakyFetch).toHaveBeenCalledTimes(2);
    expect(recovered.issueNo).toBe(1);
  });

  it('supports CloudBase HTTP API gateway envelope with Bearer token and HTTP 200 code 422', async () => {
    const secret = 'gateway-secret';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    const gatewayFetch = vi.fn<typeof fetch>(async (_url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: { issueId: '2026-11-22_daily', issueNo: 1, upsertedRepos: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await pushIssueToCloud(SAMPLE_INGEST_PAYLOAD, {
      ingestUrl: 'https://cloud1-demo.api.tcloudbasegateway.com/v1/functions/ingestIssue',
      ingestSecret: secret,
      apiKey: 'test-api-key-jwt',
      nowSeconds: () => 1795321234,
      fetchImpl: gatewayFetch,
    });

    expect(res.issueNo).toBe(1);
    expect(capturedHeaders.Authorization).toBe('Bearer test-api-key-jwt');
    expect(capturedHeaders['x-gitpulse-signature']).toBeUndefined();

    const envelope = JSON.parse(capturedBody) as {
      headers: Record<string, string>;
      rawBody: string;
    };
    expect(envelope.headers['x-gitpulse-timestamp']).toBe('1795321234');
    expect(envelope.headers['x-gitpulse-signature']).toBe(
      computeHmacSignature('1795321234', envelope.rawBody, secret),
    );
    expect(JSON.parse(envelope.rawBody)).toEqual(SAMPLE_INGEST_PAYLOAD);

    const filteredGatewayFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ code: 422, message: 'filtered' }), { status: 200 }),
    );
    await expect(
      pushIssueToCloud(SAMPLE_INGEST_PAYLOAD, {
        ingestUrl: 'https://cloud1-demo.api.tcloudbasegateway.com/v1/functions/ingestIssue',
        ingestSecret: secret,
        apiKey: 'test-api-key-jwt',
        fetchImpl: filteredGatewayFetch,
      }),
    ).rejects.toThrow(/复核/);
    expect(filteredGatewayFetch).toHaveBeenCalledTimes(1);
  });
});
