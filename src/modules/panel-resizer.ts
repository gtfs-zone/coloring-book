import { MapController } from './map-controller';

const MIN_WIDTH = 300;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 650;

export class PanelResizer {
  constructor(appContainer: HTMLElement, mapController: MapController) {
    const resizer = document.getElementById('panel-resizer');
    if (!resizer) {
      return;
    }

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth =
        parseInt(
          getComputedStyle(appContainer).getPropertyValue('--panel-width')
        ) || DEFAULT_WIDTH;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (e: MouseEvent) => {
        const newWidth = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidth + startX - e.clientX)
        );
        appContainer.style.setProperty('--panel-width', `${newWidth}px`);
        mapController.resizeNow();
      };

      const onMouseUp = () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        mapController.forceMapResize();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}
