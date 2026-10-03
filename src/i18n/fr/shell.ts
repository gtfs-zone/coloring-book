import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { shell as en } from '../en/shell';

/** App shell, navbar and keyboard shortcuts, in French. */
export const shell: Translation<typeof en> = {
  'app.title': 'edit.gtfs.zone - Éditeur de données de transport GTFS',
  'app.initFailed':
    "Échec de l'initialisation de l'application. Actualisez la page et réessayez.",
  'shell.pointer': 'Pointeur',
  'shell.addStop': 'Ajouter un arrêt',
  'shell.addPathway': 'Ajouter un cheminement',
  'shell.addPathwayExpand':
    "Ajouter un cheminement (déplier d'abord une station)",
  'shell.addPathwayActive': 'Cliquez sur deux arrêts pour les relier',
  'shell.noData': 'Aucune donnée GTFS à explorer',
  'shell.browse': 'Parcourir',
  'shell.files': 'Fichiers',
  'shell.timetables': 'Horaires',
  'shell.history': 'Historique',
  'nav.timetables': 'Horaires',
  'nav.shapes': 'Tracés',
  'nav.calendar': 'Calendrier de service',
  'nav.fares': 'Tarifs (V2)',
  'nav.onDemand': 'Transport à la demande (GTFS Flex)',
  'nav.feedData':
    'Données du flux (correspondances, attributions, traductions)',
  'nav.levels': 'Gérer les niveaux',
  'nav.files': 'Fichiers',
  'nav.theme': 'Changer de thème',
  'nav.guide': 'Guide',
  'nav.history': 'Historique',
  'nav.load': 'Charger',
  'nav.export': 'Exporter',
  'nav.nothingToUndo': 'Rien à annuler',
  'nav.nothingToRedo': 'Rien à rétablir',
  'nav.undoLabel': 'Annuler : {label}',
  'nav.redoLabel': 'Rétablir : {label}',
  'shortcut.openLoad': 'Ouvrir la fenêtre de chargement du flux',
  'shortcut.export': 'Exporter le flux GTFS',
  'shortcut.guide': 'Afficher le guide',
  'shortcut.focusSearch': 'Aller à la recherche sur la carte',
  'shortcut.clearSearch': 'Effacer les recherches',
  'shortcut.undo': 'Annuler la dernière modification',
  'shortcut.redo': 'Rétablir la dernière modification annulée',
};
