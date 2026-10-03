import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { timetable as en } from '../en/timetable';

/** Timetables, in French. */
export const timetable: Translation<typeof en> = {
  'tt.route': 'Ligne',
  'tt.service': 'Service',
  'tt.direction': 'Direction',
  'tt.addDirection': 'Ajouter une direction',
  'tt.bothDirections':
    'Les deux directions existent déjà : GTFS ne définit que direction_id 0 et 1',
  'tt.brouterTitle': 'Ouvrir dans BRouter',
  'tt.brouterText':
    "Calcule dans BRouter, dans un nouvel onglet, l'itinéraire des {count} arrêts de ce voyage, pour tracer ou vérifier un tracé sur le réseau routier ou ferré. Le flux n'est pas modifié.",
  'tt.brouterDisabled':
    'Ouvrir dans BRouter nécessite au moins deux arrêts avec coordonnées sur ce voyage',
  'tt.uploadTitle': 'Importer un tracé pour ce voyage',
  'tt.uploadText':
    "Lit un fichier GPX, ou un tracé d'un flux GTFS, dans de nouvelles lignes shapes.txt et y fait pointer le shape_id de ce voyage. Annulable depuis le panneau Historique.",
  'tt.shapeActions': 'Actions de tracé',
  'tt.addHeadwayTitle': 'Ajouter une période de fréquence à {trip}',
  'tt.addHeadwayText':
    'Ajoute une ligne <code>frequencies.txt</code> : une plage de service et le nombre de secondes entre deux départs. Les stop_times du voyage deviennent un modèle de décalages par rapport à son premier départ.',
  'tt.addFrequency': '+ fréquence',
  'tt.addPeriod': '+ période',
  'tt.frequencyN': 'fréquence {n}',
  'tt.deleteHeadwayTitle': 'Supprimer cette période de fréquence',
  'tt.deleteHeadwayText':
    'Supprime la ligne <code>frequencies.txt</code> de {trip} à {start} : {period}. Les stop_times du voyage restent inchangés.',
  'tt.minutes': '{field} - {n} minutes',
  'tt.seconds': '{field} - {n} secondes',
  'tt.emptyEquivalent': '{field} - vide, équivaut à 0',
  'tt.frequencyTripTitle': 'Voyage en fréquence',
  'tt.frequencyTripText':
    'Les stop_times ci-dessous sont un modèle : seuls leurs décalages par rapport au premier départ comptent, et un véhicule part à chaque intervalle pendant chaque période.',
  'tt.deleteTripTitle': 'Supprimer le voyage {trip}',
  'tt.deleteTripText':
    'Supprime le voyage et ses stop_times. Annulable depuis le panneau Historique.',
  'tt.outOfOrder':
    "Les stop_times de ce voyage ne sont pas dans l'ordre chronologique.",
  'tt.sortTripTitle': 'Trier le voyage {trip} par heure',
  'tt.sortTripText':
    "Renumérote les stop_times de ce voyage dans l'ordre chronologique. Les arrêts peuvent changer de colonne sur le bandeau. Annulable depuis le panneau Historique.",
  'tt.copyTripTitle': 'Copier le voyage {trip}',
  'tt.copyTripText':
    "Demande un décalage horaire et s'il faut inverser l'ordre des arrêts, puis crée la copie avec un trip ID généré. Copie aussi les stop_times et les frequencies.",
  'tt.reverseTripTitle': 'Inverser le voyage {trip}',
  'tt.reverseTripText':
    'Inverse et renumérote les stop_times, en reflétant les heures pour que le voyage avance toujours. Efface le tracé. Ne touche pas à direction_id, que vous voudrez sans doute mettre à jour ensuite. Annulable depuis le panneau Historique.',
  'tt.shiftTripTitle': 'Décaler le voyage {trip}',
  'tt.shiftTripText':
    "Ajoute un décalage signé à chaque heure de ce voyage. L'ordre des arrêts ne change pas. Annulable depuis le panneau Historique.",
  'tt.newTrip': 'Nouveau voyage',
  'tt.stop': 'Arrêt',
  'tt.tripActions': 'Actions de voyage',
  'tt.stopOrder': 'Ordre des arrêts',
  'tt.focusStop': 'Centrer la carte sur cet arrêt',
  'tt.visit': '(passage {n})',
  'tt.servedBy': 'Desservi par {serves} voyages sur {total}',
  'tt.stopShowingTitle': 'Ne plus afficher {field}',
  'tt.stopShowingText':
    "Retire la sous-ligne de chaque cellule. Les valeurs déjà présentes dans le flux ne sont pas touchées, et le champ revient de lui-même dès qu'une cellule en a une.",
  'tt.changeStop': "Changer d'arrêt",
  'tt.group': 'Groupe',
  'tt.zone': 'Zone',
  'tt.openGroup': "Ouvrir ce groupe d'emplacements",
  'tt.openZone': 'Ouvrir cette zone',
  'tt.pendingFlex': 'Ligne à la demande en attente',
  'tt.pendingStop': 'Arrêt en attente',
  'tt.addTripFirst':
    "Ajoutez d'abord un voyage : les horaires de passage appartiennent à un voyage",
  'tt.addStopOrZone': 'Ajouter un arrêt ou une zone...',
  'tt.noTripsInDirection':
    "Cette direction de la ligne n'a pas encore de voyage. Les horaires de passage appartiennent à un voyage : ajoutez-en un avant d'ajouter des arrêts.",
  'tt.addFirstTrip': 'Ajouter le premier voyage',
  'tt.directionNoTrips': '{name} : aucun voyage',
  'tt.error': 'Erreur',
  'tt.noTrips':
    "Ce flux n'a pas encore de voyage, il n'y a donc pas d'horaire.",
  'tt.title': 'Horaires',
  'tt.browserTitle': 'Horaires',
  'tt.noAgency': 'Aucune agence',
  'tt.noRoutes': 'Aucune ligne.',
  'tt.newTimetable': 'Nouvel horaire',
  'tt.openTimetable': "Ouvrir l'horaire",
  'tt.feedNoRoutes': "Ce flux n'a pas encore de ligne.",
  'tt.fromFirstDeparture': '{offset} depuis le premier départ',
  'tt.addFieldTitle': 'Afficher un autre champ de {file}',
  'tt.addFieldText':
    "Choisit un champ à ajouter en sous-ligne de chaque cellule de ce tableau. Il n'est écrit dans le flux qu'une fois une valeur saisie, et disparaît en quittant l'horaire.",
  'tt.noRecord': 'Aucun enregistrement avec {field} {value}',
  'tt.noStopTimeYet': 'pas encore de stop_time sur ce voyage',
  'tt.outbound': 'Aller',
  'tt.inbound': 'Retour',
  'tt.directionN': 'Direction {id}',
  'tt.routeNotFound': 'Ligne {id} introuvable',
  'tt.stopMissing':
    'Arrêt {id} absent de stops.txt mais référencé dans stop_times.txt',
  'tt.invalidTime':
    'Format horaire invalide : {time}. Le format doit être HH:MM:SS.',
  'tt.dbLost': 'Connexion à la base de données perdue',
  'tt.arrivalAfterDeparture':
    "L'heure d'arrivée doit être antérieure ou égale à l'heure de départ",
};
