import { describe, expect, it } from 'vitest';
import { generateJsonFeed, generateRssXml } from '../src/feedGenerator.js';
import type { SnapshotPayload } from '../src/types.js';

const SAMPLE_SNAPSHOT: SnapshotPayload = {
  generatedAt: '2026-11-22T07:35:00+08:00',
  availableDates: ['2026-11-22', '2026-11-21'],
  issues: {
    '2026-11-22_daily': {
      _id: '2026-11-22_daily',
      date: '2026-11-22',
      period: 'daily',
      issueNo: 42,
      summary: '今日 AI Agent 与前端工具链双双领跑。',
      topCategory: 'ai-agent',
      repoIds: ['acme__alpha-agent', 'acme__beta-ui'],
      publishedAt: '2026-11-22T07:35:00+08:00',
    },
    '2026-11-21_daily': {
      _id: '2026-11-21_daily',
      date: '2026-11-21',
      period: 'daily',
      issueNo: 41,
      summary: '昨日开源基础设施表现抢眼。',
      topCategory: 'dev-tools',
      repoIds: ['acme__alpha-agent', 'acme__gamma-cli'],
      publishedAt: '2026-11-21T07:35:00+08:00',
    },
  },
  repos: {
    'acme__alpha-agent': {
      _id: 'acme__alpha-agent',
      fullName: 'acme/alpha-agent',
      owner: 'acme',
      name: 'alpha-agent',
      url: 'https://github.com/acme/alpha-agent',
      description: 'Fast & safe <agent> orchestrator',
      language: 'TypeScript',
      languageColor: '#3178C6',
      stars: 12400,
      starsToday: 1520,
      forks: 800,
      license: 'MIT',
      category: 'ai-agent',
      tags: ['AI & Agent', 'CLI'],
      ai: {
        tagline: '支持沙箱隔离的轻量多代理编排器',
        whyHot: '大幅降低并行编码冲突 & 提升 CI 稳定性。',
        highlights: ['亮点一', '亮点二', '亮点三'],
        targetAudience: '中大型仓库研发团队',
        aiStatus: 'ok',
      },
      latestDate: '2026-11-22',
      updatedAt: '2026-11-22T07:35:00+08:00',
    },
    'acme__beta-ui': {
      _id: 'acme__beta-ui',
      fullName: 'acme/beta-ui',
      owner: 'acme',
      name: 'beta-ui',
      url: 'https://github.com/acme/beta-ui',
      description: 'Zero-runtime UI kit',
      language: 'TypeScript',
      languageColor: '#3178C6',
      stars: 5200,
      starsToday: 620,
      forks: 210,
      license: 'MIT',
      category: 'frontend',
      tags: ['组件库', 'CSS'],
      ai: {
        tagline: '基于原生 CSS 能力的新一代无障碍组件库',
        whyHot: '零运行时开销，首屏体积更小。',
        highlights: ['无障碍优先', '原生 Popover', '主题令牌'],
        targetAudience: '前端开发者',
        aiStatus: 'ok',
      },
      latestDate: '2026-11-22',
      updatedAt: '2026-11-22T07:35:00+08:00',
    },
    'acme__gamma-cli': {
      _id: 'acme__gamma-cli',
      fullName: 'acme/gamma-cli',
      owner: 'acme',
      name: 'gamma-cli',
      url: 'https://github.com/acme/gamma-cli',
      description: 'Rust CLI helper',
      language: 'Rust',
      languageColor: '#DEA584',
      stars: 3100,
      starsToday: 410,
      forks: 120,
      license: 'Apache-2.0',
      category: 'dev-tools',
      tags: ['Rust', 'CLI'],
      ai: {
        tagline: '用 Rust 编写的极速命令行辅助工具',
        whyHot: '单二进制零依赖，秒级启动。',
        highlights: ['单二进制', '跨平台', '低内存'],
        targetAudience: '全栈与运维工程师',
        aiStatus: 'ok',
      },
      latestDate: '2026-11-21',
      updatedAt: '2026-11-21T07:35:00+08:00',
    },
  },
};

describe('feedGenerator', () => {
  it('generates valid RSS 2.0 XML with deduplicated recent items and XML escaping', () => {
    const xml = generateRssXml(SAMPLE_SNAPSHOT, {
      siteUrl: 'https://demo.github.io/gitpulse/',
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('href="https://demo.github.io/gitpulse/rss.xml"');
    expect(xml).toContain('https://demo.github.io/gitpulse/#/pages/detail/index?id=acme__alpha-agent');
    expect(xml).toContain('&amp;');

    // acme__alpha-agent appears in both daily issues but must only be emitted once (from latest issue #42)
    const itemMatches = xml.match(/<item>/g) ?? [];
    expect(itemMatches).toHaveLength(3);
    expect(xml).toContain('gitpulse:2026-11-22:acme__alpha-agent');
    expect(xml).not.toContain('gitpulse:2026-11-21:acme__alpha-agent');
  });

  it('generates valid JSON Feed 1.1 document respecting maxItems', () => {
    const feed = generateJsonFeed(SAMPLE_SNAPSHOT, {
      siteUrl: 'https://demo.github.io/gitpulse',
      maxItems: 2,
    });

    expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(feed.home_page_url).toBe('https://demo.github.io/gitpulse/');
    expect(feed.feed_url).toBe('https://demo.github.io/gitpulse/feed.json');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]?.external_url).toBe('https://github.com/acme/alpha-agent');
    expect(feed.items[0]?.title).toContain('[第42期 · +1.5k★]');
  });
});
