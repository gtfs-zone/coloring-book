/** Boot, load and export flows, in English. */
export const load = {
  'boot.openingDb': 'Opening database...',
  'boot.restoringPatches': 'Restoring patches...',
  'boot.buildingMap': 'Building map...',
  'boot.openingFeed': 'Opening feed...',
  'boot.restoreContext': 'restoring the stored feed',
  'boot.refreshFailed': 'Failed to refresh navigation: {message}',
  'edit.undone': 'Undone: {label}',
  'edit.redone': 'Redone: {label}',
  'edit.undoFailed': 'Undo failed: {message}',
  'edit.redoFailed': 'Redo failed: {message}',
  'edit.refreshAfterUndoFailed': 'Failed to refresh after undo/redo: {message}',
  'edit.refreshAfterEditFailed': 'Failed to refresh after edit: {message}',
  'help.continueShapes': 'Continue to Shapes',
  'help.continueFares': 'Continue to Fares',
  'help.continueOnDemand': 'Continue to On-Demand',
  'load.linkedFeed': 'Linked feed',
  'load.newEmpty': 'New Empty Feed',
  'load.urlErrorTitle': 'Failed to load feed',
  'load.attemptedUrl': 'Attempted URL: {link}',
  'load.corsHint':
    'Some feeds block direct browser requests (CORS). You can try opening the link above to download the file, then upload it directly using Load -> Upload.',
  'load.mapUpdateFailed': 'Failed to update map: {message}',
  'load.notZip': 'Please upload a ZIP file containing GTFS data',
  'load.preservingUnknown_one':
    'Preserving {count} unrecognized file for export: {files}',
  'load.preservingUnknown_other':
    'Preserving {count} unrecognized files for export: {files}',
  'load.loadedFile': 'Successfully loaded GTFS file: {name}',
  'load.loadedUrl': 'Successfully loaded GTFS from URL',
  'load.fileFailed': 'Failed to load GTFS file',
  'load.fileFailedReason': 'Failed to load GTFS file: {message}',
  'load.tryAgain': 'Try Again',
  'load.moreInfo': 'More Info',
  'files.required': 'Required Files',
  'files.optional': 'Optional Files',
  'files.additional': 'Additional Files',
  'files.lines_one': '{count} line',
  'files.lines_other': '{count} lines',
  'load.emptyCreated': 'New empty GTFS feed created.',
  'load.emptyFailed': 'Failed to create new GTFS feed: {message}',
  'export.versionTitle': 'feed_version has not changed since import',
  'export.versionBody':
    'Consumers use feed_version to tell one release of a feed from the next. Set a new one before publishing.',
  'export.saveAndExport': 'Save and export',
  'export.versionUnchanged': 'Enter a new feed_version, or export anyway.',
  'export.anyway': 'Export anyway',
  'export.noData': 'No GTFS data to export. Please add some data first.',
  'export.preparing': 'Preparing GTFS export...',
  'export.done': 'GTFS data exported successfully!',
  'export.failed': 'Failed to export GTFS data: {message}',
  'db.contextInit': 'initialization',
  'db.unknownError': 'Unknown error',
  'db.errorDuring': 'A database error occurred during {context}.',
  'db.stackTrace': 'Stack trace (for developers)',
  'db.exportClear': 'Export & Clear',
  'db.clearReload': 'Clear & Reload',
  'db.errorTitle': 'Database Error',
  'db.resetTitle': 'Reset Database',
  'db.resetBody':
    'This will permanently delete all stored GTFS data. Make sure to export any important data before proceeding.',
  'db.resetting': 'Resetting database...',
  'db.resetDone': 'Database reset successfully. Reloading page...',
  'db.otherTabsTitle': 'Close the other tabs',
  'db.otherTabsBody':
    'Another GTFS.zone tab still has the database open, so it cannot be reset. Close every other GTFS.zone tab, then reload this page to finish the reset.',
  'db.reload': 'Reload',
  'db.resetFailed':
    'Failed to reset database. Please clear browser data manually.',
  'db.noIndexedDb':
    'IndexedDB is not supported in this browser. GTFS.zone requires IndexedDB to function.',
  'db.missingStores_one':
    'The saved database is missing {count} table and could not be cleared ({outcome}). Close any other GTFS.zone tabs and reload.',
  'db.missingStores_other':
    'The saved database is missing {count} tables and could not be cleared ({outcome}). Close any other GTFS.zone tabs and reload.',
  'tabLock.title': 'Tab not active',
  'tabLock.body':
    'This editor is open in another tab. Only one tab can edit at a time.',
  'tabLock.useHere': 'Use here',
  'large.title': 'Large feed',
  'large.body': '{name} is large.',
  'large.wait':
    'Loading it may take about 30 seconds. Cancelling leaves the feed you have loaded now exactly as it is.',
  'large.loadAnyway': 'Load anyway',
  'parse.busy':
    'Another feed is already loading. Wait for it to finish, or cancel it first.',
  'parse.watchdog':
    'The feed loader stopped responding (no progress for {seconds}s). The feed may be too large for this browser.',
  'parse.openingStored': 'Opening stored feed...',
  'parse.preparing': 'Preparing...',
  'parse.readingStored': 'Reading stored feed...',
  'parse.restoringTable': 'Restoring {table}...',
  'parse.buildingIndexes': 'Building indexes...',
  'parse.restoringFiles': 'Restoring files...',
  'parse.complete': 'Complete!',
  'parse.waitingConfirm': 'Waiting for confirmation...',
  'parse.downloading': 'Downloading feed...',
  'parse.readingFile': 'Reading file...',
  'parse.saving': 'Saving feed...',
  'parse.networkConflict_one':
    'This feed defines networks in networks.txt or route_networks.txt and also sets network_id on {count} route in routes.txt. GTFS forbids both, so the routes.network_id values are ignored and will not be exported.',
  'parse.networkConflict_other':
    'This feed defines networks in networks.txt or route_networks.txt and also sets network_id on {count} routes in routes.txt. GTFS forbids both, so the routes.network_id values are ignored and will not be exported.',
  'parse.noData': 'No GTFS data to export',
  'dbui.outOfDate': 'App is out of date',
  'dbui.outOfDateBody':
    'The saved database is at version {current}, but this version of GTFS.zone only understands version {supported}. Reload the page to pick up the current version of the app.',
  'dbui.updateRequired': 'Database update required',
  'dbui.updateBody':
    'GTFS.zone needs to update its local database schema. Export your saved feed first, or clear and continue.',
  'dbui.exportContinue': 'Export & Continue',
  'dbui.clearContinue': 'Clear & Continue',
  'dbui.otherTabUpdating':
    'Another GTFS.zone tab is updating the database. Reload this tab to keep editing.',
  'dbui.blockedByTab':
    'Another GTFS.zone tab still has the old database open, so it cannot be updated.',
  'dbui.notAnswering':
    'The browser is not answering the request to open the database. An earlier reset may still be waiting on a tab that was never closed.',
  'dbui.notResponding': 'Database is not responding',
  'dbui.closeTabsRetry':
    'Close any other GTFS.zone tabs and retry. If that does not help, restarting the browser clears the stuck request.',
  'dbui.retry': 'Retry',
  'dbui.continueWithout': 'Continue without saving',
  'dbui.noDatabase':
    'Running without a database: edits will not be saved to this browser.',
} as const;
