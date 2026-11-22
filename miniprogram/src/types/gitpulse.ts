export type TrendingPeriod = 'daily' | 'weekly';

export type CategoryId =
  | 'all'
  | 'ai-agent'
  | 'frontend'
  | 'dev-tools'
  | 'backend-infra'
  | 'open-models'
  | 'other';

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

export interface RepoAISummary {
  tagline: string;
  whyHot: string;
  highlights: string[];
  targetAudience: string;
  aiStatus: 'ok' | 'fallback';
}

export interface RepoItem {
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
  license: string;
  category: Exclude<CategoryId, 'all'>;
  tags: string[];
  ai: RepoAISummary;
  latestDate: string;
  updatedAt: string;
}

export interface DailyIssue {
  _id: string;
  date: string;
  period: TrendingPeriod;
  issueNo: number;
  summary: string;
  topCategory: Exclude<CategoryId, 'all'>;
  repoIds: string[];
  publishedAt: string;
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
  issues: Record<string, DailyIssue>;
  repos: Record<string, RepoItem>;
}

export interface CloudResponse<T> {
  code: number;
  message: string;
  data?: T;
}

export interface DailyIssueResponse {
  issue: DailyIssue | null;
  repos: RepoItem[];
  availableDates: string[];
  bookmarkedIds: string[];
  subscription: PushSubscriptionState;
}

export interface SearchReposParams {
  keyword?: string;
  category?: CategoryId;
  language?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchReposResponse {
  items: RepoItem[];
  total: number;
  hasMore: boolean;
  bookmarkedIds: string[];
}

export interface BookmarkListResponse {
  items: RepoItem[];
  total: number;
  hasMore: boolean;
}
