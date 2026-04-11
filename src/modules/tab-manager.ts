export class TabManager {
  constructor() {
    // Don't initialize automatically, wait for explicit call
  }

  initialize() {
    // Tab radios have been replaced with modals; nothing to initialize
    console.log('[TabManager] initialized (tabs removed, modals in use)');
  }

  // No-op: tabs have been replaced with modal buttons
  switchToTab(tabName: string) {
    console.warn(
      '[TabManager] switchToTab is deprecated (tabs removed):',
      tabName
    );
  }

  // Browse is always the active panel view now
  getActiveTab(): string {
    return 'browse';
  }

  // No-op: no tab radios exist
  onTabChange(_callback: (tabName: string) => void) {
    // intentional no-op
  }
}
