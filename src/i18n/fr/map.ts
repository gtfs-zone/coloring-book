import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { map as en } from '../en/map';

/** Map, pathways and GeoJSON exchange, in French. */
export const map: Translation<typeof en> = {
  'map.newStop': 'Nouvel arrêt',
  'map.invalidStop': 'Arrêt invalide',
  'map.stationNotEndpoint':
    "Les stations (location_type=1) ne peuvent pas être des extrémités de cheminement. Choisissez un quai, une entrée, un nœud générique ou une zone d'embarquement.",
  'map.pathwayFrom':
    'Départ : {id}. Cliquez maintenant sur le second arrêt à relier.',
  'map.invalidPathway': 'Cheminement invalide',
  'map.sameEndpoints':
    'Les deux extrémités doivent être des arrêts différents.',
  'map.fromStop': 'Arrêt de départ',
  'map.toStop': "Arrêt d'arrivée",
  'map.newPathway': 'Nouveau cheminement',
  'map.createPathway': 'Créer le cheminement',
  'map.pathwayMode': 'Mode de cheminement',
  'map.bidirectional': 'Bidirectionnel',
  'map.exitGateOneWay':
    'Les portillons de sortie (mode 7) ne doivent pas être bidirectionnels.',
  'map.clickTwoStops':
    'Cliquez sur deux arrêts pour créer un cheminement entre eux.',
  'map.ok': 'OK',
  'map.coordsFailed':
    "Échec de la mise à jour des coordonnées de l'arrêt : {message}",
  'map.unnamedStop': 'Arrêt sans nom',
  'map.servedBy': '{serves} voyages sur {total}',
  'map.servedByTitle': 'Desservi par {serves} voyages sur {total}',
  'map.routeDiagram': 'Schéma de ligne',
  'geo.noId': '(sans id)',
  'geo.nothing': 'rien',
  'geo.noPolygon':
    'Aucun polygone pour la zone « {id} » dans le GeoJSON. Trouvé : {found}.',
  'geo.noGeometry':
    "Cette zone n'a pas de géométrie. Tracez-la dans geojson.io ou collez du GeoJSON ci-dessous.",
  'geo.type': 'Type',
  'geo.vertices': 'Sommets',
  'geo.bounds': 'Emprise',
  'geo.zoneGone':
    "La zone {id} n'est plus dans locations.geojson. Rechargez la page.",
  'geo.zoneUpdated': 'Géométrie de la zone {id} mise à jour',
  'geo.noFeatureWithId':
    "Aucune feature avec l'id « {id} » dans le GeoJSON. Trouvé : {found}.",
  'geo.expectedOne':
    'Une seule feature attendue, {count} reçues. Ne gardez que celle voulue.',
  'geo.editorEmpty': "L'éditeur est vide.",
  'geo.invalidJson': 'JSON invalide : {message}',
  'geo.noFeaturesArray': "La FeatureCollection n'a pas de tableau features.",
  'geo.expectedFeature':
    'Feature ou FeatureCollection GeoJSON attendue, reçu : {type}.',
  'geo.importTitle': 'Importer du GeoJSON depuis une URL',
  'geo.importBody':
    "Collez un lien de partage geojson.io, ou l'URL d'un fichier GeoJSON à récupérer. Rien n'est enregistré avant d'appuyer sur Enregistrer.",
  'geo.url': 'URL',
  'geo.useCors': 'Utiliser le proxy CORS',
  'geo.fetch': 'Récupérer',
  'geo.defaultHint':
    "Pour récupérer une modification, utilisez Share dans geojson.io et collez le lien ici. geojson.io ne garde plus les données dans la barre d'adresse pendant le tracé.",
  'geo.editIn': 'Modifier dans geojson.io',
  'geo.importFromUrl': 'Importer depuis une URL',
  'geo.pastedNoId':
    "Une feature collée n'a pas d'id. Chaque zone a besoin d'un `id` égal à son location_id.",
  'geo.duplicateId': 'Id de zone en double dans le GeoJSON collé : {id}',
  'geo.notPolygon':
    "La zone {id} est revenue avec la géométrie {type}, un Polygon ou un MultiPolygon était attendu. Tracez d'abord la zone dans geojson.io, puis Share et collez le lien.",
  'search.zoneTerms': 'zone à la demande',
  'search.groupTerms': "groupe d'emplacements",
};
