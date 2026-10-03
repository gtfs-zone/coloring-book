import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { worker as en } from '../en/worker';

/** Import worker progress and errors, in French. */
export const worker: Translation<typeof en> = {
  'worker.downloadingOf': 'Téléchargement du flux, {loaded} sur {total}',
  'worker.downloadingBytes': 'Téléchargement du flux, {loaded}',
  'worker.opening': 'Ouverture de {path}...',
  'worker.extracting': 'Extraction du fichier ZIP...',
  'worker.processing': 'Traitement de {file}...',
  'worker.finalizing': 'Finalisation...',
  'worker.noEntry': "L'archive n'a pas d'entrée « {path} ».",
  'worker.noEntryFound':
    "L'archive n'a pas d'entrée « {path} » : elle contient {found}.",
};
