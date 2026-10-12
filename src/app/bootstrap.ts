import { GameApp } from './GameApp';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Game mount is missing');

try {
  const app = new GameApp(root);
  void app.initialize();
  if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
} catch {
  root.innerHTML = '<main class="boot-error"><h1>FlickChain could not start</h1><p>Check that your browser supports WebGL, then reload to try again.</p><button type="button">Reload</button></main>';
  root.querySelector('button')?.addEventListener('click', () => location.reload());
}
