import Taro from '@tarojs/taro';
import snapshotRaw from '@/data/snapshot.json';
import type {
  BookmarkListResponse,
  CategoryId,
  CloudResponse,
  DailyIssueResponse,
  PushSubscriptionState,
  RepoItem,
  SearchReposParams,
  SearchReposResponse,
  SnapshotPayload,
  TrendingPeriod,
} from '@/types/gitpulse';
import { isH5Env } from '@/utils/format';

const STORAGE_BOOKMARKS_KEY = 'gitpulse_local_bookmarks_v1';
const STORAGE_SUBSCRIPTION_KEY = 'gitpulse_local_subscription_v1';
const STORAGE_FORCE_ERROR_KEY = 'gitpulse_debug_force_error';

const snapshotData = snapshotRaw as unknown as SnapshotPayload;

let cloudInitialized = false;

export function getCloudEnvId(): string {
  return typeof __CLOUDBASE_ENV_ID__ === 'string' ? __CLOUDBASE_ENV_ID__.trim() : '';
}

export function getSubscribeTemplateId(): string {
  return typeof __SUBSCRIBE_TEMPLATE_ID__ === 'string' ? __SUBSCRIBE_TEMPLATE_ID__.trim() : '';
}

export function isCloudMode(): boolean {
  if (isH5Env()) return false;
  if (!getCloudEnvId()) return false;
  return Boolean(Taro.cloud && typeof Taro.cloud.callFunction === 'function');
}

export function getRuntimeMode(): 'cloudbase' | 'snapshot' {
  return isCloudMode() ? 'cloudbase' : 'snapshot';
}

export function initCloudIfNeeded(): void {
  if (cloudInitialized || !isCloudMode()) return;
  try {
    Taro.cloud.init({
      env: getCloudEnvId(),
      traceUser: true,
    });
    cloudInitialized = true;
  } catch {
    cloudInitialized = false;
  }
}

function readLocalBookmarks(): string[] {
  try {
    const stored = Taro.getStorageSync(STORAGE_BOOKMARKS_KEY);
    if (Array.isArray(stored)) {
      return stored.filter((item): item is string => typeof item === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

function writeLocalBookmarks(ids: string[]): void {
  try {
    Taro.setStorageSync(STORAGE_BOOKMARKS_KEY, Array.from(new Set(ids)));
  } catch {
    // Ignore storage quota errors in restricted WebViews
  }
}

function readLocalSubscription(): PushSubscriptionState {
  const defaultState: PushSubscriptionState = {
    remainingCount: 0,
    preferredCategory: 'all',
    lastPushedDate: null,
    templateId: getSubscribeTemplateId(),
  };

  try {
    const stored = Taro.getStorageSync(STORAGE_SUBSCRIPTION_KEY);
    if (stored && typeof stored === 'object') {
      return {
        remainingCount: Number(stored.remainingCount) || 0,
        preferredCategory: (stored.preferredCategory as CategoryId) || 'all',
        lastPushedDate: typeof stored.lastPushedDate === 'string' ? stored.lastPushedDate : null,
        templateId: typeof stored.templateId === 'string' && stored.templateId
          ? stored.templateId
          : defaultState.templateId,
      };
    }
    return defaultState;
  } catch {
    return defaultState;
  }
}

function writeLocalSubscription(state: PushSubscriptionState): void {
  try {
    Taro.setStorageSync(STORAGE_SUBSCRIPTION_KEY, state);
  } catch {
    // Ignore storage errors
  }
}

async function callCloudFunction<T>(
  name: string,
  data: Record<string, unknown>,
): Promise<T> {
  initCloudIfNeeded();
  const res = await Taro.cloud.callFunction({
    name,
    data,
  });
  const payload = res.result as CloudResponse<T> | undefined;
  if (!payload || payload.code !== 0 || payload.data === undefined) {
    throw new Error(payload?.message || `云函数 ${name} 返回异常`);
  }
  return payload.data;
}

function maybeThrowDebugError(): void {
  try {
    if (Taro.getStorageSync(STORAGE_FORCE_ERROR_KEY) === '1') {
      throw new Error('模拟网络请求失败，请点击重新加载');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('模拟网络请求失败')) {
      throw err;
    }
  }
}

export async function fetchDailyIssue(params: {
  date?: string;
  period?: TrendingPeriod;
  category?: CategoryId;
} = {}): Promise<DailyIssueResponse> {
  maybeThrowDebugError();
  const period: TrendingPeriod = params.period || 'daily';
  const category: CategoryId = params.category || 'all';

  if (isCloudMode()) {
    return callCloudFunction<DailyIssueResponse>('getDailyIssue', {
      date: params.date,
      period,
      category,
    });
  }

  const availableDates = snapshotData.availableDates || [];
  const targetDate = params.date && availableDates.includes(params.date)
    ? params.date
    : availableDates[0];

  const issueKey = targetDate ? `${targetDate}_${period}` : '';
  const issue = issueKey ? (snapshotData.issues[issueKey] || null) : null;
  const bookmarkedIds = readLocalBookmarks();
  const subscription = readLocalSubscription();

  if (!issue) {
    return {
      issue: null,
      repos: [],
      availableDates,
      bookmarkedIds,
      subscription,
    };
  }

  const orderedRepos = issue.repoIds
    .map((id) => snapshotData.repos[id])
    .filter((repo): repo is RepoItem => Boolean(repo));

  const filteredRepos = category === 'all'
    ? orderedRepos
    : orderedRepos.filter((repo) => repo.category === category);

  return {
    issue,
    repos: filteredRepos,
    availableDates,
    bookmarkedIds,
    subscription,
  };
}

export async function searchRepos(params: SearchReposParams = {}): Promise<SearchReposResponse> {
  maybeThrowDebugError();
  const keyword = (params.keyword || '').trim().toLowerCase();
  const category = params.category || 'all';
  const language = (params.language || '').trim().toLowerCase();
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(30, Math.max(1, params.pageSize || 15));

  if (isCloudMode()) {
    return callCloudFunction<SearchReposResponse>('searchRepos', {
      keyword: params.keyword?.trim() || '',
      category,
      language: params.language?.trim() || '',
      page,
      pageSize,
    });
  }

  const allRepos = Object.values(snapshotData.repos).sort((a, b) => {
    if (a.latestDate !== b.latestDate) {
      return b.latestDate.localeCompare(a.latestDate);
    }
    return b.starsToday - a.starsToday;
  });

  const filtered = allRepos.filter((repo) => {
    if (category !== 'all' && repo.category !== category) {
      return false;
    }
    if (language && repo.language.toLowerCase() !== language) {
      return false;
    }
    if (keyword) {
      const haystack = [
        repo.fullName,
        repo.description,
        repo.language,
        repo.ai.tagline,
        repo.ai.whyHot,
        repo.ai.targetAudience,
        ...repo.tags,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    }
    return true;
  });

  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    total: filtered.length,
    hasMore: start + items.length < filtered.length,
    bookmarkedIds: readLocalBookmarks(),
  };
}

export async function getRepoById(repoId: string): Promise<{
  repo: RepoItem | null;
  bookmarked: boolean;
}> {
  maybeThrowDebugError();
  if (!repoId) {
    return { repo: null, bookmarked: false };
  }

  if (isCloudMode()) {
    const res = await searchRepos({ keyword: repoId.replace('__', '/'), page: 1, pageSize: 10 });
    const exact = res.items.find((item) => item._id === repoId) || null;
    return {
      repo: exact,
      bookmarked: res.bookmarkedIds.includes(repoId),
    };
  }

  const repo = snapshotData.repos[repoId] || null;
  const bookmarkedIds = readLocalBookmarks();
  return {
    repo,
    bookmarked: bookmarkedIds.includes(repoId),
  };
}

export async function toggleBookmark(repoId: string): Promise<{ bookmarked: boolean }> {
  if (isCloudMode()) {
    return callCloudFunction<{ bookmarked: boolean }>('bookmark', {
      action: 'toggle',
      repoId,
    });
  }

  const current = readLocalBookmarks();
  const exists = current.includes(repoId);
  const next = exists
    ? current.filter((id) => id !== repoId)
    : [repoId, ...current];
  writeLocalBookmarks(next);
  return { bookmarked: !exists };
}

export async function fetchBookmarks(page = 1, pageSize = 20): Promise<BookmarkListResponse> {
  maybeThrowDebugError();
  if (isCloudMode()) {
    return callCloudFunction<BookmarkListResponse>('bookmark', {
      action: 'list',
      page,
      pageSize,
    });
  }

  const ids = readLocalBookmarks();
  const itemsAll = ids
    .map((id) => snapshotData.repos[id])
    .filter((repo): repo is RepoItem => Boolean(repo));

  const start = (page - 1) * pageSize;
  const items = itemsAll.slice(start, start + pageSize);

  return {
    items,
    total: itemsAll.length,
    hasMore: start + items.length < itemsAll.length,
  };
}

export async function fetchSubscriptionState(): Promise<PushSubscriptionState> {
  if (isCloudMode()) {
    return callCloudFunction<PushSubscriptionState>('subscription', {
      action: 'get',
    });
  }
  return readLocalSubscription();
}

export async function updateSubscriptionPreference(
  preferredCategory: CategoryId,
): Promise<PushSubscriptionState> {
  if (isCloudMode()) {
    return callCloudFunction<PushSubscriptionState>('subscription', {
      action: 'updatePreference',
      preferredCategory,
    });
  }
  const current = readLocalSubscription();
  const next: PushSubscriptionState = {
    ...current,
    preferredCategory,
  };
  writeLocalSubscription(next);
  return next;
}

export async function requestDailyPushReservation(
  currentTemplateId?: string,
): Promise<{ state: PushSubscriptionState; accepted: boolean; mode: 'weapp' | 'preview' }> {
  const templateId = currentTemplateId || getSubscribeTemplateId();

  if (!isH5Env() && templateId && typeof Taro.requestSubscribeMessage === 'function') {
    const authRes = await Taro.requestSubscribeMessage({
      tmplIds: [templateId],
      entityIds: [],
    });
    const statusMap = authRes as unknown as Record<string, string>;
    const accepted = statusMap[templateId] === 'accept';
    if (!accepted) {
      const state = await fetchSubscriptionState();
      return { state, accepted: false, mode: 'weapp' };
    }
    const state = isCloudMode()
      ? await callCloudFunction<PushSubscriptionState>('subscription', {
        action: 'increment',
        delta: 1,
        templateId,
      })
      : incrementLocalSubscription(1, templateId);
    return { state, accepted: true, mode: 'weapp' };
  }

  // Local snapshot / H5 preview fallback: simulate 1 reservation increment cleanly
  const state = isCloudMode()
    ? await callCloudFunction<PushSubscriptionState>('subscription', {
      action: 'increment',
      delta: 1,
      templateId,
    })
    : incrementLocalSubscription(1, templateId);

  return { state, accepted: true, mode: 'preview' };
}

function incrementLocalSubscription(delta: number, templateId: string): PushSubscriptionState {
  const current = readLocalSubscription();
  const safeDelta = Math.min(3, Math.max(1, delta));
  const next: PushSubscriptionState = {
    ...current,
    remainingCount: current.remainingCount + safeDelta,
    templateId: templateId || current.templateId,
  };
  writeLocalSubscription(next);
  return next;
}

export function getAvailableLanguages(): string[] {
  const counts = new Map<string, number>();
  for (const repo of Object.values(snapshotData.repos)) {
    if (repo.language && repo.language !== 'Unknown') {
      counts.set(repo.language, (counts.get(repo.language) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}
