/**
 * Form Patch Bridge
 *
 * Attaches change listeners to rendered form inputs that have data-field,
 * data-table, and data-record-id attributes, recording each edit as a patch.
 */

import { GTFS_PRIMARY_KEYS } from '../types/gtfs.js';
import { convertValueToGTFS } from './field-formatters.js';
import type { GTFSFieldType } from '../types/gtfs-field-types.js';
import type { GTFSDatabaseRecord } from '../modules/gtfs-database.js';

export interface FormPatchDeps {
  patchManager: {
    recordUpdate: (
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ) => Promise<void>;
  };
  parser: {
    getFileDataSync: (fileName: string) => GTFSDatabaseRecord[] | null;
  };
}

export function attachFormPatchListeners(
  container: HTMLElement,
  deps: FormPatchDeps
): void {
  const selector =
    'input[data-field][data-table][data-record-id], select[data-field][data-table][data-record-id], textarea[data-field][data-table][data-record-id]';
  const inputs = container.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(selector);

  inputs.forEach((input) => {
    const rawTable = input.getAttribute('data-table')!; // e.g. "agency.txt"
    const table = rawTable.replace(/\.txt$/, ''); // e.g. "agency"
    const field = input.getAttribute('data-field')!;
    const recordId = input.getAttribute('data-record-id')!;

    input.addEventListener('change', async () => {
      let newValue = input.value;
      const gtfsType = input.getAttribute('data-gtfs-type');
      if (gtfsType) {
        newValue = convertValueToGTFS(newValue, gtfsType as GTFSFieldType);
      }

      // Look up before value from parser in-memory data
      const rows = deps.parser.getFileDataSync(rawTable);
      const pkField = (GTFS_PRIMARY_KEYS as Record<string, string | undefined>)[
        rawTable
      ];
      const row = pkField
        ? rows?.find((r) => String(r[pkField]) === recordId)
        : rows?.[0]; // feed_info has no PK — use first row

      const before = String(row?.[field] ?? '');

      if (before === newValue) {
        return;
      }

      await deps.patchManager.recordUpdate(
        table,
        recordId,
        { [field]: before },
        { [field]: newValue }
      );
    });
  });
}
