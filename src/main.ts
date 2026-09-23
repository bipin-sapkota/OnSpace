import '@fontsource/rajdhani/400.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import { Game } from './core/Game';

/**
 * OnSpace entry point.
 */
function boot(): void {
  const container = document.getElementById('app')!;
  const canvasTest = document.createElement('canvas');
  if (!canvasTest.getContext('webgl2')) {
    container.innerHTML = '<div style="color:#fff;font-family:sans-serif;padding:40px">OnSpace requires WebGL 2. Please use a recent version of Chrome, Edge, Firefox or Safari.</div>';
    return;
  }
  const game = new Game(container);
  (window as unknown as { game: Game }).game = game;
  game.start();
}

boot();
