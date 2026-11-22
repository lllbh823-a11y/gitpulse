'use strict';

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 30;

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

function isDuplicateKeyError(err) {
  if (!err) {
    return false;
  }
  const code = err.errCode || err.code;
  const msg = String(err.errMsg || err.message || '');
  return (
    code === -502001 ||
    code === 11000 ||
    msg.includes('E11000') ||
    msg.toLowerCase().includes('duplicate key')
  );
}

async function handleToggle(db, openid, rawRepoId) {
  if (typeof rawRepoId !== 'string' || !rawRepoId.trim()) {
    return {
      code: 400,
      message: 'Missing or invalid repoId',
    };
  }

  const repoId = rawRepoId.trim().toLowerCase();
  const collection = db.collection('user_bookmarks');

  const existingRes = await collection
    .where({ openid, repoId })
    .limit(1)
    .get();

  const exists = existingRes && Array.isArray(existingRes.data) && existingRes.data.length > 0;

  if (exists) {
    await collection.where({ openid, repoId }).remove();
    return {
      code: 0,
      message: 'ok',
      data: { bookmarked: false },
    };
  }

  try {
    await collection.add({
      data: {
        openid,
        repoId,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw err;
    }
  }

  return {
    code: 0,
    message: 'ok',
    data: { bookmarked: true },
  };
}

async function handleList(db, _, openid, event) {
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
  const skip = (page - 1) * pageSize;

  const collection = db.collection('user_bookmarks');
  const [countRes, bmRes] = await Promise.all([
    collection.where({ openid }).count(),
    collection
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get(),
  ]);

  const total = countRes && typeof countRes.total === 'number' ? countRes.total : 0;
  const bookmarkDocs = bmRes && Array.isArray(bmRes.data) ? bmRes.data : [];
  const hasMore = skip + bookmarkDocs.length < total;

  if (bookmarkDocs.length === 0) {
    return {
      code: 0,
      message: 'ok',
      data: {
        items: [],
        total,
        hasMore,
      },
    };
  }

  const repoIds = bookmarkDocs.map((doc) => doc.repoId).filter(Boolean);
  const reposRes = await db
    .collection('repos')
    .where({ _id: _.in(repoIds) })
    .limit(repoIds.length)
    .get();

  const repoDocs = reposRes && Array.isArray(reposRes.data) ? reposRes.data : [];
  const repoMap = new Map(repoDocs.map((repo) => [repo._id, repo]));

  const items = [];
  for (const bm of bookmarkDocs) {
    if (repoMap.has(bm.repoId)) {
      items.push(repoMap.get(bm.repoId));
    }
  }

  return {
    code: 0,
    message: 'ok',
    data: {
      items,
      total,
      hasMore,
    },
  };
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
  const openid = wxContext && wxContext.OPENID ? String(wxContext.OPENID) : '';

  if (!openid) {
    return {
      code: 401,
      message: 'Unauthorized: missing OPENID',
    };
  }

  const action = event.action;
  if (action !== 'toggle' && action !== 'list') {
    return {
      code: 400,
      message: 'Invalid action: expected "toggle" or "list"',
    };
  }

  const db = cloud.database();
  const _ = db.command;

  try {
    if (action === 'toggle') {
      return await handleToggle(db, openid, event.repoId);
    }
    return await handleList(db, _, openid, event);
  } catch (err) {
    console.error(`[bookmark] Action "${action}" failed:`, err);
    return {
      code: 500,
      message: 'Internal server error while processing bookmark',
    };
  }
};
