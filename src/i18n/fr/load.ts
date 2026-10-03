import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { load as en } from '../en/load';

/** Boot, load and export flows, in French. */
export const load: Translation<typeof en> = {
  'boot.openingDb': 'Ouverture de la base de données...',
  'boot.restoringPatches': 'Restauration des modifications...',
  'boot.buildingMap': 'Construction de la carte...',
  'boot.openingFeed': 'Ouverture du flux...',
  'boot.restoreContext': 'la restauration du flux enregistré',
  'boot.refreshFailed': "Échec de l'actualisation de la navigation : {message}",
  'edit.undone': 'Annulé : {label}',
  'edit.redone': 'Rétabli : {label}',
  'edit.undoFailed': "Échec de l'annulation : {message}",
  'edit.redoFailed': 'Échec du rétablissement : {message}',
  'edit.refreshAfterUndoFailed':
    "Échec de l'actualisation après annulation/rétablissement : {message}",
  'edit.refreshAfterEditFailed':
    "Échec de l'actualisation après la modification : {message}",
  'help.continueShapes': 'Continuer vers les tracés',
  'help.continueFares': 'Continuer vers les tarifs',
  'help.continueOnDemand': 'Continuer vers le transport à la demande',
  'load.linkedFeed': 'Flux lié',
  'load.newEmpty': 'Nouveau flux vide',
  'load.urlErrorTitle': 'Échec du chargement du flux',
  'load.attemptedUrl': 'URL demandée : {link}',
  'load.corsHint':
    'Certains flux bloquent les requêtes directes du navigateur (CORS). Ouvrez le lien ci-dessus pour télécharger le fichier, puis importez-le avec Charger -> Importer.',
  'load.mapUpdateFailed': 'Échec de la mise à jour de la carte : {message}',
  'load.notZip': 'Importez un fichier ZIP contenant des données GTFS',
  'load.preservingUnknown_one':
    "Conservation de {count} fichier non reconnu pour l'export : {files}",
  'load.preservingUnknown_other':
    "Conservation de {count} fichiers non reconnus pour l'export : {files}",
  'load.loadedFile': 'Fichier GTFS chargé : {name}',
  'load.loadedUrl': "Flux GTFS chargé depuis l'URL",
  'load.fileFailed': 'Échec du chargement du fichier GTFS',
  'load.fileFailedReason': 'Échec du chargement du fichier GTFS : {message}',
  'load.tryAgain': 'Réessayer',
  'load.moreInfo': "Plus d'infos",
  'files.required': 'Fichiers obligatoires',
  'files.optional': 'Fichiers facultatifs',
  'files.additional': 'Fichiers supplémentaires',
  'files.lines_one': '{count} ligne',
  'files.lines_other': '{count} lignes',
  'load.emptyCreated': 'Nouveau flux GTFS vide créé.',
  'load.emptyFailed': 'Échec de la création du flux GTFS : {message}',
  'export.versionTitle': "feed_version n'a pas changé depuis l'import",
  'export.versionBody':
    'Les réutilisateurs se servent de feed_version pour distinguer une version du flux de la suivante. Indiquez-en une nouvelle avant de publier.',
  'export.saveAndExport': 'Enregistrer et exporter',
  'export.versionUnchanged':
    'Saisissez une nouvelle feed_version, ou exportez quand même.',
  'export.anyway': 'Exporter quand même',
  'export.noData':
    "Aucune donnée GTFS à exporter. Ajoutez d'abord des données.",
  'export.preparing': "Préparation de l'export GTFS...",
  'export.done': 'Données GTFS exportées.',
  'export.failed': "Échec de l'export des données GTFS : {message}",
  'db.contextInit': "l'initialisation",
  'db.unknownError': 'Erreur inconnue',
  'db.errorDuring':
    "Une erreur de base de données s'est produite lors de {context}.",
  'db.stackTrace': 'Trace de pile (pour les développeurs)',
  'db.exportClear': 'Exporter et vider',
  'db.clearReload': 'Vider et recharger',
  'db.errorTitle': 'Erreur de base de données',
  'db.resetTitle': 'Réinitialiser la base de données',
  'db.resetBody':
    'Toutes les données GTFS enregistrées seront définitivement supprimées. Exportez les données importantes avant de continuer.',
  'db.resetting': 'Réinitialisation de la base de données...',
  'db.resetDone': 'Base de données réinitialisée. Rechargement de la page...',
  'db.otherTabsTitle': 'Fermez les autres onglets',
  'db.otherTabsBody':
    'Un autre onglet GTFS.zone utilise encore la base de données, elle ne peut donc pas être réinitialisée. Fermez tous les autres onglets GTFS.zone, puis rechargez cette page pour terminer la réinitialisation.',
  'db.reload': 'Recharger',
  'db.resetFailed':
    'Échec de la réinitialisation de la base de données. Effacez manuellement les données du navigateur.',
  'db.noIndexedDb':
    'Ce navigateur ne prend pas en charge IndexedDB, nécessaire au fonctionnement de GTFS.zone.',
  'db.missingStores_one':
    "Il manque {count} table à la base de données enregistrée et elle n'a pas pu être vidée ({outcome}). Fermez les autres onglets GTFS.zone et rechargez.",
  'db.missingStores_other':
    "Il manque {count} tables à la base de données enregistrée et elle n'a pas pu être vidée ({outcome}). Fermez les autres onglets GTFS.zone et rechargez.",
  'tabLock.title': 'Onglet inactif',
  'tabLock.body':
    'Cet éditeur est ouvert dans un autre onglet. Un seul onglet peut modifier à la fois.',
  'tabLock.useHere': 'Utiliser ici',
  'large.title': 'Flux volumineux',
  'large.body': '{name} est volumineux.',
  'large.wait':
    'Le charger peut prendre environ 30 secondes. Annuler laisse le flux actuellement chargé tel quel.',
  'large.loadAnyway': 'Charger quand même',
  'parse.busy':
    "Un autre flux est déjà en cours de chargement. Attendez qu'il se termine, ou annulez-le d'abord.",
  'parse.watchdog':
    'Le chargeur de flux ne répond plus (aucune progression depuis {seconds} s). Le flux est peut-être trop volumineux pour ce navigateur.',
  'parse.openingStored': 'Ouverture du flux enregistré...',
  'parse.preparing': 'Préparation...',
  'parse.readingStored': 'Lecture du flux enregistré...',
  'parse.restoringTable': 'Restauration de {table}...',
  'parse.buildingIndexes': 'Construction des index...',
  'parse.restoringFiles': 'Restauration des fichiers...',
  'parse.complete': 'Terminé !',
  'parse.waitingConfirm': 'En attente de confirmation...',
  'parse.downloading': 'Téléchargement du flux...',
  'parse.readingFile': 'Lecture du fichier...',
  'parse.saving': 'Enregistrement du flux...',
  'parse.networkConflict_one':
    'Ce flux définit des réseaux dans networks.txt ou route_networks.txt et renseigne aussi network_id sur {count} ligne de routes.txt. GTFS interdit les deux : les valeurs de routes.network_id sont ignorées et ne seront pas exportées.',
  'parse.networkConflict_other':
    'Ce flux définit des réseaux dans networks.txt ou route_networks.txt et renseigne aussi network_id sur {count} lignes de routes.txt. GTFS interdit les deux : les valeurs de routes.network_id sont ignorées et ne seront pas exportées.',
  'parse.noData': 'Aucune donnée GTFS à exporter',
  'dbui.outOfDate': "L'application n'est pas à jour",
  'dbui.outOfDateBody':
    "La base de données enregistrée est en version {current}, mais cette version de GTFS.zone ne comprend que la version {supported}. Rechargez la page pour obtenir la version actuelle de l'application.",
  'dbui.updateRequired': 'Mise à jour de la base de données nécessaire',
  'dbui.updateBody':
    "GTFS.zone doit mettre à jour le schéma de sa base de données locale. Exportez d'abord votre flux enregistré, ou videz et continuez.",
  'dbui.exportContinue': 'Exporter et continuer',
  'dbui.clearContinue': 'Vider et continuer',
  'dbui.otherTabUpdating':
    'Un autre onglet GTFS.zone met à jour la base de données. Rechargez cet onglet pour continuer à modifier.',
  'dbui.blockedByTab':
    "Un autre onglet GTFS.zone utilise encore l'ancienne base de données, elle ne peut donc pas être mise à jour.",
  'dbui.notAnswering':
    "Le navigateur ne répond pas à la demande d'ouverture de la base de données. Une réinitialisation précédente attend peut-être encore un onglet jamais fermé.",
  'dbui.notResponding': 'La base de données ne répond pas',
  'dbui.closeTabsRetry':
    'Fermez les autres onglets GTFS.zone et réessayez. Si cela ne suffit pas, redémarrer le navigateur débloque la requête.',
  'dbui.retry': 'Réessayer',
  'dbui.continueWithout': 'Continuer sans enregistrer',
  'dbui.noDatabase':
    'Fonctionnement sans base de données : les modifications ne seront pas enregistrées dans ce navigateur.',
};
