import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateJsonFeed, generateRssXml } from './feedGenerator.js';
import { validateSnapshotPayload } from './snapshotWriter.js';

export interface GenerateFeedsCliOptions {
  snapshotPath: string;
  outDir: string;
  siteUrl: string;
  maxItems: number;
  copySnapshot: boolean;
}

export async function generateFeedsToDir(
  options: GenerateFeedsCliOptions,
): Promise<{ rssPath: string; jsonFeedPath: string; snapshotCopyPath?: string }> {
  const raw = await readFile(options.snapshotPath, 'utf8');
  const snapshot = validateSnapshotPayload(JSON.parse(raw) as unknown);

  await mkdir(options.outDir, { recursive: true });

  const rssXml = generateRssXml(snapshot, {
    siteUrl: options.siteUrl,
    maxItems: options.maxItems,
  });
  const jsonFeed = generateJsonFeed(snapshot, {
    siteUrl: options.siteUrl,
    maxItems: options.maxItems,
  });

  const rssPath = join(options.outDir, 'rss.xml');
  const jsonFeedPath = join(options.outDir, 'feed.json');
  await writeFile(rssPath, rssXml, 'utf8');
  await writeFile(jsonFeedPath, `${JSON.stringify(jsonFeed, null, 2)}\n`, 'utf8');
  await writeFile(join(options.outDir, '.nojekyll'), '', 'utf8');

  let snapshotCopyPath: string | undefined;
  if (options.copySnapshot) {
    snapshotCopyPath = join(options.outDir, 'snapshot.json');
    await writeFile(snapshotCopyPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  return { rssPath, jsonFeedPath, snapshotCopyPath };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      snapshot: { type: 'string', default: '../miniprogram/src/data/snapshot.json' },
      'out-dir': { type: 'string', default: '../miniprogram/dist/h5' },
      'site-url': { type: 'string', default: process.env.SITE_URL || 'https://gitpulse.dev' },
      'max-items': { type: 'string', default: '30' },
      'copy-snapshot': { type: 'boolean', default: true },
    },
    strict: true,
    allowPositionals: false,
  });

  const snapshotPath = resolve(process.cwd(), values.snapshot);
  const outDir = resolve(process.cwd(), values['out-dir']);
  const maxItems = Math.max(1, Number.parseInt(values['max-items'], 10) || 30);

  const result = await generateFeedsToDir({
    snapshotPath,
    outDir,
    siteUrl: values['site-url'],
    maxItems,
    copySnapshot: Boolean(values['copy-snapshot']),
  });

  console.info(
    `[gitpulse] Generated RSS & JSON feeds: ${result.rssPath}, ${result.jsonFeedPath}`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((error) => {
    console.error(
      '[gitpulse] Failed to generate feeds:',
      error instanceof Error ? error.stack ?? error.message : error,
    );
    process.exitCode = 1;
  });
}
