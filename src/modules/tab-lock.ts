import { generateId } from '../utils/uuid';

interface TabLockMessage {
  type: string;
  tabId: string;
  claimedAt: number;
}

export class TabLockController {
  private tabId: string = generateId();
  private claimedAt: number = Date.now();
  private active = true;
  private channel: BroadcastChannel | null = null;
  private overlay: HTMLElement | null = null;

  init(): void {
    this.channel = new BroadcastChannel('gtfs-zone-tab-lock');
    this.channel.onmessage = (e: MessageEvent<TabLockMessage>) =>
      this.handleMessage(e.data);
    this.channel.postMessage({
      type: 'claim',
      tabId: this.tabId,
      claimedAt: this.claimedAt,
    });
    window.addEventListener('beforeunload', () => this.channel?.close());
    console.log('[TabLock] Tab claimed active status', this.tabId);
  }

  private handleMessage(msg: TabLockMessage): void {
    if (msg.type !== 'claim') {
      return;
    }
    const incomingIsNewer =
      msg.claimedAt > this.claimedAt ||
      (msg.claimedAt === this.claimedAt && msg.tabId > this.tabId);
    if (incomingIsNewer) {
      this.active = false;
      this.showOverlay();
    }
  }

  private showOverlay(): void {
    if (this.overlay) {
      return;
    }
    console.log(
      '[TabLock] Tab deactivated — another tab claimed active status'
    );
    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 z-[200] bg-base-300/80 backdrop-blur-sm flex items-center justify-center';
    overlay.innerHTML = `
      <div class="card bg-base-100 shadow-2xl p-8 text-center max-w-sm">
        <h2 class="text-xl font-bold mb-2">Tab not active</h2>
        <p class="text-base-content/70 mb-6 text-sm">
          This editor is open in another tab. Only one tab can edit at a time.
        </p>
        <button id="tab-lock-use-here" class="btn btn-primary w-full">Use here</button>
      </div>
    `;
    overlay
      .querySelector('#tab-lock-use-here')
      ?.addEventListener('click', () => window.location.reload());
    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  isActive(): boolean {
    return this.active;
  }
}
