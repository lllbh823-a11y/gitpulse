'use strict';

const Module = require('module');
const path = require('path');

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getPathValue(obj, fieldPath) {
  const parts = String(fieldPath).split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isCommand(value) {
  return Boolean(value && typeof value === 'object' && value.__cmdType);
}

function isDbRegExp(value) {
  return Boolean(value && typeof value === 'object' && value.__dbRegExp);
}

function matchSingleValue(actual, expected) {
  if (isDbRegExp(expected)) {
    const re = new RegExp(expected.regexp, expected.options || '');
    if (Array.isArray(actual)) {
      return actual.some((entry) => typeof entry === 'string' && re.test(entry));
    }
    return typeof actual === 'string' && re.test(actual);
  }

  if (isCommand(expected)) {
    switch (expected.__cmdType) {
      case 'in':
        if (Array.isArray(actual)) {
          return actual.some((entry) => expected.value.includes(entry));
        }
        return expected.value.includes(actual);
      case 'gt':
        return actual !== undefined && actual !== null && actual > expected.value;
      case 'gte':
        return actual !== undefined && actual !== null && actual >= expected.value;
      case 'lt':
        return actual !== undefined && actual !== null && actual < expected.value;
      case 'lte':
        return actual !== undefined && actual !== null && actual <= expected.value;
      case 'neq':
        return actual !== expected.value;
      case 'eq':
        return actual === expected.value;
      default:
        throw new Error(`Unsupported mock db command: ${expected.__cmdType}`);
    }
  }

  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.includes(expected);
  }
  return actual === expected;
}

function matchCondition(doc, condition) {
  if (!condition || Object.keys(condition).length === 0) {
    return true;
  }

  if (isCommand(condition)) {
    if (condition.__cmdType === 'and') {
      return condition.value.every((sub) => matchCondition(doc, sub));
    }
    if (condition.__cmdType === 'or') {
      return condition.value.some((sub) => matchCondition(doc, sub));
    }
    throw new Error(`Unsupported top-level command: ${condition.__cmdType}`);
  }

  for (const [key, expected] of Object.entries(condition)) {
    const actual = getPathValue(doc, key);
    if (!matchSingleValue(actual, expected)) {
      return false;
    }
  }
  return true;
}

function applyProjection(doc, projection) {
  if (!projection || Object.keys(projection).length === 0) {
    return deepClone(doc);
  }
  const out = { _id: doc._id };
  for (const [key, include] of Object.entries(projection)) {
    if (include && doc[key] !== undefined) {
      out[key] = deepClone(doc[key]);
    }
  }
  return out;
}

function applyUpdate(doc, updateData) {
  const next = deepClone(doc);
  for (const [key, value] of Object.entries(updateData)) {
    if (key === '_id') {
      throw new Error('Cannot update immutable field _id');
    }
    if (isCommand(value) && value.__cmdType === 'inc') {
      const current = typeof next[key] === 'number' ? next[key] : 0;
      next[key] = current + value.value;
    } else {
      next[key] = deepClone(value);
    }
  }
  return next;
}

function createMockWxSdk(options = {}) {
  const collections = new Map();
  let openid = options.openid !== undefined ? options.openid : 'mock-openid-user-1';
  let autoIdSeq = 1;
  const sentMessages = [];
  const msgSecChecks = [];
  let sendHandler = options.onSendSubscribeMessage || (async () => ({ errCode: 0, errMsg: 'ok' }));
  let msgSecHandler = options.onMsgSecCheck || (async () => ({ errCode: 0, result: { suggest: 'pass' } }));

  function ensureCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  function seed(collectionName, docs) {
    const store = ensureCollection(collectionName);
    for (const rawDoc of docs) {
      const doc = deepClone(rawDoc);
      if (!doc._id) {
        doc._id = `${collectionName}_auto_${autoIdSeq++}`;
      }
      store.set(doc._id, doc);
    }
  }

  function getAll(collectionName) {
    const store = ensureCollection(collectionName);
    return Array.from(store.values()).map((doc) => deepClone(doc));
  }

  function getById(collectionName, id) {
    const store = ensureCollection(collectionName);
    const doc = store.get(id);
    return doc ? deepClone(doc) : null;
  }

  const command = {
    in: (value) => ({ __cmdType: 'in', value }),
    gt: (value) => ({ __cmdType: 'gt', value }),
    gte: (value) => ({ __cmdType: 'gte', value }),
    lt: (value) => ({ __cmdType: 'lt', value }),
    lte: (value) => ({ __cmdType: 'lte', value }),
    neq: (value) => ({ __cmdType: 'neq', value }),
    eq: (value) => ({ __cmdType: 'eq', value }),
    inc: (value) => ({ __cmdType: 'inc', value }),
    and: (value) => ({ __cmdType: 'and', value }),
    or: (value) => ({ __cmdType: 'or', value }),
  };

  function createQuery(collectionName, state = {}) {
    const queryState = {
      whereCond: state.whereCond || null,
      orderBys: state.orderBys ? [...state.orderBys] : [],
      skipCount: state.skipCount || 0,
      limitCount: state.limitCount !== undefined ? state.limitCount : 100,
      projection: state.projection || null,
    };

    function runFilter() {
      const store = ensureCollection(collectionName);
      let rows = Array.from(store.values());
      if (queryState.whereCond) {
        rows = rows.filter((doc) => matchCondition(doc, queryState.whereCond));
      }
      if (queryState.orderBys.length > 0) {
        rows.sort((a, b) => {
          for (const { field, direction } of queryState.orderBys) {
            const va = getPathValue(a, field);
            const vb = getPathValue(b, field);
            if (va === vb) continue;
            if (va === undefined || va === null) return direction === 'asc' ? -1 : 1;
            if (vb === undefined || vb === null) return direction === 'asc' ? 1 : -1;
            if (va < vb) return direction === 'asc' ? -1 : 1;
            if (va > vb) return direction === 'asc' ? 1 : -1;
          }
          return 0;
        });
      }
      return rows;
    }

    return {
      where(cond) {
        return createQuery(collectionName, { ...queryState, whereCond: cond });
      },
      orderBy(field, direction = 'asc') {
        return createQuery(collectionName, {
          ...queryState,
          orderBys: [...queryState.orderBys, { field, direction }],
        });
      },
      skip(n) {
        return createQuery(collectionName, { ...queryState, skipCount: n });
      },
      limit(n) {
        return createQuery(collectionName, { ...queryState, limitCount: n });
      },
      field(projection) {
        return createQuery(collectionName, { ...queryState, projection });
      },
      async get() {
        const filtered = runFilter();
        const sliced = filtered.slice(
          queryState.skipCount,
          queryState.skipCount + queryState.limitCount
        );
        return {
          data: sliced.map((doc) => applyProjection(doc, queryState.projection)),
        };
      },
      async count() {
        const filtered = runFilter();
        return { total: filtered.length };
      },
      async remove() {
        const store = ensureCollection(collectionName);
        const matched = runFilter();
        for (const doc of matched) {
          store.delete(doc._id);
        }
        return { stats: { removed: matched.length } };
      },
      async update({ data }) {
        const store = ensureCollection(collectionName);
        const matched = runFilter();
        for (const doc of matched) {
          store.set(doc._id, applyUpdate(doc, data));
        }
        return { stats: { updated: matched.length } };
      },
    };
  }

  function collection(collectionName) {
    const baseQuery = createQuery(collectionName);

    return {
      ...baseQuery,
      async add({ data }) {
        const store = ensureCollection(collectionName);
        const doc = deepClone(data);
        if (!doc._id) {
          doc._id = `${collectionName}_auto_${autoIdSeq++}`;
        }

        // Enforce unique composite index openid + repoId on user_bookmarks
        if (collectionName === 'user_bookmarks') {
          for (const existing of store.values()) {
            if (existing.openid === doc.openid && existing.repoId === doc.repoId) {
              const dupErr = new Error('E11000 duplicate key error on user_bookmarks(openid, repoId)');
              dupErr.errCode = -502001;
              throw dupErr;
            }
          }
        }

        store.set(doc._id, doc);
        return { _id: doc._id };
      },
      doc(id) {
        return {
          async get() {
            const store = ensureCollection(collectionName);
            if (!store.has(id)) {
              const err = new Error(`document with _id ${id} does not exist`);
              err.errCode = -502005;
              throw err;
            }
            return { data: deepClone(store.get(id)) };
          },
          async set({ data }) {
            if (Object.prototype.hasOwnProperty.call(data, '_id')) {
              throw new Error('CloudBase doc().set({ data }) must not contain _id inside data');
            }
            const store = ensureCollection(collectionName);
            const record = { ...deepClone(data), _id: id };
            store.set(id, record);
            return { _id: id, stats: { updated: 1 } };
          },
          async update({ data }) {
            const store = ensureCollection(collectionName);
            if (!store.has(id)) {
              return { stats: { updated: 0 } };
            }
            const updated = applyUpdate(store.get(id), data);
            store.set(id, updated);
            return { stats: { updated: 1 } };
          },
          async remove() {
            const store = ensureCollection(collectionName);
            const existed = store.delete(id);
            return { stats: { removed: existed ? 1 : 0 } };
          },
        };
      },
    };
  }

  const sdk = {
    DYNAMIC_CURRENT_ENV: 'mock-dynamic-env',
    initCalls: [],
    init(cfg) {
      sdk.initCalls.push(cfg);
    },
    getWXContext() {
      return {
        OPENID: openid,
        APPID: 'wx-mock-appid',
        ENV: 'mock-env',
      };
    },
    database() {
      return {
        collection,
        command,
        RegExp({ regexp, options: reOptions }) {
          return { __dbRegExp: true, regexp, options: reOptions || '' };
        },
      };
    },
    openapi: {
      subscribeMessage: {
        async send(params) {
          sentMessages.push(deepClone(params));
          return sendHandler(params);
        },
      },
      security: {
        async msgSecCheck(params) {
          msgSecChecks.push(deepClone(params));
          return msgSecHandler(params);
        },
      },
    },
    // Test helpers
    __test: {
      setOpenId(nextOpenId) {
        openid = nextOpenId;
      },
      setSendHandler(fn) {
        sendHandler = fn;
      },
      setMsgSecHandler(fn) {
        msgSecHandler = fn;
      },
      getMsgSecChecks() {
        return msgSecChecks;
      },
      getSentMessages() {
        return sentMessages;
      },
      clearSentMessages() {
        sentMessages.length = 0;
      },
      seed,
      getAll,
      getById,
    },
  };

  return sdk;
}

function loadCloudFunction(fnName, mockSdk) {
  const fnEntryPath = path.resolve(
    __dirname,
    '..',
    '..',
    'cloudfunctions',
    fnName,
    'index.js'
  );
  delete require.cache[fnEntryPath];

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return mockSdk;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(fnEntryPath);
  } finally {
    Module._load = originalLoad;
  }
}

function makeSampleRepo(overrides = {}) {
  const owner = overrides.owner || 'anthropics';
  const name = overrides.name || 'claude-code';
  const fullName = overrides.fullName || `${owner}/${name}`;
  const id = (overrides._id || `${owner}__${name}`).toLowerCase();
  return {
    _id: id,
    fullName,
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
    description: 'An agentic coding tool that lives in your terminal.',
    language: 'TypeScript',
    languageColor: '#3178c6',
    stars: 42000,
    starsToday: 1280,
    forks: 3400,
    license: 'MIT',
    category: 'ai-agent',
    tags: ['AI Agent', 'CLI', 'TypeScript'],
    ai: {
      tagline: '终端原生 AI 编程智能体，自动规划并执行跨文件开发任务',
      whyHot: '开发者无需离开命令行即可完成复杂代码检索、重构与自动化测试，大幅缩短研发闭环。',
      highlights: [
        '原生深度理解整个代码库上下文与 Git 变更历史',
        '支持自动执行构建、单测并根据报错自主修复代码',
        '轻量 CLI 架构，适配任意本地编辑器与远程开发容器',
      ],
      targetAudience: '全栈工程师、后端开发者与高频命令行重度用户',
      aiStatus: 'ok',
    },
    latestDate: '2026-11-22',
    updatedAt: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

module.exports = {
  createMockWxSdk,
  loadCloudFunction,
  makeSampleRepo,
};
