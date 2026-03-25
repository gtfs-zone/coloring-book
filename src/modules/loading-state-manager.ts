/**
 * Loading State Manager for Database Operations
 * Provides global loading indicators and state management
 */
export class LoadingStateManager {
  private loadingStates: Map<string, boolean> = new Map();
  private loadingElement: HTMLElement | null = null;
  private progressElement: HTMLElement | null = null;
  private statusElement: HTMLElement | null = null;

  constructor() {
    this.initializeLoadingIndicator();
  }

  /**
   * Initialize the global loading indicator UI
   */
  private initializeLoadingIndicator(): void {
    // Create loading indicator if it doesn't exist
    let existingIndicator = document.getElementById('global-loading-indicator');
    if (!existingIndicator) {
      existingIndicator = this.createLoadingIndicator();
      document.body.appendChild(existingIndicator);
    }

    this.loadingElement = existingIndicator;
    this.progressElement = existingIndicator.querySelector('.loading-progress');
    this.statusElement = existingIndicator.querySelector('.loading-status');
  }

  /**
   * Create the loading indicator DOM element
   */
  private createLoadingIndicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.id = 'global-loading-indicator';
    indicator.className =
      'fixed top-0 left-0 right-0 z-50 bg-primary text-primary-content px-4 py-2 transform -translate-y-full transition-transform duration-300 ease-in-out';
    indicator.innerHTML = `
      <div class="flex items-center justify-center space-x-3">
        <span class="loading loading-spinner loading-sm"></span>
        <div class="flex flex-col">
          <span class="loading-status text-sm font-medium">Processing...</span>
          <div class="loading-progress-container mt-1">
            <progress class="loading-progress progress progress-primary-content w-64 h-1" value="0" max="100"></progress>
          </div>
        </div>
      </div>
    `;
    return indicator;
  }

  /**
   * Start loading for a specific operation
   */
  startLoading(operation: string, status: string = 'Processing...'): void {
    this.loadingStates.set(operation, true);
    this.updateLoadingDisplay(status);
  }

  /**
   * Update loading progress and status
   */
  updateProgress(operation: string, progress: number, status?: string): void {
    if (this.loadingStates.has(operation)) {
      if (this.progressElement) {
        (this.progressElement as HTMLProgressElement).value = progress;
      }
      if (status && this.statusElement) {
        this.statusElement.textContent = status;
      }
    }
  }

  /**
   * Finish loading for a specific operation
   */
  finishLoading(operation: string): void {
    this.loadingStates.delete(operation);

    if (this.loadingStates.size === 0) {
      this.hideLoadingIndicator();
    }
  }

  /**
   * Check if any operations are currently loading
   */
  isLoading(): boolean {
    return this.loadingStates.size > 0;
  }

  /**
   * Get current loading operations
   */
  getLoadingOperations(): string[] {
    return Array.from(this.loadingStates.keys());
  }

  /**
   * Update the loading display
   */
  private updateLoadingDisplay(status: string): void {
    if (this.statusElement) {
      this.statusElement.textContent = status;
    }

    if (this.progressElement) {
      (this.progressElement as HTMLProgressElement).value = 0;
    }

    this.showLoadingIndicator();
  }

  /**
   * Show the loading indicator
   */
  private showLoadingIndicator(): void {
    if (this.loadingElement) {
      this.loadingElement.classList.remove('-translate-y-full');
      this.loadingElement.classList.add('translate-y-0');
    }
  }

  /**
   * Hide the loading indicator
   */
  private hideLoadingIndicator(): void {
    if (this.loadingElement) {
      this.loadingElement.classList.remove('translate-y-0');
      this.loadingElement.classList.add('-translate-y-full');
    }
  }

  /**
   * Force hide loading indicator (for error scenarios)
   */
  forceHideLoading(): void {
    this.loadingStates.clear();
    this.hideLoadingIndicator();
  }

  /**
   * Show error state
   */
  showError(message: string): void {
    if (this.loadingElement) {
      this.loadingElement.className =
        'fixed top-0 left-0 right-0 z-50 bg-error text-error-content px-4 py-2 transform translate-y-0 transition-transform duration-300 ease-in-out';
      if (this.statusElement) {
        this.statusElement.textContent = `Error: ${message}`;
      }

      // Hide error after 5 seconds
      setTimeout(() => {
        this.hideLoadingIndicator();
        // Reset to normal appearance
        this.loadingElement!.className =
          'fixed top-0 left-0 right-0 z-50 bg-primary text-primary-content px-4 py-2 transform -translate-y-full transition-transform duration-300 ease-in-out';
      }, 5000);
    }
  }

  /**
   * Show warning state briefly
   */
  showWarning(message: string): void {
    if (this.loadingElement) {
      this.loadingElement.className =
        'fixed top-0 left-0 right-0 z-50 bg-warning text-warning-content px-4 py-2 transform translate-y-0 transition-transform duration-300 ease-in-out';
      if (this.statusElement) {
        this.statusElement.textContent = message;
      }

      // Hide warning after 5 seconds
      setTimeout(() => {
        this.hideLoadingIndicator();
        // Reset to normal appearance
        this.loadingElement!.className =
          'fixed top-0 left-0 right-0 z-50 bg-primary text-primary-content px-4 py-2 transform -translate-y-full transition-transform duration-300 ease-in-out';
      }, 5000);
    }
  }

  /**
   * Show success state briefly
   */
  showSuccess(message: string): void {
    if (this.loadingElement) {
      this.loadingElement.className =
        'fixed top-0 left-0 right-0 z-50 bg-success text-success-content px-4 py-2 transform translate-y-0 transition-transform duration-300 ease-in-out';
      if (this.statusElement) {
        this.statusElement.textContent = message;
      }

      // Hide success after 3 seconds
      setTimeout(() => {
        this.hideLoadingIndicator();
        // Reset to normal appearance
        this.loadingElement!.className =
          'fixed top-0 left-0 right-0 z-50 bg-primary text-primary-content px-4 py-2 transform -translate-y-full transition-transform duration-300 ease-in-out';
      }, 3000);
    }
  }
}

// Global singleton instance
export const loadingStateManager = new LoadingStateManager();
