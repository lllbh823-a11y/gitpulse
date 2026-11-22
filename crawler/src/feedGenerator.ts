import type { DailyIssue, RepoCategoryId, RepoItem, SnapshotPayload } from './types.js';

export interface FeedGeneratorOptions {
  /** Base public URL of the web app, e.g. "https://user.github.io/gitpulse" */
  siteUrl: string;
  /** Feed display title */
  title?: string;
  /** Feed display description */
  description?: string;
  /** Maximum number of repository items included across recent daily issues */
  maxItems?: number;
}

export interface JsonFeedItem {
  id: string;
  url: string;
  external_url: string;
  title: string;
  summary: string;
  content_html: string;
  date_published: string;
  date_modified: string;
  authors: Array<{ name: string; url: string }>;
  tags: string[];
}

export interface JsonFeedDocument {
  version: 'https://jsonfeed.org/version/1.1';
  title: string;
  home_page_url: string;
  feed_url: string;
  description: string;
  language: string;
  items: JsonFeedItem[];
}

const CATEGORY_LABELS: Record<RepoCategoryId, string> = {
  'ai-agent': 'AI & Agent',
  frontend: '前端与 UI',
  'dev-tools': '效率工具',
  'backend-infra': '后端与架构',
  'open-models': '开源模型',
  other: '其他精选',
};

function normalizeSiteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  return trimmed || 'https://gitpulse.dev';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, ']]]]><![CDATA[>');
}

function formatStarCount(num: number): string {
  if (!Number.isFinite(num) || num < 0) return '0';
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(num);
}

function toRfc2822(isoOrDate: string): string {
  const ts = Date.parse(isoOrDate);
  if (Number.isNaN(ts)) {
    return new Date().toUTCString();
  }
  return new Date(ts).toUTCString();
}

interface CollectedEntry {
  issue: DailyIssue;
  repo: RepoItem;
  rank: number;
}

function collectRecentEntries(snapshot: SnapshotPayload, maxItems: number): CollectedEntry[] {
  const dailyIssues = Object.values(snapshot.issues)
    .filter((issue) => issue.period === 'daily')
    .sort((a, b) => b.date.localeCompare(a.date));

  const fallbackIssues =
    dailyIssues.length > 0
      ? dailyIssues
      : Object.values(snapshot.issues).sort((a, b) => b.date.localeCompare(a.date));

  const entries: CollectedEntry[] = [];
  const seenRepoIds = new Set<string>();

  for (const issue of fallbackIssues) {
    for (let i = 0; i < issue.repoIds.length; i += 1) {
      const repoId = issue.repoIds[i];
      if (!repoId || seenRepoIds.has(repoId)) continue;
      const repo = snapshot.repos[repoId];
      if (!repo) continue;
      seenRepoIds.add(repoId);
      entries.push({ issue, repo, rank: i + 1 });
      if (entries.length >= maxItems) {
        return entries;
      }
    }
  }

  return entries;
}

function buildItemHtml(entry: CollectedEntry, detailUrl: string): string {
  const { issue, repo, rank } = entry;
  const catLabel = CATEGORY_LABELS[repo.category] ?? '其他精选';
  const highlightsHtml = repo.ai.highlights
    .map((h) => `<li>${escapeXml(h)}</li>`)
    .join('');

  return [
    `<p><strong>${escapeXml(repo.ai.tagline)}</strong></p>`,
    `<p>第 ${issue.issueNo} 期（${escapeXml(issue.date)}）#${rank} · 分类：${escapeXml(catLabel)} · 语言：${escapeXml(repo.language)} · 总 Stars：${repo.stars.toLocaleString('en-US')}（本期 +${formatStarCount(repo.starsToday)}）</p>`,
    `<h3>为什么近期爆火</h3>`,
    `<p>${escapeXml(repo.ai.whyHot)}</p>`,
    `<h3>三大核心亮点</h3>`,
    `<ol>${highlightsHtml}</ol>`,
    `<h3>最适合谁用</h3>`,
    `<p>${escapeXml(repo.ai.targetAudience)}</p>`,
    `<p><a href="${escapeXml(repo.url)}">访问 GitHub 仓库</a> · <a href="${escapeXml(detailUrl)}">在 GitPulse 网页版阅读</a></p>`,
  ].join('\n');
}

export function generateRssXml(
  snapshot: SnapshotPayload,
  options: FeedGeneratorOptions,
): string {
  const baseUrl = normalizeSiteUrl(options.siteUrl);
  const title = options.title?.trim() || 'GitPulse · 开源每日脉搏';
  const description =
    options.description?.trim() ||
    '每天 3 分钟看懂 GitHub 最值得关注的开源突破：每日热门项目与 AI 中文深度速览。';
  const maxItems = Math.max(1, options.maxItems ?? 30);
  const entries = collectRecentEntries(snapshot, maxItems);
  const lastBuildDate = toRfc2822(snapshot.generatedAt);

  const itemsXml = entries
    .map((entry) => {
      const { issue, repo } = entry;
      const detailUrl = `${baseUrl}/#/pages/detail/index?id=${encodeURIComponent(repo._id)}`;
      const itemTitle = `[第${issue.issueNo}期 · +${formatStarCount(repo.starsToday)}★] ${repo.fullName} — ${repo.ai.tagline}`;
      const html = buildItemHtml(entry, detailUrl);
      const catLabel = CATEGORY_LABELS[repo.category] ?? '其他精选';
      const categoriesXml = [catLabel, ...repo.tags]
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join('\n');

      return [
        '    <item>',
        `      <title>${escapeXml(itemTitle)}</title>`,
        `      <link>${escapeXml(detailUrl)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(`gitpulse:${issue.date}:${repo._id}`)}</guid>`,
        `      <pubDate>${toRfc2822(issue.publishedAt || repo.updatedAt)}</pubDate>`,
        categoriesXml,
        `      <description><![CDATA[${escapeCdata(html)}]]></description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(baseUrl)}/</link>`,
    `    <description>${escapeXml(description)}</description>`,
    '    <language>zh-CN</language>',
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(`${baseUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    itemsXml,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function generateJsonFeed(
  snapshot: SnapshotPayload,
  options: FeedGeneratorOptions,
): JsonFeedDocument {
  const baseUrl = normalizeSiteUrl(options.siteUrl);
  const title = options.title?.trim() || 'GitPulse · 开源每日脉搏';
  const description =
    options.description?.trim() ||
    '每天 3 分钟看懂 GitHub 最值得关注的开源突破：每日热门项目与 AI 中文深度速览。';
  const maxItems = Math.max(1, options.maxItems ?? 30);
  const entries = collectRecentEntries(snapshot, maxItems);

  const items: JsonFeedItem[] = entries.map((entry) => {
    const { issue, repo } = entry;
    const detailUrl = `${baseUrl}/#/pages/detail/index?id=${encodeURIComponent(repo._id)}`;
    const catLabel = CATEGORY_LABELS[repo.category] ?? '其他精选';

    return {
      id: `gitpulse:${issue.date}:${repo._id}`,
      url: detailUrl,
      external_url: repo.url,
      title: `[第${issue.issueNo}期 · +${formatStarCount(repo.starsToday)}★] ${repo.fullName} — ${repo.ai.tagline}`,
      summary: repo.ai.tagline,
      content_html: buildItemHtml(entry, detailUrl),
      date_published: issue.publishedAt || repo.updatedAt,
      date_modified: repo.updatedAt,
      authors: [
        {
          name: repo.owner,
          url: `https://github.com/${repo.owner}`,
        },
      ],
      tags: Array.from(new Set([catLabel, repo.language, ...repo.tags].filter(Boolean))),
    };
  });

  return {
    version: 'https://jsonfeed.org/version/1.1',
    title,
    home_page_url: `${baseUrl}/`,
    feed_url: `${baseUrl}/feed.json`,
    description,
    language: 'zh-CN',
    items,
  };
}
