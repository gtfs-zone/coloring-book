export interface ModalAction {
  label: string;
  className?: string;
  onClick: () => boolean | void | Promise<boolean | void>;
}

/**
 * Show a non-dismissible DaisyUI modal and wait for the user to click an action.
 * Buttons are disabled while the action's onClick promise is pending.
 * If onClick returns true, the modal stays open (for validation failures).
 */
export async function showModal(options: {
  title: string;
  body: string;
  actions: ModalAction[];
  onMount?: () => void;
}): Promise<void> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal modal-open';
    modal.innerHTML = `
      <div class="modal-box">
        <h3 class="font-bold text-lg">${options.title}</h3>
        <div class="py-4">${options.body}</div>
        <div class="modal-action">
          ${options.actions
            .map(
              (a, i) =>
                `<button class="btn ${a.className ?? ''}" data-idx="${i}">${a.label}</button>`
            )
            .join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    if (options.onMount) {
      options.onMount();
    }

    modal
      .querySelectorAll<HTMLButtonElement>('button[data-idx]')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.dataset.idx);
          modal
            .querySelectorAll('button')
            .forEach((b) => ((b as HTMLButtonElement).disabled = true));
          const keepOpen = await options.actions[idx].onClick();
          if (keepOpen === true) {
            modal
              .querySelectorAll('button')
              .forEach((b) => ((b as HTMLButtonElement).disabled = false));
            return;
          }
          document.body.removeChild(modal);
          resolve();
        });
      });
  });
}
