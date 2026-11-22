'use strict';

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const BATCH_SIZE = 50;
const SEND_CONCURRENCY = 10;
const IN_QUERY_BATCH_SIZE = 100;
const THING_MAX_LENGTH = 20;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ERR_CODE_USER_REFUSED = 43101;
const VALID_MP_STATES = new Set(['developer', 'trial', 'formal']);

function getBeijingDateString(now = new Date()) {
  const cstMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(cstMs).toISOString().slice(0, 10);
}

/**
 * Truncate text for WeChat subscribeMessage `thing` fields (strictly <= 20 chars).
 * Iterates by Unicode code points so surrogate pairs (e.g. emojis) are never split,
 * while guaranteeing both code-point length and UTF-16 `.length` stay <= maxLen.
 */
function truncateThing(rawText, maxLen = THING_MAX_LENGTH, fallback = 'GitHub 热门项目') {
  const normalized = String(rawText === undefined || rawText === null ? '' : rawText)
    .replace(/\s+/g, ' ')
    .trim();

  const source = normalized || fallback;
  const chars = Array.from(source);
  if (chars.length <= maxLen && source.length <= maxLen) {
    return source;
  }

  const ellipsis = '…';
  const budget = Math.max(1, maxLen - ellipsis.length);
  let out = '';
  let count = 0;

  for (const ch of chars) {
    if (count + 1 > budget || out.length + ch.length > budget) {
      break;
    }
    out += ch;
    count += 1;
  }

  return `${out}${ellipsis}`;
}

function formatDateFieldValue(dateStr, fieldKey) {
  const [year, month, day] = dateStr.split('-');
  if (typeof fieldKey === 'string' && fieldKey.startsWith('time')) {
    return `${year}年${month}月${day}日 08:30`;
  }
  if (typeof fieldKey === 'string' && fieldKey.startsWith('date')) {
    return `${year}-${month}-${day}`;
  }
  return truncateThing(dateStr, THING_MAX_LENGTH, dateStr);
}

function pickTopRepoForUser(orderedRepos, preferredCategory) {
  if (!Array.isArray(orderedRepos) || orderedRepos.length === 0) {
    return null;
  }
  if (preferredCategory && preferredCategory !== 'all') {
    const matched = orderedRepos.find((repo) => repo.category === preferredCategory);
    if (matched) {
      return matched;
    }
  }
  return orderedRepos[0];
}

function buildSubscribePayload({ repo, issue, today, env = process.env }) {
  const keyTitle = (env.PUSH_KEY_TITLE || 'thing1').trim();
  const keyDesc = (env.PUSH_KEY_DESC || 'thing2').trim();
  const keyDate = (env.PUSH_KEY_DATE || 'time3').trim();

  const starsToday =
    typeof repo.starsToday === 'number' && repo.starsToday > 0 ? ` +${repo.starsToday}★` : '';
  const rawTitle = `${repo.name || repo.fullName || '热门项目'}${starsToday}`;
  const rawDesc =
    (repo.ai && repo.ai.tagline) ||
    (issue && issue.summary) ||
    repo.description ||
    '今日 GitHub 热门速览已更新';

  const titleValue = truncateThing(rawTitle, THING_MAX_LENGTH, 'GitHub 热门项目');
  const descValue = truncateThing(rawDesc, THING_MAX_LENGTH, '今日开源速览已更新');
  const dateValue = formatDateFieldValue(today, keyDate);

  return {
    [keyTitle]: { value: titleValue },
    [keyDesc]: { value: descValue },
    [keyDate]: { value: dateValue },
  };
}

function isError43101(err) {
  if (!err) {
    return false;
  }
  const code = Number(err.errCode !== undefined ? err.errCode : err.errcode);
  if (code === ERR_CODE_USER_REFUSED) {
    return true;
  }
  const msg = String(err.errMsg || err.message || '');
  return msg.includes('43101');
}

async function fetchReposInOrder(db, _, repoIds) {
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
  const ordered = [];
  for (const id of repoIds) {
    if (repoMap.has(id)) {
      ordered.push(repoMap.get(id));
    }
  }
  return ordered;
}

async function runWithConcurrency(items, concurrency, worker) {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    await Promise.all(chunk.map((item) => worker(item)));
  }
}

exports.main = async (event = {}) => {
  const today =
    typeof event.date === 'string' && DATE_REGEX.test(event.date)
      ? event.date
      : getBeijingDateString(new Date());

  const db = cloud.database();
  const _ = db.command;
  const issueId = `${today}_daily`;

  try {
    const issueRes = await db
      .collection('daily_issues')
      .where({ _id: issueId })
      .limit(1)
      .get();

    const issue =
      issueRes && Array.isArray(issueRes.data) && issueRes.data.length > 0
        ? issueRes.data[0]
        : null;

    if (!issue || !Array.isArray(issue.repoIds) || issue.repoIds.length === 0) {
      console.warn(
        `[sendDailyPush] Daily issue "${issueId}" not found or empty. Skipping push without deducting user quotas.`
      );
      return {
        code: 0,
        message: 'no daily issue yet, skipped',
        data: {
          date: today,
          skipped: true,
          totalProcessed: 0,
          sent: 0,
          disabled: 0,
          failed: 0,
        },
      };
    }

    const orderedRepos = await fetchReposInOrder(db, _, issue.repoIds);
    if (orderedRepos.length === 0) {
      console.warn(
        `[sendDailyPush] No repo records resolved for "${issueId}". Skipping push without deducting user quotas.`
      );
      return {
        code: 0,
        message: 'no repos resolved for daily issue, skipped',
        data: {
          date: today,
          skipped: true,
          totalProcessed: 0,
          sent: 0,
          disabled: 0,
          failed: 0,
        },
      };
    }

    const mpState = VALID_MP_STATES.has(process.env.MINIPROGRAM_STATE)
      ? process.env.MINIPROGRAM_STATE
      : 'formal';
    const defaultTemplateId = (process.env.SUBSCRIBE_TEMPLATE_ID || '').trim();

    let lastSeenId = null;
    let totalProcessed = 0;
    let sent = 0;
    let disabled = 0;
    let failed = 0;

    while (true) {
      const condition = {
        remainingCount: _.gt(0),
        lastPushedDate: _.neq(today),
      };
      if (lastSeenId !== null) {
        condition._id = _.gt(lastSeenId);
      }

      const batchRes = await db
        .collection('push_subscriptions')
        .where(condition)
        .orderBy('_id', 'asc')
        .limit(BATCH_SIZE)
        .get();

      const subscribers = batchRes && Array.isArray(batchRes.data) ? batchRes.data : [];
      if (subscribers.length === 0) {
        break;
      }

      lastSeenId = subscribers[subscribers.length - 1]._id;

      await runWithConcurrency(subscribers, SEND_CONCURRENCY, async (subscriber) => {
        totalProcessed += 1;
        const openid = subscriber._id;
        const templateId =
          (typeof subscriber.templateId === 'string' && subscriber.templateId.trim()) ||
          defaultTemplateId;

        if (!templateId) {
          console.error(
            `[sendDailyPush] Missing templateId for user "${openid}", skipping without deducting quota.`
          );
          failed += 1;
          return;
        }

        const topRepo = pickTopRepoForUser(orderedRepos, subscriber.preferredCategory);
        const dataPayload = buildSubscribePayload({
          repo: topRepo,
          issue,
          today,
          env: process.env,
        });

        try {
          await cloud.openapi.subscribeMessage.send({
            touser: openid,
            templateId,
            page: `pages/today/index?date=${today}`,
            miniprogramState: mpState,
            lang: 'zh_CN',
            data: dataPayload,
          });

          await db
            .collection('push_subscriptions')
            .where({
              _id: openid,
              remainingCount: _.gt(0),
            })
            .update({
              data: {
                remainingCount: _.inc(-1),
                lastPushedDate: today,
                updatedAt: new Date().toISOString(),
              },
            });

          sent += 1;
        } catch (err) {
          if (isError43101(err)) {
            console.warn(
              `[sendDailyPush] User "${openid}" returned 43101 (refused/no quota). Resetting remainingCount to 0.`
            );
            await db
              .collection('push_subscriptions')
              .doc(openid)
              .update({
                data: {
                  remainingCount: 0,
                  updatedAt: new Date().toISOString(),
                },
              });
            disabled += 1;
            return;
          }

          console.error(
            `[sendDailyPush] Transient push failure for user "${openid}", keeping quota intact:`,
            err
          );
          failed += 1;
        }
      });

      if (subscribers.length < BATCH_SIZE) {
        break;
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        date: today,
        skipped: false,
        totalProcessed,
        sent,
        disabled,
        failed,
      },
    };
  } catch (err) {
    console.error('[sendDailyPush] Unexpected error:', err);
    return {
      code: 500,
      message: 'Internal server error while sending daily push',
    };
  }
};

exports._internal = {
  getBeijingDateString,
  truncateThing,
  formatDateFieldValue,
  pickTopRepoForUser,
  buildSubscribePayload,
  isError43101,
  BATCH_SIZE,
  THING_MAX_LENGTH,
};
