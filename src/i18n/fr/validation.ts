import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { validation as en } from '../en/validation';

/** Validation messages, in French. */
export const validation: Translation<typeof en> = {
  'rule.bothOrNeither':
    '{a} et {b} doivent être renseignés tous les deux, ou laissés vides tous les deux',
  'rule.requiredWhen': '{field} est obligatoire quand {condition}',
  'rule.forbiddenWhen': '{field} est interdit quand {condition}',
  'rule.wallClock': '{field} doit être une heure au format HH:MM:SS',
  'rule.notAfter24': '{field} ne doit pas dépasser 24:00:00',
  'cond.transferType': 'transfer_type vaut {type}',
  'cond.transferTypeStops': 'transfer_type est vide, 0, 1, 2 ou 3',
  'cond.window': 'une plage de prise en charge/dépose est définie',
  'cond.times': 'arrival_time ou departure_time est défini',
  'cond.defined': '{field} est défini',
  'cond.timepoint': 'timepoint=1',
  'flexRule.oneOf':
    'un de stop_id, location_group_id ou location_id est obligatoire',
  'flexRule.exclusive':
    "{fields} s'excluent mutuellement : n'en renseignez qu'un",
  'flexRule.and': ' et ',
  'flexRule.windowRequired':
    'une plage de prise en charge/dépose est obligatoire quand {field} est défini',
  'flexRule.windowForbidden':
    'une plage de prise en charge/dépose est interdite quand arrival_time ou departure_time est défini',
  'flexRule.windowOrder':
    'start_pickup_drop_off_window ne doit pas être postérieur à end_pickup_drop_off_window',
  'flexRule.pickupType':
    'pickup_type doit valoir 1 ou 2 quand une plage de prise en charge/dépose est définie',
  'flexRule.dropOffType':
    'drop_off_type doit valoir 1, 2 ou 3 quand une plage de prise en charge/dépose est définie',
  'flexRule.continuous':
    '{field} doit valoir 1 ou être vide quand une plage de prise en charge/dépose est définie',
  'flexRule.firstLast':
    "arrival_time est obligatoire pour le premier et le dernier arrêt d'un voyage",
  'flexRule.pickupForbidden':
    'pickup_type={value} est interdit quand une plage de prise en charge/dépose est définie ; il doit valoir 1 ou 2',
  'flexRule.pickupEmpty':
    'pickup_type doit valoir 1 ou 2 quand une plage de prise en charge/dépose est définie ; vide équivaut à 0',
  'flexRule.dropOffForbidden':
    'drop_off_type=0 est interdit quand une plage de prise en charge/dépose est définie ; il doit valoir 1, 2 ou 3',
  'flexRule.dropOffEmpty':
    'drop_off_type doit valoir 1, 2 ou 3 quand une plage de prise en charge/dépose est définie ; vide équivaut à 0',
  'flexRule.continuousForbidden':
    '{field}={value} est interdit quand une plage de prise en charge/dépose est définie ; il doit valoir 1 ou être vide',
  'booking.requiredFor': '{field} est obligatoire pour booking_type={type}',
  'booking.forbiddenFor': '{field} est interdit pour booking_type={type}',
  'booking.startDayMax':
    'prior_notice_start_day est interdit pour booking_type=1 quand prior_notice_duration_max est défini',
  'booking.serviceOnly2':
    "prior_notice_service_id n'est autorisé que pour booking_type=2, pas booking_type={type}",
  'ids.groupTaken':
    "location_group_id « {id} » est déjà utilisé comme {owner} ; l'ID doit être unique dans stops.txt, locations.geojson et location_groups.txt",
  'ids.taken':
    "« {id} » est déjà utilisé comme {owner} ; l'ID doit être unique dans stops.txt, locations.geojson et location_groups.txt.",
  'ids.ownerStop': 'stop_id de stops.txt',
  'ids.ownerZone': 'id de locations.geojson',
  'ids.ownerGroup': 'location_group_id de location_groups.txt',
  'freq.required': '{field} est obligatoire',
  'freq.invalidTime': "{field} « {value} » n'est pas une heure valide",
  'freq.endAfterStart': 'end_time doit être postérieur à start_time',
  'freq.headway':
    'headway_secs « {value} » doit être un nombre entier positif de secondes',
  'freq.exactTimes': 'exact_times « {value} » doit valoir 0, 1 ou être vide',
  'freq.overlap':
    'la période de fréquence {period} chevauche {other} sur le même voyage',
  'renameRule.empty': "L'ID ne peut pas être vide",
  'renameRule.whitespace': "L'ID ne peut pas commencer ni finir par un espace",
  'renameRule.taken': "{table} a déjà une ligne avec l'ID « {id} »",
  'renameRule.unchanged': "L'ID n'a pas changé",
  'value.mustBeNumber': 'Doit être un nombre',
  'value.required': 'Ce champ est obligatoire',
  'value.invalid': 'Valeur invalide',
  'value.month': 'Le mois doit être compris entre 01 et 12',
  'value.day': 'Le jour doit être compris entre 01 et 31',
  'value.year': "L'année doit être comprise entre 1900 et 2200",
  'value.timeNumbers': "L'heure doit contenir des nombres valides",
  'value.minutes': 'Les minutes doivent être comprises entre 00 et 59',
  'value.seconds': 'Les secondes doivent être comprises entre 00 et 59',
  'value.hoursNegative': 'Les heures ne peuvent pas être négatives',
  'value.validNumber': 'Doit être un nombre valide',
  'value.validInteger': 'Doit être un entier valide',
  'value.integerNoDecimals': 'Doit être un entier (sans décimales)',
  'value.languageCode': 'Doit être un code de langue IETF BCP 47 valide',
  'value.currencyCode': 'Doit être un code de devise ISO 4217 à 3 lettres',
  'value.decimalAmount': 'Doit être un montant décimal valide',
  'value.hexColor': 'Doit être une couleur hexadécimale à 6 chiffres',
  'value.dateFormat': 'Doit être au format AAAAMMJJ',
  'value.timeFormat': 'Doit être au format HH:MM:SS',
  'value.notZero': 'Ne doit pas valoir 0',
  'value.unknownType': 'Type de champ inconnu : {type}',
  'value.invalidFormat': 'Format invalide pour {type}. {description}',
  'value.min': 'La valeur doit être >= {min}',
  'value.max': 'La valeur doit être <= {max}',
  'shapeGeo.noGeometry': "Cette feature n'a pas de géométrie.",
  'shapeGeo.multiLine':
    "Un tracé est une seule ligne, mais ce MultiLineString a {count} parties. Réunissez-les d'abord en une seule LineString.",
  'shapeGeo.notLine':
    'Un tracé est une ligne, mais cette feature est un {type}. Tracez plutôt une LineString.',
  'shapeGeo.tooFew':
    "Un tracé a besoin d'au moins deux points, cette ligne en a {count}.",
  'shapeGeo.badPoint': 'Le point {n} a une coordonnée non numérique.',
  'geoIo.decompress':
    'Impossible de décompresser les données geojson.io : {message}',
  'geoIo.encoding':
    'Encodage des données geojson.io non pris en charge : préfixe « {gz} » ou « {json} » attendu.',
  'geoIo.nothingPasted': "Rien n'a été collé.",
  'geoIo.notUrl': "Ce n'est pas une URL valide.",
  'geoIo.noData':
    "Cette URL geojson.io n'a pas de paramètre `data`. Tracez d'abord quelque chose, ou collez directement le GeoJSON.",
  'geoIo.notCollection': 'FeatureCollection GeoJSON attendue, reçu : {type}.',
  'gpx.noPoints': 'Aucun point de trace dans le fichier GPX',
  'gpx.noValidPoints': 'Aucun point de trace valide dans le fichier GPX',
  'coords.invalid': 'Coordonnées invalides : lat={lat}, lng={lng}',
  'coords.lat': 'Latitude invalide : {lat}. Doit être comprise entre -90 et 90',
  'coords.lng':
    'Longitude invalide : {lng}. Doit être comprise entre -180 et 180',
};
