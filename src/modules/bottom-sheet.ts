import { TabManager } from './tab-manager';

type Snap = 'peek' | 'half' | 'full';

const PEEK_PX = 56;
const HALF_VH = 0.45;
const FULL_VH = 0.92;

export class BottomSheetController {
  private snap: Snap = 'peek';
  private panel: HTMLElement;

  constructor(panel: HTMLElement, tabManager: TabManager) {
    this.panel = panel;

    // Only activate on mobile
    if (window.innerWidth >= 768) {
      return;
    }

    this.setupDragHandle();
    this.setupTabExpansion(tabManager);
    this.setSnap('peek', false);

    // Re-check on resize (e.g. orientation change)
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        panel.style.removeProperty('height');
        panel.classList.remove('sheet-full');
      } else {
        this.setSnap(this.snap, false);
      }
    });
  }

  private setupDragHandle(): void {
    const handle = document.getElementById('sheet-drag-handle');
    if (!handle) {
      return;
    }

    let startY = 0;
    let startHeight = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let dragging = false;

    const onStart = (clientY: number) => {
      startY = clientY;
      startHeight = this.panel.getBoundingClientRect().height;
      lastY = clientY;
      lastTime = Date.now();
      velocity = 0;
      dragging = true;
      this.panel.style.transition = 'none';
      document.body.style.userSelect = 'none';
    };

    const onMove = (clientY: number) => {
      if (!dragging) {
        return;
      }
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) {
        velocity = (lastY - clientY) / dt;
      } // px/ms, positive = up
      lastY = clientY;
      lastTime = now;

      const delta = startY - clientY; // positive = dragging up
      const newHeight = Math.min(
        window.innerHeight * FULL_VH,
        Math.max(PEEK_PX, startHeight + delta)
      );
      this.panel.style.height = `${newHeight}px`;
    };

    const onEnd = () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      startY = 0;
      document.body.style.userSelect = '';
      this.panel.style.transition = '';
      const targetSnap = this.resolveSnap(velocity);
      this.setSnap(targetSnap, true);
    };

    // Touch
    handle.addEventListener(
      'touchstart',
      (e) => onStart(e.touches[0].clientY),
      { passive: true }
    );
    document.addEventListener(
      'touchmove',
      (e) => {
        if (dragging) {
          onMove(e.touches[0].clientY);
        }
      },
      { passive: true }
    );
    document.addEventListener('touchend', () => onEnd());

    // Mouse (for desktop testing)
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onStart(e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
      if (dragging) {
        onMove(e.clientY);
      }
    });
    document.addEventListener('mouseup', () => onEnd());
  }

  private resolveSnap(velocity: number): Snap {
    const VELOCITY_THRESHOLD = 0.4; // px/ms
    if (velocity > VELOCITY_THRESHOLD) {
      return this.snap === 'peek' ? 'half' : 'full';
    }
    if (velocity < -VELOCITY_THRESHOLD) {
      return this.snap === 'full' ? 'half' : 'peek';
    }
    // Snap to nearest based on current height
    const h = this.panel.getBoundingClientRect().height;
    const halfH = window.innerHeight * HALF_VH;
    const fullH = window.innerHeight * FULL_VH;
    if (h < (PEEK_PX + halfH) / 2) {
      return 'peek';
    }
    if (h < (halfH + fullH) / 2) {
      return 'half';
    }
    return 'full';
  }

  private setSnap(snap: Snap, animate: boolean): void {
    this.snap = snap;
    if (!animate) {
      this.panel.style.transition = 'none';
    }
    const h =
      snap === 'peek'
        ? PEEK_PX
        : snap === 'half'
          ? window.innerHeight * HALF_VH
          : window.innerHeight * FULL_VH;
    this.panel.style.setProperty('--sheet-height', `${h}px`);
    this.panel.style.height = `${h}px`;
    this.panel.classList.toggle('sheet-full', snap === 'full');
    if (!animate) {
      // Re-enable transition after layout settles
      requestAnimationFrame(() => {
        this.panel.style.transition = '';
      });
    }
  }

  private setupTabExpansion(tabManager: TabManager): void {
    // When a tab is activated while the sheet is at peek, expand to half
    tabManager.onTabChange(() => {
      if (this.snap === 'peek') {
        this.setSnap('half', true);
      }
    });
  }

  public expandTo(snap: 'half' | 'full'): void {
    this.setSnap(snap, true);
  }
}
