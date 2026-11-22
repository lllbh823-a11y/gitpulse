import { createRequire } from 'node:module';
import type { ComplianceBlockCategory, ComplianceDecision, EnrichedRepo, RepoItem } from './types.js';

export interface ComplianceRule {
  id: string;
  category: Exclude<ComplianceBlockCategory, 'ai-flagged' | 'custom-blocklist'>;
  reason: string;
  /** Matched against repo fullName, owner, name, description, and topics (higher precision) */
  metadataPattern?: RegExp;
  /** Matched against full corpus including README excerpt or generated Chinese text */
  textPattern?: RegExp;
}

export interface ComplianceFilterOptions {
  /** Extra comma-separated keywords/patterns (case-insensitive substring or regex) */
  extraBlocklist?: string[];
  /** Metadata-only rule exceptions in owner/name#rule-id format */
  allowlist?: string[];
}

const BUILTIN_RULES: readonly ComplianceRule[] = createRequire(import.meta.url)('../../cloudbase/cloudfunctions/ingestIssue/rules.cjs');

export function parseEnvList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  return raw
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildComplianceOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ComplianceFilterOptions {
  return {
    extraBlocklist: parseEnvList(env.COMPLIANCE_EXTRA_BLOCKLIST),
    allowlist: parseEnvList(env.COMPLIANCE_ALLOWLIST),
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchExtraBlocklist(corpus: string, extraTerms: readonly string[]): string | null {
  for (const term of extraTerms) {
    const cleaned = term.trim();
    if (!cleaned) continue;
    const re = new RegExp(escapeRegExp(cleaned), 'i');
    if (re.test(corpus)) {
      return cleaned;
    }
  }
  return null;
}

export type ComplianceInspectableRepo = Pick<
  EnrichedRepo,
  'fullName' | 'owner' | 'name' | 'description'
> & {
  topics?: string[];
  readmeExcerpt?: string;
  tags?: string[];
  ai?: RepoItem['ai'];
};

export function evaluateRepoCompliance(
  repo: ComplianceInspectableRepo,
  options: ComplianceFilterOptions = {},
): ComplianceDecision {
  const allowSet = new Set((options.allowlist ?? []).map((item) => item.toLowerCase()));

  const metadataCorpus = [
    repo.fullName,
    repo.owner,
    repo.name,
    repo.description,
    (repo.topics ?? []).join(' '),
    (repo.tags ?? []).join(' '),
  ]
    .filter(Boolean)
    .join('\n');

  const copy = repo.ai;
  const generatedText = [copy?.tagline, copy?.whyHot, ...(copy?.highlights ?? []), copy?.targetAudience].join('\n');
  const fullTextCorpus = [metadataCorpus, repo.readmeExcerpt, generatedText].filter(Boolean).join('\n');

  for (const rule of BUILTIN_RULES) {
    if (rule.metadataPattern?.test(metadataCorpus) && !allowSet.has(repo.fullName.toLowerCase() + '#' + rule.id)) {
      return {
        allowed: false,
        category: rule.category,
        reason: rule.reason,
        matchedRule: rule.id,
      };
    }
    if (rule.textPattern?.test(fullTextCorpus) || rule.metadataPattern?.test(generatedText)) {
      return {
        allowed: false,
        category: rule.category,
        reason: rule.reason,
        matchedRule: rule.id,
      };
    }
  }

  const extraMatched = matchExtraBlocklist(fullTextCorpus, options.extraBlocklist ?? []);
  if (extraMatched) {
    return {
      allowed: false,
      category: 'custom-blocklist',
      reason: `命中自定义黑名单关键词：${extraMatched}`,
      matchedRule: `custom:${extraMatched}`,
    };
  }

  return { allowed: true };
}

export function evaluateTextCompliance(
  text: string,
  options: ComplianceFilterOptions = {},
): ComplianceDecision {
  const cleaned = text.trim();
  if (!cleaned) {
    return { allowed: true };
  }

  for (const rule of BUILTIN_RULES) {
    if (rule.textPattern?.test(cleaned) || rule.metadataPattern?.test(cleaned)) {
      return {
        allowed: false,
        category: rule.category,
        reason: rule.reason,
        matchedRule: rule.id,
      };
    }
  }

  const extraMatched = matchExtraBlocklist(cleaned, options.extraBlocklist ?? []);
  if (extraMatched) {
    return {
      allowed: false,
      category: 'custom-blocklist',
      reason: `命中自定义黑名单关键词：${extraMatched}`,
      matchedRule: `custom:${extraMatched}`,
    };
  }

  return { allowed: true };
}

export function filterCompliantRepos<T extends ComplianceInspectableRepo>(
  repos: readonly T[],
  options: ComplianceFilterOptions = {},
): {
  allowed: T[];
  blocked: Array<{ repo: T; decision: ComplianceDecision }>;
} {
  const allowed: T[] = [];
  const blocked: Array<{ repo: T; decision: ComplianceDecision }> = [];

  for (const repo of repos) {
    const decision = evaluateRepoCompliance(repo, options);
    if (decision.allowed) {
      allowed.push(repo);
    } else {
      blocked.push({ repo, decision });
    }
  }

  return { allowed, blocked };
}
