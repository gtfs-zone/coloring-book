import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { calendar as en } from '../en/calendar';

/** Service calendar, in French. */
export const calendar: Translation<typeof en> = {
  'svc.loadFailed': "Échec du chargement de l'éditeur de service",
  'svc.dayFailed': 'Échec de la mise à jour de {day}',
  'svc.addExceptionFailed': "Échec de l'ajout de l'exception",
  'svc.weeklyPattern': 'Jours de la semaine',
  'svc.dateRange': 'Période',
  'svc.exceptions': 'Exceptions de service',
  'svc.renameNeedsRow':
    'Seul un service ayant une ligne calendar.txt peut être renommé. Activez un jour de la semaine pour en créer une.',
  'svc.noCalendarRow':
    "Ce service n'a pas de ligne calendar.txt, donc pas de période. Ses dates viennent des exceptions ci-dessous. Activez un jour de la semaine pour en créer une.",
  'svc.exceptionsUnavailable':
    "Les exceptions ne peuvent pas être modifiées tant que l'historique des modifications n'est pas prêt.",
  'svc.added': 'Service ajouté',
  'svc.removed': 'Service supprimé',
  'svc.noAdded':
    "Aucune date n'ajoute de service en plus des jours de la semaine.",
  'svc.noRemoved': 'Aucune date ne retire de service des jours de la semaine.',
  'svc.enterDate': 'Saisissez une date au format AAAAMMJJ',
  'svc.setRangeFirst': "Définissez d'abord une date de début et de fin",
  'svc.holidaysInRange_one':
    '{count} jour férié fédéral tombe dans cette période',
  'svc.holidaysInRange_other':
    '{count} jours fériés fédéraux tombent dans cette période',
  'svc.excludeHolidays': 'Exclure les jours fériés fédéraux américains',
  'svc.setRangeBeforeHolidays':
    "Définissez une date de début et de fin avant d'exclure les jours fériés",
  'svc.includeHolidaysLabel': 'Inclure les jours fériés fédéraux américains',
  'svc.excludeHolidaysLabel': 'Exclure les jours fériés fédéraux américains',
  'svc.holidaysFailed': 'Échec de la mise à jour des jours fériés fédéraux',
  'timeline.noData': 'Aucune donnée de service disponible',
  'timeline.noDates': 'Aucune donnée de date disponible',
  'timeline.addedOn': 'Ajouté le {date}',
  'timeline.removedOn': 'Retiré le {date}',
  'timeline.editService': 'Modifier le service {id}',
  'timeline.clickRow': 'Cliquez sur la ligne pour ouvrir le service',
  'timeline.truncated': "La période dépasse 3 ans : l'affichage est tronqué.",
  'timeline.hint':
    'Choisissez un service pour afficher ses horaires, ou utilisez le crayon pour modifier le service lui-même.',
  'timeline.trips': 'Voyages',
  'cal.feedStart': 'Date de début du flux',
  'cal.feedEnd': 'Date de fin du flux',
  'cal.title': 'Calendrier de service',
  'cal.monthGrid': 'Grille mensuelle',
  'cal.timeline': 'Frise',
  'newSvc.title': 'Nouveau service',
  'newSvc.idHasExceptions':
    'calendar_dates contient déjà des exceptions pour le service « {id} »',
  'newSvc.needsDates':
    "Un service a besoin d'une date de début et d'une date de fin.",
  'newSvc.endBeforeStart': 'La date de fin est antérieure à la date de début.',
  'newSvc.created': 'Service {id} créé',
};
