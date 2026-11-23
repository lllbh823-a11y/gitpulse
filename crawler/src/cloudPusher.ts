import { createHmac } from 'node:crypto';
import type {
  CloudResponse,
  IngestIssueRequest,
  IngestIssueResponseData,
} from './types.js';
import { fetchWithTimeout, sleep } from './utils.js';

export interface SignedHeaders {
  'x-gitpulse-timestamp': string;
  'x-gitpulse-signature': string;
}

export interface CloudPushOptions {
  ingestUrl: string;
  ingestSecret: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  nowSeconds?: () => number;
  fetchImpl?: typeof fetch;
}

export function isCloudBaseGatewayUrl(url: string): boolean {
  return /\.tcloudbasegateway\.com\/v1\/functions\//i.test(url.trim());
}

export function computeHmacSignature(
  timestamp: string,
  rawBody: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

export function createSignedHeaders(
  rawBody: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): SignedHeaders {
  if (!secret) {
    throw new Error('INGEST_SECRET is required to sign CloudBase ingest requests');
  }
  const timestamp = String(Math.floor(timestampSeconds));
  const signature = computeHmacSignature(timestamp, rawBody, secret);
  return {
    'x-gitpulse-timestamp': timestamp,
    'x-gitpulse-signature': signature,
  };
}

export class IssueFilteredError extends Error {}

export async function pushIssueToCloud(
  payload: IngestIssueRequest,
  options: CloudPushOptions,
): Promise<IngestIssueResponseData> {
  const {
    ingestUrl,
    ingestSecret,
    apiKey,
    timeoutMs = 60_000,
    maxRetries = 2,
    retryDelayMs = 1_000,
    nowSeconds = () => Math.floor(Date.now() / 1000),
    fetchImpl = fetch,
  } = options;

  if (!ingestUrl?.trim()) {
    throw new Error('CLOUDBASE_INGEST_URL is required');
  }
  if (!ingestSecret?.trim()) {
    throw new Error('INGEST_SECRET is required');
  }

  const useGatewayEnvelope = isCloudBaseGatewayUrl(ingestUrl);
  const bearerToken = apiKey?.trim() || '';
  if (useGatewayEnvelope && !bearerToken) {
    throw new Error('CLOUDBASE_API_KEY is required when using CloudBase HTTP API gateway');
  }

  const rawBody = JSON.stringify(payload);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const signedHeaders = createSignedHeaders(rawBody, ingestSecret, nowSeconds());
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
    };
    if (bearerToken) {
      requestHeaders.Authorization = `Bearer ${bearerToken}`;
    }
    const requestBody = useGatewayEnvelope
      ? JSON.stringify({
          headers: signedHeaders,
          rawBody,
        })
      : rawBody;
    if (!useGatewayEnvelope) {
      Object.assign(requestHeaders, signedHeaders);
    }

    try {
      const response = await fetchWithTimeout(
        ingestUrl,
        {
          method: 'POST',
          headers: requestHeaders,
          body: requestBody,
        },
        timeoutMs,
        fetchImpl,
      );

      const responseText = await response.text();
      let parsed: CloudResponse<IngestIssueResponseData> | null = null;
      try {
        parsed = JSON.parse(responseText) as CloudResponse<IngestIssueResponseData>;
      } catch {
        parsed = null;
      }

      if (parsed?.code === 422) {
        throw new IssueFilteredError('本期全部项目被拦截或等待复核');
      }
      if (!response.ok) {
        const errMessage = parsed?.message || responseText.slice(0, 200) || `HTTP ${response.status}`;
        const err = new Error(`CloudBase ingestIssue failed (HTTP ${response.status}): ${errMessage}`);
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxRetries) {
          throw err;
        }
        lastError = err;
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }

      if (!parsed || typeof parsed.code !== 'number') {
        throw new Error(`CloudBase ingestIssue returned invalid JSON payload: ${responseText.slice(0, 200)}`);
      }

      if (parsed.code !== 0 || !parsed.data) {
        const err = new Error(
          `CloudBase ingestIssue rejected payload (code=${parsed.code}): ${parsed.message || 'unknown error'}`,
        );
        const retryable = parsed.code >= 500;
        if (!retryable || attempt === maxRetries) {
          throw err;
        }
        lastError = err;
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof IssueFilteredError) throw error;
      lastError = error;
      const isExplicitClientRejection =
        error instanceof Error &&
        (error.message.includes('HTTP 400') ||
          error.message.includes('HTTP 401') ||
          error.message.includes('HTTP 403') ||
          error.message.includes('HTTP 404') ||
          error.message.includes('code=400') ||
          error.message.includes('code=401') ||
          error.message.includes('code=404'));

      if (isExplicitClientRejection || attempt === maxRetries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to push issue to CloudBase');
}
