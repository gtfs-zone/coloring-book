import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { common as en } from '../en/common';

/** Strings shared across the app, in French. */
export const common: Translation<typeof en> = {
  'common.close': 'Fermer',
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.delete': 'Supprimer',
  'common.none': 'Aucun',
  'common.loadCancelled': 'Chargement annulé',
};
