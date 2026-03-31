interface NotificationAction {
  id: string;
  label: string;
  handler: () => void;
  primary?: boolean;
}

interface NotificationOptions {
  autoHide?: boolean;
  duration?: number;
  actions?: NotificationAction[];
}

interface Notification {
  id: number;
  message: string;
  type: string;
  autoHide: boolean;
  duration: number;
  actions: NotificationAction[];
  element: HTMLElement | null;
}

export class NotificationSystem {
  private container: HTMLElement | null = null;
  private notifications: Notification[] = [];
  private maxNotifications: number = 5;
  private autoHideDelay: number = 5000; // 5 seconds

  constructor() {}

  initialize(): void {
    // Create notification container
    this.container = document.createElement('div');
    this.container.id = 'notification-container';
    this.container.className = 'fixed bottom-4 left-4 z-50 space-y-2';
    document.body.appendChild(this.container);
  }

  show(
    message: string,
    type: string = 'info',
    options: NotificationOptions = {}
  ): number {
    const {
      autoHide = true,
      duration = this.autoHideDelay,
      actions = [],
    } = options;

    const notification = {
      id: Date.now() + Math.random(),
      message,
      type,
      autoHide,
      duration,
      actions,
      element: null,
    };

    this.notifications.push(notification);
    this.renderNotification(notification);

    // Remove oldest notifications if we exceed the limit
    if (this.notifications.length > this.maxNotifications) {
      const toRemove = this.notifications.splice(
        0,
        this.notifications.length - this.maxNotifications
      );
      toRemove.forEach((n) => this.removeNotification(n.id));
    }

    // Auto-hide if enabled
    if (autoHide) {
      setTimeout(() => {
        this.removeNotification(notification.id);
      }, duration);
    }

    return notification.id;
  }

  showError(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'error', {
      autoHide: true,
      duration: 8000,
      ...options,
    });
  }

  showWarning(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'warning', {
      autoHide: true,
      duration: 6000,
      ...options,
    });
  }

  showSuccess(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'success', {
      autoHide: true,
      duration: 4000,
      ...options,
    });
  }

  showInfo(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'info', {
      autoHide: true,
      duration: 5000,
      ...options,
    });
  }

  showLoading(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'loading', { autoHide: false, ...options });
  }

  renderNotification(notification: Notification): void {
    const { message, type, actions } = notification;

    const alertClassMap = {
      error: 'alert alert-error',
      warning: 'alert alert-warning',
      success: 'alert alert-success',
      info: 'alert alert-info',
      loading: 'alert',
    };

    const element = document.createElement('div');
    element.className = `notification-item ${alertClassMap[type as keyof typeof alertClassMap] ?? 'alert'} shadow-lg max-w-sm transform transition-all duration-300 ease-in-out`;
    element.style.opacity = '0';
    element.style.transform = 'translateX(-100%)';

    let actionsHtml = '';
    if (actions.length > 0) {
      actionsHtml = `
        <div class="mt-3 flex gap-2">
          ${actions
            .map(
              (action) => `
            <button
              class="notification-action btn btn-xs ${action.primary ? 'btn-info' : 'btn-outline'}"
              data-action="${action.id}"
            >
              ${action.label}
            </button>
          `
            )
            .join('')}
        </div>
      `;
    }

    const iconHtml =
      type === 'loading'
        ? '<span class="loading loading-spinner loading-sm"></span>'
        : '';

    element.innerHTML = `
      <div class="flex items-start gap-3 w-full">
        ${iconHtml}
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">${this.escapeHtml(message)}</div>
          ${actionsHtml}
        </div>
        <button class="notification-close btn btn-ghost btn-xs btn-circle">
          ×
        </button>
      </div>
    `;

    notification.element = element;
    this.container!.appendChild(element);

    // Animate in
    requestAnimationFrame(() => {
      element.style.opacity = '1';
      element.style.transform = 'translateX(0)';
    });

    // Add event listeners
    const closeBtn = element.querySelector('.notification-close');
    closeBtn?.addEventListener('click', () => {
      this.removeNotification(notification.id);
    });

    // Add action listeners
    const actionBtns = element.querySelectorAll('.notification-action');
    actionBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const actionId = (btn as HTMLElement).dataset.action;
        const action = actions.find((a) => a.id === actionId);
        if (action && action.handler) {
          action.handler();
        }
        this.removeNotification(notification.id);
      });
    });
  }

  removeNotification(id: number): void {
    const notificationIndex = this.notifications.findIndex((n) => n.id === id);
    if (notificationIndex === -1) {
      return;
    }

    const notification = this.notifications[notificationIndex];
    if (!notification.element) {
      return;
    }

    // Animate out
    notification.element.style.opacity = '0';
    notification.element.style.transform = 'translateX(-100%)';

    setTimeout(() => {
      if (notification.element && notification.element.parentNode) {
        notification.element.parentNode.removeChild(notification.element);
      }
      this.notifications.splice(notificationIndex, 1);
    }, 300);
  }

  removeAllNotifications(): void {
    this.notifications.forEach((notification) => {
      this.removeNotification(notification.id);
    });
  }

  updateNotification(
    id: number,
    newMessage: string,
    newType: string | null = null
  ): void {
    const notification = this.notifications.find((n) => n.id === id);
    if (!notification) {
      return;
    }

    notification.message = newMessage;
    if (newType) {
      notification.type = newType;
    }

    // Re-render the notification
    const oldElement = notification.element;
    this.renderNotification(notification);

    if (oldElement && oldElement.parentNode) {
      oldElement.parentNode.replaceChild(notification.element!, oldElement);
    }
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Create a global instance
export const notifications = new NotificationSystem();
