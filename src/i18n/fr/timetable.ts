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
  'sched.offsetError':
    'Le décalage doit être en minutes signées, MM:SS ou HH:MM:SS, par ex. -5',
  'sched.offsetLabel': 'Décalage horaire',
  'sched.offsetNote':
    'Minutes signées ajoutées à chaque heure, par ex. <code>-5</code>. <code>MM:SS</code> (<code>1:30</code>) et <code>HH:MM:SS</code> (<code>+01:00:00</code>) fonctionnent aussi.',
  'sched.allFieldsShown': 'Tous les champs de stop_times sont déjà affichés',
  'sched.addFieldTitle': 'Ajouter un champ stop_times',
  'sched.enterWindowTime':
    'Saisissez une heure de plage de prise en charge/dépose, par ex. 9:30 ou 09:30:00',
  'sched.enterTime': 'Saisissez une heure, par ex. 9:30 ou 09:30:00',
  'sched.changeStop': "Changer d'arrêt",
  'sched.addStopOrZone': 'Ajouter un arrêt ou une zone',
  'sched.stopNotListed':
    "Arrêt absent de la liste ? Le plus simple est d'ajouter d'abord tous les arrêts de la ligne sur la carte avec l'outil arrêt, puis de les ajouter ici.",
  'sched.manageZones': "Gérer les zones et groupes d'emplacements...",
  'sched.pickupRule': 'Règle de réservation pour la prise en charge',
  'sched.dropOffRule': 'Règle de réservation pour la dépose',
  'sched.manageRules': 'Gérer les règles de réservation...',
  'sched.selectShape': 'Choisir un tracé',
  'sched.manageShapes': 'Gérer les tracés...',
  'sched.replacedShape': 'Tracé {id} remplacé',
  'sched.uploadedShape': 'Tracé {id} importé pour le voyage {trip}',
  'sched.zoneSecondary': 'Zone à la demande - {id}',
  'sched.groupSecondary': "Groupe d'emplacements - {id}",
  'sched.invalidTime': 'Heure invalide',
  'sched.labelAddStop': "Ajout de l'arrêt {stop} au voyage {trip}",
  'sched.labelClearTime': "Effacement de l'heure {type} pour {trip}/{stop}",
  'sched.labelSetTime': 'Heure {type} de {trip}/{stop} mise à {time}',
  'sched.addedStop': 'Arrêt ajouté au voyage',
  'sched.saveTimeFailed': "Échec de l'enregistrement de l'heure",
  'sched.windowOrder':
    'Le début de la plage doit être antérieur ou égal à sa fin',
  'sched.saveWindowFailed': "Échec de l'enregistrement de la plage",
  'sched.saveFieldFailed': "Échec de l'enregistrement de {field}",
  'sched.labelAddRef': 'Ajout de {kind} {id} au voyage {trip}',
  'sched.addedFlex': 'Ligne à la demande ajoutée au voyage',
  'sched.saveFlexFailed': "Échec de l'enregistrement de la ligne à la demande",
  'sched.addedRefInherited':
    '{id} ajouté au voyage {trip} (prise en charge {pickup}, dépose {dropOff} copiées depuis {from})',
  'sched.addedRef': '{id} ajouté au voyage {trip}',
  'sched.labelRemove': 'Retrait de {row} du voyage {trip}',
  'sched.removed': '{row} retiré du voyage {trip}',
  'sched.removeFailed': 'Échec du retrait de la ligne du voyage',
  'sched.emptySameAs0': '- (vide, équivaut à 0)',
  'sched.secondsBetween': 'Secondes entre deux départs',
  'sched.labelMoveHeadway':
    'Déplacement de la période de fréquence de {trip} à {start}',
  'sched.addHeadwayFailed': "Échec de l'ajout de la période de fréquence",
  'sched.removeHeadwayFailed':
    'Échec de la suppression de la période de fréquence',
  'sched.tripPropFailed':
    'Échec de la mise à jour de {field} pour le voyage {trip}',
  'sched.timeError': 'Format horaire invalide : {message}',
  'sched.renderFailed': 'Échec de la génération de la vue des horaires',
  'sched.routePickerTitle': "Ligne de l'horaire",
  'sched.routeNoTrips':
    "La ligne {id} n'a aucun voyage, elle n'a donc pas d'horaire.",
  'sched.notOnRoute': 'Pas encore sur cette ligne',
  'sched.servicePickerTitle': "Service de l'horaire",
  'sched.newService': 'Nouveau service…',
  'sched.noTimetable': 'Aucun horaire chargé',
  'sched.newTrip': 'Nouveau voyage',
  'sched.invalidTripId': 'Trip ID invalide',
  'sched.tripIdTaken': 'Ce trip ID existe déjà, choisissez-en un autre',
  'sched.tripIdCheckFailed': 'Échec de la validation du trip ID',
  'sched.stopNotFound': 'Arrêt introuvable',
  'sched.refNotFound': 'Référence introuvable',
  'sched.pendingStop':
    "Arrêt ajouté. Saisissez une heure pour au moins un voyage pour l'enregistrer.",
  'sched.pendingFlex':
    "Ligne ajoutée. Saisissez une plage de prise en charge pour au moins un voyage pour l'enregistrer.",
  'sched.addRowFailed': "Échec de l'ajout de la ligne à l'horaire",
  'sched.noStopTimesForStop':
    'Aucun horaire de passage ne référence cet arrêt dans cette direction',
  'sched.labelChangeStop':
    'Arrêt « {from} » -> « {to} » (ligne {route}, direction {direction})',
  'sched.changeStopFailed': "Échec du changement d'arrêt",
  'sched.alreadySorted': "Le voyage {trip} est déjà dans l'ordre chronologique",
  'sched.labelSort': 'Tri du voyage {trip} par heure',
  'sched.sorted': 'Voyage {trip} trié par heure ({count} lignes déplacées)',
  'sched.sortFailed': 'Échec du tri du voyage {trip}',
  'sched.tooFewToReverse':
    "Le voyage {trip} a trop peu d'arrêts pour être inversé",
  'sched.labelReverse': 'Inversion du voyage {trip}',
  'sched.reversed': 'Voyage {trip} inversé',
  'sched.reversedClearedShape': 'Voyage {trip} inversé et son tracé effacé',
  'sched.reverseFailed': "Échec de l'inversion du voyage {trip}",
  'sched.shiftTitle': 'Décaler le voyage {trip}',
  'sched.shiftCreate': 'Décaler les heures',
  'sched.nothingToShift': 'Rien à décaler sur le voyage {trip}',
  'sched.labelShift': 'Décalage du voyage {trip} de {offset}',
  'sched.shifted': 'Voyage {trip} décalé de {offset}',
  'sched.shiftFailed': 'Échec du décalage du voyage {trip}',
  'sched.tripNotFound': 'Voyage {trip} introuvable',
  'sched.copyTitle': 'Copier le voyage {trip}',
  'sched.copyCreate': 'Copier le voyage',
  'sched.flipLabel': "Inverser l'ordre des arrêts et la direction",
  'sched.flipNote':
    'Reflète les heures pour que la copie avance toujours. Efface shape_id et shape_dist_traveled.',
  'sched.labelCopy': 'Copie du voyage {trip} vers {id}',
  'sched.copied': 'Voyage {trip} copié vers {id}',
  'sched.copiedFlipped':
    'Voyage {trip} copié vers {id} (inversé, tracé effacé)',
  'sched.deleteTripLabel': 'Supprimer le voyage {trip}',
  'sched.deleteTripTitle': 'Supprimer le voyage ?',
  'sched.deleteTripBody':
    "Supprimer le voyage {trip} ? Seule l'annulation permet de revenir en arrière.",
  'sched.deleteTrip': 'Supprimer le voyage',
  'sched.tripHasStopTimes': 'Le voyage a des horaires de passage',
  'sched.tripHasStopTimesBody': 'Le voyage {trip} a {stopTimes}.',
  'sched.tripCascade':
    'Supprimer ce voyage supprimera aussi tous ses horaires de passage (annulable).',
};
