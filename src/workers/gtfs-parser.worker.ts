/**
 * GTFS Parser Web Worker
 *
 * Owns the whole import pipeline: download, ZIP extraction, CSV parsing,
 * serialization and the staging-generation blob writes. The main thread never
 * touches feed bytes, never calls JSON.stringify on feed data, and never holds
 * a second copy of the rows: each chunk's JSON string is posted as it is
 * written, so hydration on the other side is incremental.
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CONFIG } from '../config';
import { ALL_GTFS_FILES, isSupportedFile } from '../modules/gtfs-file-registry';
import { processParsedData } from '../utils/gtfs-field-values';
import {
  downloadWithProgress,
  downloadPercent,
  formatBytes,
} from 'interlocking/gtfs/feed-download';

type GTFSDatabaseRecord = {
  [key: string]: string | number | boolean | undefined;
};

/**
 * Just the store the import writes. Mirrors the `file_blobs` entry of
 * `GTFSDBSchema` in `src/modules/gtfs-database.ts`; that module cannot be
 * imported here because it reaches for the DOM (modals, downloads).
 */
interface BlobDBSchema extends DBSchema {
  file_blobs: {
    key: [number, string, number];
    value: { gen: number; tableName: string; chunk: number; json: string };
    indexes: { gen: number };
  };
}

/** Where the feed bytes come from. */
export type ImportSource =
  | { kind: 'buffer'; buffer: ArrayBuffer }
  | { kind: 'url'; url: string; innerPaths: string[] };

export interface WorkerChunkMessage {
  type: 'chunk';
  tableName: string;
  chunk: number;
  json: string;
  rowCount: number;
}

export interface WorkerDoneMessage {
  type: 'done';
  /** Rows written per table, so the main thread can verify what it hydrated. */
  tableCounts: { [tableName: string]: number };
  tableErrors: { [fileName: string]: Papa.ParseError[] };
  unknownFiles: string[];
  passthroughFiles: { [fileName: string]: string };
  /** Raw text of each `.geojson` file the archive carried, keyed by file name. */
  locationsJson: { [fileName: string]: string };
}

export interface WorkerOversizeTable {
  fileName: string;
  bytes: number;
  rows: number;
}

/**
 * The feed is over a warning threshold. The worker stops here until the main
 * thread answers with `proceed`, or terminates it.
 */
export interface WorkerOversizeMessage {
  type: 'oversize';
  totalBytes: number;
  totalRows: number;
  memoryBytes: number;
  /** Biggest tables first, so the prompt can name what makes the feed big. */
  tables: WorkerOversizeTable[];
}

export interface WorkerProgressMessage {
  type: 'progress';
  progress: number;
  status: string;
}

export interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerOutbound =
  | WorkerProgressMessage
  | WorkerOversizeMessage
  | WorkerChunkMessage
  | WorkerDoneMessage
  | WorkerErrorMessage;

export type WorkerInbound =
  | {
      type: 'parse';
      gen: number;
      chunkRows: number;
      source: ImportSource;
    }
  | { type: 'proceed' };

const post = (msg: WorkerOutbound): void => self.postMessage(msg);

/**
 * Open the app's database read-write without ever creating or upgrading it.
 *
 * The main thread owns the schema and has always opened it before an import
 * starts. Opening versionless means this never races that; a missing store
 * means the assumption broke, and a silent skip here would lose the whole feed.
 */
async function openBlobStore(): Promise<IDBPDatabase<BlobDBSchema>> {
  const db = await openDB<BlobDBSchema>(CONFIG.DB_NAME);
  if (!db.objectStoreNames.contains('file_blobs')) {
    throw new Error(
      `[ImportWorker] ${CONFIG.DB_NAME} has no file_blobs store; the main thread must open the database first`
    );
  }
  return db;
}

/**
 * One nested archive out of another. Fails loudly with the entries that *are*
 * there: a wrong `#inner.zip` is a typo the user can fix, and the list is the
 * only thing that tells them what to fix it to.
 */
async function extractInnerZip(
  outer: ArrayBuffer,
  innerPath: string
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(outer);
  const entry = zip.file(innerPath);
  if (!entry) {
    const found = Object.keys(zip.files)
      .filter((name) => name.toLowerCase().endsWith('.zip'))
      .join(', ');
    throw new Error(
      `The archive has no entry "${innerPath}"${found ? ` — it contains ${found}` : ''}.`
    );
  }
  return entry.async('arraybuffer');
}

/** Fetch or unwrap the feed bytes, reporting download progress over 0-25%. */
async function resolveSourceBytes(source: ImportSource): Promise<ArrayBuffer> {
  if (source.kind === 'buffer') {
    return source.buffer;
  }

  const blob = await downloadWithProgress(source.url, {
    onProgress: (loaded, total) => {
      const percent = downloadPercent(loaded, total);
      post({
        type: 'progress',
        progress: ((percent ?? 0) / 100) * 25,
        status: total
          ? `Downloading feed, ${formatBytes(loaded)} of ${formatBytes(total)}`
          : `Downloading feed, ${formatBytes(loaded)}`,
      });
    },
  });

  let buffer = await blob.arrayBuffer();
  for (const innerPath of source.innerPaths) {
    post({
      type: 'progress',
      progress: 25,
      status: `Opening ${innerPath}...`,
    });
    buffer = await extractInnerZip(buffer, innerPath);
  }
  return buffer;
}

/**
 * Uncompressed size of a zip entry, read from the central directory that
 * `loadAsync` already parsed. JSZip keeps it on the private `_data`, so a
 * future version dropping it must be caught rather than silently estimating
 * every feed at zero.
 */
function uncompressedSize(entry: JSZip.JSZipObject): number {
  const data = (entry as { _data?: { uncompressedSize?: number } })._data;
  if (typeof data?.uncompressedSize !== 'number') {
    throw new Error(
      '[ImportWorker] JSZip entry has no uncompressedSize; the large-feed check cannot run'
    );
  }
  return data.uncompressedSize;
}

/**
 * Size the feed from the central directory alone, before anything is inflated.
 * Rows are estimated from uncompressed bytes at a measured bytes-per-row rate,
 * so the number is approximate by design: it decides whether to ask the user,
 * not what to allocate.
 */
function estimateFeedSize(zip: JSZip): {
  totalBytes: number;
  totalRows: number;
  memoryBytes: number;
  tables: WorkerOversizeTable[];
} {
  const tables: WorkerOversizeTable[] = [];
  let totalBytes = 0;
  let totalRows = 0;

  for (const [fileName, entry] of Object.entries(zip.files)) {
    if (entry.dir || !fileName.endsWith('.txt')) {
      continue;
    }
    const bytes = uncompressedSize(entry);
    const rows = Math.round(bytes / CONFIG.FEED_CSV_BYTES_PER_ROW);
    totalBytes += bytes;
    totalRows += rows;
    tables.push({ fileName, bytes, rows });
  }

  tables.sort((a, b) => b.bytes - a.bytes);
  return {
    totalBytes,
    totalRows,
    memoryBytes: totalRows * CONFIG.FEED_ROW_MEMORY_BYTES,
    tables,
  };
}

/** Resolver for the `proceed` reply while a large-feed prompt is open. */
let proceed: (() => void) | null = null;

/**
 * Serialize a table's rows into `chunkRows`-row records, write each one under
 * the staging generation, and post it to the main thread as it lands.
 *
 * A table with no rows still gets exactly one `[]` chunk, so an intentionally
 * empty table reads back as empty rather than as a table that was never
 * written.
 */
async function writeTableChunks(
  db: IDBPDatabase<BlobDBSchema>,
  gen: number,
  tableName: string,
  rows: GTFSDatabaseRecord[],
  chunkRows: number
): Promise<void> {
  const total = Math.max(1, Math.ceil(rows.length / chunkRows));
  for (let chunk = 0; chunk < total; chunk++) {
    const slice = rows.slice(chunk * chunkRows, (chunk + 1) * chunkRows);
    const json = JSON.stringify(slice);
    await db.put('file_blobs', { gen, tableName, chunk, json });
    post({
      type: 'chunk',
      tableName,
      chunk,
      json,
      rowCount: slice.length,
    });
  }
}

async function runImport(
  gen: number,
  chunkRows: number,
  source: ImportSource
): Promise<void> {
  const db = await openBlobStore();
  const buffer = await resolveSourceBytes(source);

  post({ type: 'progress', progress: 25, status: 'Extracting ZIP file...' });

  const zip = new JSZip();
  const zipContent = await zip.loadAsync(buffer);

  // Central-directory check, before the first inflation and before any staging
  // write, so a declined load costs nothing but the download.
  const estimate = estimateFeedSize(zipContent);
  if (
    estimate.totalBytes > CONFIG.LARGE_FEED_WARN_BYTES ||
    estimate.totalRows > CONFIG.LARGE_FEED_WARN_ROWS
  ) {
    post({ type: 'oversize', ...estimate });
    // Resolves on `proceed`; a decline terminates this worker instead.
    await new Promise<void>((resolve) => {
      proceed = resolve;
    });
  }

  const files = Object.keys(zipContent.files).filter(
    (name) => name.endsWith('.txt') || name.endsWith('.geojson')
  );

  const unknownFiles: string[] = [];
  const passthroughFiles: { [fileName: string]: string } = {};
  const locationsJson: { [fileName: string]: string } = {};
  const tableCounts: { [tableName: string]: number } = {};
  const tableErrors: { [fileName: string]: Papa.ParseError[] } = {};
  const written = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];

    if (!isSupportedFile(fileName)) {
      unknownFiles.push(fileName);
      passthroughFiles[fileName] =
        await zipContent.files[fileName].async('text');
      continue;
    }

    post({
      type: 'progress',
      progress: 25 + 65 * (i / files.length),
      status: `Processing ${fileName}...`,
    });

    const fileContent = await zipContent.files[fileName].async('text');

    if (fileName.endsWith('.geojson')) {
      // One row holding a whole FeatureCollection. It has no virtual table and
      // no blob chunks: it swaps inside the commit transaction instead.
      locationsJson[fileName] = fileContent;
      continue;
    }

    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
    });
    const rows = processParsedData<GTFSDatabaseRecord>(
      parsed.data as Record<string, unknown>[]
    );
    if (parsed.errors.length > 0) {
      tableErrors[fileName] = parsed.errors;
    }

    const tableName = fileName.replace('.txt', '');
    tableCounts[tableName] = rows.length;
    written.add(tableName);
    await writeTableChunks(db, gen, tableName, rows, chunkRows);
  }

  // Every supported table gets a generation record, present in the ZIP or not,
  // so a restore can tell "the feed shipped this table empty" from "nothing
  // wrote it".
  for (const fileName of ALL_GTFS_FILES) {
    if (!fileName.endsWith('.txt')) {
      continue;
    }
    const tableName = fileName.replace('.txt', '');
    if (written.has(tableName)) {
      continue;
    }
    tableCounts[tableName] = 0;
    await writeTableChunks(db, gen, tableName, [], chunkRows);
  }

  post({ type: 'progress', progress: 90, status: 'Finalizing...' });
  post({
    type: 'done',
    tableCounts,
    tableErrors,
    unknownFiles,
    passthroughFiles,
    locationsJson,
  });
}

self.onmessage = async (event: MessageEvent<WorkerInbound>) => {
  try {
    if (event.data.type === 'proceed') {
      const resume = proceed;
      proceed = null;
      resume?.();
      return;
    }
    if (event.data.type === 'parse') {
      const { gen, chunkRows, source } = event.data;
      await runImport(gen, chunkRows, source);
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
