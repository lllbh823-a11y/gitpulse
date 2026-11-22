import {
  CATEGORY_LABELS,
  REPO_CATEGORY_IDS,
  type EnrichedRepo,
  type RepoAIEnrichment,
  type RepoAISummary,
  type RepoCategoryId,
  type RepoItem,
  type TrendingPeriod,
} from './types.js';
import { fetchWithTimeout, normalizeWhitespace, runWithConcurrency, sleep } from './utils.js';

export interface AISummarizerConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  concurrency?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  skipAI?: boolean;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'warn' | 'info'>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

const VALID_CATEGORIES = new Set<string>(REPO_CATEGORY_IDS);

function truncateChars(text: string, maxChars: number): string {
  const cleaned = normalizeWhitespace(text);
  const chars = Array.from(cleaned);
  if (chars.length <= maxChars) {
    return cleaned;
  }
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Empty LLM response');
  }

  // Strip ```json ... ``` fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Attempt extracting outermost JSON object substring
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Response is not valid JSON');
  }
}

export function inferCategory(repo: Pick<EnrichedRepo, 'fullName' | 'description' | 'language' | 'topics' | 'readmeExcerpt'>): RepoCategoryId {
  const corpus = [
    repo.fullName,
    repo.description,
    repo.language,
    repo.topics.join(' '),
    repo.readmeExcerpt.slice(0, 800),
  ]
    .join(' ')
    .toLowerCase();

  if (
    /\b(llm|vlm|gguf|checkpoint|weights|fine-?tun|pretrain|foundation model|diffusion|llama|qwen|deepseek|mistral|gemma|whisper|embedding model|tts|ocr model)\b/.test(
      corpus,
    )
  ) {
    return 'open-models';
  }

  if (
    /\b(agents?|agentic|mcp|model context protocol|rag|copilot|claude|openai|langchain|langgraph|autogen|crewai|prompts?|ai assistant|chatbot|coding assistant|workflow automation)\b/.test(
      corpus,
    )
  ) {
    return 'ai-agent';
  }

  if (
    /\b(react|vue|svelte|nextjs|next\.js|nuxt|tailwind|css|ui library|component library|shadcn|frontend|browser|canvas|webgl|three\.js|taro|flutter|swiftui|design system)\b/.test(
      corpus,
    )
  ) {
    return 'frontend';
  }

  if (
    /\b(kubernetes|k8s|docker|database|postgres|postgresql|mysql|sqlite|redis|clickhouse|distributed|microservice|proxy|gateway|load balancer|grpc|kafka|storage engine|serverless|cloud native|kernel|operating system)\b/.test(
      corpus,
    )
  ) {
    return 'backend-infra';
  }

  if (
    /\b(cli|terminal|tui|editor|ide|neovim|vim|vscode|git|linter|formatter|debugger|testing|build tool|bundler|compiler|sdk|devtools|developer tool|benchmark|profiler)\b/.test(
      corpus,
    )
  ) {
    return 'dev-tools';
  }

  if (['TypeScript', 'JavaScript', 'CSS', 'Vue', 'Svelte', 'HTML'].includes(repo.language)) {
    return 'frontend';
  }
  if (['Go', 'Rust', 'C', 'C++', 'Java'].includes(repo.language)) {
    return 'backend-infra';
  }
  return 'other';
}

export function inferTags(
  repo: Pick<EnrichedRepo, 'language' | 'topics' | 'description' | 'fullName'>,
  category: RepoCategoryId,
): string[] {
  const tags: string[] = [];
  const pushTag = (value: string) => {
    const clean = normalizeWhitespace(value).slice(0, 18);
    if (!clean) {
      return;
    }
    if (!tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      tags.push(clean);
    }
  };

  if (repo.language && repo.language !== 'Unknown') {
    pushTag(repo.language);
  }

  for (const topic of repo.topics) {
    if (tags.length >= 3) {
      break;
    }
    const formatted = topic
      .replace(/[-_]+/g, ' ')
      .replace(/\b(ai|llm|cli|ui|sdk|mcp|rag|api|sql)\b/gi, (m) => m.toUpperCase());
    if (formatted.length <= 16) {
      pushTag(formatted);
    }
  }

  const categoryDefaults: Record<RepoCategoryId, string[]> = {
    'ai-agent': ['AI Agent', '自动化', '开源工作流'],
    frontend: ['前端生态', 'UI 组件', 'Web 开发'],
    'dev-tools': ['效率工具', '开发者工具', 'CLI'],
    'backend-infra': ['后端架构', '基础设施', '高性能'],
    'open-models': ['开源模型', '大模型', 'AI 推理'],
    other: ['开源精选', '实用项目', '热门趋势'],
  };

  for (const fallbackTag of categoryDefaults[category]) {
    if (tags.length >= 3) {
      break;
    }
    pushTag(fallbackTag);
  }

  return tags.slice(0, 3);
}

export function buildFallbackRepoAI(repo: EnrichedRepo): RepoAIEnrichment {
  const category = inferCategory(repo);
  const tags = inferTags(repo, category);
  const categoryLabel = CATEGORY_LABELS[category];
  const langLabel = repo.language !== 'Unknown' ? repo.language : '多语言';
  const periodLabel = repo.period === 'weekly' ? '本周' : '今日';
  const shortName = truncateChars(repo.name, 16);
  const starsText = repo.stars.toLocaleString('en-US');
  const deltaText = repo.starsToday.toLocaleString('en-US');

  const taglineCandidate = `${shortName}：${langLabel} ${categoryLabel}热门开源项目`;
  const tagline =
    Array.from(taglineCandidate).length <= 32
      ? taglineCandidate
      : truncateChars(`${shortName}：${categoryLabel}高人气开源项目`, 32);

  const briefDesc = repo.description ? truncateChars(repo.description, 32) : '';
  const whyHot = briefDesc
    ? truncateChars(
        `${periodLabel}新增 ${deltaText} Star，累计 ${starsText} Star；聚焦「${briefDesc}」，受到社区高频关注。`,
        90,
      )
    : `${periodLabel}新增 ${deltaText} Star，累计 ${starsText} Star，登上 GitHub ${periodLabel}热榜，成为${categoryLabel}方向焦点。`;

  const highlights: string[] = [
    truncateChars(`基于 ${langLabel} 构建，累计收获 ${starsText} Star 与 ${repo.forks} Fork`, 36),
    truncateChars(
      repo.license !== 'Unknown'
        ? `采用 ${repo.license} 开源协议，便于评估引入与二次定制`
        : `源码结构完整开放，支持直接克隆到本地运行体验`,
      36,
    ),
    truncateChars(
      repo.description
        ? `聚焦场景：${truncateChars(repo.description, 26)}`
        : `入选 GitHub ${periodLabel}趋势榜，社区活跃度持续攀升`,
      36,
    ),
  ];

  const targetAudience = truncateChars(
    `关注 ${categoryLabel} 与 ${langLabel} 生态的开发者及团队`,
    40,
  );

  return {
    category,
    tags,
    ai: {
      tagline,
      whyHot,
      highlights,
      targetAudience,
      aiStatus: 'fallback',
    },
  };
}

export function parseAndValidateRepoAIResponse(
  rawText: string,
  repo: Pick<EnrichedRepo, 'language' | 'topics' | 'description' | 'fullName'>,
): RepoAIEnrichment {
  const parsed = extractJsonObject(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI response root must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Handle explicit AI compliance rejection even if summary fields were omitted
  if (obj.compliant === false) {
    const rawReason =
      typeof obj.complianceReason === 'string' && obj.complianceReason.trim()
        ? normalizeWhitespace(obj.complianceReason)
        : 'AI 合规审查判定为不适宜公开展示的项目';
    const fallbackCategory = VALID_CATEGORIES.has(String(obj.category || '').trim())
      ? (String(obj.category).trim() as RepoCategoryId)
      : 'other';
    return {
      category: fallbackCategory,
      tags: [],
      ai: {
        tagline: '已由内容合规策略拦截',
        whyHot: rawReason,
        highlights: [rawReason, rawReason, rawReason],
        targetAudience: '不适用',
        aiStatus: 'ok',
      },
      compliance: {
        allowed: false,
        category: 'ai-flagged',
        reason: truncateChars(rawReason, 80),
        matchedRule: 'llm-compliance-gate',
      },
    };
  }

  if (obj.compliant !== true) throw new Error('Field compliant must be boolean');
  const categoryRaw = typeof obj.category === 'string' ? obj.category.trim() : '';
  if (!VALID_CATEGORIES.has(categoryRaw)) {
    throw new Error(`Invalid category: "${categoryRaw}"`);
  }
  const category = categoryRaw as RepoCategoryId;

  const tagline = typeof obj.tagline === 'string' ? normalizeWhitespace(obj.tagline) : '';
  const whyHot = typeof obj.whyHot === 'string' ? normalizeWhitespace(obj.whyHot) : '';
  const targetAudience = typeof obj.targetAudience === 'string' ? normalizeWhitespace(obj.targetAudience) : '';

  if (tagline.length < 4) {
    throw new Error('Field "tagline" is missing or too short');
  }
  if (whyHot.length < 10) {
    throw new Error('Field "whyHot" is missing or too short');
  }
  if (targetAudience.length < 4) {
    throw new Error('Field "targetAudience" is missing or too short');
  }

  if (!Array.isArray(obj.highlights)) {
    throw new Error('Field "highlights" must be an array');
  }
  const highlights = obj.highlights
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length >= 4);

  if (highlights.length < 3) {
    throw new Error(`Field "highlights" must contain 3 valid items, got ${highlights.length}`);
  }

  const rawTags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeWhitespace(item))
        .filter((item) => item.length > 0 && item.length <= 24)
    : [];

  const dedupedTags: string[] = [];
  for (const tag of rawTags) {
    if (!dedupedTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      dedupedTags.push(tag);
    }
  }

  let finalTags = dedupedTags.slice(0, 3);
  if (finalTags.length < 2) {
    const supplemental = inferTags(repo, category);
    for (const candidate of supplemental) {
      if (finalTags.length >= 3) {
        break;
      }
      if (!finalTags.some((t) => t.toLowerCase() === candidate.toLowerCase())) {
        finalTags.push(candidate);
      }
    }
    finalTags = finalTags.slice(0, 3);
  }

  const ai: RepoAISummary = {
    tagline: truncateChars(tagline, 40),
    whyHot: truncateChars(whyHot, 110),
    highlights: highlights.slice(0, 3).map((item) => truncateChars(item, 44)),
    targetAudience: truncateChars(targetAudience, 50),
    aiStatus: 'ok',
  };

  return {
    category,
    tags: finalTags,
    ai,
    compliance: { allowed: true },
  };
}

function buildRepoPrompts(repo: EnrichedRepo): { system: string; user: string } {
  const system = [
    '你是 GitPulse（开源每日脉搏）的资深技术编辑与内容合规审核员，擅长将 GitHub 热门仓库提炼为精准、克制、高信息密度的中文技术速览。',
    '你必须只输出一个严格合法的 JSON 对象，不要包含任何 Markdown 说明或额外文字。',
    '内容合规审核要求（面向中国大陆公开发布的微信小程序）：',
    '1. 若该项目属于以下任一高风险类别，必须将 compliant 设为 false 并在 complianceReason 中说明原因：',
    '   - 翻墙/代理/科学上网客户端、节点订阅、VPN 绕过工具（注意：常规服务端反向代理/网关如 Nginx、Envoy、Traefik 属于正常基础设施，不应误判）；',
    '   - 软件破解、盗版激活、盗版影视/资源抓取、勒索木马、免杀攻击或黑灰产外挂工具；',
    '   - 色情低俗、NSFW、成人内容或博彩赌博相关工具；',
    '   - 涉政敏感、反审查汇总或高风险时政话题仓库。',
    '2. 正常合法的开源开发工具、AI 框架、前后端组件、数据库、模型等项目，将 compliant 设为 true。',
    'JSON 字段规范如下：',
    '- compliant: 布尔值（true 表示合规可公开展示；false 表示应拦截过滤）',
    '- complianceReason: 字符串，仅 compliant 为 false 时填写简短拦截原因，否则为空字符串 ""',
    '- category: 必须严格取以下枚举之一："ai-agent" | "frontend" | "dev-tools" | "backend-infra" | "open-models" | "other"',
    '- tags: 字符串数组，2~3 个简短中文或技术标签（如 ["AI Agent", "CLI", "TypeScript"]）',
    '- tagline: 字符串，15~32字，一句话看懂核心价值',
    '- whyHot: 字符串，40~90字，解释为什么近期爆火、解决了什么实际痛点',
    '- highlights: 字符串数组，严格固定 3 条核心亮点，每条 12~36 字，突出具体能力或差异化优势',
    '- targetAudience: 字符串，15~40字，说明最适合什么开发者角色或业务场景使用',
  ].join('\n');

  const user = [
    `仓库名：${repo.fullName}`,
    `榜单周期：${repo.period === 'weekly' ? 'GitHub 本周热榜' : 'GitHub 今日热榜'}（第 ${repo.rank} 名）`,
    `编程语言：${repo.language}`,
    `开源协议：${repo.license}`,
    `总 Star：${repo.stars} | 本期新增 Star：${repo.starsToday} | Fork：${repo.forks}`,
    `GitHub 原始简介：${repo.description || '(无)'}`,
    `Topics：${repo.topics.length > 0 ? repo.topics.join(', ') : '(无)'}`,
    `README 精简内容：\n${repo.readmeExcerpt || '(未获取到 README)'}`,
  ].join('\n');

  return { system, user };
}

async function callChatCompletion(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  config: AISummarizerConfig,
  requireJsonObject: boolean,
): Promise<string> {
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = config.apiKey?.trim();
  const model = config.model?.trim() || 'gpt-4o-mini';
  const timeoutMs = config.timeoutMs ?? 30_000;
  const fetchImpl = config.fetchImpl ?? fetch;

  if (!apiKey) {
    throw new Error('LLM_API_KEY is not configured');
  }

  const endpoint = `${baseUrl}/chat/completions`;
  const makeRequest = async (useResponseFormat: boolean) => {
    const payload: Record<string, unknown> = {
      model,
      temperature: 0.3,
      messages,
    };
    if (useResponseFormat) {
      payload.response_format = { type: 'json_object' };
    }

    return fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      fetchImpl,
    );
  };

  let response = await makeRequest(requireJsonObject);

  // Some OpenAI-compatible gateways reject response_format=json_object with HTTP 400
  if (requireJsonObject && response.status === 400) {
    const errBody = await response.text().catch(() => '');
    if (/response_format|json_object/i.test(errBody)) {
      response = await makeRequest(false);
    } else {
      throw new Error(`LLM API HTTP 400: ${errBody.slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`LLM API HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM API returned empty choices[0].message.content');
  }
  return content;
}

export async function summarizeSingleRepo(
  repo: EnrichedRepo,
  config: AISummarizerConfig = {},
): Promise<RepoAIEnrichment> {
  const {
    maxRetries = 2,
    retryDelayMs = 800,
    skipAI = false,
    logger = console,
  } = config;

  if (skipAI || !config.apiKey?.trim()) {
    return buildFallbackRepoAI(repo);
  }

  const { system, user } = buildRepoPrompts(repo);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const content = await callChatCompletion(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        config,
        true,
      );
      return parseAndValidateRepoAIResponse(content, repo);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt < maxRetries) {
        logger.warn(
          `[aiSummarizer] Repo ${repo.fullName} attempt ${attempt + 1} failed (${msg}), retrying...`,
        );
        await sleep(retryDelayMs * (attempt + 1));
      } else {
        logger.warn(
          `[aiSummarizer] Repo ${repo.fullName} failed after ${maxRetries + 1} attempts (${msg}), falling back to deterministic summary.`,
        );
      }
    }
  }

  return buildFallbackRepoAI(repo);
}

export async function summarizeRepos(
  repos: readonly EnrichedRepo[],
  config: AISummarizerConfig = {},
  aiCache?: Map<string, RepoAIEnrichment>,
): Promise<Map<string, RepoAIEnrichment>> {
  const concurrency = config.concurrency ?? 3;
  const cache = aiCache ?? new Map<string, RepoAIEnrichment>();

  const pending: EnrichedRepo[] = [];
  const seenPending = new Set<string>();
  for (const repo of repos) {
    if (!cache.has(repo._id) && !seenPending.has(repo._id)) {
      seenPending.add(repo._id);
      pending.push(repo);
    }
  }

  const results = await runWithConcurrency(pending, concurrency, async (repo) => {
    const enrichment = await summarizeSingleRepo(repo, config);
    return { id: repo._id, enrichment };
  });

  for (const item of results) {
    cache.set(item.id, item.enrichment);
  }

  return cache;
}

export function computeTopCategory(repos: readonly Pick<RepoItem, 'category' | 'starsToday'>[]): RepoCategoryId {
  if (repos.length === 0) {
    return 'other';
  }

  const stats = new Map<RepoCategoryId, { count: number; starsToday: number; firstIndex: number }>();
  repos.forEach((repo, index) => {
    const current = stats.get(repo.category);
    if (!current) {
      stats.set(repo.category, { count: 1, starsToday: repo.starsToday, firstIndex: index });
    } else {
      current.count += 1;
      current.starsToday += repo.starsToday;
    }
  });

  let best: RepoCategoryId = 'other';
  let bestScore: { count: number; starsToday: number; firstIndex: number } | null = null;

  for (const [category, score] of stats.entries()) {
    if (!bestScore) {
      best = category;
      bestScore = score;
      continue;
    }
    if (
      score.count > bestScore.count ||
      (score.count === bestScore.count && score.starsToday > bestScore.starsToday) ||
      (score.count === bestScore.count &&
        score.starsToday === bestScore.starsToday &&
        score.firstIndex < bestScore.firstIndex)
    ) {
      best = category;
      bestScore = score;
    }
  }

  return best;
}

export function buildFallbackIssueSummary(
  period: TrendingPeriod,
  topCategory: RepoCategoryId,
  repos: readonly Pick<RepoItem, 'name' | 'starsToday'>[],
): string {
  const periodText = period === 'weekly' ? '本周' : '今日';
  const categoryLabel = CATEGORY_LABELS[topCategory];
  if (repos.length === 0) {
    return `${periodText}开源热榜聚焦${categoryLabel}赛道，精选高增长项目速览。`;
  }

  const twoNames = repos
    .slice(0, 2)
    .map((r) => r.name)
    .join('、');
  const fullCandidate = `${periodText}热榜聚焦${categoryLabel}，${twoNames}等 ${repos.length} 个项目领跑。`;
  if (Array.from(fullCandidate).length <= 48) {
    return fullCandidate;
  }

  const firstName = truncateChars(repos[0]?.name ?? '', 16);
  const singleCandidate = `${periodText}热榜聚焦${categoryLabel}，${firstName}等 ${repos.length} 个项目领跑。`;
  return truncateChars(singleCandidate, 48);
}

export async function generateIssueSummary(
  date: string,
  period: TrendingPeriod,
  repos: readonly RepoItem[],
  config: AISummarizerConfig = {},
): Promise<{ summary: string; topCategory: RepoCategoryId }> {
  const topCategory = computeTopCategory(repos);
  const {
    maxRetries = 2,
    retryDelayMs = 800,
    skipAI = false,
    logger = console,
  } = config;

  if (repos.length === 0 || skipAI || !config.apiKey?.trim()) {
    return {
      topCategory,
      summary: buildFallbackIssueSummary(period, topCategory, repos),
    };
  }

  const periodText = period === 'weekly' ? '本周' : '今日';
  const digestLines = repos.slice(0, 10).map(
    (repo, idx) =>
      `${idx + 1}. ${repo.fullName} [${CATEGORY_LABELS[repo.category]}] (+${repo.starsToday}★): ${repo.ai.tagline}`,
  );

  const system = [
    '你是 GitPulse 开源项目趋势速览技术编辑，请根据本期上榜开源软件项目，写一句客观凝练的中文技术趋势总结。',
    '只输出严格合法的 JSON：{"summary": "..."}。',
    '要求：20~48字，不要加引号或序号，仅聚焦软件技术趋势，不使用新闻媒体或煽动性口吻。',
  ].join('\n');

  const user = [
    `日期：${date}（${periodText}热榜，共 ${repos.length} 个项目，最热领域：${CATEGORY_LABELS[topCategory]}）`,
    '代表项目：',
    ...digestLines,
  ].join('\n');

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const content = await callChatCompletion(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        config,
        true,
      );
      const parsed = extractJsonObject(content);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).summary === 'string'
      ) {
        const summary = normalizeWhitespace((parsed as Record<string, unknown>).summary as string);
        if (summary.length >= 10) {
          return {
            topCategory,
            summary: truncateChars(summary, 48),
          };
        }
      }
      throw new Error('Invalid issue summary JSON');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt < maxRetries) {
        logger.warn(`[aiSummarizer] Issue summary (${period}) attempt ${attempt + 1} failed (${msg}), retrying...`);
        await sleep(retryDelayMs * (attempt + 1));
      } else {
        logger.warn(`[aiSummarizer] Issue summary (${period}) failed after retries, using fallback.`);
      }
    }
  }

  return {
    topCategory,
    summary: buildFallbackIssueSummary(period, topCategory, repos),
  };
}
