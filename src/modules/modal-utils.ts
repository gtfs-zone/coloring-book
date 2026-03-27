export interface ModalAction {
  label: string;
  className?: string;
  onClick: () => void | Promise<void>;
}

/**
 * Show a non-dismissible DaisyUI modal and wait for the user to click an action.
 * Buttons are disabled while the action's onClick promise is pending.
 */
export async function showModal(options: {
  title: string;
  body: string;
  actions: ModalAction[];
}): Promise<void> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal modal-open';
    modal.innerHTML = `
      <div class="modal-box">
        <h3 class="font-bold text-lg">${options.title}</h3>
        <p class="py-4">${options.body}</p>
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

    modal
      .querySelectorAll<HTMLButtonElement>('button[data-idx]')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.dataset.idx);
          modal
            .querySelectorAll('button')
            .forEach((b) => ((b as HTMLButtonElement).disabled = true));
          await options.actions[idx].onClick();
          document.body.removeChild(modal);
          resolve();
        });
      });
  });
}
