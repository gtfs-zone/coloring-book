import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { help as en } from '../en/help';

/** Guide pages, in French. */
export const help: Translation<typeof en> = {
  'help.welcome.label': 'Bienvenue',
  'help.welcome.title': 'Charger, modifier et exporter un flux GTFS',
  'help.intro':
    'edit.gtfs.zone est un éditeur de données de transport GTFS dans le navigateur. Toutes les données restent dans votre navigateur : aucun serveur, aucun compte.',
  'help.welcome.load': 'Charger un flux',
  'help.welcome.loadText': 'Depuis une URL ou un fichier local.',
  'help.welcome.edit': "Modifier n'importe quelle table",
  'help.welcome.editText':
    'Agences, lignes, arrêts, voyages et tous les autres fichiers.',
  'help.welcome.place': 'Placer les arrêts sur la carte',
  'help.welcome.placeText':
    'Ajoutez et positionnez les arrêts directement sur la carte.',
  'help.welcome.check': 'Vérifier le flux',
  'help.welcome.checkText':
    "Validation au fil de l'eau par rapport à la spécification GTFS.",
  'help.welcome.export': 'Exporter un zip',
  'help.welcome.exportText': 'Téléchargez un flux GTFS prêt à publier.',
  'help.welcome.hover':
    'Survolez une propriété pour voir sa description GTFS ; cliquez sur son nom pour ouvrir la référence GTFS officielle.',
  'help.new.label': 'Créer un nouveau flux',
  'help.new.title': 'Construire un flux à partir de zéro',
  'help.new.lede':
    'Chaque objet ci-dessous fait référence à celui du dessus : en suivant cet ordre, tout reste relié.',
  'help.new.feedInfo': 'Renseigner les informations du flux',
  'help.new.agency': 'Ajouter une agence',
  'help.new.services': 'Ajouter quelques services',
  'help.new.servicesText': 'Les jours où le service circule.',
  'help.new.routes': "Ajouter des lignes à l'agence",
  'help.new.trip': 'Relier une ligne à un service',
  'help.new.tripText': 'En créant un voyage.',
  'help.new.stopTimes': 'Ajouter arrêts et horaires',
  'help.new.stopTimesText': 'Renseignez les horaires de passage de ce voyage.',
  'help.specReference': 'Référence de la spécification : {links}.',
  'help.spec.feedInfo': 'Informations du flux',
  'help.spec.agencies': 'Agences',
  'help.spec.calendar': 'Calendrier',
  'help.spec.routes': 'Lignes',
  'help.spec.trips': 'Voyages',
  'help.spec.stopTimes': 'Horaires de passage',
  'help.spec.shapes': 'Tracés',
  'help.spec.fareProducts': 'Produits tarifaires',
  'help.spec.fareMedia': 'Supports tarifaires',
  'help.spec.fareLegRules': 'Règles tarifaires par trajet',
  'help.spec.locations': 'Zones',
  'help.spec.bookingRules': 'Règles de réservation',
  'help.spec.locationGroups': "Groupes d'emplacements",
  'help.revisit': 'Vous pouvez revenir ici à tout moment depuis le menu Guide.',
  'help.shapes.label': 'Tracés',
  'help.shapes.title': 'Créer les tracés des lignes',
  'help.shapes.lede':
    "Un tracé est le chemin suivi par un véhicule sur la carte. Il est distinct de la suite d'arrêts desservis par un voyage.",
  'help.shapes.stops': "Placer d'abord les arrêts",
  'help.shapes.stopsText': 'Mettez les arrêts de la ligne au bon endroit.',
  'help.shapes.brouter': 'Tracer le chemin sur brouter',
  'help.shapes.brouterText':
    'Ouvrez un voyage dans les horaires de la ligne et cliquez sur « ouvrir dans brouter ».',
  'help.shapes.gpx': 'Exporter en GPX',
  'help.shapes.gpxText':
    'Exportez depuis brouter le chemin tracé sous forme de fichier GPX.',
  'help.shapes.import': 'Importer le tracé',
  'help.shapes.importText':
    "Importez ce fichier GPX ici, dans le gestionnaire de tracés. Le même bouton accepte aussi un flux GTFS, pour copier un tracé d'un flux existant.",
  'help.shapes.link': 'Associer le tracé',
  'help.shapes.linkText': 'Associez le tracé importé à vos voyages.',
  'help.fares.label': 'Tarifs',
  'help.fares.title': 'Décrire les tarifs dans votre flux GTFS',
  'help.fares.lede':
    'Cet éditeur utilise GTFS-Fares V2. Quelques entités décrivent ensemble ce que paie un voyageur.',
  'help.fares.products': 'Définir les produits tarifaires',
  'help.fares.productsText':
    "Ce qu'un voyageur peut acheter, comme un ticket à l'unité ou un pass journée.",
  'help.fares.media': 'Définir les supports et les catégories de voyageurs',
  'help.fares.mediaText':
    "Le support d'un produit (par ex. une carte, des espèces, une appli) et qui y a droit (par ex. adulte, senior, étudiant).",
  'help.fares.legs': 'Ajouter des règles tarifaires par trajet',
  'help.fares.legsText':
    "Appliquez vos produits tarifaires à des trajets précis d'un parcours.",
  'help.onDemand.label': 'À la demande',
  'help.onDemand.title': 'Décrire un service à la demande (GTFS Flex)',
  'help.onDemand.lede':
    'Un service à la demande se réserve au lieu de se prendre à heure fixe. GTFS Flex le décrit avec quelques éléments qui se greffent sur un voyage ordinaire.',
  'help.onDemand.zone': 'Une zone est un secteur, pas un arrêt',
  'help.onDemand.zoneText':
    "Un polygone tracé sur la carte, à l'intérieur duquel un voyageur peut être pris en charge ou déposé n'importe où. Les zones sont dans locations.geojson, pas dans stops.txt.",
  'help.onDemand.group': "Un groupe d'emplacements est un ensemble d'arrêts",
  'help.onDemand.groupText':
    "Quand le service dessert quelques arrêts nommés plutôt qu'un secteur entier, regroupez ces arrêts au lieu de tracer une zone.",
  'help.onDemand.booking': 'Une règle de réservation indique comment réserver',
  'help.onDemand.bookingText':
    "Combien de temps à l'avance un voyageur doit appeler ou réserver, et où. En temps réel, le jour même, ou avant une heure limite un jour précédent.",
  'help.onDemand.stopTime': 'Un stop_time les rattache à un voyage',
  'help.onDemand.stopTimeText':
    "Donnez à un stop_time une plage de prise en charge et de dépose au lieu d'une arrivée et d'un départ, faites-le pointer vers une zone ou un groupe d'emplacements, et indiquez la règle de réservation utilisée.",
  'help.about.subject': 'Retour sur edit.gtfs.zone',
  'help.about.sibling': 'suivez un flux GTFS Realtime sur une carte en direct',
  'help.mapKey.label': 'Légende de la carte',
  'help.mapKey.title': 'Lire les symboles de la carte',
  'help.mapKey.unlocated': 'Nœud sans position',
  'help.mapKey.pathways': 'Cheminements',
  'help.publish.label': 'Publier votre flux',
  'help.publish.title': 'Publier votre flux',
  'help.publish.lede':
    "Un flux GTFS n'est utile qu'une fois accessible aux voyageurs et à leurs applis. Quelques étapes transforment le fichier exporté en flux publié.",
  'help.publish.validator': 'Valider avec le {link}',
  'help.publish.validatorLink': 'validateur GTFS de référence',
  'help.publish.validatorText':
    'Repérez tout ce que cet éditeur ne vérifie pas.',
  'help.publish.license': 'Respecter la licence du flux source',
  'help.publish.licenseText':
    "Si vous êtes parti du flux de quelqu'un d'autre, sa licence couvre toujours ce que vous publiez. Créditez-le dans attributions.txt.",
  'help.publish.host': 'Héberger le zip à une URL stable',
  'help.publish.hostText':
    'Un emplacement qui ne change pas, pour que les applis récupèrent toujours la dernière version.',
  'help.publish.register': 'Référencer le flux pour que les applis le trouvent',
  'help.publish.registerText':
    'Ajoutez-le à la {mdb} et à {atlas}, et soumettez-le à {google}.',
  'help.publish.realtime': 'Suivre vos véhicules avec {link}',
  'help.publish.realtimeText':
    "Une fois les horaires publiés, les positions des véhicules en direct, les mises à jour de voyages et les alertes de service sont l'étape suivante.",
  'help.publish.footnote':
    'Vous pouvez revenir ici à tout moment depuis le menu Guide. {link} détaille toute la démarche.',
  'help.publish.footnoteLink': 'La publication sur gtfs.org',
};
