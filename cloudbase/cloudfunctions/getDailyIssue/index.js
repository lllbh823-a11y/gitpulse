'use strict';

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const VALID_PERIODS = new Set(['daily', 'weekly']);
const VALID_CATEGORIES = new Set([
  'all',
  'ai-agent',
  'frontend',
  'dev-tools',
  'backend-infra',
  'open-models',
  'other',
]);
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const AVAILABLE_DATES_LIMIT = 14;
const IN_QUERY_BATCH_SIZE = 100;

function getDefaultSubscription() {
  return {
    remainingCount: 0,
    preferredCategory: 'all',
    lastPushedDate: null,
    templateId: process.env.SUBSCRIBE_TEMPLATE_ID || '',
  };
}

async function fetchReposByIds(db, _, repoIds) {
  if (!Array.isArray(repoIds) || repoIds.length === 0) {
    return [];
  }

  const repoMap = new Map();
  for (let i = 0; i < repoIds.length; i += IN_QUERY_BATCH_SIZE) {
    const chunk = repoIds.slice(i, i + IN_QUERY_BATCH_SIZE);
    const res = await db
      .collection('repos')
      .where({ _id: _.in(chunk) })
      .limit(chunk.length)
      .get();

    const docs = res && Array.isArray(res.data) ? res.data : [];
    for (const doc of docs) {
      repoMap.set(doc._id, doc);
    }
  }

  // Strictly preserve ranking order defined in issue.repoIds
  const ordered = [];
  for (const id of repoIds) {
    if (repoMap.has(id)) {
      ordered.push(repoMap.get(id));
    }
  }
  return ordered;
}

async function fetchBookmarkedIds(db, _, openid, repoIds) {
  if (!openid || !Array.isArray(repoIds) || repoIds.length === 0) {
    return [];
  }

  const result = [];
  for (let i = 0; i < repoIds.length; i += IN_QUERY_BATCH_SIZE) {
    const chunk = repoIds.slice(i, i + IN_QUERY_BATCH_SIZE);
    const res = await db
      .collection('user_bookmarks')
      .where({
        openid,
        repoId: _.in(chunk),
      })
      .limit(chunk.length)
      .get();

    const docs = res && Array.isArray(res.data) ? res.data : [];
    for (const doc of docs) {
      if (doc.repoId) {
        result.push(doc.repoId);
      }
    }
  }
  return result;
}

async function fetchSubscriptionState(db, openid) {
  const fallback = getDefaultSubscription();
  if (!openid) {
    return fallback;
  }

  const res = await db
    .collection('push_subscriptions')
    .where({ _id: openid })
    .limit(1)
    .get();

  const doc = res && Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
  if (!doc) {
    return fallback;
  }

  return {
    remainingCount:
      typeof doc.remainingCount === 'number' && doc.remainingCount > 0 ? doc.remainingCount : 0,
    preferredCategory: VALID_CATEGORIES.has(doc.preferredCategory)
      ? doc.preferredCategory
      : 'all',
    lastPushedDate: typeof doc.lastPushedDate === 'string' ? doc.lastPushedDate : null,
    templateId: doc.templateId || process.env.SUBSCRIBE_TEMPLATE_ID || '',
  };
}

exports.main = async (event = {}) => {
  const period = event.period === undefined ? 'daily' : event.period;
  const category = event.category === undefined ? 'all' : event.category;
  const date = event.date === undefined || event.date === '' ? undefined : event.date;

  if (!VALID_PERIODS.has(period)) {
    return {
      code: 400,
      message: 'Invalid period: expected "daily" or "weekly"',
    };
  }

  if (!VALID_CATEGORIES.has(category)) {
    return {
      code: 400,
      message: 'Invalid category',
    };
  }

  if (date !== undefined && (typeof date !== 'string' || !DATE_REGEX.test(date))) {
    return {
      code: 400,
      message: 'Invalid date: expected YYYY-MM-DD',
    };
  }

  const db = cloud.database();
  const _ = db.command;
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
  const openid = wxContext && wxContext.OPENID ? String(wxContext.OPENID) : '';

  try {
    const [datesRes, issueRes, subscription] = await Promise.all([
      db
        .collection('daily_issues')
        .where({ period })
        .orderBy('date', 'desc')
        .limit(AVAILABLE_DATES_LIMIT)
        .field({ date: true })
        .get(),
      date
        ? db
            .collection('daily_issues')
            .where({ _id: `${date}_${period}` })
            .limit(1)
            .get()
        : db
            .collection('daily_issues')
            .where({ period })
            .orderBy('date', 'desc')
            .limit(1)
            .get(),
      fetchSubscriptionState(db, openid),
    ]);

    const availableDates = [];
    const seenDates = new Set();
    const dateDocs = datesRes && Array.isArray(datesRes.data) ? datesRes.data : [];
    for (const doc of dateDocs) {
      if (doc && typeof doc.date === 'string' && !seenDates.has(doc.date)) {
        seenDates.add(doc.date);
        availableDates.push(doc.date);
      }
    }

    const issue =
      issueRes && Array.isArray(issueRes.data) && issueRes.data.length > 0
        ? issueRes.data[0]
        : null;

    if (!issue) {
      return {
        code: 0,
        message: 'ok',
        data: {
          issue: null,
          repos: [],
          availableDates,
          bookmarkedIds: [],
          subscription,
        },
      };
    }

    const orderedRepos = await fetchReposByIds(db, _, issue.repoIds || []);
    const filteredRepos =
      category === 'all'
        ? orderedRepos
        : orderedRepos.filter((repo) => repo.category === category);

    const bookmarkedIds = await fetchBookmarkedIds(
      db,
      _,
      openid,
      filteredRepos.map((repo) => repo._id)
    );

    return {
      code: 0,
      message: 'ok',
      data: {
        issue,
        repos: filteredRepos,
        availableDates,
        bookmarkedIds,
        subscription,
      },
    };
  } catch (err) {
    console.error('[getDailyIssue] Failed to load issue:', err);
    return {
      code: 500,
      message: 'Internal server error while fetching daily issue',
    };
  }
};
