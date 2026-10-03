import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { pages as en } from '../en/pages';

/** Home and entity pages, in French. */
export const pages: Translation<typeof en> = {
  'page.readOnly':
    'Ce flux est ouvert en lecture seule et ne peut donc pas être corrigé',
  'page.loadFailed': 'Échec du chargement du contenu. Réessayez.',
  'page.cleanFeed': 'Tout est bon ? Exportez votre flux et publiez-le.',
  'page.publishingGuide': 'Guide de publication',
  'page.noPatchManager': 'Aucun gestionnaire de modifications disponible',
  'page.trimAllTitle':
    'Mettre la start_date de chaque service au {date} et supprimer toutes les exceptions antérieures',
  'page.extendAllTitle':
    'Mettre la end_date de chaque service au {date} et supprimer toutes les exceptions postérieures',
  'page.noFeedStart': "feed_info n'a pas de feed_start_date",
  'page.noFeedEnd': "feed_info n'a pas de feed_end_date",
  'page.feedIssues': 'Problèmes du flux',
  'page.agencies': 'Agences',
  'page.newAgency': '+ Nouvelle agence',
  'page.noAgencies': 'Aucune agence dans les données GTFS.',
  'page.services': 'Services',
  'page.trimAll': 'Tout raccourcir au début du flux',
  'page.extendAll': "Tout prolonger jusqu'à la fin du flux",
  'page.newService': '+ Nouveau service',
  'page.noServices': 'Aucun service dans les données GTFS.',
  'page.feedInfo': 'Informations du flux',
  'page.attributions': 'Attributions',
  'page.manageAttributions': 'Gérer les attributions',
  'page.producer': 'Producteur',
  'page.operator': 'Exploitant',
  'page.authority': 'Autorité organisatrice',
  'page.noOrganization': "Pas de nom d'organisation",
  'page.scopeMissing': '{label} : {id} {missing}',
  'page.scopeNoSuch': '(introuvable)',
  'page.scope': '{label} : {name}',
  'page.wholeDataset': "S'applique à l'ensemble des données",
  'page.timetable': 'Horaires',
  'page.addTimetable': 'Ajouter des horaires pour le service :',
  'page.noServicesYet': "Aucun service pour l'instant : créez-en un d'abord",
  'page.chooseService': 'Choisir un service...',
  'page.newServiceOption': 'Nouveau service…',
  'page.timetables': 'Horaires',
  'page.noServicesFound': 'Aucun service.',
  'page.createOne': 'Créez-en un',
  'page.noTimetables':
    "Pas encore d'horaires. Choisissez un service ci-dessus pour en créer.",
  'page.network': 'Réseau',
  'page.notInNetwork': 'Hors réseau',
  'page.selectNetwork': 'Choisir un réseau',
  'page.createNetwork': '+ Créer un réseau...',
  'page.newNetwork': 'Nouveau réseau',
  'page.networkNote':
    "Nommer un réseau fait exporter networks.txt et route_networks.txt plutôt qu'une colonne network_id dans routes.txt.",
  'page.newAgencyTitle': 'Nouvelle agence',
  'page.newRouteTitle': 'Nouvelle ligne',
  'page.alreadyAtBound': 'Tous les services sont déjà à cette limite',
  'page.trimmed': '{services} raccourci(s)',
  'page.extended': '{services} prolongé(s)',
  'page.trimmedRemoved': '{services} raccourci(s), {exceptions} supprimée(s)',
  'page.extendedRemoved': '{services} prolongé(s), {exceptions} supprimée(s)',
  'page.deleteRouteTitle': 'Supprimer la ligne ?',
  'page.deleteRouteEmpty':
    "Cette ligne n'a aucun voyage. Voulez-vous vraiment la supprimer ?",
  'page.routeHasTrips': 'La ligne a des voyages',
  'page.routeHasTripsBody': 'Cette ligne a {trips} et {stopTimes}.',
  'page.routeCascade':
    'Supprimer cette ligne supprimera en cascade tous ses voyages et stop_times (annulable). Ou annulez pour la conserver.',
  'page.deleteServiceTitle': 'Supprimer le service ?',
  'page.deleteServiceEmpty':
    "Ce service n'a ni voyage ni date de calendrier. Voulez-vous vraiment le supprimer ?",
  'page.serviceHasDependents': 'Le service a des dépendances',
  'page.serviceHasBody': 'Ce service a {parts}.',
  'page.serviceCascade':
    'Supprimer ce service supprimera en cascade tous ses voyages, stop_times et calendar_dates (annulable). Ou annulez pour le conserver.',
  'page.deleteAgencyTitle': "Supprimer l'agence ?",
  'page.deleteAgencyEmpty':
    "Cette agence n'a aucune ligne. Voulez-vous vraiment la supprimer ?",
  'page.agencyHasRoutes': "L'agence a des lignes",
  'page.agencyHasBody': 'Cette agence a {routes}, {trips} et {stopTimes}.',
  'page.agencyCascade':
    'Supprimer cette agence supprimera en cascade toutes ses lignes, tous ses voyages et stop_times (annulable). Ou annulez pour la conserver.',
  'page.stopHasVisits': "L'arrêt a des passages prévus",
  'page.stopReferenced':
    'Cet arrêt est référencé par {stopTimes} dans {trips} :',
  'page.stopCascade':
    "Vous pouvez supprimer en cascade l'arrêt et tous ses stop_times (annulable), ou annuler.",
  'page.zoneHasPickups': 'La zone a des prises en charge prévues',
  'page.zoneReferenced':
    'Cette zone est référencée par {stopTimes} dans {trips} :',
  'page.zoneCascade':
    'Vous pouvez supprimer en cascade la zone et tous ses stop_times (annulable), ou annuler.',
};
