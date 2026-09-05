/**
 * GTFS Parser Web Worker
 * Handles ZIP extraction and CSV parsing off the main thread.
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import {
  ALL_GTFS_FILES,
  isSupportedFile,
  makeHeaderOnlyCSV,
} from '../modules/gtfs-file-registry.js';

type GTFSDatabaseRecord = {
  [key: string]: string | number | boolean | undefined;
};

export interface WorkerFileResult {
  data: GTFSDatabaseRecord[];
  rawContent: string; // original file text (CSV or GeoJSON string)
  errors: Papa.ParseError[];
  isGeoJSON: boolean;
}

export interface WorkerDoneMessage {
  type: 'done';
  files: { [fileName: string]: WorkerFileResult };
  unknownFiles: string[];
  passthroughFiles: { [fileName: string]: string };
}

export interface WorkerDoneRestoreMessage {
  type: 'done-restore';
  tables: { [tableName: string]: GTFSDatabaseRecord[] };
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
  | WorkerDoneMessage
  | WorkerDoneRestoreMessage
  | WorkerErrorMessage;

function parseFieldValue(fieldName: string, value: string): string | number {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const stringValue = String(value);

  let shouldBeNumeric = false;
  if (
    fieldName.includes('_lat') ||
    fieldName.includes('_lon') ||
    fieldName === 'stop_lat' ||
    fieldName === 'stop_lon' ||
    fieldName === 'shape_pt_lat' ||
    fieldName === 'shape_pt_lon' ||
    fieldName === 'shape_dist_traveled' ||
    fieldName.includes('_sequence') ||
    fieldName === 'direction_id' ||
    fieldName === 'location_type' ||
    fieldName === 'wheelchair_boarding' ||
    fieldName === 'wheelchair_accessible' ||
    fieldName === 'bikes_allowed' ||
    fieldName === 'pickup_type' ||
    fieldName === 'drop_off_type' ||
    fieldName === 'payment_method' ||
    fieldName === 'transfers' ||
    fieldName === 'transfer_duration' ||
    fieldName === 'route_type' ||
    fieldName === 'route_sort_order' ||
    fieldName === 'continuous_pickup' ||
    fieldName === 'continuous_drop_off' ||
    fieldName === 'exception_type' ||
    fieldName.includes('_type')
  ) {
    shouldBeNumeric = true;
  }

  if (shouldBeNumeric && stringValue !== '') {
    const num = parseFloat(stringValue);
    if (!isNaN(num)) {
      if (Number.isInteger(num)) {
        return parseInt(stringValue, 10);
      }
      return num;
    }
  }

  return stringValue;
}

function processParsedData(
  data: Record<string, unknown>[]
): GTFSDatabaseRecord[] {
  return data.map((row) => {
    const processedRow: GTFSDatabaseRecord = {};
    for (const [fieldName, value] of Object.entries(row)) {
      processedRow[fieldName] = parseFieldValue(fieldName, value as string);
    }
    return processedRow;
  });
}

self.onmessage = async (
  event: MessageEvent<
    | { type: 'parse'; buffer: ArrayBuffer }
    | { type: 'restore'; blobs: { tableName: string; json: string }[] }
  >
) => {
  const post = (msg: WorkerOutbound) => self.postMessage(msg);

  if (event.data.type === 'restore') {
    try {
      const { blobs } = event.data;
      const tables: { [tableName: string]: GTFSDatabaseRecord[] } = {};
      for (let i = 0; i < blobs.length; i++) {
        const { tableName, json } = blobs[i];
        post({
          type: 'progress',
          progress: (i / blobs.length) * 100,
          status: `Restoring ${tableName}...`,
        });
        tables[tableName] = JSON.parse(json) as GTFSDatabaseRecord[];
      }
      post({ type: 'done-restore', tables });
    } catch (err) {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (event.data.type !== 'parse') {
    return;
  }

  try {
    const { buffer } = event.data;

    post({ type: 'progress', progress: 20, status: 'Extracting ZIP file...' });

    const zip = new JSZip();
    const zipContent = await zip.loadAsync(buffer);

    const files = Object.keys(zipContent.files).filter(
      (name) => name.endsWith('.txt') || name.endsWith('.geojson')
    );

    const unknownFiles: string[] = [];
    const passthroughFiles: { [fileName: string]: string } = {};
    const totalFiles = files.length;
    const resultFiles: { [fileName: string]: WorkerFileResult } = {};

    for (let i = 0; i < files.length; i++) {
      const fileName = files[i];

      if (!isSupportedFile(fileName)) {
        unknownFiles.push(fileName);
        passthroughFiles[fileName] =
          await zipContent.files[fileName].async('text');
        continue;
      }

      const progress = 20 + 60 * (i / totalFiles);
      post({ type: 'progress', progress, status: `Processing ${fileName}...` });

      const fileContent = await zipContent.files[fileName].async('text');

      if (fileName.endsWith('.txt')) {
        const parsed = Papa.parse(fileContent, {
          header: true,
          skipEmptyLines: true,
        });

        const processedData = processParsedData(
          parsed.data as Record<string, unknown>[]
        );

        resultFiles[fileName] = {
          data: processedData,
          rawContent: fileContent,
          errors: parsed.errors,
          isGeoJSON: false,
        };
      } else if (fileName.endsWith('.geojson')) {
        resultFiles[fileName] = {
          data: [JSON.parse(fileContent) as GTFSDatabaseRecord],
          rawContent: fileContent,
          errors: [],
          isGeoJSON: true,
        };
      }
    }

    // Fill in empty entries for files not in the ZIP. isGeoJSON has to follow
    // the extension even here: the main thread keys the whole storage shape off
    // it, and a .geojson file marked as CSV gets a virtual table it must never
    // have. A header-only CSV is meaningless for GeoJSON, so it gets no content.
    for (const filename of ALL_GTFS_FILES) {
      if (!resultFiles[filename]) {
        const isGeoJSON = filename.endsWith('.geojson');
        resultFiles[filename] = {
          data: [],
          rawContent: isGeoJSON ? '' : makeHeaderOnlyCSV(filename),
          errors: [],
          isGeoJSON,
        };
      }
    }

    post({ type: 'progress', progress: 90, status: 'Finalizing...' });
    post({ type: 'done', files: resultFiles, unknownFiles, passthroughFiles });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerErrorMessage);
  }
};
