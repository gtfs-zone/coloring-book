import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { issues as en } from '../en/issues';

/** Feed issues, in French. */
export const issues: Translation<typeof en> = {
  'issues.rows': '{file} : lignes {text}',
  'issues.missingRequiredField': 'auxquelles il manque un champ obligatoire',
  'issues.missingRequiredFile': 'auxquelles il manque un fichier obligatoire',
  'issues.routesBadAgency': 'lignes avec un agency_id absent de agency.txt',
  'issues.badRefField': '{file} : lignes avec un {field} inexistant',
  'issues.badRef':
    '{file} : lignes qui font référence à un enregistrement inexistant',
  'issues.routesBadAgencyNote':
    "Ces lignes n'apparaîtront sous aucune agence tant que agency_id ne sera pas corrigé.",
  'issues.empty': 'vides',
  'issues.duplicateId': 'avec un id en double',
  'issues.invalidCoordinate': 'avec une coordonnée invalide',
  'issues.invalidDate': 'avec une date invalide',
  'issues.invalidTime': 'avec une heure invalide',
  'issues.invalidNumber': 'avec un nombre invalide',
  'issues.invalidUrl': 'avec une URL invalide',
  'issues.invalidCode': "{file} : lignes dont {field} n'est pas un code valide",
  'issues.value': 'la valeur',
  'issues.invalidGeometry': '{file} : zones avec une géométrie invalide',
  'issues.conditional':
    'auxquelles il manque un champ obligatoire sous condition',
  'issues.unknownRouteType': 'avec un route_type inconnu',
  'issues.unknownLocationType': 'avec un location_type inconnu',
  'issues.invalidExceptionType': 'avec un exception_type invalide',
  'issues.invalidArea': 'avec une affectation de secteur invalide',
  'issues.noStopTimes': 'sans aucun stop_time',
  'issues.deleteTrips': 'Supprimer les voyages',
  'issues.deleteTripsConfirm':
    'Supprimer {trips} sans stop_times, et les lignes frequencies de ces voyages ? Une seule annulation suffit pour revenir en arrière.',
  'issues.orphaned': "sans coordonnées propres ni héritées d'un parent",
  'issues.orphanedNote':
    'Ils ne sont pas dessinés sur la carte. Donnez à chacun des coordonnées, ou un parent_station qui en a.',
  'issues.unpairedFlex':
    'avec une plage de prise en charge/dépose non appariée',
  'issues.unpairedFlexNote':
    "D'autres voyages de la ligne associent cette plage à une seconde ligne pour l'autre sens de déplacement.",
  'issues.riderDefault':
    'produits tarifaires sans exactement une catégorie de voyageurs par défaut',
  'issues.networkConflict': 'avec un network_id en conflit',
  'issues.missingCalendar': 'sans fichier de calendrier',
  'issues.inheritedCoords': "héritant des coordonnées d'un parent",
  'issues.hiddenWhitespaceField':
    '{file} : lignes dont {field} contient des espaces cachés',
  'issues.hiddenWhitespace': 'avec des espaces cachés dans une valeur',
  'issues.hiddenWhitespaceNote':
    'Un champ CSV entre guillemets qui a absorbé la fin de ligne. Les caractères en trop sont invisibles mais comptent : un id qui les porte ne correspond à rien.',
  'issues.fix': 'Corriger',
  'issues.fixConfirm':
    'Nettoyer les espaces cachés dans {values} ? Une seule annulation suffit pour revenir en arrière.',
  'issues.values_one': '{count} valeur',
  'issues.values_other': '{count} valeurs',
  'issues.duplicateKey': 'partageant une clé primaire avec une autre ligne',
  'issues.frequencyOverlap':
    'avec des périodes de fréquence qui se chevauchent',
  'issues.frequencyEnd': 'dont end_time tombe sur un départ',
  'issues.recordTitle': 'Problèmes de cet enregistrement',
  'issues.danglingRef':
    "{field} fait référence à « {value} », qui n'existe pas",
  'issues.danglingNote':
    "Choisissez une valeur existante ci-dessous, ou créez l'enregistrement auquel elle fait référence.",
  'issues.gone': 'Ce problème a déjà disparu',
  'issues.unknownAction': 'Action inconnue {id}',
  'issues.confirmTitle': '{label} ?',
  'issues.title': 'Problèmes du flux',
};
