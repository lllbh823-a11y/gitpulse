// Shared data contract strictly aligned with docs/specs/2026-11-22-gitpulse-design.md Section 5.

export type TrendingPeriod = 'daily' | 'weekly';

export type CategoryId =
  | 'all'
  | 'ai-agent'
  | 'frontend'
  | 'dev-tools'
  | 'backend-infra'
  | 'open-models'
  | 'other';

export type RepoCategoryId = Exclude<CategoryId, 'all'>;

export interface CategoryMeta {
  id: CategoryId;
  label: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'all', label: '全部' },
  { id: 'ai-agent', label: 'AI & Agent' },
  { id: 'frontend', label: '前端与 UI' },
  { id: 'dev-tools', label: '效率工具' },
  { id: 'backend-infra', label: '后端与架构' },
  { id: 'open-models', label: '开源模型' },
  { id: 'other', label: '其他精选' },
];

export const REPO_CATEGORY_IDS: readonly RepoCategoryId[] = [
  'ai-agent',
  'frontend',
  'dev-tools',
  'backend-infra',
  'open-models',
  'other',
] as const;

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  all: '全部',
  'ai-agent': 'AI & Agent',
  frontend: '前端与 UI',
  'dev-tools': '效率工具',
  'backend-infra': '后端与架构',
  'open-models': '开源模型',
  other: '其他精选',
};

export interface RepoAISummary {
  tagline: string; // 15~32字，一句话看懂核心价值
  whyHot: string; // 40~90字，解释为什么近期爆火/解决什么痛点
  highlights: string[]; // 固定 3 条核心亮点，每条 12~36 字
  targetAudience: string; // 15~40字，最适合什么角色/场景使用
  aiStatus: 'ok' | 'fallback';
}

export interface RepoItem {
  _id: string; // 规范化唯一主键：`${owner}__${name}`.toLowerCase()
  fullName: string; // 例如 "anthropics/claude-code"
  owner: string;
  name: string;
  url: string; // "https://github.com/owner/name"
  description: string; // GitHub 原始英文简介
  language: string; // 无语言时为 "Unknown"
  languageColor: string; // 十六进制色值，如 "#3178c6"
  stars: number; // 总 Star 数
  starsToday: number; // 本期（日/周）新增 Star 数
  forks: number;
  license: string; // 如 "MIT" / "Apache-2.0" / "Unknown"
  category: RepoCategoryId;
  tags: string[]; // 2~3 个中文/技术短标签，如 ["AI Agent", "CLI", "TypeScript"]
  ai: RepoAISummary;
  latestDate: string; // 最近上榜日期 "YYYY-MM-DD"
  updatedAt: string; // ISO 8601 时间戳
}

export interface DailyIssue {
  _id: string; // `${date}_${period}`，如 "2026-11-22_daily"
  date: string; // "YYYY-MM-DD"（北京时间）
  period: TrendingPeriod;
  issueNo: number; // 递增期刊号，从 1 开始
  summary: string; // 当日一句趋势风向总结（20~48字）
  topCategory: RepoCategoryId;
  repoIds: string[]; // 按榜单排名有序排列的 RepoItem._id 数组
  publishedAt: string; // ISO 8601 时间戳
}

export interface PushSubscriptionState {
  remainingCount: number;
  preferredCategory: CategoryId;
  lastPushedDate: string | null;
  templateId: string;
}

export interface SnapshotPayload {
  generatedAt: string;
  availableDates: string[];
  issues: Record<string, DailyIssue>; // key: `${date}_${period}`
  repos: Record<string, RepoItem>; // key: RepoItem._id
}

export interface CloudResponse<T> {
  code: number; // 0 表示成功，非 0 为业务/系统错误码
  message: string; // "ok" 或可读错误信息
  data?: T;
}

export interface IngestIssueRequest {
  date: string; // "YYYY-MM-DD"
  period: TrendingPeriod; // "daily" | "weekly"
  summary: string;
  topCategory: RepoCategoryId;
  repos: RepoItem[]; // 按榜单顺序排列
}

export interface IngestIssueResponseData {
  issueId: string;
  issueNo: number;
  upsertedRepos: number;
  repoIds?: string[];
  summary?: string;
  topCategory?: RepoCategoryId;
}

// --- Internal crawler pipeline types ---

export interface RawTrendingRepo {
  _id: string;
  fullName: string;
  owner: string;
  name: string;
  url: string;
  description: string;
  language: string;
  languageColor: string;
  stars: number;
  starsToday: number;
  forks: number;
  period: TrendingPeriod;
  rank: number;
}

export interface RepoMetaInfo {
  description?: string;
  language?: string;
  stars?: number;
  forks?: number;
  license: string;
  topics: string[];
  readmeExcerpt: string;
}

export interface EnrichedRepo extends RawTrendingRepo {
  license: string;
  topics: string[];
  readmeExcerpt: string;
}

export type ComplianceBlockCategory =
  | 'circumvention'
  | 'security-abuse'
  | 'adult-gambling'
  | 'sensitive-politics'
  | 'custom-blocklist'
  | 'ai-flagged';

export interface ComplianceDecision {
  allowed: boolean;
  category?: ComplianceBlockCategory;
  reason?: string;
  matchedRule?: string;
}

export interface RepoAIEnrichment {
  category: RepoCategoryId;
  tags: string[];
  ai: RepoAISummary;
  compliance?: ComplianceDecision;
}
