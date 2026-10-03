/** Import worker progress and errors, in English. */
export const worker = {
  'worker.downloadingOf': 'Downloading feed, {loaded} of {total}',
  'worker.downloadingBytes': 'Downloading feed, {loaded}',
  'worker.opening': 'Opening {path}...',
  'worker.extracting': 'Extracting ZIP file...',
  'worker.processing': 'Processing {file}...',
  'worker.finalizing': 'Finalizing...',
  'worker.noEntry': 'The archive has no entry "{path}".',
  'worker.noEntryFound':
    'The archive has no entry "{path}": it contains {found}.',
} as const;
