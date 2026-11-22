'use strict';

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const VALID_CATEGORIES = new Set([
  'all',
  'ai-agent',
  'frontend',
  'dev-tools',
  'backend-infra',
  'open-models',
  'other',
]);
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 30;
const MAX_KEYWORD_LENGTH = 64;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) {
    return null;
  }
  return Math.floor(num);
}

function buildWhereClause(db, _, { keyword, category, language }) {
  const conditions = [];

  if (category && category !== 'all') {
    conditions.push({ category });
  }

  if (language) {
    const escapedLang = escapeRegExp(language);
    conditions.push({
      language: db.RegExp({
        regexp: `^${escapedLang}$`,
        options: 'i',
      }),
    });
  }

  if (keyword) {
    const escapedKeyword = escapeRegExp(keyword);
    const regex = db.RegExp({
      regexp: escapedKeyword,
      options: 'i',
    });
    conditions.push(
      _.or([
        { fullName: regex },
        { description: regex },
        { language: regex },
        { tags: regex },
        { 'ai.tagline': regex },
        { 'ai.whyHot': regex },
      ])
    );
  }

  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return _.and(conditions);
}

exports.main = async (event = {}) => {
  const category = event.category === undefined || event.category === '' ? 'all' : event.category;
  if (!VALID_CATEGORIES.has(category)) {
    return {
      code: 400,
      message: 'Invalid category',
    };
  }

  const page = parsePositiveInt(event.page, DEFAULT_PAGE);
  if (page === null) {
    return {
      code: 400,
      message: 'Invalid page: expected positive integer',
    };
  }

  const rawPageSize = parsePositiveInt(event.pageSize, DEFAULT_PAGE_SIZE);
  if (rawPageSize === null) {
    return {
      code: 400,
      message: 'Invalid pageSize: expected positive integer',
    };
  }
  const pageSize = Math.min(rawPageSize, MAX_PAGE_SIZE);

  const keyword =
    typeof event.keyword === 'string'
      ? event.keyword.trim().slice(0, MAX_KEYWORD_LENGTH)
      : '';

  let language = typeof event.language === 'string' ? event.language.trim() : '';
  if (language.toLowerCase() === 'all' || language === '全部') {
    language = '';
  }

  const db = cloud.database();
  const _ = db.command;
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
  const openid = wxContext && wxContext.OPENID ? String(wxContext.OPENID) : '';

  try {
    const whereClause = buildWhereClause(db, _, { keyword, category, language });
    const skip = (page - 1) * pageSize;

    const [countRes, listRes] = await Promise.all([
      db.collection('repos').where(whereClause).count(),
      db
        .collection('repos')
        .where(whereClause)
        .orderBy('latestDate', 'desc')
        .orderBy('starsToday', 'desc')
        .orderBy('stars', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get(),
    ]);

    const total = countRes && typeof countRes.total === 'number' ? countRes.total : 0;
    const items = listRes && Array.isArray(listRes.data) ? listRes.data : [];
    const hasMore = skip + items.length < total;

    let bookmarkedIds = [];
    if (openid && items.length > 0) {
      const repoIds = items.map((item) => item._id);
      const bmRes = await db
        .collection('user_bookmarks')
        .where({
          openid,
          repoId: _.in(repoIds),
        })
        .limit(repoIds.length)
        .get();

      const bmDocs = bmRes && Array.isArray(bmRes.data) ? bmRes.data : [];
      bookmarkedIds = bmDocs.map((doc) => doc.repoId).filter(Boolean);
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        items,
        total,
        hasMore,
        bookmarkedIds,
      },
    };
  } catch (err) {
    console.error('[searchRepos] Search failed:', err);
    return {
      code: 500,
      message: 'Internal server error while searching repositories',
    };
  }
};

exports._internal = {
  escapeRegExp,
};
