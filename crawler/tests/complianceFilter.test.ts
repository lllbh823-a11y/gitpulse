import { describe, expect, it, vi } from 'vitest';
import { parseAndValidateRepoAIResponse } from '../src/aiSummarizer.js';
import {
  evaluateRepoCompliance,
  evaluateTextCompliance,
  filterCompliantRepos,
} from '../src/complianceFilter.js';
import { parseCliArgs, runPipeline } from '../src/index.js';

describe('complianceFilter', () => {
  it('blocks circumvention, crack/malware, adult/gambling, and politically sensitive repositories', () => {
    const blockedSamples = [
      {
        fullName: 'SagerNet/sing-box',
        owner: 'SagerNet',
        name: 'sing-box',
        description: 'The universal proxy platform',
        topics: ['proxy', 'vless', 'vmess'],
        expectedCategory: 'circumvention',
      },
      {
        fullName: 'clash-verge-rev/clash-verge-rev',
        owner: 'clash-verge-rev',
        name: 'clash-verge-rev',
        description: 'A modern Clash Meta GUI client',
        topics: ['clash', 'mihomo'],
        expectedCategory: 'circumvention',
      },
      {
        fullName: 'massgravel/windows-activator',
        owner: 'massgravel',
        name: 'windows-activator',
        description: 'KMS activator and keygen tool',
        topics: ['activator', 'crack'],
        expectedCategory: 'security-abuse',
      },
      {
        fullName: 'demo/nsfw-scraper',
        owner: 'demo',
        name: 'nsfw-scraper',
        description: 'Scrape adult videos from sites',
        topics: ['nsfw'],
        expectedCategory: 'adult-gambling',
      },
      {
        fullName: 'demo/anti-censorship-kit',
        owner: 'demo',
        name: 'anti-censorship-kit',
        description: 'Bypass Great Firewall anti-censorship guide',
        topics: ['anti-censorship'],
        expectedCategory: 'sensitive-politics',
      },
    ];

    for (const sample of blockedSamples) {
      const decision = evaluateRepoCompliance(sample);
      expect(decision.allowed, `Expected ${sample.fullName} to be blocked`).toBe(false);
      expect(decision.category).toBe(sample.expectedCategory);
      expect(decision.reason).toBeTruthy();
    }
  });

  it('allows legitimate infrastructure, reverse proxy, AI, and developer tools without false positives', () => {
    const cleanSamples = [
      { fullName: 'nginx/nginx', name: 'nginx', owner: 'nginx', description: 'Reverse proxy with VPN integration' },
      {
        fullName: 'traefik/traefik',
        owner: 'traefik',
        name: 'traefik',
        description: 'The Cloud Native Application Proxy and Reverse Proxy',
        topics: ['reverse-proxy', 'kubernetes', 'load-balancer'],
        readmeExcerpt: 'Traefik is a modern HTTP reverse proxy and load balancer.',
      },
      {
        fullName: 'envoyproxy/envoy',
        owner: 'envoyproxy',
        name: 'envoy',
        description: 'Cloud-native high-performance edge/middle/service proxy',
        topics: ['proxy', 'service-mesh', 'cpp'],
        readmeExcerpt: 'Envoy is an L7 proxy and communication bus for microservices.',
      },
      {
        fullName: 'anthropics/claude-code',
        owner: 'anthropics',
        name: 'claude-code',
        description: 'An agentic coding tool that lives in your terminal',
        topics: ['ai', 'agent', 'cli'],
        readmeExcerpt: 'Claude Code helps engineers understand codebases and automate workflows.',
      },
      {
        fullName: 'deepseek-ai/DeepSeek-V3',
        owner: 'deepseek-ai',
        name: 'DeepSeek-V3',
        description: 'Open-source MoE foundation model',
        topics: ['llm', 'moe', 'ai'],
        readmeExcerpt: 'DeepSeek-V3 is a strong Mixture-of-Experts language model.',
      },
    ];

    for (const sample of cleanSamples) {
      const decision = evaluateRepoCompliance(sample);
      expect(decision.allowed, `Expected ${sample.fullName} to be allowed`).toBe(true);
    }
  });

  it('supports custom extra blocklist and explicit allowlist overrides', () => {
    const repo = {
      fullName: 'acme/custom-tool',
      owner: 'acme',
      name: 'custom-tool',
      description: 'Includes ForbiddenVendorKeyword inside description',
    };

    const blocked = evaluateRepoCompliance(repo, {
      extraBlocklist: ['ForbiddenVendorKeyword'],
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.category).toBe('custom-blocklist');

    const overridden = evaluateRepoCompliance(repo, {
      extraBlocklist: ['ForbiddenVendorKeyword'],
      allowlist: ['acme/custom-tool'],
    });
    expect(overridden.allowed).toBe(false);
  });

  it('limits exceptions to the named metadata rule and scans generated English terms', () => {
    const repo = { fullName: 'acme/xray', owner: 'acme', name: 'xray', description: 'Industrial imaging' };
    const options = { allowlist: ['acme/xray#circumvention-clash-vpn-meta'] };
    expect(evaluateRepoCompliance(repo).allowed).toBe(false);
    expect(evaluateRepoCompliance(repo, options).allowed).toBe(true);
    const ai = { tagline: 'Includes keygen', whyHot: '', highlights: [], targetAudience: '', aiStatus: 'ok' as const };
    expect(evaluateRepoCompliance({ ...repo, ai }, options).allowed).toBe(false);
    expect(evaluateTextCompliance(ai.tagline).allowed).toBe(false);
  });

  it('detects non-compliant Chinese issue summary text', () => {
    expect(evaluateTextCompliance('今日开源热榜聚焦 AI Agent 与 Rust 基础设施。').allowed).toBe(true);
    expect(evaluateTextCompliance('今日热榜推荐免费节点与科学上网工具。').allowed).toBe(false);
  });

  it('parses AI compliance rejection flag cleanly even when summary fields are omitted', () => {
    const parsed = parseAndValidateRepoAIResponse(
      JSON.stringify({
        compliant: false,
        complianceReason: '该项目为跨境代理翻墙客户端工具，不适宜公开展示',
      }),
      {
        fullName: 'demo/obscure-tunnel',
        language: 'Go',
        description: 'Tunnel tool',
        topics: [],
      },
    );
    expect(parsed.compliance?.allowed).toBe(false);
    expect(parsed.compliance?.category).toBe('ai-flagged');
    expect(parsed.compliance?.reason).toContain('翻墙');
  });

  it('filters out blocked repos end-to-end inside runPipeline (both pre-AI and AI-flagged)', async () => {
    const mixedHtml = `
      <article class="Box-row">
        <h2><a href="/vercel/ai">vercel / ai</a></h2>
        <p>Build AI-powered applications with TypeScript</p>
        <div>
          <span itemprop="programmingLanguage">TypeScript</span>
          <a href="/vercel/ai/stargazers">12,000</a>
          <a href="/vercel/ai/forks">1,200</a>
          <span class="d-inline-block float-sm-right">400 stars today</span>
        </div>
      </article>
      <article class="Box-row">
        <h2><a href="/SagerNet/sing-box">SagerNet / sing-box</a></h2>
        <p>The universal proxy platform</p>
        <div>
          <span itemprop="programmingLanguage">Go</span>
          <a href="/SagerNet/sing-box/stargazers">20,000</a>
          <a href="/SagerNet/sing-box/forks">2,000</a>
          <span class="d-inline-block float-sm-right">300 stars today</span>
        </div>
      </article>
      <article class="Box-row">
        <h2><a href="/demo/hidden-risk">demo / hidden-risk</a></h2>
        <p>Opaque utility tool</p>
        <div>
          <span itemprop="programmingLanguage">Python</span>
          <a href="/demo/hidden-risk/stargazers">500</a>
          <a href="/demo/hidden-risk/forks">50</a>
          <span class="d-inline-block float-sm-right">120 stars today</span>
        </div>
      </article>
    `;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://github.com/trending')) {
        return new Response(mixedHtml, { status: 200 });
      }
      if (url.endsWith('/readme')) {
        return new Response('# Readme', { status: 200 });
      }
      if (url.includes('/repos/')) {
        return new Response(
          JSON.stringify({
            description: 'Repo description',
            language: 'TypeScript',
            stargazers_count: 1000,
            forks_count: 100,
            topics: [],
            license: { spdx_id: 'MIT' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/chat/completions')) {
        const reqBody = String(init?.body ?? '');
        if (reqBody.includes('demo/hidden-risk')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      compliant: false,
                      complianceReason: '经审查属于违规灰产脚本工具',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (reqBody.includes('代表项目')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: '今日开源趋势聚焦 AI 应用开发工具链与 TypeScript 生态。',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    compliant: true,
                    complianceReason: '',
                    category: 'ai-agent',
                    tags: ['AI', 'TypeScript', 'SDK'],
                    tagline: 'TypeScript 全栈 AI 应用开发工具包，统一多模型接入体验',
                    whyHot: '统一主流大模型流式接口与结构化输出能力，显著降低前端与全栈团队构建 AI 应用的门槛。',
                    highlights: [
                      '提供跨模型厂商的统一流式生成与工具调用接口',
                      '原生适配 React、Next.js 与现代 TypeScript 工程',
                      '支持结构化 JSON 输出与多步 Agent 编排能力',
                    ],
                    targetAudience: '构建 AI 应用的 TypeScript 全栈与前端工程师',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const cli = parseCliArgs(['--dry-run', '--periods', 'daily', '--date', '2026-11-22']);
    const result = await runPipeline(
      { ...cli, outPath: undefined },
      {
        LLM_BASE_URL: 'https://api.deepseek.com/v1',
        LLM_API_KEY: 'test-key',
        LLM_MODEL: 'deepseek-chat',
      },
      {
        fetchImpl: fetchMock,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    );

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]?.repos.map((r) => r.fullName)).toEqual(['vercel/ai']);
    expect(result.blockedRepos).toHaveLength(2);
    expect(result.blockedRepos.find((b) => b.fullName === 'SagerNet/sing-box')?.stage).toBe('pre-ai');
    expect(result.blockedRepos.find((b) => b.fullName === 'demo/hidden-risk')?.stage).toBe('post-ai');
  });

  it('partitions allowed and blocked lists cleanly with filterCompliantRepos', () => {
    const { allowed, blocked } = filterCompliantRepos([
      { fullName: 'vuejs/core', owner: 'vuejs', name: 'core', description: 'Vue.js framework' },
      { fullName: 'v2fly/v2ray-core', owner: 'v2fly', name: 'v2ray-core', description: 'Proxy platform' },
    ]);
    expect(allowed).toHaveLength(1);
    expect(allowed[0]?.fullName).toBe('vuejs/core');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.repo.fullName).toBe('v2fly/v2ray-core');
  });
});
