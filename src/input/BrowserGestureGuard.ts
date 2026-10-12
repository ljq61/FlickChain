/** Suppress page-native gestures without taking ownership of game Pointer Events. */
export class BrowserGestureGuard {
  private readonly events = new AbortController();

  constructor(root: HTMLElement) {
    const options = { capture: true, signal: this.events.signal };
    const targetElement = (event: Event): Element | null => {
      const target = event.target;
      return target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    };
    const editable = (target: Element): boolean => {
      if (target.closest('input, textarea, select')) return true;
      const editor = target.closest('[contenteditable]');
      return !!editor && editor.getAttribute('contenteditable') !== 'false';
    };
    const suppress = (event: Event): void => {
      const target = targetElement(event);
      if (event.cancelable && target && !editable(target)) event.preventDefault();
    };
    for (const type of ['contextmenu', 'selectstart', 'dragstart', 'dblclick']) {
      root.addEventListener(type, suppress, options);
    }
    // touch-action handles normal pan/zoom. Explicit non-passive listeners also
    // suppress long-press defaults in mobile WebViews that expose Touch Events.
    // UI buttons and scrollable dialogs must keep their native touch behavior.
    const suppressCanvasTouch = (event: Event): void => {
      const target = targetElement(event);
      if (event.cancelable && target?.closest('canvas.game-canvas') && !editable(target)) event.preventDefault();
    };
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      root.addEventListener(type, suppressCanvasTouch, { ...options, passive: false });
    }
  }

  dispose(): void { this.events.abort(); }
}
