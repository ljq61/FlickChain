import { GameApp } from './GameApp';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Game mount is missing');

try {
  const app = new GameApp(root);
  void app.initialize();
  if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
} catch {
  root.innerHTML = '<main class="boot-error"><h1>桌面暂时无法打开</h1><p>请确认浏览器支持 WebGL，然后刷新页面重试。</p><button type="button">重新加载</button></main>';
  root.querySelector('button')?.addEventListener('click', () => location.reload());
}
