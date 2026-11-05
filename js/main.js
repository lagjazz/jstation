// ============================================================
// main.js — entry point. Boot happens here because ES modules are
// deferred: the DOM is already parsed when this file runs.
// ============================================================

import { Game } from './game.js';

const game = new Game();
window.GAME = game;
game.boot().catch((err) => console.error('[boot failed]', err));
