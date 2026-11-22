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
const MIN_INCREMENT_DELTA = 1;
const MAX_INCREMENT_DELTA = 3;

function toSubscriptionState(doc) {
  const defaultTemplateId = process.env.SUBSCRIBE_TEMPLATE_ID || '';
  if (!doc) {
    return {
      remainingCount: 0,
      preferredCategory: 'all',
      lastPushedDate: null,
      templateId: defaultTemplateId,
    };
  }
  return {
    remainingCount:
      typeof doc.remainingCount === 'number' && doc.remainingCount > 0 ? doc.remainingCount : 0,
    preferredCategory: VALID_CATEGORIES.has(doc.preferredCategory)
      ? doc.preferredCategory
      : 'all',
    lastPushedDate: typeof doc.lastPushedDate === 'string' ? doc.lastPushedDate : null,
    templateId:
      typeof doc.templateId === 'string' && doc.templateId.trim()
        ? doc.templateId.trim()
        : defaultTemplateId,
  };
}

async function getSubscriptionDoc(db, openid) {
  const res = await db
    .collection('push_subscriptions')
    .where({ _id: openid })
    .limit(1)
    .get();

  return res && Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
}

function parseIncrementDelta(rawDelta) {
  if (rawDelta === undefined || rawDelta === null) {
    return MIN_INCREMENT_DELTA;
  }
  const num = Number(rawDelta);
  if (!Number.isFinite(num) || num < MIN_INCREMENT_DELTA) {
    return null;
  }
  return Math.min(MAX_INCREMENT_DELTA, Math.floor(num));
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
  if (action !== 'get' && action !== 'increment' && action !== 'updatePreference') {
    return {
      code: 400,
      message: 'Invalid action: expected "get", "increment", or "updatePreference"',
    };
  }

  const db = cloud.database();
  const _ = db.command;
  const collection = db.collection('push_subscriptions');

  try {
    if (action === 'get') {
      const existing = await getSubscriptionDoc(db, openid);
      return {
        code: 0,
        message: 'ok',
        data: toSubscriptionState(existing),
      };
    }

    const nowIso = new Date().toISOString();

    if (action === 'increment') {
      const safeDelta = parseIncrementDelta(event.delta);
      if (safeDelta === null) {
        return {
          code: 400,
          message: 'Invalid delta: expected a positive number (capped at 1~3 per call)',
        };
      }

      const incomingTemplateId =
        typeof event.templateId === 'string' && event.templateId.trim()
          ? event.templateId.trim()
          : '';
      const existing = await getSubscriptionDoc(db, openid);

      if (existing) {
        const updateData = {
          remainingCount: _.inc(safeDelta),
          updatedAt: nowIso,
        };
        if (incomingTemplateId) {
          updateData.templateId = incomingTemplateId;
        }
        await collection.doc(openid).update({ data: updateData });
        const refreshed = await getSubscriptionDoc(db, openid);
        return {
          code: 0,
          message: 'ok',
          data: toSubscriptionState(refreshed),
        };
      }

      const newDoc = {
        openid,
        remainingCount: safeDelta,
        preferredCategory: 'all',
        lastPushedDate: null,
        templateId: incomingTemplateId || process.env.SUBSCRIBE_TEMPLATE_ID || '',
        updatedAt: nowIso,
      };
      await collection.doc(openid).set({ data: newDoc });
      return {
        code: 0,
        message: 'ok',
        data: toSubscriptionState(newDoc),
      };
    }

    // action === 'updatePreference'
    const preferredCategory = event.preferredCategory;
    if (!VALID_CATEGORIES.has(preferredCategory)) {
      return {
        code: 400,
        message: 'Invalid preferredCategory',
      };
    }

    const existing = await getSubscriptionDoc(db, openid);
    if (existing) {
      await collection.doc(openid).update({
        data: {
          preferredCategory,
          updatedAt: nowIso,
        },
      });
      const refreshed = await getSubscriptionDoc(db, openid);
      return {
        code: 0,
        message: 'ok',
        data: toSubscriptionState(refreshed),
      };
    }

    const newDoc = {
      openid,
      remainingCount: 0,
      preferredCategory,
      lastPushedDate: null,
      templateId: process.env.SUBSCRIBE_TEMPLATE_ID || '',
      updatedAt: nowIso,
    };
    await collection.doc(openid).set({ data: newDoc });
    return {
      code: 0,
      message: 'ok',
      data: toSubscriptionState(newDoc),
    };
  } catch (err) {
    console.error(`[subscription] Action "${action}" failed:`, err);
    return {
      code: 500,
      message: 'Internal server error while processing subscription',
    };
  }
};

exports._internal = {
  parseIncrementDelta,
  toSubscriptionState,
  MAX_INCREMENT_DELTA,
};
