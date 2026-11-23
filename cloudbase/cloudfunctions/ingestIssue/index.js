'use strict';

const crypto = require('crypto');
const https = require('https');
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const VALID_PERIODS = new Set(['daily', 'weekly']);
const VALID_REPO_CATEGORIES = new Set([
  'ai-agent',
  'frontend',
  'dev-tools',
  'backend-infra',
  'open-models',
  'other',
]);
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HEX64_REGEX = /^[0-9a-f]{64}$/;
const MAX_CLOCK_SKEW_SECONDS = 300;
const UPSERT_CONCURRENCY = 10;
const MSG_SEC_CHECK_MAX_CHARS = 2400;

const COMPLIANCE_RULES = require('./rules.cjs');

function parseEnvList(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }
  return raw
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchExtraTerms(corpus, extraTerms) {
  for (const term of extraTerms) {
    if (!term) continue;
    const re = new RegExp(escapeRegExp(term), 'i');
    if (re.test(corpus)) {
      return term;
    }
  }
  return null;
}

function checkRepoHardCompliance(repoData, env = process.env) {
  const allowSet = new Set(parseEnvList(env.COMPLIANCE_ALLOWLIST).map((s) => s.toLowerCase()));

  const metadataCorpus = [
    repoData.fullName,
    repoData.owner,
    repoData.name,
    repoData.description,
    repoData.language,
    repoData.license,
    repoData.url,
    Array.isArray(repoData.tags) ? repoData.tags.join(' ') : '',
  ]
    .filter(Boolean)
    .join('\n');

  const copy = repoData.ai;
  const generatedText = [copy?.tagline, copy?.whyHot, ...(copy?.highlights ?? []), copy?.targetAudience].join('\n');
  const fullCorpus = [metadataCorpus, generatedText].filter(Boolean).join('\n');

  for (const rule of COMPLIANCE_RULES) {
    if (rule.metadataPattern?.test(metadataCorpus) && !allowSet.has(repoData.fullName.toLowerCase() + '#' + rule.id)) {
      return { allowed: false, reason: rule.reason, matchedRule: rule.id };
    }
    if (rule.textPattern?.test(fullCorpus) || rule.metadataPattern?.test(generatedText)) {
      return { allowed: false, reason: rule.reason, matchedRule: rule.id };
    }
  }

  const extraMatched = matchExtraTerms(fullCorpus, parseEnvList(env.COMPLIANCE_EXTRA_BLOCKLIST));
  if (extraMatched) {
    return {
      allowed: false,
      reason: `命中自定义黑名单关键词：${extraMatched}`,
      matchedRule: `custom:${extraMatched}`,
    };
  }

  return { allowed: true };
}

function checkTextHardCompliance(text, env = process.env) {
  const cleaned = String(text || '').trim();
  if (!cleaned) {
    return { allowed: true };
  }
  for (const rule of COMPLIANCE_RULES) {
    if (rule.textPattern?.test(cleaned) || rule.metadataPattern?.test(cleaned)) {
      return { allowed: false, reason: rule.reason, matchedRule: rule.id };
    }
  }
  const extraMatched = matchExtraTerms(cleaned, parseEnvList(env.COMPLIANCE_EXTRA_BLOCKLIST));
  if (extraMatched) {
    return {
      allowed: false,
      reason: `命中自定义黑名单关键词：${extraMatched}`,
      matchedRule: `custom:${extraMatched}`,
    };
  }
  return { allowed: true };
}

function buildRepoModerationText(repoData) {
  const ai = repoData.ai || {};
  const parts = [
    repoData.fullName,
    repoData.description,
    Array.isArray(repoData.tags) ? repoData.tags.join(' ') : '',
    ai.tagline,
    ai.whyHot,
    Array.isArray(ai.highlights) ? ai.highlights.join(' ') : '',
    ai.targetAudience,
  ].filter(Boolean);
  return [repoData.owner, repoData.name, repoData.url, repoData.license, repoData.language, ...parts].join('\n');
}

let cachedWeChatToken = {
  appid: '',
  token: '',
  expiresAt: 0,
};

function postHttpsJson(urlString, bodyObj, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlString);
    const payload = Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': payload.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch (_err) {
            reject(new Error(`微信接口返回非 JSON (HTTP ${res.statusCode}): ${text.slice(0, 120)}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`微信接口 HTTP ${res.statusCode}: ${json.errmsg || text.slice(0, 120)}`));
            return;
          }
          resolve(json);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('微信审核接口请求超时'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function getWeChatStableAccessToken(env = process.env, { forceRefresh = false, postJson = postHttpsJson } = {}) {
  const appid = env.WX_APPID?.trim();
  const secret = env.WX_APPSECRET?.trim();
  if (!appid || !secret) {
    return '';
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    cachedWeChatToken.token &&
    cachedWeChatToken.appid === appid &&
    now < cachedWeChatToken.expiresAt
  ) {
    return cachedWeChatToken.token;
  }

  const res = await postJson('https://api.weixin.qq.com/cgi-bin/stable_token', {
    grant_type: 'client_credential',
    appid,
    secret,
    force_refresh: forceRefresh,
  });

  if (!res || typeof res.access_token !== 'string' || !res.access_token) {
    const code = res?.errcode ?? 'unknown';
    const msg = res?.errmsg || 'failed to acquire stable access_token';
    throw new Error(`获取微信 stable_token 失败 (${code}): ${msg}`);
  }

  const expiresInSec = Number(res.expires_in) || 7200;
  cachedWeChatToken = {
    appid,
    token: res.access_token,
    expiresAt: now + Math.max(60, expiresInSec - 300) * 1000,
  };
  return cachedWeChatToken.token;
}

async function callWeChatMsgSecViaHttps({ openid, content, env, postJson = postHttpsJson }) {
  let token = await getWeChatStableAccessToken(env, { forceRefresh: false, postJson });
  let res = await postJson(
    `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`,
    { version: 2, scene: 3, openid, content }
  );
  const code = Number(res?.errcode ?? res?.errCode);
  if (code === 40001 || code === 42001) {
    token = await getWeChatStableAccessToken(env, { forceRefresh: true, postJson });
    res = await postJson(
      `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`,
      { version: 2, scene: 3, openid, content }
    );
  }
  return res;
}

async function checkWeChatMsgSec(content, env = process.env, deps = {}) {
  const trimmed = String(content || '').trim();
  if (!trimmed) {
    return { allowed: true };
  }

  const api = cloud.openapi?.security;
  const openid = env.MSG_SEC_CHECK_OPENID?.trim();
  const hasHttpsCreds = Boolean(env.WX_APPID?.trim() && env.WX_APPSECRET?.trim());
  if (!openid || (!hasHttpsCreds && typeof api?.msgSecCheck !== 'function') || env.ENABLE_MSG_SEC_CHECK === 'false') {
    throw new Error('微信审核配置缺失或已停用');
  }
  if (trimmed.length > MSG_SEC_CHECK_MAX_CHARS) {
    return { allowed: false, reason: '文本超过送审上限', matchedRule: 'text-length' };
  }
  let res;
  try {
    res = hasHttpsCreds
      ? await callWeChatMsgSecViaHttps({
          openid,
          content: trimmed,
          env,
          postJson: deps.postJson || postHttpsJson,
        })
      : await api.msgSecCheck({ version: 2, scene: 3, openid, content: trimmed });
  } catch (err) {
    if (Number(err.errCode ?? err.errcode ?? err.code) !== 87014) throw err;
    res = { errCode: 87014 };
  }
  const errCode = res?.errCode ?? res?.errcode;
  if (errCode === 87014 || (errCode === 0 && res.result?.suggest === 'risky')) {
    return { allowed: false, reason: '微信判定违规', matchedRule: 'wx-risky' };
  }
  if (errCode === 0 && res.result?.suggest === 'review') {
    return { allowed: false, pending: true, reason: '微信要求复核', matchedRule: 'wx-review' };
  }
  if (errCode !== 0 || res.result?.suggest !== 'pass') {
    throw new Error('微信审核未取得明确结论，错误码 ' + (errCode ?? 'unknown'));
  }
  return { allowed: true };
}

async function filterCompliantPayload({ date, period, summary, repos }, env = process.env) {
  async function moderate(text, subject) {
    let decision;
    try {
      decision = await checkWeChatMsgSec(text, env);
    } catch (err) {
      decision = { allowed: false, pending: true, reason: err.message, matchedRule: 'wx-unavailable' };
    }
    const id = crypto.createHash('sha256').update(JSON.stringify([date, period, subject, text])).digest('hex');
    const records = cloud.database().collection('moderation_pending');
    if (decision.pending) {
      const record = { date, period, subject, reason: decision.reason, rule: decision.matchedRule };
      console.warn('[ingestIssue][wechat]', record);
      await records.doc(id).set({ data: { ...record, status: 'pending', text, updatedAt: new Date().toISOString() } });
      if (decision.matchedRule === 'wx-unavailable') throw new Error(decision.reason);
    } else {
      await records.where({ _id: id, status: 'pending' }).update({
        data: { status: decision.allowed ? 'passed' : 'rejected', updatedAt: new Date().toISOString() },
      });
    }
    return decision;
  }
  const compliantRepos = [];
  const filteredRepos = [];

  for (const item of repos) {
    const hardCheck = checkRepoHardCompliance(item.data, env);
    const stage = hardCheck.allowed ? 'wechat' : 'cloud-blacklist';
    const decision = hardCheck.allowed
      ? await moderate(buildRepoModerationText(item.data), item.data.fullName)
      : hardCheck;
    if (!decision.allowed) {
      const entry = { id: item.id, fullName: item.data.fullName, stage, reason: decision.reason, matchedRule: decision.matchedRule };
      filteredRepos.push(entry);
      console.warn('[ingestIssue][compliance]', { date, period, ...entry });
      continue;
    }
    compliantRepos.push(item);
  }

  if (!compliantRepos.length) return { compliantRepos, filteredRepos, safeSummary: '' };
  const fallback = (period === 'weekly' ? '本周' : '今日') + '精选 ' + compliantRepos.length + ' 个热门开源软件项目中文速览。';
  let safeSummary = summary;
  async function checkSummary(text) {
    const hard = checkTextHardCompliance(text, env);
    return hard.allowed ? moderate(text, 'issue-summary') : hard;
  }
  const decision = filteredRepos.length
    ? { allowed: false, reason: '项目列表已变更' }
    : await checkSummary(summary);
  if (!decision.allowed) {
    console.warn('[ingestIssue][summary]', { date, period, reason: decision.reason });
    if (!(await checkSummary(fallback)).allowed) throw new Error('默认总结未通过审核');
    safeSummary = fallback;
  }

  return {
    compliantRepos,
    filteredRepos,
    safeSummary,
  };
}

function normalizeHeaders(headers) {
  const result = {};
  if (!headers || typeof headers !== 'object') {
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === 'string') {
      result[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }
  }
  return result;
}

function computeSignature(secret, timestamp, rawBody) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

function verifyHmacRequest({ headers, rawBody, secret, nowMs = Date.now() }) {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return {
      ok: false,
      code: 500,
      message: 'Server misconfigured: INGEST_SECRET is not set',
    };
  }

  const normalized = normalizeHeaders(headers);
  const rawTimestamp = normalized['x-gitpulse-timestamp'];
  const rawSignature = normalized['x-gitpulse-signature'];

  if (rawTimestamp === undefined || rawTimestamp === null || String(rawTimestamp).trim() === '') {
    return {
      ok: false,
      code: 401,
      message: 'Missing x-gitpulse-timestamp header',
    };
  }

  const timestampStr = String(rawTimestamp).trim();
  if (!/^\d+$/.test(timestampStr)) {
    return {
      ok: false,
      code: 401,
      message: 'Invalid x-gitpulse-timestamp format',
    };
  }

  const timestampSec = Number.parseInt(timestampStr, 10);
  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - timestampSec) > MAX_CLOCK_SKEW_SECONDS) {
    return {
      ok: false,
      code: 401,
      message: 'Request timestamp expired or outside allowed +/-300s window',
    };
  }

  if (typeof rawSignature !== 'string' || !rawSignature.trim()) {
    return {
      ok: false,
      code: 401,
      message: 'Missing x-gitpulse-signature header',
    };
  }

  const providedHex = rawSignature.trim().toLowerCase();
  if (!HEX64_REGEX.test(providedHex)) {
    return {
      ok: false,
      code: 401,
      message: 'Invalid x-gitpulse-signature format',
    };
  }

  const expectedHex = computeSignature(secret, timestampStr, rawBody);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(providedHex, 'hex');

  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return {
      ok: false,
      code: 401,
      message: 'HMAC signature verification failed',
    };
  }

  return { ok: true };
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function normalizeRepoItem(rawRepo, issueDate, nowIso) {
  if (!rawRepo || typeof rawRepo !== 'object') {
    throw new Error('Each repo entry must be an object');
  }

  let owner = typeof rawRepo.owner === 'string' ? rawRepo.owner.trim() : '';
  let name = typeof rawRepo.name === 'string' ? rawRepo.name.trim() : '';
  let fullName = typeof rawRepo.fullName === 'string' ? rawRepo.fullName.trim() : '';

  if ((!owner || !name) && fullName.includes('/')) {
    const parts = fullName.split('/');
    owner = owner || parts[0].trim();
    name = name || parts.slice(1).join('/').trim();
  }
  if (!fullName && owner && name) {
    fullName = `${owner}/${name}`;
  }
  if (!owner || !name || !fullName) {
    throw new Error('Repo item missing required owner/name/fullName');
  }

  const canonicalId = (
    typeof rawRepo._id === 'string' && rawRepo._id.trim()
      ? rawRepo._id.trim()
      : `${owner}__${name}`
  ).toLowerCase();

  const rawAi = rawRepo.ai && typeof rawRepo.ai === 'object' ? rawRepo.ai : {};
  const highlights = Array.isArray(rawAi.highlights)
    ? rawAi.highlights.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  const category = VALID_REPO_CATEGORIES.has(rawRepo.category) ? rawRepo.category : 'other';
  const tags = Array.isArray(rawRepo.tags)
    ? rawRepo.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 6)
    : [];

  const data = {
    fullName,
    owner,
    name,
    url:
      typeof rawRepo.url === 'string' && rawRepo.url.trim()
        ? rawRepo.url.trim()
        : `https://github.com/${owner}/${name}`,
    description: typeof rawRepo.description === 'string' ? rawRepo.description : '',
    language:
      typeof rawRepo.language === 'string' && rawRepo.language.trim()
        ? rawRepo.language.trim()
        : 'Unknown',
    languageColor:
      typeof rawRepo.languageColor === 'string' && rawRepo.languageColor.trim()
        ? rawRepo.languageColor.trim()
        : '#8C949C',
    stars: toFiniteNumber(rawRepo.stars, 0),
    starsToday: toFiniteNumber(rawRepo.starsToday, 0),
    forks: toFiniteNumber(rawRepo.forks, 0),
    license:
      typeof rawRepo.license === 'string' && rawRepo.license.trim()
        ? rawRepo.license.trim()
        : 'Unknown',
    category,
    tags,
    ai: {
      tagline: typeof rawAi.tagline === 'string' ? rawAi.tagline : '',
      whyHot: typeof rawAi.whyHot === 'string' ? rawAi.whyHot : '',
      highlights,
      targetAudience: typeof rawAi.targetAudience === 'string' ? rawAi.targetAudience : '',
      aiStatus: rawAi.aiStatus === 'ok' ? 'ok' : 'fallback',
    },
    latestDate:
      typeof rawRepo.latestDate === 'string' && DATE_REGEX.test(rawRepo.latestDate)
        ? rawRepo.latestDate
        : issueDate,
    updatedAt:
      typeof rawRepo.updatedAt === 'string' && rawRepo.updatedAt.trim()
        ? rawRepo.updatedAt.trim()
        : nowIso,
  };

  return { id: canonicalId, data };
}

function validatePayload(payload, nowIso) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }

  const { date, period, summary, topCategory, repos } = payload;

  if (typeof date !== 'string' || !DATE_REGEX.test(date)) {
    return { ok: false, message: 'Invalid date: expected YYYY-MM-DD' };
  }

  if (!VALID_PERIODS.has(period)) {
    return { ok: false, message: 'Invalid period: expected "daily" or "weekly"' };
  }

  if (typeof summary !== 'string' || !summary.trim()) {
    return { ok: false, message: 'Invalid summary: must be a non-empty string' };
  }

  if (!VALID_REPO_CATEGORIES.has(topCategory)) {
    return { ok: false, message: 'Invalid topCategory' };
  }

  if (!Array.isArray(repos) || repos.length === 0) {
    return { ok: false, message: 'Invalid repos: must be a non-empty array' };
  }

  const normalizedRepos = [];
  const seenIds = new Set();
  for (let i = 0; i < repos.length; i += 1) {
    try {
      const normalized = normalizeRepoItem(repos[i], date, nowIso);
      if (!seenIds.has(normalized.id)) {
        seenIds.add(normalized.id);
        normalizedRepos.push(normalized);
      }
    } catch (err) {
      return { ok: false, message: `Invalid repo at index ${i}: ${err.message}` };
    }
  }

  return {
    ok: true,
    value: {
      date,
      period,
      summary: summary.trim(),
      topCategory,
      repos: normalizedRepos,
    },
  };
}

function formatResponse(isHttpTrigger, payload, httpStatusOverride) {
  if (!isHttpTrigger) {
    return payload;
  }
  const statusMap = {
    0: 200,
    400: 400,
    401: 401,
    404: 404,
    405: 405,
    422: 422,
    500: 500,
  };
  const statusCode = httpStatusOverride || statusMap[payload.code] || 500;
  return {
    isBase64Encoded: false,
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  };
}

function extractRawBody(event) {
  if (typeof event.rawBody === 'string') {
    return event.rawBody;
  }
  if (typeof event.body === 'string') {
    if (event.isBase64Encoded) {
      return Buffer.from(event.body, 'base64').toString('utf8');
    }
    return event.body;
  }
  if (event.body && typeof event.body === 'object') {
    return JSON.stringify(event.body);
  }
  return '';
}

async function runInBatches(items, batchSize, worker) {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.all(chunk.map((item) => worker(item)));
  }
}

exports.main = async (event = {}) => {
  const isHttpTrigger = typeof event.httpMethod === 'string';

  if (isHttpTrigger && event.httpMethod.toUpperCase() !== 'POST') {
    return formatResponse(
      true,
      { code: 400, message: `Method ${event.httpMethod} not allowed; expected POST` },
      405
    );
  }

  const rawBody = extractRawBody(event);
  const verification = verifyHmacRequest({
    headers: event.headers,
    rawBody,
    secret: process.env.INGEST_SECRET,
    nowMs: Date.now(),
  });

  if (!verification.ok) {
    return formatResponse(isHttpTrigger, {
      code: verification.code,
      message: verification.message,
    });
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (_err) {
    return formatResponse(isHttpTrigger, {
      code: 400,
      message: 'Malformed JSON request body',
    });
  }

  const nowIso = new Date().toISOString();
  const validation = validatePayload(parsedBody, nowIso);
  if (!validation.ok) {
    return formatResponse(isHttpTrigger, {
      code: 400,
      message: validation.message,
    });
  }

  const { date, period, summary, topCategory, repos } = validation.value;
  const issueId = `${date}_${period}`;
  const db = cloud.database();

  try {
    // 0. Defense-in-depth content compliance & WeChat msgSecCheck filtering
    const { compliantRepos, filteredRepos, safeSummary } = await filterCompliantPayload(
      { date, period, summary, repos },
      process.env
    );


    if (compliantRepos.length === 0) {
      return formatResponse(isHttpTrigger, {
        code: 422,
        message: 'All repositories in payload were blocked by content compliance policy',
        data: {
          filteredRepos,
        },
      });
    }

    // 1. Idempotently upsert all compliant repositories in bounded batches
    await runInBatches(compliantRepos, UPSERT_CONCURRENCY, async ({ id, data }) => {
      await db.collection('repos').doc(id).set({ data });
    });

    // 2. Check whether this issue already exists to keep issueNo and publishedAt idempotent
    const existingRes = await db
      .collection('daily_issues')
      .where({ _id: issueId })
      .limit(1)
      .get();

    const existingIssue =
      existingRes && Array.isArray(existingRes.data) && existingRes.data.length > 0
        ? existingRes.data[0]
        : null;

    let issueNo;
    let publishedAt = nowIso;

    if (existingIssue && Number.isInteger(existingIssue.issueNo) && existingIssue.issueNo >= 1) {
      issueNo = existingIssue.issueNo;
      if (typeof existingIssue.publishedAt === 'string' && existingIssue.publishedAt) {
        publishedAt = existingIssue.publishedAt;
      }
    } else {
      const latestRes = await db
        .collection('daily_issues')
        .where({ period })
        .orderBy('issueNo', 'desc')
        .limit(1)
        .get();

      const latestIssue =
        latestRes && Array.isArray(latestRes.data) && latestRes.data.length > 0
          ? latestRes.data[0]
          : null;

      issueNo =
        latestIssue && Number.isInteger(latestIssue.issueNo) && latestIssue.issueNo >= 1
          ? latestIssue.issueNo + 1
          : 1;
    }

    const scores = new Map();
    for (const { data } of compliantRepos) {
      const score = scores.get(data.category) || { count: 0, stars: 0 };
      score.count += 1;
      score.stars += data.starsToday;
      scores.set(data.category, score);
    }
    const publishedCategory = filteredRepos.length ? [...scores].sort((a, b) => b[1].count - a[1].count || b[1].stars - a[1].stars)[0][0] : topCategory;
    const issueDoc = {
      date,
      period,
      issueNo,
      summary: safeSummary,
      topCategory: publishedCategory,
      repoIds: compliantRepos.map((item) => item.id),
      publishedAt,
    };

    await db.collection('daily_issues').doc(issueId).set({ data: issueDoc });

    const responseData = {
      issueId,
      issueNo,
      upsertedRepos: compliantRepos.length,
      repoIds: issueDoc.repoIds,
      summary: safeSummary,
      topCategory: publishedCategory,
    };
    if (filteredRepos.length > 0) {
      responseData.filteredRepos = filteredRepos;
    }

    return formatResponse(isHttpTrigger, {
      code: 0,
      message: 'ok',
      data: responseData,
    });
  } catch (err) {
    console.error('[ingestIssue] Failed to persist issue:', err);
    return formatResponse(isHttpTrigger, {
      code: 500,
      message: 'Internal server error while persisting issue',
    });
  }
};

exports._internal = {
  computeSignature,
  verifyHmacRequest,
  normalizeRepoItem,
  validatePayload,
  checkRepoHardCompliance,
  checkTextHardCompliance,
  checkWeChatMsgSec,
  filterCompliantPayload,
  MAX_CLOCK_SKEW_SECONDS,
};
