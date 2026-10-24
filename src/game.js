'use strict';

const W = 960, H = 540, GROUND = 478;
// Profondeur (façon Streets of Rage) : on marche sur la rue entre ces deux lignes de l'écran
const Z_TOP = 378, Z_BOT = 520;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------- Chargement des images ----------
const IMG = {};
// Version allégée (tools/optimize_assets.py) : assets/web/<chemin>.webp ; l'original si elle manque
const webSrc = src => src.startsWith('assets/') && !src.startsWith('assets/web/') ? 'assets/web/' + src.slice(7).replace(/\.(png|jpe?g)$/i, '.webp') : src;
function loadImage(key, src) {
  return new Promise(resolve => {
    const img = new Image(), web = webSrc(src);
    img.onload = () => { IMG[key] = img; resolve(); };
    img.onerror = () => { if (img.src.endsWith(web) && web !== src) img.src = src; else resolve(); }; // image absente : remplaçant
    img.src = web;
  });
}

// Résolution de rendu : le jeu est pensé en 960 × 540, mais il est dessiné à la taille réelle de l'écran
// (jusqu'à 2 fois plus fin) pour que les textes et les portraits restent nets une fois agrandis.
let RES = 1;
function fitCanvas() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const max = matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  const res = Math.min(max, Math.max(1, Math.round(r.width * dpr / W * 4) / 4));
  if (res !== RES || canvas.width !== Math.round(W * res)) { RES = res; canvas.width = Math.round(W * RES); canvas.height = Math.round(H * RES); }
}
fitCanvas();
addEventListener('resize', fitCanvas);
// Au démarrage : interface, portraits, effets et aperçus des niveaux. Les sprites des combattants et les décors
// d'un niveau ne sont chargés qu'au lancement de la partie (requireGame) : tout charger d'un coup demandait
// ~1,5 Go de mémoire, trop pour un téléphone.
const PENDING = {};
const want = (key, src) => IMG[key] ? Promise.resolve() : PENDING[key] || (PENDING[key] = loadImage(key, src).finally(() => delete PENDING[key]));
function loadAll() {
  const jobs = [];
  for (const [k, src] of Object.entries(ASSETS.ui)) if (!k.startsWith('intro_') && k !== 'title') jobs.push(want(k, src)); // présentations : à la demande
  jobs.push(want('title_art', `assets/ui/title/title_${titlePick}.jpg`).then(() => IMG.title_art || want('title', ASSETS.ui.title)));
  if (typeof FX !== 'undefined') for (const list of Object.values(FX)) for (const f of list) jobs.push(want(f.src, f.src));
  for (const C of Object.values(CHARS)) jobs.push(want(C.card, `assets/ui/${C.card}.png`)); // gros plans d'ultime : à la demande
  for (const src of showcaseFrames()) jobs.push(want(src, src)); // garde de chaque perso (vitrine de la sélection)
  for (const L of LEVELS) for (const key of levelPreviewKeys(L)) jobs.push(want('pv_' + key, `assets/web/preview/${key}.webp`));
  return Promise.all(jobs);
}
// Vitrine de la sélection : la garde (ou la respiration filmée) de chaque perso
const showcaseFrames = () => Object.values(CHARS).flatMap(C => {
  const S = SPRITES[C.sheet] || {}, A = S.idle || S.combo || S.punch;
  return A ? (S.idle ? A.frames : [A.frames[0]]).map(f => f.src) : [];
});
const levelPreviewKeys = L => [L.zones[0].sky || L.sky, L.zones[0].mid, L.zones[0].ground, ...(L.far ? ['far'] : [])].filter(Boolean);
// Planches de sprites d'un personnage (avec ses formes) et d'un niveau (ennemis, boss et renforts)
const charSheets = id => { const C = CHARS[id]; return C ? [C.sheet, ...(C.forms || []).map(F => F.sheet).filter(Boolean), ...(C.extraSheets || [])] : []; };
function levelNeeds(L) {
  const types = new Set(['thug', 'ninja', 'brute', L.extra, L.boss, ...(ETYPES[L.boss]?.adds || [])]);
  for (const w of L.waves || []) for (const t of w.foes) types.add(t);
  // sans planche à lui, un ennemi emprunte celle de sa doublure (alt)
  const known = [...types].filter(t => t && ETYPES[t]), sheets = known.map(t => SPRITES[ETYPES[t].sheet || t] || !ETYPES[t].alt ? ETYPES[t].sheet || t : ETYPES[t].alt);
  const bgs = new Set([L.sky, ...(L.far ? ['far'] : [])]);
  for (const Z of L.zones) for (const k of [Z.sky, Z.mid, Z.mid2, Z.ground, STRIPS[Z.id]?.img]) if (k) bgs.add(k);
  for (const k of [...GATES[L.id] || [], ...levelExtras(L)]) bgs.add(k);
  return { sheets, bgs: [...bgs].filter(k => ASSETS.backgrounds[k]), intros: known.map(t => 'intro_' + t).filter(k => ASSETS.ui[k]) };
}
let gameLoading = null; // { done, total } pendant le chargement d'une partie
function requireGame(chars, L) {
  const sheets = new Set([...chars.flatMap(charSheets), ...levelNeeds(L).sheets]);
  const frames = [...sheets].flatMap(sh => Object.values(SPRITES[sh] || {}).flatMap(a => a.frames.map(f => f.src)));
  const { bgs, intros } = levelNeeds(L), cuts = chars.map(id => 'cutin_' + id);
  // on libère les sprites, décors et images de présentation qui ne servent plus (mémoire du téléphone)
  const keep = new Set([...frames, ...bgs, ...intros, ...cuts, ...showcaseFrames()]);
  for (const k of Object.keys(IMG)) if ((k.startsWith('assets/sprites/') || ASSETS.backgrounds[k] || /^(intro|cutin)_/.test(k)) && !keep.has(k)) delete IMG[k];
  const todo = [...frames.map(src => [src, src]), ...bgs.map(k => [k, ASSETS.backgrounds[k]]), ...intros.map(k => [k, ASSETS.ui[k]]),
    ...cuts.map(k => [k, `assets/ui/cutin/${k.slice(6)}.jpg`])].filter(([k]) => !IMG[k]);
  if (!todo.length) { gameLoading = null; return; }
  const state = gameLoading = { done: 0, total: todo.length };
  Promise.all(todo.map(([k, src]) => want(k, src).then(() => state.done++))).then(() => { if (gameLoading === state) gameLoading = null; });
}

// ---------- Clavier et manette ----------
// Chaque joueur a ses entrées : actions tenues (clavier, manette), actions déclenchées pendant cette image,
// et celles gardées pendant le petit gel d'impact (combos).
const mkInput = () => ({ keys: new Set(), pad: new Set(), pressed: new Set(), carry: new Set(), lastTap: { a: null, t: 0 } });
const INPUT = [mkInput(), mkInput(), mkInput(), mkInput()]; // J3 et J4 : manettes ou en ligne
const isHeld = (p, a) => INPUT[p].keys.has(a) || INPUT[p].pad.has(a);
// Menus, pause, son : n'importe quel joueur
const anyPressed = a => INPUT.some(I => I.pressed.has(a));

// Commandes par défaut ; chaque joueur peut changer les siennes dans le menu pause (gardées dans le navigateur).
// Clavier : codes physiques des touches (KeyQ = touche A sur un clavier AZERTY).
// Manette (disposition standard) : 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Select, 9 Start, 12-15 croix.
const ACTIONS = [
  ['left', 'Gauche'], ['right', 'Droite'], ['up', 'Monter (vers le fond)'], ['down', 'Descendre (vers l\'avant)'],
  ['jump', 'Sauter (2× = double saut)'], ['crouch', 'Se baisser'],
  ['punch', 'Attaque (tenir : coup chargé)'], ['kick', 'Garde / parade / esquive'], ['blast', 'Coup spécial'], ['dash', 'Dash'],
  ['charge', 'Charger le ki (tenir)'], ['transform', 'Transformation'], ['ultra', 'Attaque ultime'],
  ['tag', 'Relais / attaque à deux'], ['pause', 'Pause / commandes'], ['mute', 'Couper le son'],
];
const PAD_DEFAULT = {
  left: [14], right: [15], up: [12], down: [13], jump: [1], crouch: [11], punch: [2], kick: [3], blast: [0],
  dash: [5], charge: [4], transform: [6], ultra: [7], tag: [8], pause: [9], mute: [],
};
const DEFAULT_BINDS = [
  { // Joueur 1 : flèches ou ZQSD, et les touches de droite du clavier
    keys: {
      left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
      jump: ['Space'], crouch: ['KeyC'], punch: ['KeyJ'], kick: ['KeyK'], blast: ['KeyL'],
      dash: ['ShiftLeft', 'ShiftRight'], charge: ['KeyI'], transform: ['KeyO'], ultra: ['KeyU'], tag: ['KeyH'],
      pause: ['Escape', 'KeyP'], mute: ['KeyM', 'Semicolon'],
    },
    pad: PAD_DEFAULT,
  },
  { // Joueur 2 : flèches et pavé numérique (les flèches lui reviennent quand il joue au clavier)
    keys: {
      left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
      jump: ['Numpad0'], crouch: ['NumpadDecimal'], punch: ['Numpad1'], kick: ['Numpad2'], blast: ['Numpad3'],
      dash: ['Numpad4'], charge: ['Numpad5'], transform: ['Numpad6'], ultra: ['Numpad7'], tag: ['Numpad8'],
      pause: ['NumpadEnter'], mute: ['NumpadSubtract'],
    },
    pad: PAD_DEFAULT,
  },
  // Joueurs 3 et 4 : manette seulement (ou en ligne)
  ...[2, 3].map(() => ({ keys: Object.fromEntries(['left', 'right', 'up', 'down', 'jump', 'crouch', 'punch', 'kick', 'blast', 'dash', 'charge', 'transform', 'ultra', 'tag', 'pause', 'mute'].map(a => [a, []])), pad: PAD_DEFAULT })),
];
const copy = o => JSON.parse(JSON.stringify(o));
let binds = copy(DEFAULT_BINDS), KEYMAP = {};
try {
  const saved = JSON.parse(localStorage.getItem('kfm_binds_v4'));
  if (Array.isArray(saved)) saved.forEach((s, p) => {
    for (const k of ['keys', 'pad']) for (const [a] of ACTIONS) if (Array.isArray(s?.[k]?.[a])) binds[p][k][a] = s[k][a];
  });
} catch (e) { /* stockage indisponible : commandes par défaut */ }
function saveBinds() { try { localStorage.setItem('kfm_binds_v4', JSON.stringify(binds)); } catch (e) { } }

// Qui utilise quel appareil : les manettes sont attribuées en rejoignant la partie (écran de sélection).
// Les manettes sans joueur reviennent au joueur 1. p2Keyboard : le joueur 2 joue au clavier.
const padOwner = {};
let p2Keyboard = false, lastDevice = 'kb';

// Touche -> [joueur, action]. Une touche commune aux deux (les flèches) va au joueur 2 s'il joue au clavier.
function rebuildKeymap() {
  KEYMAP = { Enter: [0, 'start'] };
  for (const p of p2Keyboard ? [0, 1] : [1, 0])
    for (const [a, codes] of Object.entries(binds[p].keys)) for (const c of codes) KEYMAP[c] = [p, a];
  INPUT.forEach(I => I.keys.clear());
}
rebuildKeymap();

// Noms affichés : la vraie lettre du clavier du joueur quand le navigateur la donne
let layout = null;
navigator.keyboard?.getLayoutMap?.().then(m => { layout = m; }).catch(() => {});
const KEY_NAMES = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Espace', Enter: 'Entrée', Escape: 'Échap',
  ShiftLeft: 'Maj', ShiftRight: 'Maj D', ControlLeft: 'Ctrl', ControlRight: 'Ctrl D', AltLeft: 'Alt', AltRight: 'Alt Gr',
  Tab: 'Tab', Backspace: 'Retour', CapsLock: 'Verr. maj', NumpadEnter: 'Entrée pavé', NumpadDecimal: '. pavé',
  NumpadAdd: '+ pavé', NumpadSubtract: '- pavé', NumpadMultiply: '* pavé', NumpadDivide: '/ pavé',
};
const keyLabel = c => KEY_NAMES[c] || (/^Numpad\d$/.test(c) ? c.slice(6) + ' pavé'
  : (layout && layout.get(c) || c.replace(/^(Key|Digit)/, '')).toUpperCase());
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', 'Croix ↑', 'Croix ↓', 'Croix ←', 'Croix →', 'Home'];
const padLabel = i => PAD_NAMES[i] || `Bouton ${i}`;
// Touches d'une action d'un joueur, pour les aides à l'écran (deux au plus)
const K = (a, p = 0) => binds[p].keys[a].slice(0, 2).map(keyLabel).join(' / ') || '—';

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return; // saisie du code de partie (téléphone) : on laisse taper
  audio.unlock();
  if ((scene === 'play' || scene === 'options') && paused) { e.preventDefault(); menuKey(e); return; }
  const m = KEYMAP[e.code];
  if (!m) return;
  e.preventDefault();
  const [p, a] = m, I = INPUT[p];
  lastDevice = 'kb';
  if (scene === 'select' && p === 1) joinPlayer('kb');
  if (!I.keys.has(a)) {
    I.pressed.add(a);
    // Double appui sur une direction = dash
    if ((a === 'left' || a === 'right') && !e.repeat) {
      if (I.lastTap.a === a && performance.now() - I.lastTap.t < 250) I.pressed.add('dash');
      I.lastTap = { a, t: performance.now() };
    }
  }
  I.keys.add(a);
});
addEventListener('keyup', e => { if (e.target instanceof HTMLInputElement) return; const m = KEYMAP[e.code]; if (m) INPUT[m[0]].keys.delete(m[1]); });

let padNames = [];
// Stick qui dérive ou bloqué à fond (manette déréglée, manette virtuelle) : un axe n'est pris en compte qu'après
// avoir été vu au repos (près du centre) une vingtaine de lectures de suite ; sinon le perso marcherait tout seul.
const padRest = {};
function padAxes(gp) {
  const r = padRest[gp.index] || (padRest[gp.index] = { calm: gp.axes.map(() => 0), live: gp.axes.map(() => false) });
  return gp.axes.map((v, i) => {
    if (!r.live[i]) { r.calm[i] = Math.abs(v) < 0.25 ? r.calm[i] + 1 : 0; if (r.calm[i] >= 20) r.live[i] = true; }
    return r.live[i] ? v : 0;
  });
}
const padPrev = {};
function pollPad() {
  const gps = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  padNames = gps.map(g => g.id);
  const now = INPUT.map(() => new Set());
  for (const gp of gps) {
    const btn = gp.buttons.map(b => b.pressed || b.value > 0.5);
    const prev = padPrev[gp.index] || [], fresh = i => btn[i] && !prev[i];
    padPrev[gp.index] = btn;
    if (btn.some((b, i) => b && !prev[i])) lastDevice = gp.index;
    if ((scene === 'play' || scene === 'options') && paused) { if (gps.length) menuPad(fresh, btn.length); continue; }
    // Une manette libre qui appuie sur l'écran de sélection fait entrer le joueur 2
    if (scene === 'select' && padOwner[gp.index] === undefined && [0, 2, 9].some(fresh)) joinPlayer(gp.index);
    const p = padOwner[gp.index] ?? 0, set = now[p];
    for (const [a, list] of Object.entries(binds[p].pad)) if (list.some(i => btn[i])) set.add(a);
    if (btn[9]) set.add('start');
    const [ax, ay] = padAxes(gp);
    if (ax < -0.4) set.add('left');
    if (ax > 0.4) set.add('right');
    if (ay > 0.5) set.add('down');
    if (ay < -0.5) set.add('up');
  }
  INPUT.forEach((I, p) => {
    for (const a of now[p]) if (!I.pad.has(a)) { I.pressed.add(a); audio.unlock(); }
    I.pad.clear(); now[p].forEach(a => I.pad.add(a));
  });
}

// ---------- Menu pause : voir et modifier les commandes de chaque joueur ----------
// Lignes : le joueur, une ligne par action, puis « Commandes par défaut » et « Reprendre ». Colonnes : clavier, manette.
const menu = { p: 0, row: 0, col: 0, capture: null, msg: '' };
const MENU_ROWS = ACTIONS.length + 5, ROW_MUSIC = ACTIONS.length + 1, ROW_DEFAULT = ACTIONS.length + 2, ROW_RESUME = ACTIONS.length + 3;

function openMenu() { menu.row = ROW_RESUME; menu.col = 0; menu.capture = null; menu.msg = ''; }
function closeMenu() { paused = false; menu.capture = null; INPUT.forEach(I => { I.keys.clear(); I.pressed.clear(); }); }

function menuMove(dr, dc) {
  menu.row = (menu.row + dr + MENU_ROWS) % MENU_ROWS;
  if (menu.row === 0 && dc) menu.p = clamp(menu.p + dc, 0, 3);
  else menu.col = clamp(menu.col + dc, 0, 1);
  menu.msg = '';
  audio.tone(660, 0.05, 'triangle', 0.05);
}

function menuActivate() {
  if (menu.row === 0) { menu.p = (menu.p + 1) % 4; return; }
  if (menu.row <= ACTIONS.length) { menu.capture = menu.col ? 'pad' : 'key'; menu.msg = ''; return; }
  if (menu.row === ROW_MUSIC) { OPTS.musicOff = !OPTS.musicOff; saveOpts(); return; } // musique seule (les bruitages restent)
  if (menu.row === ROW_DEFAULT) {
    binds[menu.p] = copy(DEFAULT_BINDS[menu.p]); saveBinds(); rebuildKeymap();
    menu.msg = `Commandes par défaut rétablies (joueur ${menu.p + 1})`;
    return;
  }
  closeMenu();
  // Dernière ligne : quitter la partie et revenir à l'écran titre
  if (menu.row > ROW_RESUME && scene !== 'options') { scene = 'title'; sceneT = 0; audio.stopAll(); }
}

// Nouvelle touche pour l'action choisie. Si elle servait déjà ailleurs, les deux actions échangent leurs touches.
function assign(kind, value) {
  const B = binds[menu.p], action = ACTIONS[menu.row - 1][0], old = B[kind][action];
  for (const [a] of ACTIONS) {
    if (a === action || !B[kind][a].includes(value)) continue;
    B[kind][a] = B[kind][a].filter(v => v !== value);
    if (!B[kind][a].length) B[kind][a] = old.filter(v => v !== value).slice(0, 1);
    menu.msg = `Échangée avec « ${ACTIONS.find(x => x[0] === a)[1]} »`;
  }
  B[kind][action] = [value];
  saveBinds(); rebuildKeymap();
  menu.capture = null;
  audio.tone(880, 0.08, 'triangle', 0.08);
}

function menuKey(e) {
  if (menu.capture === 'key') {
    if (e.code === 'Escape') menu.capture = null;
    else if (e.code !== 'Enter') assign('keys', e.code);
    return;
  }
  if (menu.capture) { if (e.code === 'Escape') menu.capture = null; return; }
  if (e.code === 'ArrowUp') menuMove(-1, 0);
  else if (e.code === 'ArrowDown') menuMove(1, 0);
  else if (e.code === 'ArrowLeft') menuMove(0, -1);
  else if (e.code === 'ArrowRight') menuMove(0, 1);
  else if (e.repeat) return;
  else if (e.code === 'Enter' || e.code === 'Space') menuActivate();
  else if (e.code === 'Escape' || KEYMAP[e.code]?.[1] === 'pause') closeMenu();
}

function menuPad(fresh, n) {
  if (menu.capture === 'pad') {
    if (fresh(9)) { menu.capture = null; return; } // Start : annuler
    for (let i = 0; i < n; i++) if (fresh(i)) { assign('pad', i); return; }
    return;
  }
  if (menu.capture) return;
  if (fresh(12)) menuMove(-1, 0);
  if (fresh(13)) menuMove(1, 0);
  if (fresh(14)) menuMove(0, -1);
  if (fresh(15)) menuMove(0, 1);
  if (fresh(0)) menuActivate();
  if (fresh(1) || fresh(9)) closeMenu();
}

function drawPauseMenu() {
  ctx.fillStyle = 'rgba(5,0,20,0.85)'; ctx.fillRect(0, 0, W, H);
  outlined('PAUSE', W / 2, 42, 36);
  const x0 = 170, xk = 520, xp = 720, top = 58, rh = 19, B = binds[menu.p];
  const blink = Math.floor(performance.now() / 300) % 2;
  for (let r = 0; r < MENU_ROWS; r++) {
    const y = top + r * rh + (r > 0 ? 22 : 0) + (r > ACTIONS.length ? 10 : 0), sel = r === menu.row;
    if (sel) { ctx.fillStyle = 'rgba(127,240,255,0.14)'; ctx.fillRect(x0 - 14, y, 640, rh - 2); }
    ctx.font = (sel ? 'bold ' : '') + '14px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = sel ? '#fff' : '#cfd3ff';
    if (r === 0) {
      // Onglets joueur 1 / joueur 2
      ['JOUEUR 1', 'JOUEUR 2', 'JOUEUR 3', 'JOUEUR 4'].forEach((txt, p) => {
        const x = x0 + p * 130, on = menu.p === p;
        ctx.fillStyle = on ? COLORS_P[p] : 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, 118, rh - 2);
        ctx.fillStyle = on ? '#120420' : '#9aa0d0'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(txt, x + 26, y + 14);
      });
      ctx.fillStyle = '#7ff0ff'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText('CLAVIER', xk - 10, y + 36);
      const pn = Object.keys(padOwner).length;
      ctx.fillText(padNames.length ? `MANETTE${pn ? ' du joueur' : ''}` : 'MANETTE (non branchée)', xp - 10, y + 36);
      continue;
    }
    if (r <= ACTIONS.length) {
      const [a, label] = ACTIONS[r - 1];
      ctx.fillText(label, x0, y + 14);
      const cells = [B.keys[a].map(keyLabel).join('  /  '), B.pad[a].map(padLabel).join('  /  ')];
      cells.forEach((txt, c) => {
        const x = c ? xp : xk, active = sel && menu.col === c;
        if (active) { ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.strokeRect(x - 10, y + 1, 190, rh - 4); }
        const waiting = active && menu.capture;
        ctx.fillStyle = waiting ? '#ffe14d' : active ? '#fff' : '#9aa0d0';
        ctx.fillText(waiting ? (blink ? (c ? 'Appuie sur un bouton…' : 'Appuie sur une touche…') : '') : txt, x, y + 14);
      });
    } else {
      ctx.fillStyle = sel ? '#ffe14d' : '#cfd3ff';
      ctx.fillText(r === ROW_MUSIC ? `♪  Musique : ${OPTS.musicOff ? 'NON' : 'OUI'}   (les bruitages restent)` : r === ROW_DEFAULT ? `↺  Commandes par défaut (joueur ${menu.p + 1})` : r === ROW_RESUME ? (scene === 'options' ? '▶  Retour aux options' : '▶  Reprendre la partie') : (scene === 'options' ? '' : '✕  Quitter la partie (écran titre)'), x0, y + 14);
    }
  }
  ctx.textAlign = 'center'; ctx.font = '13px sans-serif';
  if (menu.msg) { ctx.fillStyle = '#ffe14d'; ctx.fillText(menu.msg, W / 2, H - 40); }
  ctx.fillStyle = '#cfd3ff';
  ctx.fillText(menu.capture
    ? 'Appuie sur la nouvelle touche ou le nouveau bouton — Échap (ou Start) pour annuler'
    : '↑ ↓ choisir   ← → joueur / clavier / manette   Entrée (A) modifier   Échap (B) reprendre', W / 2, H - 18);
}

// ---------- Sons ----------
// Bruitages Kenney (CC0) intégrés dans src/sounds.js, plus quelques sons synthétisés.
// Tout passe par un compresseur pour que les gros impacts restent puissants sans saturer.
const audio = {
  ctx: null, out: null, buf: {}, loops: {},
  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.out = this.ctx.createGain(); this.out.gain.value = 0.9;
      this.out.connect(comp).connect(this.ctx.destination);
      this.load();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  async load() {
    // cris et bruitages des personnages (src/voices.js) : fichiers à part, chargés en arrière-plan
    if (typeof VOICES !== 'undefined') for (const [k, src] of Object.entries(VOICES))
      fetch(src).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b)).then(buf => { this.buf[k] = [buf]; }).catch(() => {});
    if (typeof SOUNDS === 'undefined') return;
    for (const [k, list] of Object.entries(SOUNDS))
      this.buf[k] = await Promise.all(list.map(uri => {
        const bin = atob(uri.split(',')[1]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return this.ctx.decodeAudioData(bytes.buffer);
      }));
  },
  // Cri ou bruitage d'un perso (CV dans src/voices.js) ; un seul cri à la fois par perso
  voice(h, what, vol = 1) {
    const key = typeof CV !== 'undefined' && CV[h.char]?.[what];
    if (!key) return;
    if (h._voice) try { h._voice.s.stop(); } catch (e) { }
    h._voice = this.play(key, vol, 1, 0);
  },
  // Joue une variante au hasard, légèrement désaccordée pour éviter la répétition
  play(key, vol = 1, rate = 1, spread = 0.06) {
    const list = this.buf[key];
    if (!this.ctx || !list) return null;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = list[Math.floor(Math.random() * list.length)];
    s.playbackRate.value = rate * (1 + rand(-spread, spread));
    g.gain.value = vol; s.connect(g).connect(this.out); s.start();
    return { s, g };
  },
  // Son en boucle allumé / éteint selon une condition (aura, charge)
  loop(name, on, key, vol = 1, rate = 1) {
    const cur = this.loops[name];
    if (on && !cur && this.ctx && this.buf[key]) {
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
      s.buffer = this.buf[key][0]; s.loop = true; s.loopStart = 0.4; s.loopEnd = s.buffer.duration - 0.4;
      s.playbackRate.value = rate;
      g.gain.setValueAtTime(0, this.ctx.currentTime); g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.25);
      s.connect(g).connect(this.out); s.start(0, 0.4);
      this.loops[name] = { s, g };
    } else if (!on && cur) {
      const t = this.ctx.currentTime;
      cur.g.gain.cancelScheduledValues(t); cur.g.gain.setValueAtTime(cur.g.gain.value, t); cur.g.gain.linearRampToValueAtTime(0, t + 0.3);
      cur.s.stop(t + 0.35); delete this.loops[name];
    }
  },
  // Musique : un élément <audio> (marche aussi en ouvrant index.html sans serveur)
  muted: false, music: null,
  musicTick(on, quiet) {
    // Musique du niveau en cours (assets/music/<niveau>.mp3, sinon la musique de combat commune)
    const want = typeof MUSIC === 'undefined' ? null : (MUSIC.levels?.[LVL.id] || MUSIC.battle);
    if (want && this.ctx && this.musicSrc !== want) {
      if (this.music) this.music.pause();
      this.music = new Audio(want); this.music.loop = true; this.music.volume = 0; this.musicSrc = want;
      try { this.ctx.createMediaElementSource(this.music).connect(this.out); } catch (e) { }
      const id = LVL.id;
      this.music.onerror = () => { if (want !== MUSIC.battle) MUSIC.levels[id] = MUSIC.battle; };
    }
    const m = this.music;
    if (!m) return;
    const target = this.muted || !on || OPTS.musicOff ? 0 : MUSIC.volume * (quiet ? 0.35 : 1);
    m.volume = clamp(m.volume + Math.sign(target - m.volume) * 0.02, 0, 1); // fondu
    if (Math.abs(m.volume - target) < 0.02) m.volume = target;
    if (on && m.paused && !this.muted && !OPTS.musicOff) m.play().catch(() => {});
    if (!on && m.volume === 0 && !m.paused) { m.pause(); m.currentTime = 0; }
  },
  toggleMute() {
    this.muted = !this.muted;
    if (this.out) this.out.gain.value = this.muted ? 0 : 0.9;
  },
  stopAll() { for (const n of Object.keys(this.loops)) this.loop(n, false); },
  tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur);
  },
  // Bruit filtré dont la fréquence glisse : souffle d'un coup, sifflement d'un déplacement rapide
  sweep(dur, f0, f1, vol = 0.3, q = 1.2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = b; f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t);
  },
  noise(dur, vol = 0.25) { this.sweep(dur, 2000, 300, vol, 0.5); },
  whoosh(weight = 1) { this.play(weight > 1.2 ? 'swingHeavy' : 'swing', 0.75); },
  // Impact façon anime : coup sourd + claquement aigu très court
  hit(heavy) {
    this.play(heavy ? 'hitHeavy' : 'hit', heavy ? 1 : 0.9);
    this.sweep(0.04, 6000, 3000, 0.12, 0.7); // léger claquement « anime »
  },
  zip() { this.play('zip', 0.8); },
  // Lame qui fend l'air : souffle aigu très bref
  slash(rate = 1) { this.play('swing', 0.6, 1.4 * rate); this.sweep(0.14, 7000, 1800, 0.22, 1.4); },
  // Bras ou jambe en caoutchouc qui s'étire : « boing » qui monte, plus un souffle
  stretch() { this.tone(180, 0.22, 'sine', 0.14, 620); this.sweep(0.18, 900, 2600, 0.12, 2); },
  blast() { this.play('waveFire', 0.9); },
  hurt() { this.play('hitHeavy', 0.9, 0.85); this.tone(220, 0.18, 'triangle', 0.08, -90); },
  ko() { this.play('ko', 1); this.play('body', 0.8, 0.9); },
};

// ---------- Outils ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Personnages jouables ----------
// Pour chaque coup : durée, fenêtre active, portée, dégâts, recul.
// cancel : à partir de quand un coup demandé pendant celui-ci s'enchaîne (combos).
// multi : le coup touche à nouveau toutes les n secondes (rafale). call : nom crié à l'écran.
// rubber : coup élastique (son de caoutchouc). cost : ki dépensé. push : élan vers l'avant (dash).
// p : [planche, étapes, seuils de temps] pour les personnages à poses décrites par leurs coups.
// trail : traînée de lame (voir slashFX). proj : projectile lancé à proj.at. beam : rayon d'énergie.
// teleport : se téléporte derrière l'ennemi le plus proche. orb : sphère d'énergie dans la main.
// Coup final du combo de poings (24/10, à la place de l'uppercut) : il arme, fonce penché en avant en laissant des images
// rémanentes et frappe d'un direct explosif ; l'ennemi part à l'horizontale et rebondit sur le bord de l'écran (smash)
const FINISHER = { dur: 0.6, on: 0.16, off: 0.34, reach: [10, 160], y: [-175, -80], dmg: 3.2, kb: 720, ki: 10, launch: -300, push: 1150, pushAt: 0.1, pushDur: 0.2,
  lean: 14, shock: true, smash: true, p: ['combo', [0, 2], [0.1]] };
const MOVES = {
  punch:      { dur: 0.30, on: 0.06, off: 0.17, cancel: 0.17, reach: [20, 105], y: [-150, -95], dmg: 1, kb: 160, ki: 6 },
  cross:      { dur: 0.32, on: 0.05, off: 0.16, cancel: 0.17, reach: [20, 115], y: [-150, -95], dmg: 1, kb: 190, ki: 6 },
  finisher:   { ...FINISHER, p: undefined }, // poses : heroPose
  uppercut:   { dur: 0.50, on: 0.10, off: 0.26, reach: [10, 100], y: [-190, -90], dmg: 3, kb: 220, ki: 10, launch: -760 },
  kick:       { dur: 0.45, on: 0.09, off: 0.26, cancel: 0.27, reach: [20, 130], y: [-130, -60], dmg: 2, kb: 260, ki: 8 },
  spinkick:   { dur: 0.48, on: 0.13, off: 0.30, cancel: 0.31, reach: [20, 135], y: [-140, -70], dmg: 2, kb: 300, ki: 8 },
  roundhouse: { dur: 0.55, on: 0.12, off: 0.34, reach: [10, 140], y: [-170, -90], dmg: 3, kb: 400, ki: 10, launch: -520 },
  ckick:      { dur: 0.42, on: 0.10, off: 0.26, reach: [20, 145], y: [-40, 0], dmg: 2, kb: 200, ki: 8, launch: -380 },
  dash:       { dur: 0.55, on: 0.12, off: 0.40, reach: [0, 115], y: [-150, -60], dmg: 3, kb: 420, ki: 8, launch: -480, push: 820 },
  airkick:    { dur: 0.60, on: 0.07, off: 0.55, reach: [10, 115], y: [-120, -20], dmg: 2, kb: 300, ki: 8, launch: -520 },
  blast:      { dur: 0.65, fire: 0.3, cost: 35 },
};
// Luffy : bras et jambes en caoutchouc, des coups qui portent très loin
const L_MOVES = {
  // lanceur du jonglage : les deux paumes projetées vers le haut (poses du bazooka)
  rocket:  { dur: 0.6, on: 0.22, off: 0.36, reach: [10, 170], y: [-200, -40], dmg: 3, kb: 220, ki: 10, launch: -760, rubber: true, call: 'GOMU GOMU NO… ROCKET !' },
  punch:   { dur: 0.42, on: 0.13, off: 0.27, cancel: 0.27, reach: [20, 210], y: [-150, -95], dmg: 1.5, kb: 200, ki: 6, rubber: true, call: 'PISTOL !' },
  punch2:  { dur: 0.40, on: 0.12, off: 0.25, cancel: 0.25, reach: [20, 210], y: [-150, -95], dmg: 1.5, kb: 220, ki: 6, rubber: true },
  gatling: { dur: 0.95, on: 0.15, off: 0.78, multi: 0.09, reach: [20, 165], y: [-170, -70], dmg: 0.6, kb: 40, ki: 3, rubber: true, call: 'GATLING !' },
  kick:    { dur: 0.38, on: 0.08, off: 0.22, cancel: 0.22, reach: [20, 135], y: [-150, -70], dmg: 1.5, kb: 240, ki: 6 },
  whip:    { dur: 0.50, on: 0.12, off: 0.30, cancel: 0.30, reach: [20, 215], y: [-120, -50], dmg: 2, kb: 320, ki: 8, rubber: true, call: 'WHIP !' },
  axe:     { dur: 0.75, on: 0.38, off: 0.52, reach: [60, 250], y: [-130, 0], dmg: 3, kb: 260, ki: 10, launch: -420, rubber: true, call: 'ONO !' },
  ckick:   { dur: 0.45, on: 0.12, off: 0.28, reach: [20, 220], y: [-40, 0], dmg: 2, kb: 220, ki: 8, launch: -380, rubber: true },
  dash:    { dur: 0.60, on: 0.12, off: 0.45, reach: [0, 140], y: [-150, -40], dmg: 3, kb: 460, ki: 8, launch: -500, push: 950, rubber: true, call: 'ROCKET !' },
  airkick: { dur: 0.55, on: 0.08, off: 0.48, reach: [10, 180], y: [-100, 40], dmg: 2, kb: 300, ki: 8, launch: -480, rubber: true, call: 'STAMP !' },
  bazooka: { dur: 0.75, on: 0.30, off: 0.50, reach: [20, 175], y: [-170, -60], dmg: 4, kb: 650, ki: 0, launch: -650, rubber: true, call: 'BAZOOKA !', cost: 35 },
};
// Sangoku : arts martiaux, Kamehameha, transmission instantanée
const K_MOVES = {
  punch:    { dur: 0.28, on: 0.05, off: 0.15, cancel: 0.15, reach: [20, 110], y: [-150, -95], dmg: 1, kb: 160, ki: 6, p: ['combo', [0, 1], [0.04]] },
  cross:    { dur: 0.32, on: 0.06, off: 0.17, cancel: 0.17, reach: [20, 125], y: [-150, -95], dmg: 1.2, kb: 200, ki: 6, p: ['combo', [2]] },
  uppercut: { dur: 0.48, on: 0.08, off: 0.24, reach: [10, 105], y: [-190, -90], dmg: 3, kb: 220, ki: 10, launch: -760, p: ['combo', [3]] },
  finisher: FINISHER,
  kick:     { dur: 0.40, on: 0.08, off: 0.24, cancel: 0.24, reach: [20, 135], y: [-130, -60], dmg: 1.5, kb: 240, ki: 6, p: ['combo', [4]] },
  roundhouse: { dur: 0.45, on: 0.10, off: 0.28, cancel: 0.28, reach: [20, 145], y: [-160, -80], dmg: 2, kb: 300, ki: 8, p: ['combo', [5]] },
  spinback: { dur: 0.55, on: 0.12, off: 0.32, reach: [10, 145], y: [-160, -80], dmg: 3, kb: 420, ki: 10, launch: -520, p: ['combo', [6]] },
  ckick:    { dur: 0.42, on: 0.10, off: 0.26, reach: [20, 150], y: [-40, 0], dmg: 2, kb: 200, ki: 8, launch: -380, p: ['lowair', [1, 2, 3], [0.08, 0.3]] },
  airkick:  { dur: 0.55, on: 0.07, off: 0.48, reach: [10, 130], y: [-110, 20], dmg: 2, kb: 300, ki: 8, launch: -520, p: ['lowair', [5, 6, 7], [0.05, 0.42]] },
  dash:     { dur: 0.58, on: 0.24, off: 0.40, reach: [0, 125], y: [-150, -60], dmg: 3, kb: 420, ki: 8, launch: -480, teleport: 0.2, call: 'TRANSMISSION !', p: ['dashcharge', [0, 1, 2, 3], [0.1, 0.22, 0.46]] },
  kamehameha: { dur: 1.35, cost: 35, beam: { at: 0.55, end: 1.2, len: 900, dmg: 0.55, color: '#7fd8ff' }, call: 'KAMEHAMEHA !', p: ['special', [0, 1, 2, 3], [0.25, 0.55, 1.22]] },
};
// Sangoku : enchaînements en 4 coups. Poings : la rafale de ki à bout portant avant l'uppercut ;
// pieds : le retourné ne fait plus décoller, la transmission instantanée finit dans le dos de l'ennemi.
const GK_MOVES = { ...K_MOVES,
  uppercut: { ...K_MOVES.uppercut, dmg: 3.5, call: 'HAAA !' },
  spinback: { ...K_MOVES.spinback, launch: 0, kb: 260, cancel: 0.32 },
  kiburst:  { dur: 0.40, on: 0.10, off: 0.22, cancel: 0.24, reach: [20, 115], y: [-160, -80], dmg: 1.2, kb: 140, ki: 6, call: 'HA !',
              proj: { at: 0.1, kind: 'kiball', speed: 950, dmg: 1.6, kb: 320, life: 0.28 }, p: ['special', [2, 3], [0.12]] },
  telekick: { dur: 0.62, on: 0.26, off: 0.42, reach: [0, 135], y: [-170, -60], dmg: 3.5, kb: 460, ki: 10, launch: -620, teleport: 0.16,
              call: 'PAR ICI !', p: ['dashcharge', [1, 2, 3], [0.16, 0.4]] },
};
// Naruto : taijutsu, Rasengan, mode Kyubi, Rasenshuriken
const N_MOVES = {
  finisher: FINISHER,
  punch:    { dur: 0.28, on: 0.05, off: 0.15, cancel: 0.15, reach: [20, 105], y: [-140, -85], dmg: 1, kb: 160, ki: 6, p: ['combo', [0, 1], [0.04]] },
  cross:    { dur: 0.30, on: 0.06, off: 0.16, cancel: 0.16, reach: [20, 115], y: [-140, -85], dmg: 1.2, kb: 190, ki: 6, p: ['combo', [2]] },
  uppercut: { dur: 0.46, on: 0.08, off: 0.24, reach: [10, 100], y: [-180, -80], dmg: 3, kb: 220, ki: 10, launch: -760, p: ['combo', [3]] },
  kick:     { dur: 0.38, on: 0.08, off: 0.22, cancel: 0.22, reach: [20, 130], y: [-130, -60], dmg: 1.5, kb: 240, ki: 6, p: ['combo', [4]] },
  sidekick: { dur: 0.42, on: 0.09, off: 0.25, cancel: 0.26, reach: [20, 140], y: [-150, -70], dmg: 2, kb: 300, ki: 8, p: ['combo', [5]] },
  axekick:  { dur: 0.58, on: 0.22, off: 0.38, reach: [10, 135], y: [-170, 0], dmg: 3, kb: 300, ki: 10, launch: -480, p: ['combo', [6, 7], [0.2]], call: 'UZUMAKI !' },
  ckick:    { dur: 0.42, on: 0.10, off: 0.26, reach: [20, 145], y: [-40, 0], dmg: 2, kb: 200, ki: 8, launch: -380, p: ['lowair', [1, 2, 3], [0.08, 0.3]] },
  airkick:  { dur: 0.55, on: 0.07, off: 0.48, reach: [10, 125], y: [-110, 20], dmg: 2, kb: 300, ki: 8, launch: -520, p: ['lowair', [5, 6, 7], [0.05, 0.42]] },
  dash:     { dur: 0.55, on: 0.14, off: 0.42, reach: [0, 120], y: [-150, -60], dmg: 3, kb: 420, ki: 8, launch: -480, push: 900, p: ['dashcharge', [0, 1, 2], [0.12, 0.3]] },
  // Multi-clonage : signe des mains, quatre clones surgissent de la fumée et foncent frapper (updateClones)
  bunshin:  { dur: 0.85, cost: 35, clones: { at: 0.25, n: 4 }, call: 'MULTI-CLONAGE !', p: ['dashcharge', [4, 5], [0.14]] },
  rasengan: { dur: 0.95, cost: 35, on: 0.34, off: 0.72, reach: [0, 140], y: [-170, -60], dmg: 5, kb: 650, ki: 0, launch: -650, push: 1300, pushAt: 0.28, pushDur: 0.32,
              orb: [0, 0.75], spiral: true, stopOnHit: true, call: 'RASENGAN !', p: ['special', [0, 1, 2, 3], [0.3, 0.55, 0.82]] },
};
// Rasengan en fin de série de poings (sans ki) : il reste le coup signature de Naruto à côté du multi-clonage
N_MOVES.rasenfin = { ...N_MOVES.rasengan, cost: 0, dmg: 3.5, kb: 520 };
// Zoro : style à trois sabres
const Z_MOVES = {
  punch:    { dur: 0.32, on: 0.06, off: 0.18, cancel: 0.18, reach: [20, 150], y: [-160, -60], dmg: 1.3, kb: 180, ki: 6, p: ['combo', [0, 1], [0.04]], trail: { a0: -0.9, a1: 0.7, r: 120 } },
  cross:    { dur: 0.34, on: 0.06, off: 0.18, cancel: 0.18, reach: [20, 150], y: [-160, -60], dmg: 1.5, kb: 200, ki: 6, p: ['combo', [2]], trail: { x: true, r: 110 } },
  rising:   { dur: 0.50, on: 0.08, off: 0.26, reach: [10, 150], y: [-200, -60], dmg: 3, kb: 240, ki: 10, launch: -760, p: ['combo', [3]], trail: { a0: 1.2, a1: -1.4, r: 130 } },
  kick:     { dur: 0.36, on: 0.08, off: 0.22, cancel: 0.22, reach: [20, 125], y: [-130, -60], dmg: 1.5, kb: 240, ki: 6, p: ['combo', [4]] },
  spin:     { dur: 0.48, on: 0.10, off: 0.30, cancel: 0.30, reach: [-80, 160], y: [-160, -40], dmg: 2, kb: 300, ki: 8, p: ['combo', [5]], trail: { a0: -3.1, a1: 3.1, r: 125 }, call: 'TATSUMAKI !' },
  leap:     { dur: 0.62, on: 0.22, off: 0.40, reach: [10, 170], y: [-190, 0], dmg: 3.5, kb: 320, ki: 10, launch: -560, p: ['combo', [6, 7], [0.2]], trail: { a0: -1.6, a1: 1.2, r: 150, at: 0.2 }, call: 'ONI GIRI !' },
  ckick:    { dur: 0.42, on: 0.10, off: 0.26, reach: [20, 170], y: [-50, 0], dmg: 2, kb: 200, ki: 8, launch: -380, p: ['lowair', [1, 2, 3], [0.08, 0.3]], trail: { a0: 0.2, a1: 1.3, r: 110, y: -40 } },
  airkick:  { dur: 0.55, on: 0.07, off: 0.48, reach: [10, 160], y: [-110, 40], dmg: 2.5, kb: 300, ki: 8, launch: -520, p: ['lowair', [5, 6, 7], [0.05, 0.42]], trail: { a0: -1.5, a1: 1.4, r: 120, at: 0.1 } },
  dash:     { dur: 0.62, on: 0.15, off: 0.45, reach: [-90, 90], y: [-160, -40], dmg: 3, kb: 300, ki: 8, launch: -450, push: 1150, pushAt: 0.12, pushDur: 0.32, xcut: true, call: 'ONI GIRI !', p: ['dashcharge', [0, 1, 2, 3], [0.12, 0.42, 0.55]] },
  poundho:  { dur: 0.70, cost: 35, proj: { at: 0.3, kind: 'airblade', speed: 950, dmg: 3, kb: 380, launch: -420, life: 1.1 }, call: '36 POUND HO !', p: ['special', [0, 1, 2, 3], [0.2, 0.32, 0.55]], trail: { a0: -1.4, a1: 1.0, r: 140, at: 0.28 } },
};
// Tanjiro : souffle de l'eau (et du feu en Hinokami Kagura)
const T_MOVES = {
  punch:    { dur: 0.32, on: 0.06, off: 0.18, cancel: 0.18, reach: [20, 150], y: [-160, -60], dmg: 1.3, kb: 180, ki: 6, p: ['combo', [0, 1], [0.04]], trail: { a0: -0.6, a1: 0.9, r: 120 } },
  cross:    { dur: 0.34, on: 0.06, off: 0.18, cancel: 0.18, reach: [20, 150], y: [-170, -50], dmg: 1.5, kb: 200, ki: 6, p: ['combo', [2]], trail: { a0: -1.4, a1: 0.9, r: 125 } },
  rising:   { dur: 0.50, on: 0.08, off: 0.26, reach: [10, 150], y: [-200, -60], dmg: 3, kb: 240, ki: 10, launch: -760, p: ['combo', [3]], trail: { a0: 1.2, a1: -1.5, r: 130 } },
  kick:     { dur: 0.36, on: 0.08, off: 0.22, cancel: 0.22, reach: [20, 125], y: [-130, -60], dmg: 1.5, kb: 240, ki: 6, p: ['combo', [4]] },
  spin:     { dur: 0.48, on: 0.10, off: 0.30, cancel: 0.30, reach: [-80, 160], y: [-160, -40], dmg: 2, kb: 300, ki: 8, p: ['combo', [5]], trail: { a0: -3.1, a1: 3.1, r: 125 }, call: 'NEJIREUZUSHIO !' },
  leap:     { dur: 0.62, on: 0.22, off: 0.40, reach: [10, 170], y: [-190, 0], dmg: 3.5, kb: 320, ki: 10, launch: -560, p: ['combo', [6, 7], [0.2]], trail: { a0: -1.8, a1: 1.3, r: 150, at: 0.2 }, call: 'TAKI KO !' },
  ckick:    { dur: 0.42, on: 0.10, off: 0.26, reach: [20, 170], y: [-50, 0], dmg: 2, kb: 200, ki: 8, launch: -380, p: ['lowair', [1, 2, 3], [0.08, 0.3]], trail: { a0: 0.2, a1: 1.3, r: 110, y: -40 } },
  airkick:  { dur: 0.55, on: 0.07, off: 0.48, reach: [10, 160], y: [-110, 40], dmg: 2.5, kb: 300, ki: 8, launch: -520, p: ['lowair', [5, 6, 7], [0.05, 0.42]], trail: { a0: -3.1, a1: 3.1, r: 100, at: 0.06 } },
  dash:     { dur: 0.60, on: 0.10, off: 0.45, reach: [0, 150], y: [-200, 0], dmg: 3, kb: 380, ki: 8, launch: -560, push: 800, pushAt: 0.05, pushDur: 0.4, wheel: true, call: 'MIZU GURUMA !', p: ['dashcharge', [0, 1, 2, 3], [0.1, 0.35, 0.5]] },
  surface:  { dur: 0.70, cost: 35, proj: { at: 0.3, kind: 'wave', speed: 720, dmg: 3, kb: 380, launch: -420, life: 1.0 }, call: 'MINAMO GIRI !', p: ['special', [0, 1, 2, 3], [0.15, 0.3, 0.55]], trail: { a0: -0.4, a1: 0.5, r: 170, at: 0.28, w: 34 } },
};
// Kenshin : Hiten Mitsurugi-ryu, sabre à lame inversée
const KS_MOVES = {
  punch:    { dur: 0.30, on: 0.05, off: 0.17, cancel: 0.17, reach: [20, 150], y: [-160, -60], dmg: 1.3, kb: 180, ki: 6, p: ['combo', [0, 1], [0.04]], trail: { a0: -0.6, a1: 0.9, r: 120 } },
  cross:    { dur: 0.32, on: 0.06, off: 0.18, cancel: 0.18, reach: [20, 150], y: [-170, -50], dmg: 1.5, kb: 200, ki: 6, p: ['combo', [2]], trail: { a0: -1.4, a1: 0.9, r: 125 } },
  ryusho:   { dur: 0.52, on: 0.08, off: 0.26, reach: [10, 140], y: [-210, -60], dmg: 3, kb: 220, ki: 10, launch: -820, p: ['combo', [3]], trail: { a0: 1.3, a1: -1.6, r: 135, w: 36 }, call: 'RYU SHO SEN !' },
  kick:     { dur: 0.34, on: 0.07, off: 0.20, cancel: 0.20, reach: [20, 125], y: [-130, -60], dmg: 1.5, kb: 240, ki: 6, p: ['combo', [4]] },
  ryukan:   { dur: 0.46, on: 0.10, off: 0.30, cancel: 0.30, reach: [-80, 160], y: [-160, -40], dmg: 2, kb: 300, ki: 8, p: ['combo', [5]], trail: { a0: -3.1, a1: 3.1, r: 125 }, call: 'RYU KAN SEN !' },
  ryutsui:  { dur: 0.62, on: 0.26, off: 0.44, reach: [10, 170], y: [-210, 0], dmg: 3.5, kb: 320, ki: 10, launch: -540, p: ['combo', [6, 7], [0.24]], trail: { a0: -1.7, a1: 1.3, r: 155, at: 0.24, w: 36 }, call: 'RYU TSUI SEN !' },
  ckick:    { dur: 0.40, on: 0.10, off: 0.26, reach: [20, 170], y: [-50, 0], dmg: 2, kb: 200, ki: 8, launch: -380, p: ['lowair', [1, 2, 3], [0.08, 0.3]], trail: { a0: 0.2, a1: 1.3, r: 110, y: -40 } },
  airkick:  { dur: 0.52, on: 0.07, off: 0.46, reach: [10, 160], y: [-110, 40], dmg: 2.5, kb: 300, ki: 8, launch: -520, p: ['lowair', [5, 6, 7], [0.05, 0.4]], trail: { a0: -3.1, a1: 3.1, r: 100, at: 0.06 } },
  dash:     { dur: 0.58, on: 0.10, off: 0.40, reach: [-90, 90], y: [-160, -40], dmg: 3, kb: 300, ki: 8, launch: -450, push: 1300, pushAt: 0.08, pushDur: 0.3, xcut: true, ghost: true, call: 'SHINSOKU !', p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.36, 0.5]] },
  doryu:    { dur: 0.75, cost: 35, proj: { at: 0.32, kind: 'rocks', speed: 700, dmg: 4, kb: 420, launch: -620, life: 1.0, low: true, scale: 1.4 }, call: 'DO RYU SEN !', p: ['special', [0, 1, 2, 3], [0.18, 0.34, 0.6]] },
};
// Jeux de coups de base, à compléter par le dash et le coup spécial de chaque personnage
const plain = M => Object.fromEntries(Object.entries(M).map(([k, v]) => [k, { ...v, call: undefined }]));
const FIST = plain(K_MOVES), SWORD = plain(T_MOVES);
// Coup lanceur des épéistes à la grosse lame (24/10) : de l'accroupi à l'épée levée, la lame trace un arc qui monte
SWORD.risecut = { dur: 0.52, on: 0.1, off: 0.28, reach: [10, 170], y: [-220, -40], dmg: 3, kb: 220, ki: 10, launch: -760, p: ['combo', [3, 1], [0.1]], trail: { a0: 1.3, a1: -1.6, r: 140, w: 34 } };
// Planches de combo refaites : genou armé puis pied tendu (5-6), circulaire haut (7), retourné sauté (8)
const NEWKICK = M => ({ ...M, kick: { ...M.kick, p: ['combo', [4, 5], [0.08]] }, roundhouse: { ...M.roundhouse, p: ['combo', [6]] }, spinback: { ...M.spinback, p: ['combo', [7]] } });
Object.assign(K_MOVES, NEWKICK(K_MOVES));
// Kakashi : taijutsu, Chidori, Kamui
const KA_MOVES = { ...FIST,
  dash:    { dur: 0.55, on: 0.12, off: 0.40, reach: [-60, 120], y: [-160, -50], dmg: 3, kb: 380, ki: 8, launch: -450, push: 1200, pushAt: 0.08, pushDur: 0.3, ghost: true, xcut: true, call: 'SHUNSHIN !', p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.3, 0.48]] },
  chidori: { dur: 0.95, cost: 35, on: 0.38, off: 0.75, reach: [0, 140], y: [-170, -60], dmg: 5, kb: 650, ki: 0, launch: -650, push: 1450, pushAt: 0.36, pushDur: 0.32,
             orbFx: 'chidori', orb: [0, 0.78], bolts: true, stopOnHit: true, call: 'CHIDORI !', p: ['special', [0, 1, 2, 3], [0.36, 0.55, 0.82]] },
};
// Sasuke : taijutsu, dégainage éclair au sabre, Chidori
const SK_MOVES = { ...FIST,
  dash:    { dur: 0.55, on: 0.12, off: 0.42, reach: [-40, 160], y: [-170, -50], dmg: 3.2, kb: 400, ki: 8, launch: -480, push: 1300, pushAt: 0.08, pushDur: 0.3, ghost: true, xcut: true, call: 'CHIDORI GATANA !', p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.26, 0.46]] },
  chidori: { ...KA_MOVES.chidori, dmg: 5.5 },
};
// Gohan enfant : poings et pieds de Sangoku, Masenko
const GH_MOVES = { ...FIST,
  dash:    { dur: 0.5, on: 0.12, off: 0.36, reach: [0, 130], y: [-140, -50], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1100, pushAt: 0.06, pushDur: 0.3, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.38]] },
  masenko: { dur: 1.25, cost: 35, beam: { hand: true, charge: [[28, -262], [24, -302]], ball: true, at: 0.5, end: 1.12, len: 900, dmg: 0.6, color: '#ffe066', filter: 'hue-rotate(-150deg) saturate(1.8) brightness(1.15)' }, call: 'MASENKO !', p: ['special', [0, 1, 2, 3], [0.2, 0.5, 1.14]] },
};
// Inosuke : deux sabres dentelés, souffle de la bête (coups de tête, ruées de sanglier)
const IN_MOVES = { ...SWORD,
  spin:  { ...SWORD.spin, trail: undefined, call: 'HÉ HÉ !' },
  dash:  { dur: 0.6, on: 0.1, off: 0.45, reach: [0, 150], y: [-170, -30], dmg: 3, kb: 420, ki: 8, launch: -500, push: 1350, pushAt: 0.06, pushDur: 0.36, ghost: true, lean: 18, call: 'TOUT DROIT !', p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.3, 0.48]] },
  // Crocs de la bête : il bondit et coupe en ciseaux avec ses deux lames
  fang:  { dur: 0.8, cost: 35, on: 0.2, off: 0.5, reach: [-60, 150], y: [-170, -30], dmg: 5, kb: 440, ki: 0, launch: -620, push: 1800, pushAt: 0.16, pushDur: 0.3, xcut: true,
           call: 'CROCS DE LA BÊTE !', p: ['special', [0, 1, 2, 3], [0.16, 0.3, 0.55]], trail: { x: true, r: 130, at: 0.22, w: 30 } },
};
// Trunks du futur : poings et pieds de saiyan, dégainage de l'épée, Burning Attack
const TR_MOVES = { ...NEWKICK(FIST),
  dash:    { dur: 0.55, on: 0.12, off: 0.42, reach: [-40, 160], y: [-170, -50], dmg: 3.2, kb: 400, ki: 8, launch: -480, push: 1450, pushAt: 0.08, pushDur: 0.3, ghost: true, xcut: true, lean: 20, p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.26, 0.46]] },
  burning: { dur: 0.8, cost: 35, proj: { at: 0.4, kind: 'burning', speed: 900, dmg: 4.5, kb: 620, launch: -560, life: 1.0, scale: 1.3 }, call: 'BURNING ATTACK !', p: ['special', [0, 1, 2, 3], [0.18, 0.38, 0.62]] },
};
// Ace : poings et pieds, Hiken (le poing de feu part du poing tendu)
const AC_MOVES = { ...NEWKICK(FIST),
  dash:  { dur: 0.5, on: 0.12, off: 0.36, reach: [0, 140], y: [-150, -50], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1150, pushAt: 0.06, pushDur: 0.3, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.38]] },
  hiken: { dur: 0.8, cost: 35, proj: { at: 0.38, kind: 'hiken', speed: 950, dmg: 4.5, kb: 600, launch: -540, life: 1.0, scale: 1.2 }, call: 'HIKEN !', p: ['special', [0, 1, 2, 3], [0.18, 0.36, 0.62]] },
};
// Guts : l'épée gigantesque, lente mais longue et lourde, et le canon caché dans son bras de fer
const GT_MOVES = { ...SWORD,
  smash:  { dur: 0.62, on: 0.2, off: 0.36, cancel: 0.42, reach: [20, 225], y: [-230, 0], dmg: 2.8, kb: 320, ki: 8, p: ['combo', [1, 2, 3], [0.18, 0.4]], trail: { a0: -1.7, a1: 1.2, r: 200, at: 0.18, w: 46 } },
  sweep:  { dur: 0.56, on: 0.16, off: 0.32, cancel: 0.4, reach: [0, 235], y: [-190, -20], dmg: 2.6, kb: 380, ki: 8, p: ['combo', [4, 5], [0.16]], trail: { a0: -0.5, a1: 0.6, r: 220, at: 0.16, w: 46 } },
  thrust: { dur: 0.58, on: 0.18, off: 0.34, reach: [20, 260], y: [-170, -50], dmg: 3.4, kb: 460, ki: 10, launch: -520, p: ['combo', [6]] },
  spin:   { dur: 0.6, on: 0.16, off: 0.4, cancel: 0.44, reach: [-150, 220], y: [-190, -20], dmg: 2.4, kb: 360, ki: 8, p: ['combo', [7]], trail: { a0: -3.1, a1: 3.1, r: 190, w: 40 } },
  heavy:  { dur: 0.75, on: 0.3, off: 0.46, reach: [20, 230], y: [-240, 0], dmg: 3.8, kb: 420, ki: 10, launch: -620, p: ['combo', [1, 2, 3], [0.28, 0.5]], trail: { a0: -1.7, a1: 1.2, r: 210, at: 0.28, w: 50 }, call: 'HAAA !' },
  ckick:  { ...SWORD.ckick, reach: [20, 220], dmg: 2.4, p: ['lowair', [1, 2, 3], [0.1, 0.3]] },
  airkick: { ...SWORD.airkick, reach: [10, 210], dmg: 2.8, p: ['lowair', [5, 6, 7], [0.06, 0.42]] },
  dash:   { dur: 0.62, on: 0.12, off: 0.46, reach: [0, 170], y: [-180, -20], dmg: 3.4, kb: 480, ki: 8, launch: -500, push: 1100, pushAt: 0.08, pushDur: 0.36, lean: 14, p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.26, 0.46]] },
  cannon: { dur: 0.85, cost: 35, proj: { at: 0.42, kind: 'shell', speed: 1150, dmg: 5, kb: 650, launch: -560, life: 0.9 }, call: 'CANON !', p: ['special', [0, 1, 2, 3], [0.2, 0.4, 0.66]] },
};
// Sanji : uniquement les pieds, mains dans les poches ; Diable Jambe = la jambe s'enflamme en tournant sur lui-même
const SJ_MOVES = { ...FIST,
  punch:    { dur: 0.30, on: 0.06, off: 0.17, cancel: 0.17, reach: [20, 150], y: [-150, -60], dmg: 1.2, kb: 180, ki: 6, p: ['combo', [0, 1], [0.05]] },
  cross:    { dur: 0.34, on: 0.07, off: 0.19, cancel: 0.19, reach: [20, 155], y: [-190, -90], dmg: 1.5, kb: 220, ki: 6, p: ['combo', [2]] },
  uppercut: { dur: 0.50, on: 0.14, off: 0.28, reach: [10, 140], y: [-190, -20], dmg: 3, kb: 240, ki: 10, launch: -760, p: ['combo', [2, 3], [0.12]], trail: { a0: -1.6, a1: 0.6, r: 120, at: 0.12 }, call: 'CONCASSÉ !' },
  kick:     { dur: 0.42, on: 0.12, off: 0.26, cancel: 0.26, reach: [10, 160], y: [-130, -10], dmg: 1.6, kb: 260, ki: 6, p: ['combo', [4, 5], [0.1]] },
  roundhouse: { dur: 0.48, on: 0.10, off: 0.30, cancel: 0.30, reach: [-110, 160], y: [-130, -10], dmg: 2.2, kb: 320, ki: 8, p: ['combo', [6]], trail: { a0: -3.1, a1: 3.1, r: 130, y: -60 } },
  spinback: { dur: 0.58, on: 0.10, off: 0.32, reach: [-60, 165], y: [-140, -10], dmg: 3, kb: 420, ki: 10, launch: -520, p: ['combo', [5, 6, 7], [0.12, 0.34]], trail: { a0: -3.1, a1: 3.1, r: 135, y: -60 }, call: 'PARAGE SHOT !' },
  dash:     { dur: 0.55, on: 0.12, off: 0.42, reach: [0, 160], y: [-160, -40], dmg: 3, kb: 430, ki: 8, launch: -480, push: 1250, pushAt: 0.06, pushDur: 0.32, lean: 16, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.18, 0.42]] },
  diable:   { dur: 0.78, cost: 35, on: 0.28, off: 0.5, reach: [-40, 185], y: [-190, -30], dmg: 5, kb: 650, ki: 0, launch: -620, push: 700, pushAt: 0.24, pushDur: 0.2, legFire: [0.04, 0.62],
              call: 'DIABLE JAMBE !', p: ['special', [0, 1, 2, 3], [0.14, 0.28, 0.56]], trail: { a0: -3.1, a1: 3.1, r: 150, at: 0.12, w: 34 } },
};
// Shoto : moitié glace, moitié feu. Spécial : un mur de pics de glace qui court au sol depuis sa main droite
const ST_MOVES = { ...NEWKICK(FIST),
  dash:    { dur: 0.55, on: 0.1, off: 0.42, reach: [0, 150], y: [-120, 0], dmg: 3, kb: 400, ki: 8, launch: -480, push: 1250, pushAt: 0.06, pushDur: 0.34, lean: 12, iceTrail: true, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.44]] },
  icewall: { dur: 0.85, cost: 35, proj: { at: 0.36, kind: 'icewall', speed: 760, dmg: 4.5, kb: 420, launch: -700, life: 0.9, ground: true, scale: 1.2 }, call: 'MUR DE GLACE !', p: ['special', [0, 1, 2, 3], [0.14, 0.32, 0.66]] },
};
// Saber : l'épée dorée. Planche de combo : 0 garde, 1 levée, 2 taille verticale, 3 accroupie, 4 armée, 5 taille horizontale,
// 6 estoc, 7 taille tournante. Strike Air = la rafale de vent qui cachait la lame, lâchée depuis la pointe.
const SB_MOVES = { ...SWORD,
  smash:  { dur: 0.42, on: 0.12, off: 0.26, cancel: 0.28, reach: [20, 175], y: [-210, 0], dmg: 1.6, kb: 220, ki: 6, p: ['combo', [1, 2, 3], [0.1, 0.26]], trail: { a0: -1.7, a1: 1.2, r: 150, at: 0.1, w: 36 } },
  sweep:  { dur: 0.40, on: 0.10, off: 0.24, cancel: 0.26, reach: [0, 180], y: [-180, -20], dmg: 1.8, kb: 260, ki: 6, p: ['combo', [4, 5], [0.1]], trail: { a0: -0.5, a1: 0.6, r: 160, at: 0.1, w: 36 } },
  thrust: { dur: 0.50, on: 0.14, off: 0.30, reach: [20, 200], y: [-170, -50], dmg: 3, kb: 380, ki: 10, launch: -520, p: ['combo', [6]] },
  spin:   { dur: 0.48, on: 0.10, off: 0.32, cancel: 0.32, reach: [-110, 170], y: [-170, -20], dmg: 2, kb: 300, ki: 8, p: ['combo', [7]], trail: { a0: -3.1, a1: 3.1, r: 140, w: 34 } },
  heavy:  { dur: 0.60, on: 0.24, off: 0.38, reach: [20, 185], y: [-230, 0], dmg: 3.2, kb: 380, ki: 10, launch: -600, p: ['combo', [1, 2, 3], [0.22, 0.4]], trail: { a0: -1.7, a1: 1.2, r: 165, at: 0.22, w: 42 }, call: 'HAAA !' },
  dash:   { dur: 0.55, on: 0.12, off: 0.42, reach: [-30, 160], y: [-170, -40], dmg: 3.2, kb: 420, ki: 8, launch: -480, push: 1400, pushAt: 0.08, pushDur: 0.3, ghost: true, xcut: true, lean: 16, p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.26, 0.46]] },
  strikeair: { dur: 0.8, cost: 35, proj: { at: 0.36, kind: 'strikeair', speed: 980, dmg: 4.5, kb: 620, launch: -560, life: 1.0, scale: 1.2 }, call: 'STRIKE AIR !', p: ['special', [0, 1, 2, 3], [0.16, 0.34, 0.62]] },
};
// Mikasa : deux lames et l'équipement tridimensionnel. Même planche de combo que Saber, coups plus vifs et plus courts ;
// le dash est un tir de grappin, très penché ; le spécial une toupie qui monte et coupe plusieurs fois.
const MK_MOVES = { ...SWORD,
  smash:  { dur: 0.36, on: 0.10, off: 0.22, cancel: 0.24, reach: [20, 160], y: [-200, 0], dmg: 1.4, kb: 200, ki: 6, p: ['combo', [1, 2, 3], [0.08, 0.22]], trail: { a0: -1.7, a1: 1.2, r: 140, at: 0.08 } },
  sweep:  { dur: 0.34, on: 0.08, off: 0.20, cancel: 0.22, reach: [0, 165], y: [-180, -20], dmg: 1.6, kb: 240, ki: 6, p: ['combo', [4, 5], [0.08]], trail: { a0: -0.5, a1: 0.6, r: 150, at: 0.08 } },
  thrust: { dur: 0.44, on: 0.12, off: 0.26, reach: [20, 180], y: [-170, -50], dmg: 2.8, kb: 360, ki: 10, launch: -520, p: ['combo', [6]] },
  spin:   { dur: 0.42, on: 0.08, off: 0.28, cancel: 0.28, reach: [-110, 160], y: [-170, -20], dmg: 2, kb: 300, ki: 8, p: ['combo', [7]], trail: { a0: -3.1, a1: 3.1, r: 130, w: 30 } },
  heavy:  { dur: 0.52, on: 0.2, off: 0.32, reach: [20, 170], y: [-220, 0], dmg: 3, kb: 360, ki: 10, launch: -580, p: ['combo', [1, 2, 3], [0.18, 0.34]], trail: { a0: -1.7, a1: 1.2, r: 150, at: 0.18 } },
  dash:   { dur: 0.5, on: 0.08, off: 0.4, reach: [-20, 170], y: [-180, -40], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1900, pushAt: 0.05, pushDur: 0.3, ghost: true, xcut: true, lean: 22, call: 'GRAPPIN !', p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.22, 0.42]] },
  toupie: { dur: 0.9, cost: 35, on: 0.14, off: 0.66, multi: 0.1, reach: [-120, 160], y: [-230, -10], dmg: 1.1, kb: 120, ki: 0, launch: -380, push: 650, pushAt: 0.12, pushDur: 0.5, ghost: true,
            call: 'TOUPIE !', p: ['special', [0, 1, 2, 3], [0.12, 0.36, 0.72]], trail: { a0: -3.1, a1: 3.1, r: 145, at: 0.14, w: 32 } },
};
// Revy : poings et pieds au corps à corps (planche de combo : 0 garde, 1 coup de crosse, 2-3 bras tendu, 4 genou,
// 5 pied avant) ; les pistolets sont réservés au spécial Two Hands (payé en ki) et à l'ultime, comme une énergie.
// Chaque tir (shots) part du bout du canon dessiné, avec un éclair de bouche.
const RV_F = NEWKICK(FIST);
const RV_MOVES = { ...RV_F,
  uppercut:   { ...RV_F.uppercut, p: ['combo', [5, 6], [0.08]] },                     // coup de pied haut qui monte (lanceur du jonglage)
  punch:      { ...RV_F.punch, p: ['combo', [0, 1], [0.05]] },                       // coup de crosse
  cross:      { ...RV_F.cross, p: ['combo', [2]] },                                  // crosse en direct, bras tendu
  uppercut:   { ...RV_F.uppercut, p: ['combo', [1, 3], [0.1]] },                     // crosse armée puis frappée
  kick:       { ...RV_F.kick, p: ['combo', [4]] },                                   // genou
  roundhouse: { ...RV_F.roundhouse, p: ['combo', [5]] },                             // pied avant
  spinback:   { ...RV_F.spinback, call: 'HA HA !', p: ['combo', [4, 5], [0.12]] },   // genou armé puis pied
  ckick:      { ...RV_F.ckick, p: ['lowair', [0, 1, 3], [0.08, 0.3]] },              // roulade au sol
  airkick:    { ...RV_F.airkick, p: ['lowair', [5, 6, 5], [0.08, 0.4]] },
  // glissade sur le flanc, sans tirer
  dash:       { dur: 0.6, on: 0.1, off: 0.34, reach: [0, 140], y: [-90, 0], dmg: 2.4, kb: 360, ki: 8, launch: -420, push: 1300, pushAt: 0.06, pushDur: 0.34, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.46]] },
  // Two Hands : la rafale des deux pistolets, une main après l'autre (coûte du ki, ne le recharge pas)
  twohands:   { dur: 0.9, cost: 35, ki: 0, shots: { at: [0.14, 0.22, 0.3, 0.38, 0.46, 0.54], dmg: 0.85, kb: 70, noKi: true, last: { kb: 520, launch: -520 } }, call: 'TWO HANDS !',
                p: ['special', [0, 1, 2, 1, 2, 1, 2, 3], [0.1, 0.18, 0.26, 0.34, 0.42, 0.5, 0.66]] },
};
// Gally : Panzer Kunst, coups secs et précis. Spécial : une frappe de paume qui libère une onde de choc à l'impact
const GA_MOVES = { ...NEWKICK(FIST),
  punch:  { ...FIST.punch, dur: 0.26, cancel: 0.14 }, cross: { ...FIST.cross, dur: 0.28, cancel: 0.15 },
  dash:   { dur: 0.5, on: 0.18, off: 0.36, reach: [0, 150], y: [-170, -60], dmg: 3.2, kb: 480, ki: 8, launch: -480, push: 1500, pushAt: 0.06, pushDur: 0.3, ghost: true, lean: 18, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  palm:   { dur: 0.85, cost: 35, on: 0.3, off: 0.44, reach: [0, 175], y: [-180, -60], dmg: 5.5, kb: 820, ki: 0, launch: -600, push: 500, pushAt: 0.26, pushDur: 0.12, shock: true,
            call: 'PANZER KUNST !', p: ['special', [0, 1, 2, 3], [0.14, 0.28, 0.6]] },
};
// Livaï : deux lames en prise inversée, plus petit et plus vif que Mikasa ; le spécial est un cyclone aérien
// (special 0 bond, 1-2 rotation lames écartées, 3 réception), qui coupe plusieurs fois et soulève.
const LV_MOVES = { ...SWORD,
  smash:  { dur: 0.34, on: 0.09, off: 0.21, cancel: 0.23, reach: [20, 155], y: [-200, 0], dmg: 1.4, kb: 200, ki: 6, p: ['combo', [1, 2, 3], [0.07, 0.2]], trail: { a0: -1.7, a1: 1.2, r: 135, at: 0.07 } },
  sweep:  { dur: 0.32, on: 0.08, off: 0.19, cancel: 0.21, reach: [0, 160], y: [-180, -20], dmg: 1.6, kb: 240, ki: 6, p: ['combo', [4, 5], [0.07]], trail: { a0: -0.5, a1: 0.6, r: 145, at: 0.07 } },
  thrust: { dur: 0.42, on: 0.11, off: 0.25, reach: [20, 175], y: [-170, -50], dmg: 2.8, kb: 360, ki: 10, launch: -520, p: ['combo', [6]] },
  spin:   { dur: 0.40, on: 0.08, off: 0.27, cancel: 0.27, reach: [-110, 155], y: [-170, -20], dmg: 2, kb: 300, ki: 8, p: ['combo', [7]], trail: { a0: -3.1, a1: 3.1, r: 125, w: 28 } },
  heavy:  { dur: 0.50, on: 0.19, off: 0.31, reach: [20, 165], y: [-220, 0], dmg: 3, kb: 360, ki: 10, launch: -580, p: ['combo', [1, 2, 3], [0.17, 0.32]], trail: { a0: -1.7, a1: 1.2, r: 145, at: 0.17 } },
  dash:   { dur: 0.48, on: 0.07, off: 0.38, reach: [-20, 165], y: [-180, -40], dmg: 3, kb: 420, ki: 8, launch: -480, push: 2000, pushAt: 0.05, pushDur: 0.28, ghost: true, xcut: true, lean: 22, call: 'GRAPPIN !', p: ['dashcharge', [0, 1, 2, 3], [0.05, 0.2, 0.4]] },
  cyclone: { dur: 0.9, cost: 35, on: 0.12, off: 0.66, multi: 0.09, reach: [-130, 165], y: [-240, -10], dmg: 1.1, kb: 110, ki: 0, launch: -420, push: 600, pushAt: 0.1, pushDur: 0.5, ghost: true,
             call: 'CYCLONE !', p: ['special', [0, 1, 2, 1, 2, 3], [0.1, 0.22, 0.34, 0.46, 0.66]], trail: { a0: -3.1, a1: 3.1, r: 150, at: 0.12, w: 30 } },
};
// Baki : arts martiaux à mains nues, des coups énormes. Spécial : la frappe fouet (le bras relâché claque comme un fouet,
// special 0-3). Dos du démon : le spécial devient le direct dévastateur (special 4-7).
const BK_MOVES = { ...NEWKICK(FIST),
  punch:     { ...FIST.punch, dmg: FIST.punch.dmg * 1.15 }, cross: { ...FIST.cross, dmg: FIST.cross.dmg * 1.15 }, uppercut: { ...FIST.uppercut, dmg: FIST.uppercut.dmg * 1.15 },
  dash:      { dur: 0.55, on: 0.16, off: 0.36, reach: [0, 155], y: [-180, -60], dmg: 3.4, kb: 520, ki: 8, launch: -480, push: 1450, pushAt: 0.06, pushDur: 0.28, lean: 16, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  whip:      { dur: 0.78, cost: 35, on: 0.3, off: 0.42, reach: [0, 200], y: [-190, -70], dmg: 5, kb: 980, ki: 0, launch: -420, push: 300, pushAt: 0.26, pushDur: 0.1,
               call: 'FRAPPE FOUET !', p: ['special', [0, 1, 2, 3], [0.16, 0.3, 0.6]], trail: { a0: -0.9, a1: 0.5, r: 175, at: 0.28, w: 26 } },
  demonfist: { dur: 0.9, cost: 35, on: 0.36, off: 0.5, reach: [0, 190], y: [-180, -70], dmg: 6.5, kb: 1100, ki: 0, launch: -650, push: 900, pushAt: 0.3, pushDur: 0.14, shock: true, lean: 14,
               call: 'DOS DU DÉMON !', p: ['special', [4, 5, 6, 7], [0.2, 0.34, 0.66]] },
};
// Itachi : calme et précis. Spécial : Katon, la boule de feu soufflée par la bouche (special 0-3) ; en Mangekyô,
// Amaterasu : des flammes noires naissent directement sur l'ennemi regardé (special 4-7), sans projectile.
const IT_MOVES = { ...NEWKICK(FIST),
  dash:      { dur: 0.5, on: 0.14, off: 0.34, reach: [0, 150], y: [-170, -60], dmg: 3, kb: 420, ki: 8, launch: -460, push: 1500, pushAt: 0.05, pushDur: 0.28, ghost: true, lean: 14, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  katon:     { dur: 0.85, cost: 35, proj: { at: 0.4, kind: 'katon', from: 'mouth', speed: 820, dmg: 4.8, kb: 600, launch: -520, life: 1.1, scale: 1.3 }, call: 'KATON : GŌKAKYŪ !', p: ['special', [0, 1, 2, 3], [0.14, 0.3, 0.7]] },
  amaterasu: { dur: 0.9, cost: 35, ama: { at: 0.5, range: 520, dur: 2.4, dps: 2.4 }, call: 'AMATERASU', p: ['special', [4, 5, 6, 7], [0.18, 0.4, 0.72]] },
};
// Eren : deux lames et le grappin, plus rageur que Mikasa. Spécial : l'attaque double aux lames (special 0-3, bond puis
// double entaille) ; une fois le pouvoir du Titan éveillé, le poing du Titan (special 4-7) et son onde de choc.
const ER_MOVES = { ...SWORD,
  smash:  { dur: 0.38, on: 0.10, off: 0.23, cancel: 0.25, reach: [20, 165], y: [-210, 0], dmg: 1.6, kb: 230, ki: 6, p: ['combo', [1, 2, 3], [0.08, 0.22]], trail: { a0: -1.7, a1: 1.2, r: 145, at: 0.08 } },
  sweep:  { dur: 0.36, on: 0.09, off: 0.21, cancel: 0.23, reach: [0, 170], y: [-180, -20], dmg: 1.7, kb: 260, ki: 6, p: ['combo', [4, 5], [0.08]], trail: { a0: -0.5, a1: 0.6, r: 155, at: 0.08 } },
  thrust: { dur: 0.44, on: 0.12, off: 0.27, reach: [20, 185], y: [-170, -50], dmg: 2.9, kb: 380, ki: 10, launch: -520, p: ['combo', [6]] },
  spin:   { dur: 0.42, on: 0.09, off: 0.28, cancel: 0.28, reach: [-110, 165], y: [-170, -20], dmg: 2, kb: 300, ki: 8, p: ['combo', [7]], trail: { a0: -3.1, a1: 3.1, r: 135, w: 30 } },
  heavy:  { dur: 0.54, on: 0.21, off: 0.34, reach: [20, 175], y: [-220, 0], dmg: 3.2, kb: 380, ki: 10, launch: -600, p: ['combo', [1, 2, 3], [0.19, 0.34]], trail: { a0: -1.7, a1: 1.2, r: 155, at: 0.19, w: 38 } },
  dash:   { dur: 0.5, on: 0.08, off: 0.38, reach: [-20, 175], y: [-180, -40], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1850, pushAt: 0.05, pushDur: 0.28, ghost: true, xcut: true, lean: 20, call: 'GRAPPIN !', p: ['dashcharge', [0, 1, 2, 3], [0.05, 0.2, 0.42]] },
  erblades:  { dur: 0.8, cost: 35, on: 0.3, off: 0.46, reach: [0, 200], y: [-230, -40], dmg: 5, kb: 620, ki: 0, launch: -540, push: 900, pushAt: 0.18, pushDur: 0.22, ghost: true, xcut: true,
               call: 'ATTAQUE !', p: ['special', [0, 1, 2, 3], [0.14, 0.3, 0.62]], trail: { a0: -1.2, a1: 1.0, r: 175, at: 0.3, w: 34 } },
  titanfist: { dur: 0.9, cost: 35, on: 0.36, off: 0.5, reach: [0, 200], y: [-190, -60], dmg: 6.5, kb: 1100, ki: 0, launch: -650, push: 800, pushAt: 0.3, pushDur: 0.14, shock: true, lean: 14,
               call: 'POING DU TITAN !', p: ['special', [4, 5, 6, 7], [0.2, 0.34, 0.66]] },
};
// Boruto : poings et pieds de ninja. Spécial : le Rasengan évanescent, une petite sphère qui part de la paume tendue
// (special 2), s'efface en route et réapparaît juste avant l'impact (tir 'vrasen').
const BO_MOVES = { ...NEWKICK(FIST),
  dash:   { dur: 0.5, on: 0.14, off: 0.34, reach: [0, 150], y: [-170, -60], dmg: 3, kb: 420, ki: 8, launch: -460, push: 1550, pushAt: 0.05, pushDur: 0.28, ghost: true, lean: 18, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  vrasen: { dur: 0.85, cost: 35, proj: { at: 0.4, kind: 'vrasen', speed: 760, dmg: 4.8, kb: 620, launch: -560, life: 1.0, scale: 1 }, call: 'RASENGAN ÉVANESCENT !', p: ['special', [0, 1, 2, 3], [0.14, 0.3, 0.68]] },
};
// Naruto adolescent (Shippuden), variante de la case Naruto : poings et pieds, Rasengan tenu dans la paume (special 0-3,
// même effet que l'enfant) ; en Mode Ermite, le spécial devient le Rasen-shuriken lancé depuis la main levée (special 4-7),
// qui éclate en dôme de vent au premier ennemi touché.
const NS_MOVES = { ...NEWKICK(FIST),
  dash:     { dur: 0.5, on: 0.14, off: 0.36, reach: [0, 150], y: [-170, -60], dmg: 3, kb: 420, ki: 8, launch: -460, push: 1600, pushAt: 0.05, pushDur: 0.28, ghost: true, lean: 18, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  rasengan: { ...N_MOVES.rasengan, dmg: 5.2 },
  rshuriken: { dur: 1.0, cost: 35, heldShuriken: true, proj: { at: 0.62, kind: 'shuriken', speed: 640, dmg: 0.6, kb: 200, life: 0.9, scale: 0.55, multiT: 0, final: 3.6, burst: true, blast: 170 },
               call: 'RASEN-SHURIKEN !', p: ['special', [4, 5, 6, 7], [0.25, 0.55, 0.82]] },
};
// Edward : poings et pieds, le bras d'acier en avant. Spécial : la transmutation — il frappe dans ses mains (special 0),
// pose les deux mains au sol (special 2) et des piques de pierre jaillissent devant lui et avancent (tir 'stonewall') ;
// bras-lame activé, le spécial devient l'entaille de la lame (special 4-7).
const ED_MOVES = { ...NEWKICK(FIST),
  dash:      { dur: 0.52, on: 0.14, off: 0.34, reach: [0, 150], y: [-170, -60], dmg: 3.2, kb: 460, ki: 8, launch: -460, push: 1450, pushAt: 0.05, pushDur: 0.28, ghost: true, lean: 16, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  transmute: { dur: 0.9, cost: 35, proj: { at: 0.42, kind: 'stonewall', speed: 720, dmg: 4.6, kb: 440, launch: -720, life: 0.95, ground: true, scale: 1.25 }, call: 'TRANSMUTATION !', p: ['special', [0, 1, 2, 3], [0.18, 0.34, 0.72]] },
  armblade:  { dur: 0.8, cost: 35, on: 0.3, off: 0.44, reach: [0, 200], y: [-200, -40], dmg: 6, kb: 760, ki: 0, launch: -560, push: 900, pushAt: 0.24, pushDur: 0.16, lean: 12,
               call: 'BRAS-LAME !', p: ['special', [4, 5, 6, 7], [0.16, 0.3, 0.62]], trail: { a0: -1.0, a1: 0.7, r: 175, at: 0.3, w: 32 } },
};
// Gintoki : le sabre de bois, coups larges et nonchalants. Spécial : le démon blanc, un bond et une grande taille
// horizontale (special 0-3) ; en Shiroyasha, le spécial devient le coup écrasant (special 4-7).
const GI_MOVES = { ...SWORD,
  smash:  { dur: 0.40, on: 0.11, off: 0.25, cancel: 0.27, reach: [20, 175], y: [-210, 0], dmg: 1.7, kb: 240, ki: 6, p: ['combo', [1, 2, 3], [0.09, 0.24]], trail: { a0: -1.7, a1: 1.2, r: 150, at: 0.09 } },
  sweep:  { dur: 0.38, on: 0.09, off: 0.23, cancel: 0.25, reach: [0, 180], y: [-180, -20], dmg: 1.8, kb: 270, ki: 6, p: ['combo', [4, 5], [0.09]], trail: { a0: -0.5, a1: 0.6, r: 160, at: 0.09 } },
  thrust: { dur: 0.46, on: 0.12, off: 0.28, reach: [20, 195], y: [-170, -60], dmg: 3, kb: 400, ki: 10, launch: -520, p: ['combo', [6]] },
  spin:   { dur: 0.46, on: 0.10, off: 0.30, cancel: 0.30, reach: [-110, 170], y: [-170, -20], dmg: 2, kb: 300, ki: 8, p: ['combo', [7]], trail: { a0: -3.1, a1: 3.1, r: 140, w: 30 } },
  heavy:  { dur: 0.56, on: 0.22, off: 0.36, reach: [20, 185], y: [-230, 0], dmg: 3.3, kb: 400, ki: 10, launch: -620, p: ['combo', [1, 2, 3], [0.2, 0.36]], trail: { a0: -1.7, a1: 1.2, r: 165, at: 0.2, w: 38 } },
  dash:   { dur: 0.5, on: 0.10, off: 0.38, reach: [-10, 200], y: [-170, -50], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1500, pushAt: 0.06, pushDur: 0.28, ghost: true, lean: 16, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.42]] },
  shirodemon: { dur: 0.82, cost: 35, on: 0.3, off: 0.46, reach: [-20, 230], y: [-220, -30], dmg: 5, kb: 700, ki: 0, launch: -560, push: 1200, pushAt: 0.16, pushDur: 0.24, ghost: true,
                call: 'DÉMON BLANC !', p: ['special', [0, 1, 2, 3], [0.14, 0.3, 0.62]], trail: { a0: -0.6, a1: 0.6, r: 210, at: 0.3, w: 40 } },
  gicrush:    { dur: 0.88, cost: 35, on: 0.38, off: 0.5, reach: [0, 200], y: [-240, 0], dmg: 6.2, kb: 900, ki: 0, launch: -700, push: 500, pushAt: 0.32, pushDur: 0.12, shock: true,
                call: 'SHIROYASHA !', p: ['special', [4, 5, 6, 7], [0.18, 0.36, 0.66]], trail: { a0: -1.8, a1: 1.3, r: 185, at: 0.36, w: 44 } },
};
// Ichigo : grand sabre, Getsuga Tensho
const IC_MOVES = { ...SWORD,
  punch: { ...SWORD.punch, reach: [20, 175], dmg: 1.6 }, cross: { ...SWORD.cross, reach: [20, 175], dmg: 1.8 }, rising: { ...SWORD.rising, reach: [10, 175] },
  dash:    { dur: 0.55, on: 0.12, off: 0.40, reach: [-60, 140], y: [-170, -40], dmg: 3, kb: 380, ki: 8, launch: -450, push: 1250, pushAt: 0.08, pushDur: 0.3, ghost: true, xcut: true, call: 'SHUNPO !', p: ['dashcharge', [0, 1, 2, 7], [0.08, 0.3, 0.48]] },
  getsuga: { dur: 0.75, cost: 35, proj: { at: 0.3, kind: 'getsuga', speed: 900, dmg: 4, kb: 420, launch: -480, life: 1.1 }, call: 'GETSUGA TENSHO !', p: ['special', [0, 1, 2, 3], [0.18, 0.32, 0.6]], trail: { a0: -1.6, a1: 1.0, r: 170, at: 0.26, w: 40 } },
};
// Zenitsu : souffle de la foudre
const ZE_MOVES = { ...SWORD,
  dash:     { dur: 0.5, on: 0.08, off: 0.32, reach: [-90, 90], y: [-160, -40], dmg: 3, kb: 300, ki: 8, launch: -450, push: 1600, pushAt: 0.05, pushDur: 0.26, xcut: true, ghost: true, bolts: true, call: 'KAMINARI !', p: ['dashcharge', [0, 1, 2, 3], [0.05, 0.3, 0.42]] },
  hekireki: { dur: 0.8, cost: 35, on: 0.18, off: 0.48, reach: [-120, 100], y: [-170, -30], dmg: 5, kb: 420, ki: 0, launch: -600, push: 2300, pushAt: 0.16, pushDur: 0.3, xcut: true, ghost: true, bolts: true,
              call: 'HEKIREKI ISSEN !', p: ['special', [0, 1, 2, 0], [0.16, 0.3, 0.55]] },
};
// Izuku : One For All
const IZ_MOVES = { ...NEWKICK(FIST),
  dash:     { dur: 0.55, on: 0.12, off: 0.42, reach: [0, 130], y: [-150, -40], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1150, pushAt: 0.08, pushDur: 0.34, call: 'ST. LOUIS SMASH !', p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.2, 0.45]] },
  // Black Whip : des fouets d'énergie noire attrapent les ennemis devant, les ramènent, puis un smash les envoie valser
  blackwhip: { dur: 1.0, cost: 35, whip: { at: 0.16, range: 540, n: 3, speed: 3400, slam: 0.66, dmg: 1, slamDmg: 4 }, call: 'BLACK WHIP !',
               p: ['special', [0, 2, ['dashcharge', 1], 3], [0.15, 0.62, 0.84]] },
};
// Vegeta : Galick Gun, Final Flash
const VE_MOVES = { ...NEWKICK(FIST),
  dash:   { dur: 0.55, on: 0.12, off: 0.42, reach: [0, 125], y: [-150, -60], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1100, pushAt: 0.06, pushDur: 0.4, p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.2, 0.45]] },
  galick: { dur: 1.3, cost: 35, beam: { ball: 'violet', at: 0.5, end: 1.15, len: 900, dmg: 0.55, color: '#c27bff', filter: 'hue-rotate(75deg) saturate(1.4)' }, call: 'GALICK GUN !', p: ['special', [0, 1, 2, 3], [0.22, 0.5, 1.18]] },
};
// Gon : Jajanken
const GO_MOVES = { ...FIST,
  dash:     { dur: 0.6, on: 0.12, off: 0.4, reach: [10, 230], y: [-150, -60], dmg: 2.5, kb: 300, ki: 8, launch: -420, call: 'CANNE À PÊCHE !', p: ['dashcharge', [0, 1, 2, 3], [0.12, 0.3, 0.45]], trail: { a0: -0.4, a1: 0.4, r: 200, at: 0.12, w: 10 } },
  jajanken: { dur: 1.05, cost: 35, on: 0.62, off: 0.78, reach: [0, 160], y: [-170, -60], dmg: 6, kb: 760, ki: 0, launch: -720, push: 500, pushAt: 0.58, pushDur: 0.15, boom: true, fistGlow: [0.05, 0.62],
              call: 'JAJANKEN… GU !', p: ['special', [0, 1, 2, 3], [0.3, 0.6, 0.9]] },
};
// Killua : Godspeed
const KI_MOVES = { ...FIST,
  punch: { ...FIST.punch, trail: { a0: -0.7, a1: 0.7, r: 90, w: 12 } }, cross: { ...FIST.cross, trail: { a0: 0.7, a1: -0.7, r: 95, w: 12 } },
  dash:     { dur: 0.5, on: 0.08, off: 0.36, reach: [-80, 100], y: [-150, -40], dmg: 3, kb: 320, ki: 8, launch: -450, push: 1500, pushAt: 0.05, pushDur: 0.28, ghost: true, bolts: true, call: 'RHYTHM ECHO !', p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.3, 0.42]] },
  narukami: { dur: 0.75, cost: 35, strike: { at: 0.32, range: 520, dmg: 3.5 }, call: 'NARUKAMI !', p: ['special', [0, 1, 2, 3], [0.15, 0.32, 0.55]] },
};
// Ippo : boxe, Dempsey Roll
const IP_MOVES = {
  finisher: FINISHER,
  punch:    { ...FIST.punch, p: ['combo', [0, 1], [0.04]] },
  cross:    { ...FIST.cross, p: ['combo', [2]] },
  uppercut: { ...FIST.uppercut, p: ['combo', [3]], dmg: 2.5 },
  // boxeur : pas de coups de pied. Crochet, coup au foie, puis Gazelle Punch (accroupi, il jaillit en uppercut)
  kick:     { ...FIST.cross, p: ['combo', [4]], reach: [0, 135], y: [-175, -110], dmg: 1.9, kb: 260 },
  roundhouse: { ...FIST.cross, p: ['combo', [5]], reach: [0, 130], y: [-130, -60], dmg: 2.2, kb: 200, call: 'LIVER BLOW !' },
  spinback: { ...FIST.spinback, p: ['combo', [6, 7], [0.14]], launch: -820, call: 'GAZELLE PUNCH !' },
  ckick:    { ...FIST.ckick, y: [-90, -20] }, airkick: FIST.airkick,
  dash:     { dur: 0.5, on: 0.12, off: 0.36, reach: [0, 120], y: [-150, -60], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1000, pushAt: 0.05, pushDur: 0.3, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  dempsey:  { dur: 1.7, cost: 35, on: 0.25, off: 1.55, multi: 0.13, reach: [0, 150], y: [-160, -60], dmg: 0.75, kb: 60, ki: 0, push: 220, pushAt: 0.2, pushDur: 1.4, keepPush: true,
              cyc: { anim: 'special', frames: [1, 2, 3, 4, 5, 6], fps: 9, from: 0.2, to: 1.45, last: 7 }, call: 'DEMPSEY ROLL !', p: ['special', [0]] },
};
// Sung Jin-Woo : dagues jumelles, pas de l'ombre
const JW_MOVES = { ...SWORD,
  dash:      { dur: 0.5, on: 0.08, off: 0.34, reach: [-90, 100], y: [-160, -40], dmg: 3, kb: 320, ki: 8, launch: -450, push: 1500, pushAt: 0.05, pushDur: 0.28, ghost: true, xcut: true, call: 'PAS DE L\'OMBRE !', p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.3, 0.42]] },
  shadowcut: { dur: 0.8, cost: 35, on: 0.18, off: 0.5, reach: [-120, 110], y: [-170, -30], dmg: 5, kb: 420, ki: 0, launch: -600, push: 2100, pushAt: 0.16, pushDur: 0.3, xcut: true, ghost: true,
               call: 'DOMAINE DU MONARQUE !', p: ['special', [0, 1, 2, 3], [0.16, 0.3, 0.55]] },
};
// Saitama : un poing banal… qui suffit
const SA_MOVES = { ...NEWKICK(FIST),
  dash:    { dur: 0.55, on: 0.12, off: 0.42, reach: [0, 130], y: [-150, -40], dmg: 3, kb: 520, ki: 8, launch: -520, push: 1150, pushAt: 0.08, pushDur: 0.34, call: 'COURSE NORMALE', p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.2, 0.45]] },
  serious: { dur: 1.0, cost: 35, on: 0.55, off: 0.72, reach: [0, 190], y: [-180, -40], dmg: 7, kb: 900, ki: 0, launch: -760, push: 500, pushAt: 0.5, pushDur: 0.15, boom: true, fistGlow: [0.05, 0.55],
             call: 'COUP DE POING NORMAL.', p: ['special', [0, 1, 2, 3], [0.3, 0.55, 0.85]] },
};
// Gojo : l'infini, Rouge et Bleu
const GJ_MOVES = { ...NEWKICK(FIST),
  dash: { dur: 0.5, on: 0.2, off: 0.38, reach: [0, 125], y: [-150, -60], dmg: 3, kb: 420, ki: 8, launch: -480, teleport: 0.16, call: 'INFINI.', p: ['dashcharge', [0, 1, 2, 3], [0.1, 0.22, 0.42]] },
  red:  { dur: 0.75, cost: 35, proj: { at: 0.3, kind: 'red', speed: 1150, dmg: 4.5, kb: 640, launch: -560, life: 0.9 }, call: 'INVERSION : ROUGE !', p: ['special', [0, 1, 2, 3], [0.18, 0.3, 0.55]] },
};
const KI = { transform: 50, ultra: 90, formUltra: 50, chargeRate: 32, regen: 4, goldDrain: 6 };

// Fiche de chaque personnage. Pour en ajouter un : ses planches dans tools/slice_sheets.py,
// son portrait (ui/card_<nom>.png), ses coups, ses formes, son ultime et sa fonction de poses.
// forms : transformations, la plus forte permise par le ki. Une forme a sa planche (sheet) ou une teinte (filter).
const CHARS = {
  hero: {
    name: 'KUNG-FU', title: 'Le maître de Néo-Tokyo', sheet: 'hero', card: 'card_hero',
    colors: ['#ff2d55', '#ffb13b'], kiColor: '#7fdcff', hit: '#ffe066', stats: [['PUISSANCE', 4], ['VITESSE', 3], ['PORTÉE', 2]],
    labels: { blast: "VAGUE D'ÉNERGIE", ultra: 'SPHÈRE ULTIME' },
    forms: [{ ki: 50, name: 'FORME DORÉE', sheet: 'gold', speed: 1.2, dmg: 1.6, at: 0.95, end: 1.35, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066' }],
    moves: MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'spinkick', 'roundhouse'], launcher: 'uppercut' },
    special: 'blast', speed: 250, pose: heroPose, ultra: [startUltra, updateUltraPose],
  },
  luffy: {
    name: 'LUFFY', title: 'Le pirate élastique', sheet: 'luffy', card: 'card_luffy',
    colors: ['#e8202a', '#ffd23b'], kiColor: '#ffd27f', hit: '#fff3b0', stats: [['PUISSANCE', 3], ['VITESSE', 4], ['PORTÉE', 5]],
    labels: { blast: 'BAZOOKA', ultra: 'GIGANT PISTOL' },
    forms: [
      { ki: 50, name: 'GEAR SECOND', filter: 'sepia(0.35) saturate(1.8) hue-rotate(-25deg) brightness(1.08)', speed: 1.35, dmg: 1.5, at: 0.6, end: 1.0, steam: true, bar: ['#ff6a6a', '#ffd0d0'], color: '#ffffff' },
      // Chargé à bloc : le Gear 5, tout blanc, avec son nuage autour du cou
      { ki: 100, name: 'GEAR 5', sheet: 'luffy5', speed: 1.4, dmg: 1.9, at: 0.6, end: 1.1, cloud: true, aura: ['rgba(255,255,255,0.45)', '#ffffff'], bar: ['#d9d2ff', '#ffffff'], color: '#ffffff', hit: '#ffffff' },
    ],
    moves: L_MOVES, chain: { punch: ['punch', 'punch2', 'gatling'], kick: ['kick', 'whip', 'axe'], launcher: 'rocket' },
    special: 'bazooka', speed: 265, pose: luffyPose, ultra: [startGigant, updateGigant],
  },
  goku: {
    name: 'SANGOKU', title: 'Le saiyan au grand cœur', sheet: 'goku', card: 'card_goku',
    colors: ['#ff7a1a', '#3a6bff'], kiColor: '#8fe9ff', hit: '#bff3ff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'KAMEHAMEHA', ultra: 'GENKIDAMA' },
    // Formes par paliers (formSteps) : Super Saiyan, puis Blue, puis Ultra Instinct, une transformation à la fois.
    // Planches à part ; tant que celles de Blue / Ultra Instinct manquent, celles du Super Saiyan teintées (fallback).
    formSteps: true,
    forms: [
      { ki: 50, name: 'SUPER SAIYAN', sheet: 'goku_ssj', speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066', hit: '#fff3b0' },
      { ki: 75, name: 'SUPER SAIYAN BLUE', sheet: 'goku_blue', fallback: ['goku_ssj', 'hue-rotate(165deg) saturate(1.5) brightness(1.08)'], speed: 1.42, dmg: 2.0, at: 0.6, end: 1.0,
        aura: ['rgba(70,200,255,0.6)', '#4fd2ff'], sparks: true, glow: '#2ab4ff', bar: ['#0a5ad0', '#9fe8ff'], color: '#7fe0ff', hit: '#d8f6ff' },
      // Ultra Instinct : le corps esquive seul une partie des coups (dodge)
      { ki: 100, name: 'ULTRA INSTINCT', sheet: 'goku_ui', fallback: ['goku_ssj', 'grayscale(1) brightness(1.3) contrast(1.05)'], speed: 1.55, dmg: 2.2, at: 0.6, end: 1.1,
        aura: ['rgba(200,220,255,0.55)', '#dfeaff'], sparks: '#eef6ff', glow: '#a9c4ff', dodge: 0.45, bar: ['#5a6aa8', '#ffffff'], color: '#e8f0ff', hit: '#ffffff' },
    ],
    moves: GK_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback', 'telekick'], launcher: 'uppercut' },
    special: 'kamehameha', speed: 260, pose: stdPose, ultra: [startGenki, updateGenki], ultraPose: genkiPose,
  },
  gohan: {
    name: 'GOHAN', title: 'Le fils de la colère', sheet: 'gohan', card: 'card_gh',
    colors: ['#5a2a8a', '#ffd84a'], kiColor: '#fff07a', hit: '#fff3b0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'MASENKO', ultra: 'KAMEHAMEHA PÈRE-FILS' },
    // Super Saiyan 2 : cheveux dorés dressés (planches à part), éclairs bleus autour du corps
    forms: [{ ki: 50, name: 'SUPER SAIYAN 2', sheet: 'gohan_ssj', speed: 1.35, dmg: 1.9, at: 0.6, end: 1.0, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066', hit: '#fff3b0' }],
    moves: GH_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'masenko', speed: 265, pose: stdPose, ultra: [startFatherSon, updateFatherSon], extraSheets: ['goku'], // l'esprit de Sangoku
    ultraPose: h => ['special', h.t < 0.5 ? 4 : h.t < FSK.fire ? 5 : h.t < FSK.fire + 0.5 ? 6 : 7],
  },
  zoro: {
    name: 'ZORO', title: 'Le sabreur aux trois lames', sheet: 'zoro', card: 'card_zoro',
    colors: ['#1f8a3a', '#e8f5d0'], kiColor: '#b8ffcf', hit: '#e8fff0', trail: '#e9fff2', stats: [['PUISSANCE', 5], ['VITESSE', 3], ['PORTÉE', 4]],
    labels: { blast: '36 POUND HO', ultra: 'SANZEN SEKAI' },
    forms: [{ ki: 50, name: 'ASURA', filter: 'contrast(1.2) brightness(0.92) saturate(1.2)', speed: 1.2, dmg: 1.8, at: 0.6, end: 1.0, aura: ['rgba(120,20,90,0.55)', '#b04bff'], ghosts: true, bar: ['#6a1b8a', '#d08bff'], color: '#c070ff', trail: '#e3b8ff' }],
    moves: Z_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'], launcher: 'rising' },
    special: 'poundho', speed: 240, pose: stdPose, ultra: [startSanzen, updateSanzen], chargeFrame: 6,
    ultraPose: h => h.t < SANZEN.spin ? ['special', 4 + Math.floor(h.t * 14) % 3] : h.t < SANZEN.dash ? ['dashcharge', 1] : ['dashcharge', h.t < SANZEN.dash + 0.25 ? 2 : 3],
  },
  naruto: {
    name: 'NARUTO', title: 'Le ninja de Konoha', sheet: 'naruto', card: 'card_naruto',
    colors: ['#ff8a00', '#2a5cff'], kiColor: '#8fd0ff', hit: '#cfeaff', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'RASENGAN', ultra: 'MULTI-CLONAGE' },
    // La rage : le manteau de chakra rouge du démon renard, avec ses queues
    forms: [{ ki: 50, name: 'CHAKRA DU RENARD', filter: 'sepia(0.3) saturate(1.5) hue-rotate(-20deg) brightness(1.04) drop-shadow(0 0 5px rgba(255,20,0,0.95)) drop-shadow(0 0 12px rgba(230,0,0,0.7))', speed: 1.3, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(255,40,20,0.55)', '#ff3a1a'], foxCloak: 3, bar: ['#c01010', '#ff8a50'], color: '#ff3a1a', hit: '#ffb090' }],
    moves: N_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'sidekick', 'axekick'], launcher: 'uppercut' },
    special: 'rasengan', speed: 280, pose: stdPose, ultra: [startBunshin, updateBunshin],
    ultraPose: h => h.t < BUNSHIN.finale ? ['dashcharge', 4 + Math.floor(h.t * 6) % 2] : ['special', h.t < BUNSHIN.finale + 0.25 ? 2 : 3],
  },
  tanjiro: {
    name: 'TANJIRO', title: 'Le pourfendeur de démons', sheet: 'tanjiro', card: 'card_tanjiro',
    colors: ['#1f6f5a', '#5ad1ff'], kiColor: '#8fe0ff', hit: '#bdf0ff', trail: '#5ad1ff', element: 'water', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'SURFACE DE L\'EAU', ultra: 'DANSE DU DIEU DU FEU' },
    forms: [{ ki: 50, name: 'HINOKAMI KAGURA', filter: 'sepia(0.3) saturate(1.5) hue-rotate(-12deg) brightness(1.06)', speed: 1.2, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,110,20,0.5)', '#ff8a2a'], flames: true, bar: ['#ff5a00', '#ffd060'], color: '#ff8a2a', trail: '#ff8a2a', element: 'fire', hit: '#ffd0a0' }],
    moves: T_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'], launcher: 'rising' },
    special: 'surface', speed: 255, pose: stdPose, ultra: [startHinokami, updateHinokami],
    ultraPose: h => ['special', 4 + step(h.t, [0.4, 0.8, 1.2])],
  },
  kenshin: {
    name: 'KENSHIN', title: 'Le vagabond au sabre inversé', sheet: 'kenshin', card: 'card_kenshin',
    colors: ['#c2185b', '#ffe0ef'], kiColor: '#ffc0dc', hit: '#ffe0ef', trail: '#ffd6e8', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'DO RYU SEN', ultra: 'AMAKAKERU RYU' },
    forms: [{ ki: 50, name: 'BATTOSAI', filter: 'contrast(1.18) saturate(0.85) brightness(0.92)', speed: 1.25, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(150,0,30,0.5)', '#ff3355'], bar: ['#8a0020', '#ff5070'], color: '#ff3355', trail: '#ff5070', hit: '#ffb0c0' }],
    moves: KS_MOVES, chain: { punch: ['punch', 'cross', 'ryusho'], kick: ['kick', 'ryukan', 'ryutsui'], launcher: 'ryusho' },
    special: 'doryu', speed: 275, pose: stdPose, ultra: [startAmakakeru, updateAmakakeru],
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < AMA.dash ? 5 : h.t < AMA.dashEnd ? 6 : 7],
  },
  sasuke: {
    name: 'SASUKE', title: 'Le vengeur au Sharingan', sheet: 'sasuke', card: 'card_sk',
    colors: ['#2a2a5a', '#b9a0ff'], kiColor: '#b9d8ff', hit: '#dfe8ff', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'CHIDORI', ultra: 'KIRIN' },
    forms: [{ ki: 50, name: 'SHARINGAN', filter: 'contrast(1.12) saturate(1.15)', speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(120,60,200,0.45)', '#9a6aff'], bar: ['#3a1a8a', '#b9a0ff'], color: '#b9a0ff',
             glow: '#7a4aff', arcs: 'hue-rotate(40deg) saturate(1.2) brightness(1.2)', handArcs: true }],
    moves: SK_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'chidori', speed: 270, pose: stdPose, ultra: [startKirin, updateKirin], chargeFrame: 5,
    ultraPose: h => ['special', h.t < 0.45 ? 4 : h.t < KIRIN.strike ? 5 : h.t < KIRIN.strike + 0.4 ? 6 : 7],
  },
  inosuke: {
    name: 'INOSUKE', title: 'Le roi de la montagne', sheet: 'inosuke', card: 'card_in',
    colors: ['#3a4a6a', '#9fc8ff'], kiColor: '#bfe0ff', hit: '#e0f0ff', trail: '#a8d0ff', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'CROCS DE LA BÊTE', ultra: 'RUÉE DU SANGLIER' },
    forms: [{ ki: 50, name: 'SOUFFLE DE LA BÊTE', filter: 'contrast(1.15) saturate(1.2)', speed: 1.35, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(120,170,255,0.45)', '#8fc0ff'], ghosts: true, bar: ['#2a4a8a', '#bfe0ff'], color: '#8fc0ff', trail: '#cfe6ff' }],
    moves: IN_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'], launcher: 'rising' },
    special: 'fang', speed: 280, pose: stdPose, ultra: [startSanzen, updateSanzen], chargeFrame: 5,
    ultraPose: h => h.t < SANZEN.spin ? (Math.floor(h.t * 12) % 2 ? ['combo', 6] : ['special', 5]) : h.t < SANZEN.dash ? ['special', 6] : ['special', 7],
  },
  trunks: {
    name: 'TRUNKS', title: 'Le guerrier venu du futur', sheet: 'trunks', card: 'card_tr',
    colors: ['#24408a', '#c9a8ff'], kiColor: '#fff07a', hit: '#fff3b0', trail: '#ffffff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'BURNING ATTACK', ultra: 'SHINING SWORD ATTACK' },
    // Super Saiyan : planches aux cheveux dorés (trunks_ssj) ; tant qu'elles manquent, la planche normale dorée et un halo
    forms: [{ ki: 50, name: 'SUPER SAIYAN', sheet: 'trunks_ssj', fallback: ['trunks', 'sepia(0.55) saturate(2.2) hue-rotate(-8deg) brightness(1.15)'], speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066', hit: '#fff3b0' }],
    moves: TR_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'burning', speed: 265, pose: stdPose, ultra: [startShining, updateShining],
    ultraPose: h => ['special', h.t < SHINE.leap ? 4 : h.t < SHINE.cut ? 5 : h.t < SHINE.blast ? 6 : h.t < SHINE.blast + 0.3 ? 2 : 7],
  },
  ace: {
    name: 'ACE', title: 'Le poing ardent', sheet: 'ace', card: 'card_ac',
    colors: ['#ff6a00', '#2a1a10'], kiColor: '#ffb040', hit: '#ffd0a0', trail: '#ff9a3a', element: 'fire', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'HIKEN', ultra: 'ENTEI' },
    // Logia du feu : le corps devient flammes
    forms: [{ ki: 50, name: 'CORPS DE FLAMMES', filter: 'sepia(0.3) saturate(1.6) hue-rotate(-15deg) brightness(1.08)', speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,110,20,0.55)', '#ff8a2a'], flames: true, bar: ['#ff5a00', '#ffd060'], color: '#ff8a2a', hit: '#ffd0a0' }],
    moves: AC_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'hiken', speed: 265, pose: stdPose, ultra: [startUltra, updateUltraPose],
    ultraPose: h => ['special', h.t < 0.35 ? 4 : h.t < ULTRA.throwAt ? 6 : 2],
  },
  guts: {
    name: 'GUTS', title: 'Le guerrier noir', sheet: 'guts', card: 'card_gt',
    colors: ['#1a1a1e', '#b01a1a'], kiColor: '#ff6060', hit: '#ffb0b0', trail: '#dcdcdc', stats: [['PUISSANCE', 5], ['VITESSE', 2], ['PORTÉE', 5]],
    labels: { blast: 'CANON DU BRAS', ultra: 'TUEUR DE DRAGONS' },
    // l'armure du Berserker : il ne sent plus les coups, les yeux rouges dans le heaume
    forms: [{ ki: 50, name: 'ARMURE DU BERSERKER', filter: 'brightness(0.72) contrast(1.3) saturate(0.85)', speed: 1.2, dmg: 1.9, at: 0.6, end: 1.0, aura: ['rgba(140,0,0,0.55)', '#d01818'], glow: '#ff1010', ghosts: true, bar: ['#3a0000', '#ff3030'], color: '#ff3030', trail: '#ff5050', hit: '#ffb0b0' }],
    moves: GT_MOVES, chain: { punch: ['smash', 'sweep', 'thrust'], kick: ['spin', 'heavy'], launcher: 'risecut' },
    special: 'cannon', speed: 225, pose: stdPose, ultra: [startDragonslayer, updateDragonslayer],
    ultraPose: h => ['special', h.t < DRAGON.leap ? 4 : h.t < DRAGON.cut ? 5 : h.t < DRAGON.blast ? 6 : h.t < DRAGON.blast + 0.35 ? 2 : 7],
  },
  sanji: {
    name: 'SANJI', title: 'La jambe noire', sheet: 'sanji', card: 'card_sj',
    colors: ['#16161c', '#f2d64a'], kiColor: '#ffb040', hit: '#ffd0a0', trail: '#ffffff', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'DIABLE JAMBE', ultra: 'HELL MEMORIES' },
    // Diable Jambe : la jambe reste en feu, chaque coup de pied brûle
    forms: [{ ki: 50, name: 'DIABLE JAMBE', filter: 'saturate(1.25) contrast(1.08)', speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,90,20,0.45)', '#ff6a1a'], legFire: true, bar: ['#c02000', '#ffb040'], color: '#ff6a1a', trail: '#ffb040', hit: '#ffd0a0', element: 'fire' }],
    moves: SJ_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'diable', speed: 285, pose: stdPose, ultra: [startHellMemories, updateHellMemories],
    ultraPose: h => ['special', h.t < HELL.leap ? 0 : h.t < HELL.rise ? 4 : h.t < HELL.slam ? 5 : h.t < HELL.slam + 0.35 ? 6 : 7],
  },
  shoto: {
    name: 'SHOTO', title: 'Glace et feu', sheet: 'shoto', card: 'card_st',
    colors: ['#1c2a6a', '#e8f4ff'], kiColor: '#9fe0ff', hit: '#dff6ff', trail: '#cfefff', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 5]],
    labels: { blast: 'MUR DE GLACE', ultra: 'GLACIER ET BRASIER' },
    // les deux moitiés réveillées : givre d'un côté, flammes de l'autre
    forms: [{ ki: 50, name: 'GLACE ET FEU', filter: 'contrast(1.1) saturate(1.2)', speed: 1.25, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(150,210,255,0.45)', '#ff7a3a'], fireIce: true, bar: ['#2a7ad0', '#ff8a3a'], color: '#9fe0ff', trail: '#ffb070', hit: '#dff6ff' }],
    moves: ST_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'icewall', speed: 265, pose: stdPose, ultra: [startGlacier, updateGlacier],
    ultraPose: h => ['special', h.t < 0.3 ? 0 : h.t < GLACIER.ice ? 1 : h.t < GLACIER.ice + 0.3 ? 2 : h.t < GLACIER.fire - 0.2 ? 4 : h.t < GLACIER.fire ? 5 : h.t < GLACIER.end - 0.2 ? 6 : 7],
  },
  saber: {
    name: 'SABER', title: 'Le roi chevalier', sheet: 'saber', card: 'card_sb',
    colors: ['#2a4aa8', '#f2d64a'], kiColor: '#ffe680', hit: '#fff6c0', trail: '#fff2a0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'STRIKE AIR', ultra: 'EXCALIBUR' },
    // le vent qui cachait la lame se lève : Excalibur apparaît, dorée
    forms: [{ ki: 50, name: 'EXCALIBUR RÉVÉLÉE', filter: 'brightness(1.08) saturate(1.15)', speed: 1.25, dmg: 1.8, at: 0.6, end: 1.0, aura: ['rgba(255,215,90,0.55)', '#ffe066'], glow: '#fff0a0', bar: ['#c09000', '#fff2a0'], color: '#ffe680', trail: '#fff2a0', hit: '#fff6c0' }],
    moves: SB_MOVES, chain: { punch: ['smash', 'sweep', 'thrust'], kick: ['spin', 'heavy'], launcher: 'risecut' },
    special: 'strikeair', speed: 260, pose: stdPose, ultra: [startExcalibur, updateExcalibur],
    ultraPose: h => h.t < EXCAL.raise ? ['special', 4] : h.t < EXCAL.slash ? ['special', 5] : h.t < EXCAL.beam ? ['special', 6] : h.t < EXCAL.end - 0.15 ? ['combo', 6] : ['special', 7],
  },
  mikasa: {
    name: 'MIKASA', title: 'La soldate Ackerman', sheet: 'mikasa', card: 'card_mk',
    colors: ['#6a4a2a', '#c8102e'], kiColor: '#ff6070', hit: '#ffd0d0', trail: '#e8eef4', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'TOUPIE', ultra: 'ASSAUT TRIDIMENSIONNEL' },
    // le sang Ackerman se réveille : plus vite, plus fort, l'écharpe rouge laisse une traînée
    forms: [{ ki: 50, name: 'ACKERMAN', filter: 'contrast(1.12) saturate(1.1)', speed: 1.4, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(200,20,30,0.4)', '#e02030'], ghosts: true, bar: ['#800010', '#ff4050'], color: '#ff4050', trail: '#ff3040', hit: '#ffd0d0' }],
    moves: MK_MOVES, chain: { punch: ['smash', 'sweep', 'thrust'], kick: ['spin', 'heavy'], launcher: 'risecut' },
    special: 'toupie', speed: 285, pose: stdPose, ultra: [startOdm, updateOdm],
    ultraPose: h => h.t < ODM.start ? ['dashcharge', 0] : h.t < ODM.start + ODM.passes * ODM.pass ? ['dashcharge', 2] : h.t < ODM.end - 0.3 ? ['special', 6] : ['special', 7],
  },
  revy: {
    name: 'REVY', title: 'Two Hands', sheet: 'revy', card: 'card_rv',
    colors: ['#1a1a1a', '#7a1c2a'], kiColor: '#ff7060', hit: '#ffe0b0', trail: '#fff0c0', stats: [['PUISSANCE', 3], ['VITESSE', 5], ['PORTÉE', 5]],
    labels: { blast: 'TWO HANDS', ultra: 'PLUIE DE BALLES' },
    // Two Hands : la cadence double, une balle de chaque pistolet à chaque tir
    forms: [{ ki: 50, name: 'TWO HANDS', filter: 'contrast(1.12) saturate(1.15)', speed: 1.25, dmg: 1.5, at: 0.6, end: 1.0, aura: ['rgba(220,40,40,0.45)', '#ff4040'], rapid: true, bar: ['#901010', '#ff6060'], color: '#ff5050', trail: '#ffd0a0', hit: '#ffe0b0' }],
    moves: RV_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'twohands', speed: 275, pose: stdPose, ultra: [startBulletRain, updateBulletRain],
    ultraPose: h => h.t < RAIN.leap ? ['special', 4] : h.t < RAIN.end - RAIN.land ? ['special', Math.floor(h.t * 9) % 2 ? 6 : 5] : h.t < RAIN.end - 0.2 ? ['special', 2] : ['special', 7],
  },
  gally: {
    name: 'GALLY', title: 'L\'ange de la ferraille', sheet: 'gally', card: 'card_ga',
    colors: ['#18181e', '#c8203a'], kiColor: '#7ac8ff', hit: '#d8f0ff', trail: '#cfe8ff', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'FRAPPE DE PAUME', ultra: 'PANZER KUNST' },
    // corps du Berserker : les jointures du corps cybernétique s'allument en bleu, elle va plus vite
    forms: [{ ki: 50, name: 'BERSERKER BODY', filter: 'contrast(1.1) saturate(1.2)', speed: 1.4, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(80,160,255,0.45)', '#5ab0ff'], glow: '#7ac8ff', ghosts: true, bar: ['#1050a0', '#7ac8ff'], color: '#7ac8ff', trail: '#bfe4ff', hit: '#d8f0ff' }],
    moves: GA_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'palm', speed: 285, pose: stdPose, ultra: [startPanzer, updatePanzer],
    ultraPose: h => h.t < PANZER.rush ? ['special', 0] : h.t < PANZER.leap ? ['combo', [1, 2, 5, 6][Math.floor(h.t / 0.1) % 4]] : h.t < PANZER.kick ? ['special', 5] : h.t < PANZER.palm ? ['special', 6] : h.t < PANZER.end - 0.2 ? ['special', 2] : ['special', 3],
  },

  levi: {
    name: 'LIVAÏ', title: 'Le soldat le plus fort de l\'humanité', sheet: 'levi', card: 'card_lv',
    colors: ['#6a4a2a', '#e8eef4'], kiColor: '#bfe0ff', hit: '#e8f4ff', trail: '#e8eef4', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'CYCLONE', ultra: 'TOURBILLON DU CAPITAINE' },
    // le soldat le plus fort de l'humanité : encore plus vif, une traînée blanche derrière chaque geste
    forms: [{ ki: 50, name: 'SOLDAT DE L\'HUMANITÉ', filter: 'contrast(1.15) saturate(0.95)', speed: 1.45, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(200,225,255,0.4)', '#cfe4ff'], ghosts: true, bar: ['#304a6a', '#e0f0ff'], color: '#dfeeff', trail: '#ffffff', hit: '#f0f8ff' }],
    moves: LV_MOVES, chain: { punch: ['smash', 'sweep', 'thrust'], kick: ['spin', 'heavy'], launcher: 'risecut' },
    special: 'cyclone', speed: 290, pose: stdPose, ultra: [startSpiral, updateSpiral],
    ultraPose: h => h.t < SPIRAL.start ? ['special', 0] : h.t < SPIRAL.start + SPIRAL.run ? ['special', Math.floor(h.t * 12) % 2 ? 2 : 1] : h.t < SPIRAL.end - 0.25 ? ['special', 6] : ['special', 7],
  },  baki: {
    name: 'BAKI', title: 'Le fils de l\'ogre', sheet: 'baki', card: 'card_bk',
    colors: ['#1a1a1a', '#c0281e'], kiColor: '#ff5040', hit: '#ffd0c0', trail: '#ffe0d0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'FRAPPE FOUET', ultra: 'ASSAUT DU GRAPPLER' },
    // les muscles du dos dessinent un visage de démon ; le spécial devient le direct dévastateur
    forms: [{ ki: 50, name: 'DOS DU DÉMON', filter: 'contrast(1.15) saturate(1.2) brightness(0.96)', speed: 1.2, dmg: 1.9, at: 0.6, end: 1.0, aura: ['rgba(150,10,20,0.5)', '#b01020'], glow: '#a0101a', demon: true, bar: ['#600008', '#ff4030'], color: '#ff4030', hit: '#ffc0b0' }],
    moves: BK_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'whip', special2: 'demonfist', speed: 255, pose: stdPose, ultra: [startGrappler, updateGrappler],
    ultraPose: h => h.t < GRAPPLER.rush ? ['special', 4] : h.t < GRAPPLER.whip ? ['combo', Math.floor(h.t / GRAPPLER.every) % 2 ? 2 : 1] : h.t < GRAPPLER.fist - 0.15 ? ['special', 2] : h.t < GRAPPLER.fist ? ['special', 5] : h.t < GRAPPLER.end - 0.2 ? ['special', 6] : ['special', 7],
  },
  itachi: {
    name: 'ITACHI', title: 'Le génie du clan Uchiha', sheet: 'itachi', card: 'card_it',
    colors: ['#121218', '#c81e2a'], kiColor: '#ff3040', hit: '#ffc8c8', trail: '#ffd0d0', element: 'fire', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 5]],
    labels: { blast: 'KATON', ultra: 'SUSANOO' },
    // Mangekyô Sharingan : les yeux s'allument en rouge, des corbeaux s'envolent ; le spécial devient Amaterasu
    forms: [{ ki: 50, name: 'MANGEKYÔ SHARINGAN', filter: 'contrast(1.12) saturate(1.1)', speed: 1.25, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(200,20,40,0.45)', '#ff2a3a'], glow: '#c0101e', eyes: true, crows: true, bar: ['#80000c', '#ff5060'], color: '#ff3a4a', hit: '#ffc8c8' }],
    moves: IT_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'katon', special2: 'amaterasu', speed: 260, pose: stdPose, ultra: [startSusanoo, updateSusanoo],
    ultraPose: h => h.t < SUSANOO.rise ? ['dashcharge', 5] : h.t < SUSANOO.slash ? ['special', 6] : ['special', 7],
  },
  eren: {
    name: 'EREN', title: "L'Assaillant", sheet: 'eren', card: 'card_er',
    colors: ['#6a4a2a', '#3aa860'], kiColor: '#ffd060', hit: '#fff0c0', trail: '#f2eee0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'ATTAQUE AUX LAMES', ultra: 'TITAN ASSAILLANT' },
    // il se mord la main (dashcharge 5) : éclair jaune, vapeur ; le spécial devient le poing du Titan
    forms: [{ ki: 50, name: 'POUVOIR DU TITAN', filter: 'contrast(1.12) saturate(1.1)', speed: 1.25, dmg: 1.8, at: 0.6, end: 1.0, aura: ['rgba(255,215,110,0.4)', '#ffd870'], steam: true, arcs: 'hue-rotate(-70deg) saturate(1.6) brightness(1.2)', arcRate: 0.12, bar: ['#6a3a10', '#ffd860'], color: '#ffd060', hit: '#fff0c0' }],
    moves: ER_MOVES, chain: { punch: ['smash', 'sweep', 'thrust'], kick: ['spin', 'heavy'], launcher: 'risecut' },
    special: 'erblades', special2: 'titanfist', speed: 275, pose: stdPose, ultra: [startTitan, updateTitan],
    ultraPose: h => h.t < TITAN.rise ? ['dashcharge', h.t < 0.35 ? 4 : 5] : h.t < TITAN.punch - 0.15 ? ['dashcharge', 6] : h.t < TITAN.punch ? ['special', 5] : h.t < TITAN.end - 0.3 ? ['special', 6] : ['special', 7],
  },
  boruto: {
    name: 'BORUTO', title: 'Le fils du Hokage', sheet: 'boruto', card: 'card_bo',
    colors: ['#1a1a1a', '#f0d040'], kiColor: '#7fd0ff', hit: '#d8f0ff', trail: '#bfe8ff', stats: [['PUISSANCE', 3], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'RASENGAN ÉVANESCENT', ultra: 'RASENGAN DES TROIS' },
    // Jôgan : l'œil droit s'allume en bleu, aura bleutée
    forms: [{ ki: 50, name: 'JÔGAN', filter: 'contrast(1.1) saturate(1.1)', speed: 1.3, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(120,200,255,0.4)', '#8fd8ff'], glow: '#60b8ff', eyes: true, eyeCol: 'rgba(120,215,255,0.95)', oneEye: true, bar: ['#103a6a', '#bfe8ff'], color: '#9fdcff', hit: '#e0f4ff' }],
    moves: BO_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'vrasen', speed: 280, pose: stdPose, ultra: [startBoru, updateBoru],
    ultraPose: h => h.t < BORU.clones ? ['special', 4] : h.t < BORU.throw - 0.25 ? ['special', 0] : h.t < BORU.throw - 0.08 ? ['special', 1] : h.t < BORU.end - 0.3 ? ['special', 2] : ['special', 7],
  },
  edward: {
    name: 'EDWARD', title: 'L\'alchimiste d\'acier', sheet: 'edward', card: 'card_ed',
    colors: ['#a0141e', '#f0c84a'], kiColor: '#7fd0ff', hit: '#d8f0ff', trail: '#bfe8ff', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'TRANSMUTATION', ultra: 'GRANDE TRANSMUTATION' },
    // bras-lame : l'automail devient une lame, des éclairs bleus d'alchimie courent sur le bras ; le spécial devient l'entaille
    forms: [{ ki: 50, name: 'BRAS-LAME', filter: 'contrast(1.1) saturate(1.1)', speed: 1.25, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(120,200,255,0.4)', '#8fd8ff'], glow: '#5ab8ff',
             arcs: 'hue-rotate(95deg) saturate(1.3) brightness(1.3)', handArcs: true, bar: ['#103a6a', '#bfe8ff'], color: '#9fdcff', hit: '#e0f4ff' }],
    moves: ED_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'transmute', special2: 'armblade', speed: 270, pose: stdPose, ultra: [startAlchemy, updateAlchemy],
    ultraPose: h => h.t < ALCH.clap ? ['special', 0] : h.t < ALCH.clap + 0.15 ? ['special', 1] : h.t < ALCH.end - 0.3 ? ['special', 2] : ['special', 3],
  },
  gintoki: {
    name: 'GINTOKI', title: 'Le démon blanc', sheet: 'gintoki', card: 'card_gi',
    colors: ['#f0f4ff', '#3a6ab8'], kiColor: '#e8f0ff', hit: '#ffffff', trail: '#f0f0ff', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 5]],
    labels: { blast: 'DÉMON BLANC', ultra: 'GIN-SAN EST SÉRIEUX' },
    // Shiroyasha : l'ancien démon blanc de la guerre se réveille, aura blanche, plus vif ; le spécial devient le coup écrasant
    forms: [{ ki: 50, name: 'SHIROYASHA', filter: 'contrast(1.12) brightness(1.05) saturate(0.9)', speed: 1.4, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(240,245,255,0.5)', '#ffffff'], glow: '#e8f0ff', ghosts: true, bar: ['#5a6a88', '#ffffff'], color: '#ffffff', trail: '#ffffff', hit: '#ffffff' }],
    moves: GI_MOVES, chain: { punch: ['smash', 'sweep', 'thrust'], kick: ['spin', 'heavy'], launcher: 'risecut' },
    special: 'shirodemon', special2: 'gicrush', speed: 270, pose: stdPose, ultra: [startGinsan, updateGinsan],
    ultraPose: h => h.t < GINSAN.lazy ? ['dashcharge', 5] : h.t < GINSAN.rushEnd ? ['combo', [2, 5, 6, 7][Math.floor((h.t - GINSAN.lazy) / GINSAN.every) % 4]] : h.t < GINSAN.smash ? ['special', 5] : h.t < GINSAN.end - 0.3 ? ['special', 6] : ['special', 7],
  },  naruto_s: {
    name: 'NARUTO', title: 'Le ninja de Konoha, trois ans plus tard', sheet: 'naruto_s', card: 'card_ns',
    colors: ['#1a1a1a', '#ff9a1a'], kiColor: '#8fd0ff', hit: '#cfeaff', trail: '#bfe8ff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'RASENGAN', ultra: 'RASEN-SHURIKEN GÉANT' },
    // Mode Kyûbi (24/10, demandé à la place du Mode Ermite) : tout le corps passe au chakra doré, les vêtements sombres
    // restent sombres et font les marques noires ; liseré lumineux, aura et flammèches dorées ; le spécial devient le Rasen-shuriken
    forms: [{ ki: 50, name: 'MODE KYÛBI', filter: 'sepia(1) saturate(3.4) hue-rotate(-6deg) brightness(1.22) contrast(1.18) drop-shadow(0 0 3px rgba(255,236,120,0.95)) drop-shadow(0 0 10px rgba(255,180,30,0.75))',
             speed: 1.3, dmg: 1.8, at: 0.6, end: 1.0, aura: ['rgba(255,210,60,0.55)', '#ffd84a'], goldCloak: true, eyes: true, eyeCol: 'rgba(255,120,20,0.95)', bar: ['#a06a00', '#fff07a'], color: '#ffd84a', trail: '#fff2a0', hit: '#fff0a0' }],
    moves: NS_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'rasengan', special2: 'rshuriken', speed: 285, pose: stdPose, ultra: [startShuriken, updateShuriken],
    ultraPose: h => h.t < RSH.throwAt - 0.35 ? ['special', 4] : h.t < RSH.throwAt ? ['special', 5] : h.t < RSH.end - 0.25 ? ['special', 6] : ['special', 7],
  },


  kakashi: {
    name: 'KAKASHI', title: 'Le ninja copieur', sheet: 'kakashi', card: 'card_ka',
    colors: ['#4a6b8a', '#9fd0ff'], kiColor: '#9fd0ff', hit: '#cfe8ff', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'CHIDORI', ultra: 'KAMUI' },
    forms: [{ ki: 50, name: 'SHARINGAN', filter: 'contrast(1.12) saturate(1.2)', speed: 1.25, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(200,20,40,0.45)', '#ff3a4a'], bar: ['#a0001a', '#ff6070'], color: '#ff3a4a',
             glow: '#ff2a3a', arcs: 'hue-rotate(95deg) saturate(1.2) brightness(1.2)', handArcs: true }],
    moves: KA_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'chidori', speed: 265, pose: stdPose, ultra: [startKamui, updateKamui], chargeFrame: 5,
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.8 ? 5 : h.t < 1.8 ? 6 : 7],
  },
  ichigo: {
    name: 'ICHIGO', title: 'Le shinigami remplaçant', sheet: 'ichigo', card: 'card_ic',
    colors: ['#1a1a24', '#ff8a2a'], kiColor: '#bfe8ff', hit: '#e8f6ff', trail: '#cfeeff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'GETSUGA TENSHO', ultra: 'MUGETSU' },
    forms: [{ ki: 50, name: 'BANKAI', filter: 'contrast(1.25) brightness(0.86)', speed: 1.45, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(120,0,20,0.6)', '#ff2030'], bar: ['#3a0008', '#ff3040'], color: '#ff2030', trail: '#ff5060', hit: '#ffb0b0', proj: 'hue-rotate(160deg) saturate(1.6) brightness(0.9)' }],
    moves: IC_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'], launcher: 'rising' },
    special: 'getsuga', speed: 255, pose: stdPose, ultra: [startMugetsu, updateMugetsu],
    ultraPose: h => ['special', step(h.t, [0.35, 0.7, 1.4]) + 4],
  },
  zenitsu: {
    name: 'ZENITSU', title: 'Le souffle de la foudre', sheet: 'zenitsu', card: 'card_ze',
    colors: ['#f2b705', '#fff3a0'], kiColor: '#ffe680', hit: '#fff6b0', trail: '#ffe14d', element: 'thunder', stats: [['PUISSANCE', 3], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'HEKIREKI ISSEN', ultra: 'SHINSOKU' },
    forms: [{ ki: 50, name: 'ENDORMI', filter: 'brightness(1.08) saturate(1.2)', speed: 1.55, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(255,220,60,0.5)', '#ffe14d'], sparks: '#fff6b0', bar: ['#d0a000', '#fff07a'], color: '#ffe14d' }],
    moves: ZE_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'], launcher: 'rising' },
    special: 'hekireki', speed: 270, pose: stdPose, ultra: [startZigzag, updateZigzag], chargeFrame: 5,
    ultraPose: h => h.zz && h.t > ZIG.start ? ['special', 6 + Math.floor(h.t * 10) % 2] : ['special', 4 + step(h.t, [0.3])],
  },
  izuku: {
    name: 'IZUKU', title: 'Le héros One For All', sheet: 'izuku', card: 'card_iz',
    colors: ['#1d6b45', '#7dff9a'], kiColor: '#9dffb0', hit: '#d8ffe0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'BLACK WHIP', ultra: 'UNITED STATES OF SMASH' },
    forms: [{ ki: 50, name: 'DARK DEKU', sheet: 'izuku_dark', speed: 1.45, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(20,120,60,0.55)', '#3dff7a'], arcs: true, arcRate: 0.1, bar: ['#0a4a24', '#5dff8a'], color: '#3dff7a' }],
    moves: IZ_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'blackwhip', speed: 265, pose: stdPose, ultra: [startSmash, updateSmash],
    ultraPose: h => ['special', h.t < 0.5 ? 4 : h.t < SMASH.hit - 0.1 ? 5 : h.t < SMASH.hit + 0.4 ? 6 : 7],
  },
  vegeta: {
    name: 'VEGETA', title: 'Le prince des saiyans', sheet: 'vegeta', card: 'card_ve',
    colors: ['#2a2f8a', '#ffd23b'], kiColor: '#c9a0ff', hit: '#e8d0ff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'GALICK GUN', ultra: 'FINAL FLASH' },
    forms: [{ ki: 50, name: 'SUPER SAIYAN', sheet: 'vegeta_ssj', speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066', hit: '#fff3b0' }],
    moves: VE_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'galick', speed: 255, pose: stdPose, ultra: [startFinalFlash, updateFinalFlash],
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.75 ? 5 : h.t < 0.95 ? 6 : 7],
  },
  gon: {
    name: 'GON', title: 'Le jeune hunter', sheet: 'gon', card: 'card_go',
    colors: ['#2e8b3e', '#ffe14d'], kiColor: '#ffe680', hit: '#fff3b0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'JAJANKEN', ultra: 'GON ADULTE' },
    forms: [{ ki: 50, name: 'COLÈRE', filter: 'contrast(1.2) brightness(0.9)', speed: 1.3, dmg: 1.9, at: 0.6, end: 1.0, aura: ['rgba(255,200,40,0.45)', '#ffd23b'], bar: ['#8a6a00', '#ffe14d'], color: '#ffd23b' }],
    moves: GO_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'jajanken', speed: 270, pose: stdPose, ultra: [startSmash, updateSmash],
    ultraPose: h => ['special', h.t < 0.5 ? 4 : h.t < SMASH.hit - 0.1 ? 5 : h.t < SMASH.hit + 0.4 ? 6 : 7],
  },
  killua: {
    name: 'KILLUA', title: "L'assassin foudroyant", sheet: 'killua', card: 'card_ki',
    colors: ['#3a4a9a', '#bfe6ff'], kiColor: '#bfe6ff', hit: '#e0f4ff', trail: '#bfe6ff', element: 'thunder', stats: [['PUISSANCE', 3], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'NARUKAMI', ultra: 'GODSPEED' },
    forms: [{ ki: 50, name: 'GODSPEED', filter: 'brightness(1.1) saturate(1.2)', speed: 1.6, dmg: 1.5, at: 0.6, end: 1.0, aura: ['rgba(120,180,255,0.45)', '#9fd0ff'], sparks: '#dff2ff', bar: ['#2a5cff', '#bfe6ff'], color: '#9fd0ff' }],
    moves: KI_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'narukami', speed: 285, pose: stdPose, ultra: [startZigzag, updateZigzag],
    ultraPose: h => h.zz && h.t > ZIG.start ? ['special', 6 + Math.floor(h.t * 10) % 2] : ['special', 4 + step(h.t, [0.3])],
  },
  ippo: {
    name: 'IPPO', title: 'Le boxeur au cœur vaillant', sheet: 'ippo', card: 'card_ip',
    colors: ['#c81e2a', '#ffffff'], kiColor: '#ffb0a0', hit: '#ffe0d0', stats: [['PUISSANCE', 5], ['VITESSE', 3], ['PORTÉE', 2]],
    labels: { blast: 'DEMPSEY ROLL', ultra: 'DEMPSEY ROLL MAX' },
    forms: [{ ki: 50, name: 'ESPRIT DE COMBAT', filter: 'contrast(1.12) saturate(1.2)', speed: 1.25, dmg: 1.8, at: 0.6, end: 1.0, aura: ['rgba(255,60,40,0.45)', '#ff6a4a'], bar: ['#a01010', '#ff9a8a'], color: '#ff6a4a' }],
    moves: IP_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'dempsey', speed: 240, pose: stdPose, ultra: [startDempseyMax, updateDempseyMax],
    ultraPose: h => h.t < DMAX.end - 0.5 ? ['special', 1 + Math.floor(h.t * 10) % 6] : ['special', 7],
  },
  jinwoo: {
    name: 'JIN-WOO', title: 'Le monarque des ombres', sheet: 'jinwoo', card: 'card_jw',
    colors: ['#1a1030', '#b06aff'], kiColor: '#c9a0ff', hit: '#e0c8ff', trail: '#b06aff', stats: [['PUISSANCE', 5], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'DOMAINE DU MONARQUE', ultra: 'ARISE' },
    forms: [{ ki: 50, name: 'MONARQUE', filter: 'contrast(1.15) saturate(1.2)', speed: 1.4, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(90,20,160,0.6)', '#a050ff'], bar: ['#2a0a50', '#c080ff'], color: '#a050ff',
             glow: '#7a2aff', arcs: 'hue-rotate(160deg) saturate(1.4)', trail: '#c080ff' }],
    moves: JW_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'], launcher: 'rising' },
    special: 'shadowcut', speed: 275, pose: stdPose, ultra: [startArise, updateArise], chargeFrame: 5,
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.8 ? 5 : h.t < 1.6 ? 6 : 7],
  },
  saitama: {
    name: 'SAITAMA', title: 'Un héros pour le fun', sheet: 'saitama', card: 'card_sa',
    colors: ['#f2c400', '#ffffff'], kiColor: '#fff3a0', hit: '#ffffff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 2]],
    labels: { blast: 'COUP DE POING NORMAL', ultra: 'COUP DE POING SÉRIEUX' },
    forms: [{ ki: 50, name: 'MODE SÉRIEUX', filter: 'contrast(1.2) saturate(1.1)', speed: 1.35, dmg: 2.0, at: 0.6, end: 1.0, aura: ['rgba(255,240,180,0.5)', '#fff3a0'], bar: ['#a08000', '#fff07a'], color: '#fff3a0' }],
    moves: SA_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'serious', speed: 255, pose: stdPose, ultra: [startSmash, updateSmash],
    ultraPose: h => ['special', h.t < 0.5 ? 4 : h.t < SMASH.hit - 0.1 ? 1 : h.t < SMASH.hit + 0.4 ? 2 : 3],
  },
  gojo: {
    name: 'GOJO', title: 'Le plus fort des exorcistes', sheet: 'gojo', card: 'card_gj',
    colors: ['#101018', '#7fd8ff'], kiColor: '#9fe0ff', hit: '#e0f6ff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'ROUGE', ultra: 'VIOLET' },
    forms: [{ ki: 50, name: 'SIX YEUX', filter: 'contrast(1.12) saturate(1.2)', speed: 1.35, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(80,180,255,0.5)', '#7fd8ff'], bar: ['#0a3060', '#9fe0ff'], color: '#7fd8ff',
             glow: '#4ab0ff', proj: 'hue-rotate(200deg) saturate(1.6)' }],
    moves: GJ_MOVES, chain: { punch: ['punch', 'cross', 'finisher'], kick: ['kick', 'roundhouse', 'spinback'], launcher: 'uppercut' },
    special: 'red', speed: 260, pose: stdPose, ultra: [startFinalFlash, updateFinalFlash],
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.95 ? 5 : 6],
  },
};
// Forme dont la planche n'est pas encore découpée : elle reprend une autre planche, teintée (fallback)
for (const C of Object.values(CHARS)) for (const F of C.forms || []) {
  if (F.fallback && !SPRITES[F.sheet]) { F.sheet = F.fallback[0]; F.filter = F.fallback[1]; }
}
// Tailles relatives : les enfants et les persos plus petits le restent à l'écran (Naruto, Gon, Killua…).
// Toutes les planches du perso (formes comprises) sont réduites ; la cadence de marche suit, pour que le pied
// posé ne glisse pas.
const CHAR_SIZE = { naruto: 0.88, gon: 0.87, killua: 0.87, tanjiro: 0.92, izuku: 0.95, guts: 1.1 }; // Guts : colosse, sa garde accroupie le tassait
// Étapes remplacées par un dessin plus fin (même cadrage) : la garde de Sangoku, trop petite, perdait ses yeux
const FRAME_HD = { 'goku.combo.0': 'assets/sprites/goku/guard_hd.png' };
for (const [k, src] of Object.entries(FRAME_HD)) { const [sh, an, i] = k.split('.'); const f = SPRITES[sh]?.[an]?.frames[+i]; if (f) f.src = src; }
// Animation dessinée à une autre échelle que les autres poses du même perso (marche vidéo de Kenshin trop petite)
// Mesuré avec tools/facesize.py (taille du visage d'une animation à l'autre) : même tête sur toutes les poses
const OTHER = (walk, other, anims = ['jump', 'fall', 'combo', 'lowair', 'dashcharge', 'special']) => ({ walk, ...Object.fromEntries(anims.map(a => [a, other])) });
const ANIM_SIZE = { kenshin: OTHER(1.11, 0.79), zenitsu: OTHER(1.07, 0.76), ichigo: OTHER(1, 1.08), naruto: OTHER(1, 0.88), killua: OTHER(1, 0.9),
  // Edward : même tête en garde, en recharge et en spécial (facesize : combo 0,93, lowair 0,92, special 1,07 de la marche)
  edward: { combo: 1.075, lowair: 1.085, special: 0.935, jump: 0.96 } };
for (const [sh, anims] of Object.entries(ANIM_SIZE))
  for (const [an, k] of Object.entries(anims)) { const A = SPRITES[sh]?.[an]; if (A) { A.scale *= k; if (A.rate) A.rate /= k; } }
// Échelle du monde : tout le monde un peu plus petit pour qu'on tienne à 4 sur l'écran
const WORLD = 0.9;
for (const who of Object.values(SPRITES)) for (const A of Object.values(who)) { A.scale *= WORLD; if (A.rate) A.rate /= WORLD; }
for (const [id, k] of Object.entries(CHAR_SIZE))
  for (const sh of charSheets(id)) for (const A of Object.values(SPRITES[sh] || {})) { A.scale *= k; if (A.rate) A.rate /= k; }
// Variantes : plusieurs versions d'un perso dans la même case de la sélection (↑/↓). La première est la case,
// les suivantes n'ont pas de case à elles ; une variante absente (pas encore dans CHARS) est ignorée.
CHARS.naruto.variants = ['naruto', 'naruto_s'];
const VARIANT_LABEL = { naruto: 'ENFANT', naruto_s: 'SHIPPUDEN' };
const VARIANT_ONLY = new Set(Object.values(CHARS).flatMap(C => (C.variants || []).slice(1)));
// Un personnage n'apparaît qu'une fois ses planches découpées (src/sprites.js)
const CHAR_IDS = Object.keys(CHARS).filter(id => SPRITES[CHARS[id].sheet] && !VARIANT_ONLY.has(id));
const variantsOf = k => (CHARS[CHAR_IDS[k]].variants || [CHAR_IDS[k]]).filter(id => CHARS[id] && SPRITES[CHARS[id].sheet]);
const charAt = (k, v = 0) => { const V = variantsOf(k); return V[Math.min(v || 0, V.length - 1)]; };
const COLORS_P = ['#4fe3ff', '#ffb13b', '#7fff5a', '#ff4fd8']; // couleur de chaque joueur

// Couleurs du moment (la forme les remplace) : traînée des lames, impacts, élément
const trailOf = h => h.boost?.trail || h.C.trail || '#ffffff';
const hitOf = h => h.boost?.hit || h.C.hit || '#ffe066';
const elementOf = h => h.boost?.element || h.C.element;
// La forme la plus forte que le ki permet
const formFor = h => h.C.formSteps ? h.C.forms.find(f => h.ki >= f.ki) : h.C.forms.filter(f => h.ki >= f.ki).pop();
// Forme suivante quand on est déjà transformé (paliers) : la prochaine que le ki permet
const formAfter = h => { const fs = h.C.forms; return fs.slice(fs.indexOf(h.boost) + 1).find(f => h.ki >= f.ki); };

// ---------- État du jeu ----------
let scene = 'loading';
let cutins = [];
let players, enemies, waves, bombs, projs, fxs, particles, popups, camX, shake, flash, hitstop, score, combo, comboT, kills, spawnT, sceneT, paused;

function newPlayer(idx, char, n) {
  return {
    idx, char, C: CHARS[char],
    x: 300 - (n - 1) * 50 + idx * 100, y: GROUND, gz: [GROUND, GROUND - 50, GROUND + 25, GROUND - 80][idx % 4], vx: 0, vz: 0, vy: 0, dir: 1, state: 'idle', t: 0, move: null, hitSet: null,
    hp: 100, maxHp: 100, ki: 50, inv: 0, onGround: true, walkT: 0, lastHit: -9, back: false,
    chain: 0, buffer: null, doubled: false, boost: null, out: false, outT: 0, lives: OPTS.lives, tagCool: 0, reserve: null,
  };
}

function resetGame(chars = ['hero'], lv = levelPick) {
  setLevel(lv);
  players = chars.map((c, i) => newPlayer(i, c, chars.length));
  for (const h of players) h.y = h.gz;
  // Équipe de deux : le partenaire attend son tour (relais)
  if (OPTS.tag && sel.partners) players.forEach((h, i) => { const c = sel.partners[i]; if (c && c !== h.char) h.reserve = newPlayer(i, c, chars.length); });
  enemies = []; waves = []; stars = []; bombs = []; projs = []; zaps = []; clones = []; blackFlames = []; crows = []; fxs = []; particles = []; popups = []; cutins = [];
  if (scene !== 'loading') requireGame([...players, ...players.map(h => h.reserve).filter(Boolean)].map(h => h.char), LVL); // pas pour la partie fictive du démarrage
  resetLevel();
  camX = 0; shake = 0; flash = 0; hitstop = 0; score = 0; combo = 0; comboT = 0; kills = 0; spawnT = 1.5; sceneT = 0; paused = false;
}

// ---------- Joueurs ----------
const STATES_BUSY = ['hurt', 'prejump', 'charge', 'transform', 'ultra', 'diveland', 'dodge'];
const busy = h => !!h.move || STATES_BUSY.includes(h.state);
const say = (h, text) => popups.push({ x: h.x, y: h.y - 235, t: 0, text, small: true, c: h.C.colors[1] });

function startMove(h, name, chain = 0) {
  const m = h.C.moves[name];
  h.state = name; h.t = 0; h.move = m; h.hitSet = new Set(); h.multiT = 0; h.chain = chain; h.buffer = null;
  h.trailed = h.thrown = h.ported = h.beamed = h.struck = h.stopped = h.cloned = h.leanGo = false; h.shotN = 0;
  if (m.call) say(h, m.call);
  if ((name === h.C.special || name === h.C.special2) && !m.beam) audio.voice(h, 'special'); // rayon : le cri part avec le tir (voir m.beam)
  if (m.rubber) audio.stretch();
  if (m.trail) audio.slash();
  if (name === 'dash') { audio.zip(); audio.whoosh(1.3); }
  else if (name !== 'blast') audio.whoosh(/kick|round|whip|axe|bazooka|spin|leap/.test(name) ? 1.4 : 1);
}

// ---------- Jonglage aérien (24/10, esprit DBZ FighterZ) ----------
// Le dernier coup du combo de pieds envoie l'ennemi en l'air ; poing, pied ou saut pendant qu'il monte : le héros
// fond sur lui, enchaîne trois coups en l'air puis l'écrase au sol d'un coup plongeant (il rebondit une fois).
const JUG = { top: 215, window: 0.75, rise: 0.18, hits: [0.24, 0.36, 0.48], smash: 0.64, end: 0.8, dmg: 1.1, smashDmg: 2.6 };
// hauteur du lancement : le plus haut possible, les pieds pas au-dessus de JUG.top (le corps reste entier à l'écran)
const jugRise = e => clamp(e.gz - JUG.top - 40, 150, 330);
const C_chainLast = h => h.C.chain?.launcher; // seul le lanceur (haut + dernier coup de pied) envoie en l'air
function jugglePose(h) {
  const t = h.t, hero = h.C.pose === heroPose;
  // vraies poses en l'air : jambes repliées, coup de pied sauté, genou armé, puis coup plongeant vers le bas
  const seq = hero ? [['jump', 3], ['jumpkick', 2], ['jumpkick', 3], ['jump', 4], ['jumpkick', 4]] : [['jump', 3], ['lowair', 5], ['combo', 7], ['lowair', 4], ['lowair', 6]];
  const [a, i] = seq[t < JUG.hits[0] ? 0 : t < JUG.hits[1] ? 1 : t < JUG.hits[2] ? 2 : t < JUG.smash - 0.04 ? 3 : 4];
  return SPRITES[sheetFor(h, a)]?.[a] ? [a, i] : ['jump', 4];
}
function startJuggle(h) {
  const e = h.juggle.e;
  h.juggle = { e, t: 0, x0: h.x, y0: h.y, hit: 0, yT: Math.max(JUG.top, e.gz - jugRise(e)) }; // yT : hauteur où il monte le prendre
  h.state = 'juggle'; h.t = 0; h.move = null; h.onGround = false; h.vx = h.vy = 0;
  h.dir = Math.sign(e.x - h.x) || h.dir; e.juggled = true; e.vx = e.vy = 0;
  ring(h.x, h.gz - 10); burst(h.x, h.gz - 10, '#bfefff', 10); audio.zip(); audio.whoosh(1.5);
}
function updateJuggle(h, dt) {
  const J = h.juggle, e = J?.e, t = h.t;
  if (!e || e.state !== 'knock') { endJuggle(h); return; }
  h.inv = Math.max(h.inv, 0.1);
  // il fond sur l'ennemi (images rémanentes) puis reste collé à lui ; l'ennemi flotte en montant un peu
  const u = 1 - Math.pow(1 - Math.min(1, t / JUG.rise), 3);
  if (J.hit > JUG.hits.length) {
    // coup plongeant porté : il pique vers le sol derrière l'ennemi, jambe tendue vers le bas
    h.y = Math.min(h.gz, h.y + 1500 * dt); h.x = clamp(h.x + h.dir * 120 * dt, camX + 40, camX + W - 40);
    if (Math.random() < 0.7) afterImage(h, 0.2, 0.3, hitOf(h));
    if (t >= JUG.end || h.y >= h.gz) endJuggle(h);
    return;
  }
  h.x = clamp(J.x0 + (e.x - h.dir * 85 - J.x0) * u, camX + 40, camX + W - 40); h.y = J.y0 + (e.y + 25 - J.y0) * u;
  if (t < JUG.rise && Math.random() < 0.8) afterImage(h, 0.25, 0.35, hitOf(h));
  if (e.juggled) { J.yT = Math.max(JUG.top, J.yT - 50 * dt); e.y += (J.yT - e.y) * Math.min(1, dt * 12); } // il monte tout en haut, puis encore un peu sous les coups
  const mult = h.boost ? h.boost.dmg : 1;
  while (J.hit < JUG.hits.length && t >= JUG.hits[J.hit]) {
    J.hit++; e.x += h.dir * 8;
    damageEnemy(e, JUG.dmg * mult, 60 * h.dir, null, e.x - h.dir * 30, e.y - 110, hitOf(h)); // sans envol : petit impact
    e.state = 'knock'; e.vx = e.vy = 0;
    hitstop = Math.max(hitstop, 0.04); h.ki = Math.min(100, h.ki + 4);
    if (h.C.trail) slashFX(e.x, e.y - 110, h.dir, { a0: -0.8, a1: 0.8, r: 60, c: trailOf(h), life: 0.12, w: 8 });
  }
  if (J.hit === JUG.hits.length && t >= JUG.hits[JUG.hits.length - 1] + 0.06) h.y = Math.min(h.y, e.y - 60 * Math.min(1, (t - JUG.hits[JUG.hits.length - 1] - 0.06) / 0.08)); // il passe au-dessus
  if (J.hit === JUG.hits.length && t >= JUG.smash) {
    // coup plongeant : l'ennemi part vers le sol à toute vitesse
    J.hit++; e.juggled = false;
    damageEnemy(e, JUG.smashDmg * mult, 160 * h.dir, null, e.x - h.dir * 20, e.y - 100, hitOf(h));
    e.state = 'knock'; e.vx = h.dir * 160; e.vy = 1800; e.slam = true;
    shake = Math.max(shake, 14); hitstop = Math.max(hitstop, 0.1); // le gros choc est pour l'arrivée au sol
    audio.play('ultraBoom', 0.6, 1.5, 0);
  }
  if (t >= JUG.end) endJuggle(h);
}
function endJuggle(h) {
  if (h.juggle?.e) h.juggle.e.juggled = false;
  h.juggle = null; h.state = 'jump'; h.t = 0; h.vy = -260; h.vx = 0; h.onGround = false;
}

// ---------- Dash aérien et coup plongeant (24/10) ----------
// Garde-fous : un dash par saut ; le plongeant laisse vulnérable à l'atterrissage (DIVE.recover) ; dégâts modérés ;
// l'onde au sol renverse les sbires proches mais les boss encaissent sans tomber.
const DIVE = { recover: 0.4, radius: 170, dmg: 2 };
const AIRDASH_MOVE = { dur: 0.3, push: 950, pushAt: 0, pushDur: 0.3, keepPush: true, ghost: true };
const DIVE_MOVE = { dur: 1.2, on: 0.02, off: 1.2, reach: [-40, 120], y: [-130, 40], dmg: 2.5, kb: 320, ki: 8, launch: -480 };
function airPose(h) {
  const hero = h.C.pose === heroPose, pick = (...c) => c.find(([a]) => SPRITES[sheetFor(h, a)]?.[a]) || ['jump', 4];
  if (h.state === 'airdash') return hero ? pick(['dash', 2]) : pick(['dashcharge', 2]);
  if (h.state === 'dive') return hero ? pick(['jumpkick', 4]) : pick(['lowair', 6]);
  if (h.state === 'dodge') return h.dodge?.back ? (hero ? pick(['jump', 3]) : pick(['jump', 3], ['lowair', 1])) : hero ? pick(['dash', 1]) : pick(['dashcharge', 1]);
  // garde et coup chargé armé : planche 'guard' de chaque perso (étape 0 garde, 1 armé), sinon l'ancienne pose
  if (h.state === 'smashcharge') return hero ? pick(['guard', 1], ['charge', 1]) : pick(['guard', 1], ['dashcharge', 4]);
  if (h.state === 'guard') return hero ? pick(['guard', 0], ['punch', 0]) : pick(['guard', 0], ['combo', 0]);
  if (h.state === 'megasmash') return hero ? pick(['pcombo', h.t < 0.1 ? 1 : 4]) : pick(['combo', h.t < 0.1 ? 0 : 2]);
  return hero ? pick(['crouch', 1]) : pick(['lowair', 1]); // réception accroupie
}
const POSE_STATES = ['airdash', 'dive', 'diveland', 'dodge', 'smashcharge', 'guard', 'megasmash'];
// ---------- Bouton Attaque unique (24/10) : le dernier coup du combo dépend de la direction tenue ----------
// haut : lanceur (jonglage) ; bas : balayage ; avant : ruée explosive ; arrière : il se retourne et frappe ; neutre : projection
function finishOf(h) {
  const C = h.C, k = C.chain.kick || [], kLast = k[k.length - 1], pLast = C.chain.punch[C.chain.punch.length - 1];
  const recent = t => sceneT - (t ?? -9) < 0.5, rel = recent(h.mxT) ? h.lastMx * h.dir : 0;
  if (recent(h.upT)) return C.chain.launcher || kLast || pLast;
  if (recent(h.downT) && C.moves.ckick) return 'ckick';
  // avant : estocade des épéistes, sinon la ruée explosive ; arrière : coup qui frappe derrière ; neutre : projection normale
  const notLaunch = n => n && n !== C.chain.launcher;
  if (rel > 0) return C.moves.thrust ? 'thrust' : C.moves.finisher ? 'finisher' : pLast;
  if (rel < 0) { // un coup qui frappe derrière, pas déjà joué dans le combo
    const used = new Set(C.chain.punch.slice(0, -1));
    return k.find(n => C.moves[n]?.reach?.[0] < -50 && !used.has(n)) || (C.moves.spinback && !used.has('spinback') ? 'spinback' : null) || k.find(n => !used.has(n)) || kLast || pLast;
  }
  return notLaunch(kLast) ? kLast : notLaunch(pLast) ? pLast : k[1] || pLast;
}
// ---------- Garde, parade, esquive (ancien bouton Pied) ----------
const GUARD = { regen: 22, min: 15, cost: 3.5, chip: 0.15, parry: 0.22, dodgeT: 0.3, dodgeV: 820, dodgeInv: 0.22, backT: 0.4, backHop: 75 };
// ---------- Coup chargé : attaque maintenue puis relâchée ; un ennemi affaibli est éjecté hors de l'écran ----------
const CHARGE = { show: 0.32, full: 0.75, weak: 0.4 };
const MEGA_MOVE = { dur: 0.6, on: 0.12, off: 0.3, reach: [10, 175], y: [-190, -50], dmg: 4, kb: 900, ki: 12, launch: -360, push: 1000, pushAt: 0.04, pushDur: 0.16, lean: 16, shock: true, mega: true };
// dash aérien, coup plongeant et coup chargé : communs à tous les persos
// Uppercut de fin de combo (lanceur, haut + attaque) : uppercut montant façon Shoryuken (24/10). Il avance d'un pas, décolle
// du sol en frappant, touche plus large et plus haut (il ne rate plus l'ennemi repoussé par le combo) et l'envoie très haut.
for (const C of Object.values(CHARS)) {
  const u = C.chain?.launcher === 'uppercut' && C.moves.uppercut;
  if (!u || u.rise) continue;
  const on = Math.min(u.on, 0.1);
  C.moves.uppercut = { ...u, dur: Math.max(u.dur, 0.62), on, off: Math.max(u.off, on + 0.28), reach: [Math.min(u.reach[0], -10), Math.max(u.reach[1], 140)],
    y: [Math.min(u.y[0], -260), Math.max(u.y[1], -40)], dmg: u.dmg * 1.3, launch: -900, push: u.push ?? 380, pushAt: u.pushAt ?? 0.02, pushDur: u.pushDur ?? 0.14,
    rise: 115, shock: true };
}
for (const C of Object.values(CHARS)) { C.moves.airdash ??= AIRDASH_MOVE; C.moves.dive ??= DIVE_MOVE; C.moves.megasmash ??= MEGA_MOVE; if (C.pose === stdPose && !C.moves.thrust) C.moves.finisher ??= FINISHER; }
// Combos des combattants à mains nues (24/10) : deux coups de poing, deux coups de pied, puis le finish choisi par la
// direction (finishOf) — le même bouton enchaîne poings et pieds, comme dans les jeux de combat
for (const C of Object.values(CHARS)) {
  const P = C.chain?.punch, K = C.chain?.kick;
  if (!P || !K || P.join() !== 'punch,cross,finisher' || K.length < 3) continue;
  if (![K[0], K[1]].every(n => C.moves[n]?.cancel)) continue;
  C.chain.punch = ['punch', 'cross', K[0], K[1], 'finisher'];
}
function megaHit(h, e) {
  const T = ETYPES[e.type];
  if (T.isBoss || e.hp > e.maxHp * CHARGE.weak) { e.smashT = 0.9; return; } // encore solide : grosse projection, rebond au bord
  // éjecté, comme dans Smash Bros : vers le bord de l'écran, ou vers le ciel (haut tenu) avant de disparaître au loin
  const sky = sceneT - (h.upT ?? -9) < 0.5;
  if (e.hp > 0) { e.hp = 0; kills++; score += T.score; }
  e.alive = false; e.state = 'knock'; e.t = 0; e.getUp = false;
  e.eject = { sky, t: 0, vx: h.dir * (sky ? 520 : 2300), vy: sky ? -1500 : -260, rot: 0 };
  flash = 0.6; hitstop = Math.max(hitstop, 0.22); shake = Math.max(shake, 26);
  audio.play('ultraBoom', 1, 1.2, 0); popups.push({ x: e.x, y: e.y - 260, t: 0, text: 'ÉJECTÉ !!', c: '#ffe14d' });
}
function updateEject(e, dt) {
  const E = e.eject; E.t += dt; e.t = Math.min(e.t, 1);
  e.x += E.vx * dt; e.y += E.vy * dt; E.rot += dt * (E.sky ? 10 : 22) * Math.sign(E.vx || 1);
  if (E.sky) E.vy *= 1 - dt * 0.6;
  if (Math.random() < 0.9) particles.push({ x: e.x, y: e.y - 100, vx: -E.vx * 0.2, vy: -E.vy * 0.2, t: 0, life: 0.35, c: 'rgba(255,255,255,0.8)', r: rand(2, 4), streak: true });
  const out = E.sky ? E.t > 0.75 : e.x < camX - 20 || e.x > camX + W + 20;
  if (out && !E.done) {
    E.done = true; e.t = 2; // retiré au tour suivant
    if (E.sky) { // petite étoile qui scintille au loin
      const x = clamp(e.x, camX + 40, camX + W - 40), y = Math.max(40, e.y - 100);
      for (let k = 0; k < 2; k++) particles.push({ x, y, t: 0, life: 0.5, ring: true });
      fxs.push({ type: 'impact', x, y, r: 40, c: '#ffffff', n: 8, rot: 0, t: 0, life: 0.5 }); audio.tone(2200, 0.35, 'sine', 0.08, 800);
    } else { // choc contre le bord de l'écran
      const x = E.vx > 0 ? camX + W - 10 : camX + 10;
      impactFX(x, e.y - 100, '#ffffff', true); shake = Math.max(shake, 20); flash = 0.4; audio.play('ultraBoom', 0.9, 0.9, 0);
    }
  }
}

function diveImpact(h) {
  h.state = 'diveland'; h.t = 0; h.vx = 0;
  shake = Math.max(shake, 16); hitstop = Math.max(hitstop, 0.05); audio.play('ultraBoom', 0.6, 1.6, 0); audio.play('body', 0.9);
  shockFX(h.x + h.dir * 30, h.gz - 20, h.dir); impactFX(h.x + h.dir * 30, h.gz - 20, hitOf(h), true);
  for (let k = 0; k < 20; k++) particles.push({ x: h.x + rand(-80, 80), y: h.gz - rand(0, 10), vx: rand(-380, 380), vy: rand(-240, -60), t: 0, life: 0.55, c: 'rgba(210,200,185,0.75)', r: rand(5, 11), soft: true });
  const mult = h.boost ? h.boost.dmg : 1;
  for (const e of enemies) {
    if (!e.alive || e.state === 'down' || e.state === 'knock' || h.hitSet?.has(e) || Math.abs(e.x - h.x) > DIVE.radius || Math.abs(e.gz - h.gz) > 60) continue;
    const boss = ETYPES[e.type].isBoss;
    damageEnemy(e, DIVE.dmg * mult * (boss ? 0.6 : 1), 260 * (Math.sign(e.x - h.x) || h.dir), boss ? null : -420, e.x, e.y - 60, hitOf(h));
  }
}

function powerDown(h) {
  if (!h.boost) return;
  burst(h.x, h.y - 110, h.boost.color, 16);
  h.boost = null;
  audio.tone(500, 0.4, 'triangle', 0.1, -350);
}

function nearestEnemy(h, range) {
  let best = null;
  for (const e of enemies) {
    if (!e.alive || e.state === 'down' || e.state === 'knock') continue;
    const d = Math.abs(e.x - h.x);
    if (d < range && (!best || d < Math.abs(best.x - h.x))) best = e;
  }
  return best;
}

function updatePlayer(h, dt) {
  const C = h.C, I = INPUT[h.idx], pressed = I.pressed, held = a => isHeld(h.idx, a);
  h.t += dt;
  h.inv = Math.max(0, h.inv - dt);
  updateReserve(h, dt);
  if (h.formUltra && h.state !== 'ultra') { h.formUltra = false; powerDown(h); } // l'ultime renforcé a consumé la forme
  if (h.boost && !h.formUltra) { h.ki -= dt * KI.goldDrain; if (h.ki <= 0) { h.ki = 0; powerDown(h); } }
  else if (h.state !== 'ultra' && !h.out) h.ki = Math.min(100, h.ki + dt * KI.regen);
  formParticles(h);
  if (level.trans) { transitionWalk(h, dt); return; }
  if (h.aegis > 0) h.aegis -= dt;
  if (h.respawn) { updateRespawn(h, dt); return; }
  if (h.pit) { updatePitFall(h, dt); return; } // il tombe dans un trou
  if (h.move && !h.out) {
    const key = h.C.pose(h).join(':');
    if (h._lastPose && key !== h._lastPose && h._ghostPose) fxs.push({ ...h._ghostPose, t: 0, life: 0.14, alpha: 0.35, col: hitOf(h) });
    const [anim, i] = h.C.pose(h); h._lastPose = key;
    h._ghostPose = { type: 'ghost', x: h.x, y: h.y, dir: h.dir, sheet: sheetFor(h, anim), anim, i };
  } else h._lastPose = null;

  // Au tapis : glissade, puis on se relève (sauf K.O.)
  if (h.state === 'knock') {
    h.vy += 1900 * dt; h.x += h.vx * dt; h.y += h.vy * dt;
    if (h.y >= h.gz) { h.y = h.gz; h.vy = 0; h.state = 'floor'; h.t = 0; audio.play('body', 0.9); shake = Math.max(shake, 6); burst(h.x, h.gz - 5, '#9ad1ff', 8); }
    return;
  }
  if (h.state === 'floor') {
    h.vx *= 0.85; h.x += h.vx * dt;
    if (h.out) {
      // K.O. : relais vers le partenaire, ou une vie en moins et on se relève (plus de vie : il reste au tapis)
      h.outT += dt;
      reviveCheck(h, dt);
    } else if (h.t > 0.7) { h.state = 'getup'; h.t = 0; }
    return;
  }
  if (h.state === 'getup') {
    if (h.t > 0.45) { h.state = 'idle'; h.inv = 1.0; }
    return;
  }
  if (scene !== 'play') return;
  if (h.assist) { if (h.state === 'ultra') C.ultra[1](h, dt); return; } // partenaire de l'attaque à deux
  if (pressed.has('tag')) { tagPressed(h); if (!players.includes(h)) return; }

  const mx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  const crouching = held('crouch');
  const mz = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  if (h.state === 'hurt' && h.t > 0.35) h.state = 'idle';
  if (h.state === 'prejump' && h.t > 0.07) { h.vy = -760; h.onGround = false; h.state = 'jump'; h.t = 0; }
  if (h.state === 'land' && h.t > 0.1) h.state = 'idle';

  // Charge du ki : tant que le bouton est tenu
  if (h.state === 'charge') {
    if (!held('charge') || h.boost) h.state = 'idle';
    else {
      h.ki = Math.min(100, h.ki + dt * KI.chargeRate);
      if (Math.random() < 0.6) particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(0, 40), vx: 0, vy: rand(-320, -160), t: 0, life: 0.5, c: C.kiColor, r: rand(2, 4) });
    }
  }
  // Transformation : la forme arrive à la fin de l'animation (forme dorée, Gear Second ou Gear 5, Kaioken…)
  if (h.state === 'transform') {
    const F = h.nextForm;
    h.inv = Math.max(h.inv, 0.1);
    if (!h.boost && h.t > F.at) {
      h.boost = F; flash = 0.8; shake = 16; ring(h.x, h.y - 110); audio.voice(h, 'transform');
      burst(h.x, h.y - 120, F.color, 40);
      if (F.steam || F.cloud) for (let k = 0; k < 40; k++) particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(0, 180), vx: rand(-200, 200), vy: rand(-260, -60), t: 0, life: 0.9, c: 'rgba(255,240,240,0.6)', r: rand(6, 14), soft: true });
      audio.play('transform', 1, F.sheet === 'gold' ? 1 : 1.2, 0);
      if (F.sheet !== 'gold') { audio.sweep(0.8, 3000, 7000, 0.25, 0.6); say(h, F.name + ' !'); }
    }
    if (h.t > F.end) h.state = 'idle';
  }
  if (h.state === 'ultra') C.ultra[1](h, dt);

  // Jonglage aérien : l'ennemi vient d'être envoyé en l'air par le dernier coup du combo de pieds
  // l'appui est mémorisé (même un peu avant que le coup touche) : marteler le pied suffit
  if (['punch', 'jump'].some(a => pressed.has(a))) h.atkPressT = sceneT;
  h.holdT = held('punch') ? (h.holdT || 0) + dt : (h.state === 'smashcharge' ? h.holdT : 0);
  if (held('up')) h.upT = sceneT;
  if (held('down') || held('crouch')) h.downT = sceneT;
  if (held('left') || held('right')) { h.mxT = sceneT; h.lastMx = held('right') ? 1 : -1; }
  if (h.juggle && h.state !== 'juggle') {
    const J = h.juggle; J.t += dt;
    if ((h.atkPressT ?? -9) > J.from) J.want = true; // un nouvel appui depuis le début du coup lanceur
    if (J.t > JUG.window || J.e.state !== 'knock' || (J.e.vy > 0 && J.e.y > J.e.gz - 50)) h.juggle = null; // trop tard : il retombe au sol
    else if (J.want && J.t > 0.1) startJuggle(h);
  }
  if (h.state === 'juggle') { updateJuggle(h, dt); return; }
  if (h.state === 'dodge') {
    const T = h.dodge.back ? GUARD.backT : GUARD.dodgeT, k = Math.max(0, 1 - h.t / T);
    h.vx = h.dodge.x * GUARD.dodgeV * (h.dodge.back ? 0.8 : 1) * k; h.vz = h.dodge.z * GUARD.dodgeV * 0.5 * k;
    // esquive arrière : petit saut en arc, toujours face à l'ennemi
    if (h.dodge.back) h.y = h.gz - GUARD.backHop * Math.sin(Math.PI * Math.min(1, h.t / T));
    if (h.t < GUARD.dodgeInv) h.inv = Math.max(h.inv, 0.05);
    if (Math.random() < 0.6) afterImage(h, 0.25, 0.35, '#bfefff');
    if (h.t > T) { h.state = 'idle'; h.y = h.gz; }
  }
  if (h.state === 'airdash' && h.t > 0.1 && pressed.has('punch')) {
    if (held('down') || held('crouch')) { startMove(h, 'dive'); h.vy = 1500; h.vx = h.dir * 560; h.diveVx = h.vx; audio.whoosh(1.6); }
    else startMove(h, 'airkick');
  }
  if (h.state === 'dive') { h.vx = h.diveVx || 0; if (Math.random() < 0.8) afterImage(h, 0.18, 0.35, hitOf(h)); }
  if (h.state === 'diveland' && h.t > DIVE.recover) { h.state = 'idle'; }

  // Combos : un coup demandé pendant le coup en cours s'enchaîne dès la fin de sa fenêtre active
  const m0 = h.move;
  if (m0 && m0.cancel && h.chain < C.chain.punch.length - 1) {
    if (pressed.has('punch')) h.buffer = 'punch';
    if (h.buffer && h.t >= m0.cancel && C.chain.punch[h.chain + 1]) {
      // dernier coup : la direction tenue (ou tenue juste avant) choisit le finish
      const last = h.chain + 2 === C.chain.punch.length, name = last ? finishOf(h) : C.chain.punch[h.chain + 1];
      if (mx) h.dir = mx; // arrière : il se retourne (coup retourné)
      startMove(h, name, h.chain + 1);
    }
  }
  // uppercut montant : il décolle en frappant puis retombe sur ses pieds, avec des images rémanentes
  if (h.move?.rise && h.onGround) {
    const u = Math.min(1, h.t / h.move.dur);
    h.y = h.gz - h.move.rise * Math.sin(Math.PI * u);
    if (h.t > h.move.on && h.t < h.move.off && Math.random() < 0.7) afterImage(h, 0.25, 0.4, hitOf(h));
  }
  if (h.move && h.t > h.move.dur) { if (h.move.rise && h.onGround) h.y = h.gz; h.state = h.onGround ? 'idle' : 'jump'; h.move = null; }

  const speed = h.boost ? h.boost.speed : 1;
  if (!busy(h)) {
    // Face à l'ennemi le plus proche : s'éloigner de lui = reculer en garde
    const near = nearestEnemy(h, 320), dir0 = h.dir;
    h.back = false;
    if (mx) {
      if (near && Math.sign(near.x - h.x) === -mx && h.onGround) { h.dir = -mx; h.back = true; }
      else h.dir = mx;
    } else if (near && h.onGround) h.dir = Math.sign(near.x - h.x) || h.dir;
    h.vx = mx * (h.back ? C.speed * 0.76 : C.speed) * speed;
    h.vz = mz * 165 * speed;

    if (h.onGround) {
      h.guard = Math.min(100, (h.guard ?? 100) + dt * (h.state === 'guard' ? 0 : GUARD.regen));
      if (h.state === 'smashcharge' && !held('punch')) {
        // relâché : coup chargé s'il a assez concentré, sinon rien
        const full = h.holdT >= CHARGE.full;
        h.state = 'idle'; h.holdT = 0; h.chargeFull = false;
        if (full) { startMove(h, 'megasmash'); audio.voice(h, 'special', 0.8); }
      }
      if (held('kick') && !crouching && pressed.has('kick') && (mx || mz)) {
        // esquive : un bond rapide dans la direction tenue, invincible un instant
        // vers l'arrière (à l'opposé du regard) : saut arrière en gardant le regard vers l'avant
        const foe = nearestEnemy(h, 700), back = mx !== 0 && (foe ? Math.sign(foe.x - h.x) === -mx : mx !== dir0);
        if (back) h.dir = -mx;
        h.state = 'dodge'; h.t = 0; h.dodge = { x: mx, z: mz, back }; audio.whoosh(1.6); audio.zip();
      } else if (held('kick') && !crouching && h.guard > GUARD.min) {
        if (pressed.has('kick')) h.guardPressT = sceneT; // appui frais : parade si un coup arrive tout de suite
        if (h.state !== 'guard') { h.state = 'guard'; h.t = 0; }
        h.vx = 0; h.vz = 0;
      } else if (h.holdT > CHARGE.show && held('punch')) {
        // attaque maintenue : il concentre sa force (coup chargé au relâchement)
        if (h.state !== 'smashcharge') { h.state = 'smashcharge'; h.t = 0; audio.tone(140, 0.5, 'sawtooth', 0.06, 160); }
        h.vx = 0; h.vz = 0;
        if (Math.random() < 0.5) { const a = rand(0, 6.28), d = rand(50, 90); particles.push({ x: h.x + Math.cos(a) * d, y: h.gz - rand(0, 8), vx: -Math.cos(a) * 140 - Math.sin(a) * 120, vy: rand(-60, -10), t: 0, life: 0.45, c: 'rgba(210,200,185,0.6)', r: rand(4, 8), soft: true }); }
        if (h.holdT >= CHARGE.full && !h.chargeFull) { h.chargeFull = true; ring(h.x, h.y - 110); flash = 0.15; audio.tone(900, 0.15, 'square', 0.06, 400); }
      } else if (h.state !== 'land' && !h.move) {
        if (crouching) { if (h.state !== 'crouch') { h.state = 'crouch'; h.t = 0; } }
        else h.state = mx || mz ? 'walk' : 'idle';
      }
      if (h.state === 'guard' || h.state === 'smashcharge' || h.state === 'dodge') { /* pas d'autre action pendant la garde ou la charge */ }
      else {
      const attack = ['punch', 'kick', 'blast', 'dash'].some(a => pressed.has(a));
      if (attack && mx) h.dir = mx; // la direction tenue choisit le côté du coup
      if (h.state === 'crouch') {
        h.vx = 0; h.vz = 0;
        if (pressed.has('punch')) startMove(h, 'ckick');
      }
      else if (pressed.has('jump')) { h.state = 'prejump'; h.t = 0; audio.play('swing', 0.4, 0.8); }
      else if (pressed.has('dash')) { startMove(h, 'dash'); h.vx = 0; }
      else if (pressed.has('punch')) startMove(h, C.chain?.punch?.[0] || 'punch'); // premier coup de SON combo
      else if (pressed.has('blast')) {
        // certains persos changent de spécial une fois transformés (Amaterasu d'Itachi, direct de Baki)
        const sp = h.boost && C.special2 ? C.special2 : C.special, cost = C.moves[sp].cost;
        if (h.ki >= cost) { h.ki -= cost; startMove(h, sp); if (sp === 'blast') audio.blast(); }
        else denied(h);
      }
      else if (pressed.has('ultra')) {
        // transformé : l'ultime part dès 50 de ki, renforcé, et la forme s'achève avec lui
        const inForm = !!h.boost;
        if (h.ki >= (inForm ? KI.formUltra : KI.ultra)) { h.power = inForm ? Math.min(140, h.ki + 50) : h.ki; h.ki = 0; if (inForm) h.formUltra = true; else powerDown(h); h.state = 'ultra'; h.t = 0; h.vx = 0; h.move = null; C.ultra[0](h); audio.voice(h, 'ultra'); cutins = cutins.filter(c => c.h !== h); cutins.push({ h, t: 0 }); audio.sweep(0.5, 600, 4000, 0.3, 1); }
        else denied(h, 'KI PAS ASSEZ CHARGÉ');
      }
      else if (pressed.has('transform')) {
        if (h.boost && formAfter(h)) { h.nextForm = formAfter(h); h.boost = null; h.state = 'transform'; h.t = 0; h.vx = 0; audio.tone(160, 1, 'sawtooth', 0.08, 260); }
        else if (h.boost) powerDown(h);
        else if (formFor(h)) { h.nextForm = formFor(h); h.state = 'transform'; h.t = 0; h.vx = 0; audio.tone(120, 1, 'sawtooth', 0.08, 200); }
        else denied(h, 'IL FAUT 50 DE KI');
      }
      else if (held('charge') && !h.boost) { h.state = 'charge'; h.t = 0; }
      }
    } else {
      h.state = 'jump';
      if (mx) h.dir = mx;
      // Double saut : une seule relance en l'air
      if (pressed.has('jump') && !h.doubled) {
        h.doubled = true; h.vy = -700; h.t = 0;
        ring(h.x, h.y - 10); burst(h.x, h.y - 10, '#bfefff', 8); audio.zip();
      } else if (pressed.has('dash') && !h.airDashed) {
        // dash aérien : un seul par saut, il file à l'horizontale sans tomber
        h.airDashed = true; startMove(h, 'airdash'); h.vy = 0; audio.zip(); audio.whoosh(1.5); ring(h.x - h.dir * 30, h.y - 100);
      } else if (pressed.has('punch') && (held('down') || held('crouch'))) {
        // coup plongeant : à la verticale, ou en diagonale si une direction est tenue
        startMove(h, 'dive'); h.vy = 1500; h.vx = mx ? h.dir * 560 : 0; h.diveVx = h.vx; audio.whoosh(1.6);
      } else if (pressed.has('punch')) startMove(h, 'airkick');
    }
  }
  if (h.onGround && busy(h) && h.state !== 'hurt' && h.state !== 'dodge') { h.vx = 0; h.vz = 0; }
  if (h.state === 'hurt') { h.vx *= 0.88; h.vz = 0; }
  moveEffects(h, speed);

  // Physique
  if (!h.onGround && !(h.state === 'airdash')) h.vy += 1900 * dt;
  // Profondeur : la ligne de sol bouge, le personnage (même en l'air) suit
  const nz = clamp(h.gz + h.vz * dt, Z_TOP, Z_BOT);
  h.y += nz - h.gz; h.gz = nz;
  h.x += h.vx * dt; h.y += h.vy * dt;
  if (h.y >= h.gz) {
    h.y = h.gz; h.vy = 0;
    if (!h.onGround) {
      const dived = h.state === 'dive';
      h.onGround = true; h.doubled = false; h.airDashed = false; h.move = null; h.state = 'land'; h.t = 0; audio.play('step', 0.6, 0.8);
      if (dived) diveImpact(h);
    }
  }
  h.x = clamp(h.x, camX + 40, camX + W - 40);
  if (h.state === 'walk') {
    const [n, fps] = walkCycle(h), before = Math.floor(h.walkT * fps) % n;
    h.walkT += dt * speed;
    const now = Math.floor(h.walkT * fps) % n;
    if (now !== before && now % (n / 2) === 0) audio.play('step', 0.3);
  }

  // Coups qui touchent ; une rafale (multi) peut retoucher le même ennemi
  const m = h.move;
  if (m && m.multi && h.t >= m.on && h.t - h.multiT >= m.multi) { h.multiT = h.t; h.hitSet.clear(); }
  if (m && m.reach && h.t >= m.on && h.t <= m.off) {
    for (const e of enemies) {
      if (!e.alive || h.hitSet.has(e) || e.state === 'down') continue;
      // Même ligne de profondeur, puis portée devant et hauteur (dy = écart de hauteur au-dessus du sol)
      const dx = (e.x - h.x) * h.dir, dy = (e.y - e.gz) - (h.y - h.gz);
      if (Math.abs(e.gz - h.gz) < 28 && dx > m.reach[0] - 30 && dx < m.reach[1] + 25 && dy > m.y[0] - 60 && dy < m.y[1] + 160) {
        h.hitSet.add(e);
        const fx = e.x - h.dir * 30, fy = h.y + (m.y[0] + m.y[1]) / 2;
        damageEnemy(e, m.dmg * (h.boost ? h.boost.dmg : 1), m.kb * h.dir, m.launch, fx, fy, hitOf(h));
        if (m.xcut) slashFX(e.x, e.y - 110, h.dir, { x: true, r: 90, c: trailOf(h), life: 0.35 });
        if (m.stopOnHit) h.stopped = true;
        if (m.spiral) { spiralFX(e.x, e.y - 110, '#9fe8ff'); shake = Math.max(shake, 16); }
        if (m.shock) { shockFX(e.x - h.dir * 20, e.y - 110, h.dir); shake = Math.max(shake, 18); flash = 0.25; hitstop = Math.max(hitstop, 0.08); audio.play('ultraBoom', 0.7, 1.5, 0); }
        if (m.mega) megaHit(h, e);
        // dernier coup du combo de pieds : l'ennemi part haut, on peut le poursuivre (jonglage aérien)
        const kc = C_chainLast(h);
        if (kc && h.state === kc && e.state === 'knock' && !ETYPES[e.type].isBoss && !e.juggled) {
          e.vy = -Math.sqrt(2 * 1700 * jugRise(e)); e.vx = h.dir * 70; h.juggle = { e, t: 0, from: sceneT - h.t + 0.02 }; // très haut : le jonglage se lit au-dessus de la mêlée
          popups.push({ x: e.x, y: e.y - 250, t: 0, text: "EN L'AIR !", small: true, c: '#9fe8ff' });
        }
        if (m.smash) { hitstop = Math.max(hitstop, 0.15); flash = 0.35; e.smashT = 0.9; fxs.push({ type: 'speed', x: e.x, y: e.y - 110, t: 0, life: 0.3, c: hitOf(h) }); }
        if (m.boom) { animFX('nen', e.x, e.y - 110, 300, 0.5); shake = Math.max(shake, 20); flash = 0.3; audio.play('ultraBoom', 0.8, 1.3, 0); }
        if (m.bolts || m.orbFx === 'chidori') animFX('bolt', e.x, e.y - 150, 110, 0.25, { h: 260 });
        if (elementOf(h) === 'fire' && m.trail) for (let k = 0; k < 8; k++) particles.push({ x: e.x + rand(-30, 30), y: e.y - rand(60, 160), vx: rand(-60, 60), vy: rand(-220, -80), t: 0, life: 0.45, c: '#ff8a2a', r: rand(3, 6) });
        h.ki = Math.min(100, h.ki + m.ki);
      }
    }
  }
  // Vague d'énergie du héros de kung-fu
  if (h.state === 'blast' && h.t >= MOVES.blast.fire && !h.fired) {
    h.fired = true;
    const p = handPos(h);
    waves.push({ x: p.x, y: p.y, gz: h.gz, dir: h.dir, t: 0, hit: new Set(), gold: !!h.boost });
    shake = Math.max(shake, 8);
  }
  if (h.state !== 'blast') h.fired = false;
}

// Effets propres aux coups : élan, traînée de lame, projectile, rayon, téléportation
function moveEffects(h, speed) {
  const m = h.move;
  if (h.whips && !m?.whip) releaseWhips(h);
  if (!m) return;
  if (m.whip) updateWhip(h, m.whip);
  if (m.legFire && h.t > m.legFire[0] && h.t < m.legFire[1]) legFlames(h, 3);
  if (m.iceTrail && h.t > (m.pushAt ?? 0) && Math.random() < 0.8) particles.push({ x: h.x - h.dir * rand(0, 40), y: h.gz - rand(0, 14), vx: -h.dir * rand(20, 80), vy: rand(-60, -10), t: 0, life: 0.5, c: Math.random() < 0.5 ? '#e8fbff' : '#9fe0ff', r: rand(3, 6) });
  if (m.push) {
    const at = m.pushAt ?? 0.06, len = m.pushDur ?? 0.44;
    if (h.t > at && h.t < at + len && !h.stopped) h.vx = h.dir * m.push * (m.keepPush ? 1 : 1 - (h.t - at) / len) * speed;
    if (h.stopped) h.vx = 0;
    if (Math.random() < 0.7) particles.push({ x: h.x - h.dir * 40, y: h.y - rand(10, 150), vx: -h.dir * rand(200, 400), vy: 0, t: 0, life: 0.25, c: h.boost ? h.boost.color : '#bfefff', r: rand(1.5, 3) });
    if (m.lean && h.t > at && !h.leanGo) {
      h.leanGo = true; shake = Math.max(shake, 7); audio.whoosh(1.2);
      for (let k = 0; k < 14; k++) particles.push({ x: h.x - h.dir * rand(0, 50), y: h.gz - rand(0, 12), vx: -h.dir * rand(120, 420), vy: rand(-160, -30), t: 0, life: 0.5, c: 'rgba(210,200,185,0.7)', r: rand(5, 11), soft: true });
    }
    if (m.lean && h.t > at && h.t < at + len && Math.random() < 0.6) afterImage(h, 0.28, 0.4, h.boost ? h.boost.color : null);
    // Vitesse divine : des images rémanentes restent derrière lui
    if (m.ghost && h.t > at && h.t < at + len && Math.random() < 0.45) afterImage(h);
    // Hekireki Issen : l'éclair filmé reste sur toute la trajectoire
    if (h.state === 'hekireki' && FX.hekireki_v) {
      if (h.t > at && h.hekiX == null) h.hekiX = h.x;
      if (h.hekiX != null && h.t >= at + len * 0.6) {
        const d = Math.abs(h.x - h.hekiX);
        animFX('hekireki_v', (h.x + h.hekiX) / 2, h.y - 100 * WORLD, Math.max(520, d + 380), 0.6, { h: 190 * WORLD });
        h.hekiX = undefined; h.hekiDone = true;
      }
    }
  }
  if (h.state !== 'hekireki') h.hekiDone = false;
  if (m.trail && !h.trailed && h.t >= (m.trail.at ?? m.on)) {
    h.trailed = true;
    slashFX(h.x + h.dir * 55, h.y + (m.trail.y ?? -110), h.dir, { ...m.trail, c: trailOf(h), element: elementOf(h) });
  }
  if (m.wheel && h.t > 0.05 && h.t < 0.5 && Math.random() < 0.8) {
    // Roue d'eau (ou de feu) : un cercle de lame qui tourne pendant le salto
    const a = h.t * 18;
    particles.push({ x: h.x + Math.cos(a) * 80, y: h.y - 110 + Math.sin(a) * 80, vx: 0, vy: 0, t: 0, life: 0.35, c: trailOf(h), r: rand(5, 9) });
    if (!h.trailed) { h.trailed = true; slashFX(h.x + h.dir * 20, h.y - 110, h.dir, { a0: -3.1, a1: 3.1, r: 95, c: trailOf(h), element: elementOf(h), life: 0.4 }); }
  }
  if (m.teleport && !h.ported && h.t >= m.teleport) {
    // Transmission instantanée : réapparaît dans le dos de l'ennemi le plus proche
    h.ported = true;
    afterImage(h);
    const e = nearestEnemy(h, 600);
    if (e) { h.x = e.x - e.dir * 80; h.gz = e.gz; h.y = e.gz; h.dir = Math.sign(e.x - h.x) || h.dir; }
    else h.x += h.dir * 250;
    ring(h.x, h.y - 110); audio.zip(); audio.play('teleport', 0.9, 1, 0.08);
  }
  if (m.clones && !h.cloned && h.t >= m.clones.at) { h.cloned = true; spawnClones(h, m.clones.n); }
  if (m.proj && !h.thrown && h.t >= m.proj.at) {
    h.thrown = true;
    const P = m.proj, kind = P.kind === 'wave' && elementOf(h) === 'fire' ? 'firewave' : P.kind;
    // les tirs lancés de la main (Rouge de Gojo, Delaware, rafale de ki) partent du bout de la main dessinée
    // la boule de feu d'Itachi part de sa bouche (from: 'mouth')
    const hand = P.from === 'mouth' ? mouthPoint(h) : HAND_SHOTS.includes(kind) && handPoint(h);
    const px = hand ? h.x + h.dir * (hand[0] + 10 + (PROJ_R[kind] || 0) * (P.scale || 1)) : h.x + h.dir * 80, py = P.ground ? h.y - 6 : hand ? clamp(h.y + hand[1] + (PROJ_DY[kind] || 0), h.y - 150, h.y - 30) : h.y - (P.low ? 40 : 110);
    projs.push({ ...P, kind, filter: h.boost?.proj || '', owner: h, x: px, y: py, gz: h.gz, dir: h.dir, t: 0, hit: new Set(), dmg: P.dmg * (h.boost ? h.boost.dmg : 1) });
    if (kind === 'shell') cannonFX(px - h.dir * PROJ_R.shell * (P.scale || 1), py, h.dir);
    else if (hand) burst(px, py, projColor({ kind }), 10);
    shake = Math.max(shake, 8); audio.slash(1.4);
  }
  // tirs de pistolet (Revy) : chacun part du bout du canon dessiné à cet instant
  if (m.shots) while (h.shotN < m.shots.at.length && h.t >= m.shots.at[h.shotN]) { const last = h.shotN === m.shots.at.length - 1; fireBullet(h, last && m.shots.last ? { ...m.shots, ...m.shots.last } : m.shots); h.shotN++; }
  if (m.ama && !h.struck && h.t >= m.ama.at) { h.struck = true; amaterasu(h, m.ama); }
  if (m.strike && !h.struck && h.t >= m.strike.at) {
    // La foudre tombe sur les ennemis devant (Narukami de Killua)
    h.struck = true; shake = Math.max(shake, 12); flash = 0.3; audio.play('waveHit', 1, 1.4); audio.sweep(0.3, 6000, 1500, 0.3, 1);
    // la décharge part de sa main tendue et rebondit d'un ennemi au suivant, du plus proche au plus loin
    const hit = enemies.filter(e => { const dx = (e.x - h.x) * h.dir; return e.alive && e.state !== 'down' && dx > 20 && dx < m.strike.range && Math.abs(e.gz - h.gz) <= 90; })
      .sort((a, b) => (a.x - b.x) * h.dir);
    let from = { x: h.x + h.dir * 70, y: h.y - 120 };
    if (!hit.length) zaps.push({ x1: from.x, y1: from.y, x2: from.x + h.dir * 420, y2: from.y + rand(-30, 30), t: 0, life: 0.3, seed: rand(0, 99) });
    for (const e of hit) {
      const to = { x: e.x, y: e.y - 110 };
      zaps.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, t: 0, life: 0.5, seed: rand(0, 99) });
      animFX('green_arc', to.x, to.y, 90, 0.25, { filter: boltTint(h), rot: rand(-1, 1) });
      damageEnemy(e, m.strike.dmg * (h.boost ? h.boost.dmg : 1), 300 * h.dir, -560, e.x, e.y - 110, hitOf(h));
      from = to;
    }
  }
  if (m.bolts && h.t > (m.pushAt ?? 0) && h.t < (m.pushAt ?? 0) + (m.pushDur ?? 0.3) && Math.random() < 0.6)
    animFX('green_arc', h.x - h.dir * rand(10, 110), h.y - rand(40, 160), rand(45, 80), 0.18, { filter: boltTint(h), rot: rand(-1, 1) });
  if (m.beam && !h.beamed && h.t >= m.beam.at) {
    if (h.state === h.C.special) audio.voice(h, 'special');
    h.beamed = true;
    projs.push({ kind: 'beam', owner: h, move: h.state, ...m.beam, dmg: m.beam.dmg * (h.boost ? h.boost.dmg : 1), t: 0, hit: new Set(), multiT: 0, dir: h.dir, gz: h.gz, color: h.boost ? h.boost.color : m.beam.color });
    flash = 0.4; shake = 14; audio.play('waveFire', 1, 0.8, 0); audio.play('ultraThrow', 0.7, 1.3, 0);
  }
}

// Particules permanentes des formes : vapeur (Gear Second), nuage (Gear 5), flammes (Hinokami)
function formParticles(h) {
  const F = h.boost;
  if (!F || h.out) return;
  if (F.steam && Math.random() < 0.5) particles.push({ x: h.x + rand(-35, 35), y: h.y - rand(30, 170), vx: rand(-20, 20), vy: rand(-140, -70), t: 0, life: 0.7, c: 'rgba(255,235,235,0.55)', r: rand(5, 10), soft: true });
  if (F.cloud && Math.random() < 0.6) particles.push({ x: h.x + rand(-45, 45), y: h.y - rand(140, 190), vx: rand(-40, 40), vy: rand(-60, -20), t: 0, life: 0.6, c: 'rgba(255,255,255,0.7)', r: rand(6, 12), soft: true });
  // Éclairs autour du corps (Dark Deku en vert ; Sharingan de Kakashi en bleu, teinte donnée par la forme)
  if (F.arcs && Math.random() < (F.arcRate ?? 0.35)) animFX('green_arc', h.x + rand(-45, 45), h.y - rand(40, 180), rand(35, 60), 0.16, { rot: rand(-1, 1), filter: typeof F.arcs === 'string' ? F.arcs : '' });
  // Chidori qui crépite dans la main
  if (F.handArcs && Math.random() < 0.4) animFX('green_arc', h.x + h.dir * rand(30, 70), h.y - rand(90, 130), rand(25, 45), 0.12, { rot: rand(-1.5, 1.5), filter: F.arcs });
  // Manteau du renard : bulles de chakra rouge qui montent
  if (F.goldCloak && Math.random() < 0.8) particles.push({ x: h.x + rand(-45, 45), y: h.y - rand(10, 200), vx: rand(-25, 25), vy: rand(-200, -90), t: 0, life: 0.45, c: Math.random() < 0.6 ? 'rgba(255,220,70,0.85)' : 'rgba(255,250,190,0.85)', r: rand(2.5, 6) });
  if (F.foxCloak && Math.random() < 0.7) particles.push({ x: h.x + rand(-40, 40), y: h.y - rand(10, 190), vx: rand(-25, 25), vy: rand(-170, -80), t: 0, life: 0.5, c: Math.random() < 0.6 ? 'rgba(255,50,20,0.8)' : 'rgba(255,150,60,0.8)', r: rand(3, 7) });
  if (F.flames && Math.random() < 0.7) particles.push({ x: h.x + rand(-40, 40), y: h.y - rand(0, 150), vx: rand(-20, 20), vy: rand(-200, -100), t: 0, life: 0.45, c: Math.random() < 0.5 ? '#ff8a2a' : '#ffd060', r: rand(3, 6) });
  // Mangekyô : des corbeaux s'envolent autour d'Itachi
  if (F.crows && Math.random() < 0.1) crows.push({ x: h.x + rand(-30, 30), y: h.y - rand(60, 170), vx: rand(70, 170) * (Math.random() < 0.5 ? -1 : 1), vy: rand(-90, -30), t: 0, life: 1.3, s: rand(0.8, 1.3), ph: rand(0, 6) });
  // Diable Jambe : la jambe reste en feu
  if (F.legFire) legFlames(h, 1);
  // Shoto : flammes qui montent d'un côté, givre qui retombe de l'autre
  if (F.fireIce && Math.random() < 0.8) {
    const fire = Math.random() < 0.5, side = fire ? -1 : 1;
    particles.push({ x: h.x + h.dir * side * rand(5, 40), y: h.y - rand(40, 170), vx: rand(-15, 15), vy: fire ? rand(-190, -90) : rand(20, 70), t: 0, life: 0.45, c: fire ? (Math.random() < 0.5 ? '#ff7a2a' : '#ffd060') : (Math.random() < 0.5 ? '#e8fbff' : '#9fe0ff'), r: rand(2.5, 5) });
  }
}
// Flammes sur le pied le plus en avant (Sanji)
function legFlames(h, n) {
  const fp = footPoint(h) || [50, -40];
  for (let k = 0; k < n; k++) if (Math.random() < 0.85)
    particles.push({ x: h.x + h.dir * (fp[0] + rand(-14, 6)), y: h.y + fp[1] + rand(-10, 10), vx: -h.dir * rand(20, 90), vy: rand(-170, -60), t: 0, life: 0.35, c: Math.random() < 0.5 ? '#ff5a10' : '#ffc040', r: rand(3, 6) });
}

// ---------- Clones de Naruto ----------
let clones = [];
let puffSnd = 0;
const puff = (x, y) => { if (sceneT - puffSnd > 0.12) { puffSnd = sceneT; audio.play('clone', 0.55, 1, 0.12); } for (let k = 0; k < 14; k++) particles.push({ x: x + rand(-40, 40), y: y - rand(20, 170), vx: rand(-120, 120), vy: rand(-120, 30), t: 0, life: 0.45, c: 'rgba(240,240,240,0.75)', r: rand(10, 20), soft: true }); };
function spawnClones(h, n) {
  const dz = [-45, 45, -20, 25];
  for (let k = 0; k < n; k++) {
    const c = { owner: h, x: h.x + h.dir * (30 + k * 25), gz: clamp(h.gz + dz[k % 4], Z_TOP, Z_BOT), dir: h.dir, t: -k * 0.07, state: 'rush', run: 0, kick: k % 2 === 1, hits: 1 };
    c.y = c.gz; clones.push(c); puff(c.x, c.y);
  }
  audio.whoosh(1.4); audio.zip();
}
// ---------- Ultime de Naruto : multi-clonage (Tajū Kage Bunshin) ----------
// Une douzaine de clones surgissent partout dans la fumée, foncent sur les ennemis et frappent plusieurs fois
// (un sur trois avec un Rasengan), puis tous convergent : flash, explosion et dégâts sur tout l'écran.
const BUNSHIN = { n: 12, every: 0.06, finale: 2.3, end: 2.9 };
function startBunshin(h) {
  h.bun = { spawned: 0, boom: false };
  say(h, 'MULTI-CLONAGE !'); flash = Math.max(flash, 0.5); shake = 10;
  audio.whoosh(1.4); audio.play('ultraCharge', 0.6, 1.3, 0);
}
function updateBunshin(h, dt) {
  h.inv = Math.max(h.inv, 0.1); h.vx = 0;
  const B = h.bun;
  while (B.spawned < BUNSHIN.n && h.t > B.spawned * BUNSHIN.every) {
    const k = B.spawned++, x = camX + 60 + ((k * 0.618) % 1) * (W - 120), gz = Z_TOP + 10 + ((k * 0.37) % 1) * (Z_BOT - Z_TOP - 20);
    const c = { owner: h, x, gz, y: gz, dir: x < h.x ? 1 : -1, t: -0.1, state: 'rush', run: 0, kick: k % 2 === 1, hits: 2, seek: true, rasen: k % 3 === 2, power: 0.5 }; // équilibré : ~22 de dégâts sur un seul ennemi, comme les autres ultimes
    clones.push(c); puff(x, gz);
    if (k % 3 === 0) audio.zip();
  }
  if (!B.boom && h.t >= BUNSHIN.finale) {
    // tous convergent : explosion de fumée et de chakra, dégâts sur tout l'écran
    B.boom = true;
    flash = 1; shake = 30; hitstop = 0.14;
    audio.play('ultraBoom', 1.2, 1.1, 0);
    for (const c of clones) if (c.owner === h) { puff(c.x, c.y); c.done = true; }
    for (const e of enemies) {
      if (!e.alive || e.state === 'down' || Math.abs(e.x - (camX + W / 2)) > W / 2 + 40) continue;
      damageEnemy(e, 2 + h.power / 25, 620 * (Math.sign(e.x - h.x) || 1), -820, e.x, e.y - 110, h.C.hit);
      animFX(Math.random() < 0.5 ? 'hitboom_a' : 'hitboom_b', e.x, e.y - 110, 260 * WORLD, 0.5);
    }
    popups.push({ x: h.x, y: h.y - 260, t: 0, text: 'UZUMAKI NARUTO RENDAN !!' });
  }
  if (h.t > BUNSHIN.end) h.state = 'idle';
}
function updateClones(dt) {
  for (const c of clones) {
    c.t += dt;
    if (c.t < 0.12) continue; // il apparaît dans la fumée, les mains jointes
    if (c.state === 'rush') {
      const e = enemies.filter(e => e.alive && e.state !== 'down' && (c.seek || (e.x - c.x) * c.dir > -30) && Math.abs(e.x - c.x) < 900)
        .sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
      if (e && c.seek) c.dir = Math.sign(e.x - c.x) || c.dir;
      const step = (c.rasen ? 1100 : 900) * dt; c.x += c.dir * step; c.run += step;
      if (e) { c.gz += clamp(e.gz - c.gz, -260 * dt, 260 * dt); c.y = c.gz; }
      if (e && Math.abs(e.x - c.x) < 75 && Math.abs(e.gz - c.gz) < 35) {
        c.state = 'hit'; c.ht = 0;
        const h = c.owner, dmg = (c.rasen ? (c.seek ? 1.2 : 3) : c.power || 1.6) * (h.boost ? h.boost.dmg : 1);
        damageEnemy(e, dmg, c.dir * (c.rasen ? 560 : 300), c.rasen ? -620 : c.kick ? -420 : null, e.x, e.y - 110, h.C.hit);
        if (c.rasen) { spiralFX(e.x, e.y - 110, '#bff3ff'); shake = Math.max(shake, 10); }
      } else if (c.run > (c.seek ? 1200 : 650)) c.state = 'poof';
    } else if (c.state === 'hit' && (c.ht += dt) > 0.22) {
      // encore des coups à donner : il recule d'un pas et repart
      if (--c.hits > 0) { c.state = 'rush'; c.run = 0; c.x -= c.dir * 40; c.kick = !c.kick; } else c.state = 'poof';
    }
    if (c.state === 'poof') { puff(c.x, c.y); c.done = true; }
  }
  clones = clones.filter(c => !c.done);
}
function drawClone(c) {
  const h = c.owner, sx = c.x - camX;
  const [anim, i] = c.t < 0.12 ? ['dashcharge', 5] : c.rasen ? ['special', c.state === 'hit' ? 3 : 2]
    : c.state === 'hit' ? ['combo', c.kick ? 5 : 2] : ['dashcharge', 1];
  shadow(sx, c);
  drawAnim(sheetFor(h, anim), anim, i, sx, c.y, c.dir, h.boost?.filter || '');
  if (c.rasen && c.t >= 0.12 && FX.rasen_v) fxImg('rasen_v', Math.floor(c.t * 16), sx + c.dir * 62 * WORLD, c.y - 112 * WORLD, 95 * WORLD, null);
}

function denied(h, msg) {
  audio.tone(120, 0.1, 'square', 0.06);
  if (msg) popups.push({ x: h.x, y: h.y - 230, t: 0, text: msg, small: true });
}

// Position des mains pendant la vague d'énergie (repères mesurés sur les étapes)
// ---------- Arcs électriques (Narukami de Killua) : éclair brisé entre deux points ----------
let zaps = [];
function drawZaps(dt) {
  for (const z of zaps) {
    z.t += dt;
    const a = Math.max(0, 1 - z.t / z.life), n = 9, dx = z.x2 - z.x1, dy = z.y2 - z.y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, flick = Math.floor(z.t * 30);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
    for (const [w, c, al] of [[18, 'rgba(120,190,255,0.45)', 0.8], [7, '#bfe2ff', 1], [2.5, '#ffffff', 1]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.globalAlpha = a * al; ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = i / n, j = i && i < n ? Math.sin(z.seed + i * 12.9 + flick * 7.3) * 22 : 0;
        const px = z.x1 + dx * u + nx * j - camX, py = z.y1 + dy * u + ny * j;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  zaps = zaps.filter(z => z.t < z.life);
}

// ---------- Black Whip d'Izuku ----------
// Les fouets partent de la main tendue, filent vers les ennemis devant, s'enroulent autour et les ramènent.
// Le boss est trop lourd : c'est Izuku qui se hisse jusqu'à lui.
const whipHand = h => ({ x: h.x + h.dir * 100, y: h.y - 128 });
function updateWhip(h, W) {
  const dt = 1 / 60, boost = h.boost ? h.boost.dmg : 1;
  if (!h.whips && h.t >= W.at) {
    const n = W.n + (h.boost ? 2 : 0);
    const foes = enemies.filter(e => e.alive && !['down', 'knock'].includes(e.state) && Math.abs(e.gz - h.gz) < 90)
      .map(e => ({ e, d: (e.x - h.x) * h.dir })).filter(o => o.d > 20 && o.d < W.range).sort((a, b) => a.d - b.d).slice(0, n);
    h.whips = foes.map(o => ({ e: o.e, tip: 0, seed: rand(0, 9), latched: false, dy: 0 }));
    // Rien devant : les fouets claquent dans le vide et reviennent
    if (!h.whips.length) h.whips = [-40, 10, 55].map(dy => ({ e: null, tip: 0, seed: rand(0, 9), latched: false, dy, tx: W.range * 0.8 }));
    audio.whoosh(1.6); shake = Math.max(shake, 5);
  }
  if (!h.whips) return;
  const O = whipHand(h), slamming = h.t >= W.slam;
  for (const w of h.whips) {
    const T = whipTarget(h, w), len = Math.hypot(T.x - O.x, T.y - O.y);
    if (slamming && !w.e) w.tip = Math.max(0, w.tip - W.speed * 1.4 * dt);
    else if (!w.latched) w.tip = Math.min(len, w.tip + W.speed * dt);
    if (!w.e && w.tip >= len) w.latched = true;
    if (w.e && !w.latched && w.tip >= len) {
      w.latched = true;
      damageEnemy(w.e, W.dmg * boost, 0, 0, T.x, T.y, '#3dff7a');
    }
    const e = w.e;
    if (!e || !w.latched || slamming) continue;
    if (!e.alive || e.hp <= 0) { w.e = null; w.tx = Math.max(60, (e.x - O.x) * h.dir); w.dy = 0; continue; }
    const k = 1 - Math.exp(-9 * dt);
    if (ETYPES[e.type].superArmor) {
      // Grappin : Izuku se tire vers le boss
      h.x += (e.x - h.dir * 130 - h.x) * k;
    } else {
      // Ligoté : l'ennemi ne peut plus agir et glisse vers Izuku (la brute, plus lourde, vient moins vite)
      const heavy = ETYPES[e.type].armor ? 0.45 : 1;
      e.state = 'hurt'; e.t = 0; e.vx = 0;
      e.x += (h.x + h.dir * (110 + 25 * h.whips.indexOf(w)) - e.x) * k * heavy;
      e.gz += (h.gz - e.gz) * k * heavy; e.y = e.gz;
    }
    if (Math.random() < 0.3) particles.push({ x: T.x + rand(-30, 30), y: T.y + rand(-40, 40), vx: rand(-40, 40), vy: rand(-90, -20), t: 0, life: 0.4, c: h.boost ? '#5dff8a' : '#2fbf63', r: rand(2, 4) });
  }
  if (slamming && !h.whipSlam) {
    // Smash final : les ennemis ramenés près de lui s'envolent
    h.whipSlam = true; shake = Math.max(shake, 14); audio.play('waveHit', 1, 0.8);
    for (const w of h.whips) {
      const e = w.e;
      if (!e) continue;
      w.e = null; w.tx = Math.max(60, (e.x - O.x) * h.dir); w.dy = e.y - 110 - O.y;
      if (e.alive && e.hp > 0 && Math.abs(e.x - h.x) < 260) {
        damageEnemy(e, W.slamDmg * boost, h.dir * 460, -640, e.x, e.y - 110, '#3dff7a');
        animFX('explosion', e.x, e.y - 110, 170, 0.35, { filter: 'hue-rotate(90deg) saturate(1.3)' });
      }
    }
  }
}
// Point visé par un fouet : le torse de l'ennemi attrapé, ou un point dans le vide
function whipTarget(h, w) {
  if (w.e) return { x: w.e.x, y: w.e.y - 110 + Math.sin(h.t * 7 + w.seed) * 6 };
  const O = whipHand(h);
  return { x: O.x + h.dir * w.tx, y: O.y + w.dy };
}
function releaseWhips(h) {
  h.whips = null; h.whipSlam = false;
}
function drawWhips() {
  for (const h of players) {
    if (!h.whips) continue;
    const O = whipHand(h), dark = !!h.boost, glow = dark ? 'rgba(80,255,130,0.8)' : 'rgba(30,150,80,0.65)', vein = dark ? '#2fd468' : '#17573a';
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const w of h.whips) {
      const T = whipTarget(h, w), len = Math.hypot(T.x - O.x, T.y - O.y) || 1, f = Math.min(1, w.tip / len);
      if (f <= 0.01) continue;
      const tx = O.x + (T.x - O.x) * f, ty = O.y + (T.y - O.y) * f, nx = -(ty - O.y) / len, ny = (tx - O.x) / len;
      // Plusieurs brins noirs qui ondulent et se tordent les uns autour des autres
      for (let s = 0; s < (dark ? 4 : 3); s++) {
        const pts = [];
        for (let i = 0; i <= 18; i++) {
          const u = i / 18, env = Math.sin(Math.PI * u) * (w.latched ? 0.6 : 1);
          const wave = Math.sin(u * (7 + s * 2) - h.t * 22 + w.seed + s * 2.1) * (10 + 9 * s) * env;
          pts.push([O.x + (tx - O.x) * u + nx * wave - camX, O.y + (ty - O.y) * u + ny * wave]);
        }
        const strand = (width, col, blur) => {
          ctx.shadowBlur = blur; ctx.shadowColor = glow; ctx.strokeStyle = col;
          for (let i = 1; i < pts.length; i++) {
            ctx.lineWidth = width * (1 - (i / pts.length) * 0.75);
            ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
          }
        };
        strand(s === 0 ? 15 : 8, '#030403', 9);
        strand(s === 0 ? 2 : 1.2, vein, 0);
      }
      // Enroulé autour de l'ennemi : deux boucles noires
      if (w.latched && w.e) {
        const cx = T.x - camX;
        for (let k = 0; k < 2; k++) {
          const ey = T.y - 10 + k * 34, rot = 0.15 * (k ? -1 : 1);
          ctx.shadowBlur = 8; ctx.shadowColor = glow; ctx.strokeStyle = '#030403'; ctx.lineWidth = 10;
          ctx.beginPath(); ctx.ellipse(cx, ey, 42, 11, rot, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0; ctx.strokeStyle = vein; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(cx, ey, 42, 11, rot, 0, Math.PI); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

function handPos(h) {
  const i = heroPose(h)[1];
  const [ox, oy] = [[42, -92], [40, -96], [118, -128], [122, -128]][i] || [118, -128];
  return { x: h.x + h.dir * ox, y: h.y + oy };
}

function hurtHero(h, dmg, dir, big = false) {
  if (h.out || h.assist || h.inv > 0 || ['knock', 'floor', 'getup', 'transform', 'ultra'].includes(h.state)) return;
  // Ultra Instinct : le corps esquive seul (pas de côté, image rémanente argentée)
  if (h.boost?.dodge && Math.random() < h.boost.dodge) {
    h.inv = 0.35; h.x += dir * 46; burst(h.x - dir * 46, h.y - 110, h.boost.color, 10);
    audio.tone(1400, 0.12, 'sine', 0.06, 600); if (Math.random() < 0.3) say(h, 'ESQUIVE');
    return;
  }
  // garde : face au coup, on encaisse peu ; appui juste avant l'impact = parade
  if (h.state === 'guard' && h.dir === -dir) {
    if (sceneT - (h.guardPressT ?? -9) < GUARD.parry) {
      flash = 0.3; hitstop = Math.max(hitstop, 0.14); shake = Math.max(shake, 8); h.ki = Math.min(100, h.ki + 12); h.inv = 0.3;
      ring(h.x + h.dir * 40, h.y - 120); impactFX(h.x + h.dir * 50, h.y - 120, '#ffffff', true); audio.tone(1500, 0.18, 'square', 0.08, 900); audio.slash(1.6);
      popups.push({ x: h.x, y: h.y - 240, t: 0, text: 'PARADE !', c: '#9fe8ff' });
      // l'attaquant le plus proche devant lui est déséquilibré : on peut contre-attaquer
      const foe = enemies.filter(e => e.alive && !['knock', 'down'].includes(e.state) && (e.x - h.x) * h.dir > -20 && Math.abs(e.x - h.x) < 280 && Math.abs(e.gz - h.gz) < 60).sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x))[0];
      if (foe && !ETYPES[foe.type].isBoss) { foe.state = 'hurt'; foe.t = -0.6; foe.vx = h.dir * 160; foe.atk = null; foe.hitDone = true; }
      return;
    }
    h.guard -= dmg * GUARD.cost; h.hp -= dmg * GUARD.chip * DIFF().dmg; h.vx = dir * 160; h.inv = 0.25;
    shake = Math.max(shake, 5); audio.tone(420, 0.1, 'square', 0.06, -120); burst(h.x + h.dir * 40, h.y - 120, '#bfefff', 10);
    if (h.guard <= 0) {
      h.guard = 0; h.state = 'hurt'; h.t = -0.5; h.vx = dir * 260;
      popups.push({ x: h.x, y: h.y - 240, t: 0, text: 'GARDE BRISÉE', c: '#ff4d6d' }); audio.tone(200, 0.4, 'sawtooth', 0.1, -150);
    }
    if (h.hp <= 0) h.hp = 1;
    return;
  }
  dmg *= DIFF().dmg * endlessDmg();
  h.hp -= dmg; combo = 0;
  shake = 10; hitstop = 0.07; audio.hurt();
  burst(h.x, h.y - 120, '#ff4d6d', 14);
  impactFX(h.x, h.y - 120, '#ff4d6d', false);
  h.move = null; h.t = 0; h.dir = -dir;
  // Deux coups encaissés coup sur coup (ou un coup en l'air) : on part au tapis
  const knocked = big || h.hp <= 0 || !h.onGround || sceneT - h.lastHit < 1.2;
  h.lastHit = sceneT;
  if (knocked) {
    h.state = 'knock'; h.vx = dir * 260; h.vy = -380; h.onGround = true;
    powerDown(h);
    if (h.hp <= 0) {
      h.hp = 0; h.out = true; h.outT = 0; audio.ko();
      onKO(h);
      if (allOut()) { scene = 'gameover'; sceneT = 0; if (isEndless()) endlessRecord(); }
    }
  } else {
    h.state = 'hurt'; h.vx = dir * 220; h.inv = 0.5;
  }
}

// Ultime qui frappe tous les ennemis devant (portée, tolérance de profondeur), avec un gros impact
// kb / launch : recul et envol ; les coups d'une rafale gardent l'ennemi sur place pour que la suite touche
function ultraHit(h, reach, dmg, laneTol = 70, back = -40, kb = 600, launch = -760) {
  for (const e of enemies) {
    const dx = (e.x - h.x) * h.dir;
    if (!e.alive || e.state === 'down' || dx < back || dx > reach || Math.abs(e.gz - h.gz) > laneTol) continue;
    damageEnemy(e, dmg, kb * h.dir, launch, e.x, e.y - 110, hitOf(h));
  }
}

// Équilibrage (23/10) : les ultimes à un seul coup frappent plus fort, pour rester entre ~18 et ~24 sur un boss
// comme les ultimes à plusieurs coups (mesuré à 100 de ki sur le Kuro-Oni)
const ULT_SOLO = 1.35;
// ---------- Ultime du héros et de Sangoku : une énorme sphère d'énergie levée au-dessus de la tête ----------
const ULTRA = { raise: 1.5, throwAt: 1.75, end: 2.4, maxR: 115 };
function startUltra(h) {
  bombs.push({ owner: h, x: h.x, y: h.y - 300, r: 6, vx: 0, vy: 0, state: 'grow', t: 0, hit: new Set(), dir: h.dir, fire: h.char === 'ace', maxR: h.char === 'ace' ? 135 : ULTRA.maxR });
  h.ultraSnd = audio.play('ultraCharge', 0.9, 1, 0);
  if (h.char === 'goku') say(h, 'GENKIDAMA !');
  if (h.char === 'ace') say(h, 'DAI ENKAI… ENTEI !'); // Dai Enkai : un soleil de flammes levé au-dessus de lui (vidéo entei_v)
}

function updateUltraPose(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (h.t > ULTRA.end) h.state = 'idle';
}

// ---------- Genkidama de Sangoku, comme à la fin du combat contre Buu ----------
// Il repasse en forme normale, s'élève, fait grossir la sphère au-dessus de lui et la lance vers le sol. Au contact,
// les ennemis la retiennent (elle recule) : il passe Super Saiyan et la repousse d'un faisceau jusqu'à l'explosion.
const GENKI = { rise: 0.55, height: 120, grow: 1.9, throwAt: 2.15, maxR: 100, clash: 0.55, push: 0.95,
  // paume de la main tendue (étape « special » 7), mesurée sur les planches : départ du faisceau
  palm: { goku: [52, -135], goku_ssj: [54, -113], goku_blue: [54, -113], goku_ui: [54, -113] } };
const easeOut = k => 1 - (1 - k) * (1 - k);
function startGenki(h) {
  const b = { owner: h, genki: true, x: h.x, y: h.y - 300, r: 6, vx: 0, vy: 0, state: 'grow', t: 0, hit: new Set(), dir: h.dir };
  bombs.push(b);
  // préparation en forme normale (comme contre Buu) : la forme en cours revient au moment de repousser la sphère
  h.genki = { phase: 'rise', b, ct: 0, form: h.boost };
  h.boost = null;
  h.ultraSnd = audio.play('ultraCharge', 0.9, 1, 0);
  say(h, 'GENKIDAMA !');
}
function updateGenki(h, dt) {
  h.inv = Math.max(h.inv, 0.1); h.vy = 0;
  const G = h.genki, b = G?.b, t = h.t;
  if (!G) { h.state = 'idle'; return; }
  if (G.phase === 'rise' || G.phase === 'hold' || G.phase === 'throw') {
    h.y = h.gz - GENKI.height * easeOut(Math.min(1, t / GENKI.rise)) + (t > GENKI.rise ? Math.sin((t - GENKI.rise) * 4) * 5 : 0);
    if (G.phase === 'rise' && t >= GENKI.rise) G.phase = 'hold';
    if (G.phase === 'hold' && t >= GENKI.throwAt) {
      G.phase = 'throw'; b.state = 'fly'; b.t = 0; b.vx = h.dir * 300; b.vy = 360; b.gz = h.gz;
      if (h.ultraSnd) h.ultraSnd.s.stop();
      audio.play('ultraThrow', 1, 1, 0); shake = 10;
    }
  }
  if (G.phase === 'clash') {
    G.ct += dt;
    if (!G.ssj && G.ct >= GENKI.clash) {
      // la transformation qui donne la force de repousser la sphère
      G.ssj = true;
      const F = G.form || h.C.forms[0];
      if (F) { h.boost = F; h.ki = Math.max(h.ki, 35); }
      flash = 0.9; shake = 20; ring(h.x, h.y - 110); burst(h.x, h.y - 120, '#ffe066', 40);
      audio.play('transform', 1, 1.1, 0); audio.sweep(0.8, 3000, 7000, 0.25, 0.6);
      say(h, 'HAAAAAAA !');
    }
  }
  if (G.phase === 'land') {
    h.y += (h.gz - h.y) * Math.min(1, dt * 9);
    if (h.gz - h.y < 3) { h.y = h.gz; h.state = 'idle'; h.genki = null; }
  }
  if (t > 9) { h.y = h.gz; h.state = 'idle'; h.genki = null; } // filet de sécurité
}
function genkiPose(h) {
  const G = h.genki, t = h.t;
  if (!G) return ['combo', 0];
  if (G.phase === 'rise') return ['jump', t < 0.25 ? 2 : 3];
  if (G.phase === 'hold') return ['special', t < GENKI.rise + 0.5 ? 4 : t < GENKI.throwAt - 0.25 ? 5 : 6];
  if (G.phase === 'throw') return ['special', 7];
  // Super Saiyan : un seul bras tendu qui accompagne la sphère, l'autre poing à la hanche (comme contre Buu)
  if (G.phase === 'clash') return G.ssj && SPRITES[formSheet(h)]?.push ? ['push', 0] : ['special', 7];
  return ['jump', 6];
}
function updateGenkiBomb(b, dt) {
  const h = b.owner, G = h.genki;
  if (b.state === 'grow') {
    b.r = 6 + (GENKI.maxR - 6) * Math.min(1, b.t / GENKI.grow);
    b.x = h.x - h.dir * 6; b.y = Math.max(b.r * 0.7 + 6, h.y - 235 - b.r * 0.6);
    for (let k = 0; k < 3; k++) {
      const a = rand(0, Math.PI * 2), d = rand(250, 520);
      particles.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.2, vy: -Math.sin(a) * d * 2.2, t: 0, life: 0.42, c: b.fire ? '#ffb040' : '#9fe8ff', r: rand(2, 4) });
    }
    if (h.state !== 'ultra') b.done = true;
    return;
  }
  if (b.state === 'fly') {
    b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 500 * dt;
    if (b.y + b.r * 0.5 >= b.gz) {
      b.state = 'clash'; b.t = 0; b.y = b.gz - b.r * 0.5; b.r0 = b.r;
      if (G) G.phase = 'clash';
      shake = 14; hitstop = 0.08; audio.play('hitHeavy', 1, 0.6);
      for (const e of enemies) if (e.alive && Math.abs(e.x - b.x) < b.r + 90) { b.hit.add(e); damageEnemy(e, 2, 120 * b.dir, 0, e.x, e.y - 100, '#bff3ff'); }
    }
    return;
  }
  if (b.state === 'clash') {
    const ssj = G?.ssj, push = ssj ? b.t - GENKI.clash : 0;
    // avant : la sphère tremble et recule ; après : elle avance en grossissant, poussée par le faisceau
    b.x += (ssj ? b.dir * 260 : -b.dir * 40) * dt + rand(-3, 3);
    if (ssj) b.r = b.r0 * (1 + 0.6 * Math.min(1, push / GENKI.push));
    if (Math.random() < 0.7) particles.push({ x: b.x + rand(-b.r, b.r), y: b.gz - rand(0, 20), vx: rand(-300, 300), vy: -rand(150, 450), t: 0, life: 0.4, c: 'rgba(230,220,200,0.7)', r: rand(4, 9), soft: true });
    if (ssj) for (const e of enemies) {
      if (!e.alive || b.hit.has(e) || Math.abs(e.x - b.x) > b.r + 60) continue;
      b.hit.add(e); damageEnemy(e, 2, 300 * b.dir, -300, e.x, e.y - 100, '#fff3b0');
    }
    if (ssj && push >= GENKI.push) {
      b.state = 'boom'; b.t = 0; b.y = b.gz;
      flash = 1; shake = 32; hitstop = 0.14;
      audio.play('ultraBoom', 1.3, 0.9, 0);
      const dmg = 6 + h.power / 8;
      for (const e of enemies) {
        if (!e.alive || e.state === 'down' || Math.abs(e.x - b.x) > 560) continue;
        damageEnemy(e, dmg, 650 * (Math.sign(e.x - b.x) || 1), -850, e.x, e.y - 100, '#fff3b0');
      }
      score += 3000;
      popups.push({ x: b.x, y: b.gz - 280, t: 0, text: 'GENKIDAMA !!' });
      if (G) G.phase = 'land';
    }
    return;
  }
  if (b.state === 'boom' && b.t > 1.1) b.done = true;
}

function updateBomb(b, dt) {
  b.t += dt;
  const h = b.owner;
  if (b.genki) return updateGenkiBomb(b, dt);
  if (b.state === 'grow') {
    b.r = 6 + (b.maxR - 6) * Math.min(1, b.t / ULTRA.raise);
    b.x = h.x - h.dir * 6; b.y = h.y - 250 - b.r * 0.85;
    // Entei : des flammes montent de tout son corps et nourrissent le soleil
    if (b.fire) for (let k = 0; k < 3; k++) {
      const x = h.x + rand(-45, 45), y = h.y - rand(30, 200);
      particles.push({ x, y, vx: (b.x - x) * rand(1.6, 2.2), vy: (b.y - y) * rand(1.6, 2.2), t: 0, life: 0.45, c: Math.random() < 0.5 ? 'rgba(255,120,30,0.8)' : 'rgba(255,200,80,0.8)', r: rand(2, 4.5) });
    }
    // L'énergie de toute la ville converge vers la sphère
    else for (let k = 0; k < 3; k++) {
      const a = rand(0, Math.PI * 2), d = rand(250, 520);
      particles.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.2, vy: -Math.sin(a) * d * 2.2, t: 0, life: 0.42, c: b.fire ? '#ffb040' : '#9fe8ff', r: rand(2, 4) });
    }
    if (h.state === 'ultra' && h.t >= ULTRA.throwAt) {
      b.state = 'fly'; b.t = 0; b.dir = h.dir; b.vx = h.dir * 520; b.vy = 420; b.gz = h.gz;
      if (h.ultraSnd) h.ultraSnd.s.stop();
      audio.play('ultraThrow', 1, 1, 0); shake = 10;
    }
    if (h.state !== 'ultra') b.done = true; // interrompue (ne devrait pas arriver : invincible)
    return;
  }
  if (b.state === 'fly') {
    b.x += b.vx * dt; b.y += b.vy * dt;
    // traînée de flammes derrière le soleil d'Ace
    if (b.fire) for (let k = 0; k < 5; k++) {
      const a = rand(0, Math.PI * 2), d = b.r * rand(0.5, 0.95);
      particles.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, vx: -b.vx * rand(0.2, 0.5), vy: -b.vy * 0.3 - rand(40, 160), t: 0, life: rand(0.35, 0.6), c: ['#ff5a10', '#ff9a2a', '#ffd060'][k % 3], r: rand(10, 22) });
    }
    for (const e of enemies) {
      if (!e.alive || b.hit.has(e) || e.state === 'down') continue;
      if (Math.hypot(e.x - b.x, e.gz - 100 - b.y) < b.r + 60) { b.hit.add(e); damageEnemy(e, 6, 500 * b.dir, -700, e.x, e.y - 100, b.fire ? '#ffd0a0' : '#bff3ff'); }
    }
    if (b.y + b.r * 0.4 >= b.gz) {
      b.state = 'boom'; b.t = 0; b.y = b.gz;
      flash = 1; shake = 28; hitstop = 0.12;
      audio.play('ultraBoom', 1.2, 1, 0);
      const dmg = ULT_SOLO * (4 + h.power / 10);
      for (const e of enemies) {
        if (!e.alive || e.state === 'down' || Math.abs(e.x - b.x) > 480) continue;
        damageEnemy(e, dmg, 600 * (Math.sign(e.x - b.x) || 1), -800, e.x, e.y - 100, b.fire ? '#ffd0a0' : '#bff3ff');
      }
      if (b.fire) {
        // le soleil s'écrase : gerbes d'explosions de feu, colonne de flammes et braises
        for (let k = 0; k < 5; k++) animFX('explosion', b.x + rand(-300, 300), b.gz - rand(40, 200), rand(260, 420), rand(0.6, 0.9));
        animFX('explosion', b.x, b.gz - 160, 620, 1.0);
        for (let k = 0; k < 70; k++) particles.push({ x: b.x + rand(-260, 260), y: b.gz - rand(0, 60), vx: rand(-420, 420), vy: rand(-900, -250), t: 0, life: rand(0.6, 1.2), c: ['#ff4a00', '#ff8a1a', '#ffc040', '#fff0a0'][k % 4], r: rand(6, 16), streak: k % 3 === 0 });
      }
      score += 2000;
      popups.push({ x: b.x, y: b.gz - 260, t: 0, text: 'ULTIME !!' });
    }
    return;
  }
  if (b.state === 'boom' && b.t > 1.1) b.done = true;
}

// ---------- Ultime de Luffy : le poing gonflé, géant, qui balaie tout devant lui ----------
const GIGANT = { inflate: 0.6, punch: 1.3, end: 2.1, reach: 720 };
function startGigant(h) {
  h.punched = false; h.inflated = false;
  say(h, 'GOMU GOMU NO…');
  audio.sweep(1.2, 150, 900, 0.3, 2); // il souffle dans son pouce
}

function updateGigant(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (!h.inflated && h.t > GIGANT.inflate) { h.inflated = true; audio.play('ultraCharge', 0.7, 1.4, 0); shake = 8; }
  if (!h.punched && h.t >= GIGANT.punch) {
    h.punched = true;
    flash = 0.7; shake = 28; hitstop = 0.12;
    audio.stretch(); audio.play('ultraBoom', 1.2, 1.1, 0);
    popups.push({ x: h.x + h.dir * 260, y: h.y - 270, t: 0, text: 'GIGANT PISTOL !!' });
    ultraHit(h, GIGANT.reach, ULT_SOLO * (4 + h.power / 10), 80);
    impactFX(h.x + h.dir * 330, h.y - 130, '#fff3b0', true);
    for (let k = 0; k < 30; k++) particles.push({ x: h.x + h.dir * rand(150, 650), y: h.y - rand(60, 200), vx: h.dir * rand(300, 700), vy: rand(-150, 150), t: 0, life: 0.4, c: '#ffd27f', r: rand(2, 5) });
    score += 2000;
  }
  if (h.t > GIGANT.end) h.state = 'idle';
}

// ---------- Ultime de Naruto : le Rasenshuriken, formé au-dessus de la main, entouré de deux clones ----------
const RSH = { throwAt: 1.35, end: 1.9 };
function startShuriken(h) {
  h.thrown = false;
  say(h, 'KAGE BUNSHIN !');
  for (const s of [-1, 1]) for (let k = 0; k < 14; k++) particles.push({ x: h.x + s * 80 + rand(-25, 25), y: h.y - rand(20, 180), vx: rand(-60, 60), vy: rand(-80, 0), t: 0, life: 0.5, c: 'rgba(255,255,255,0.7)', r: rand(8, 14), soft: true });
  audio.play('ultraCharge', 0.8, 1.2, 0);
}

function updateShuriken(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (!h.thrown && h.t >= RSH.throwAt) {
    h.thrown = true;
    // géant, lancé depuis la main tendue ; il file à hauteur de poitrine, se plante dans le premier ennemi,
    // le broie un instant (sans le projeter) puis éclate en dôme : l'explosion porte l'essentiel des dégâts
    const hp = handPoint(h);
    projs.push({ kind: 'shuriken', owner: h, ult: true, x: h.x + h.dir * ((hp ? hp[0] : 40) + 110), y: hp ? h.y + hp[1] : h.y - 160, gz: h.gz, dir: h.dir, t: 0, speed: 620, life: 1.4,
      hit: new Set(), multiT: 0, dmg: 0.25, kb: 1, scale: 1.9, blast: 280, final: ULT_SOLO * (3 + h.power / 10) });
    say(h, 'RASENSHURIKEN !');
    audio.play('ultraThrow', 1, 1.2, 0); shake = 12;
  }
  if (h.t > RSH.end) h.state = 'idle';
}

// ---------- Ultime de Zoro : Sanzen Sekai, il tourne comme une tornade puis traverse la rue ----------
const SANZEN = { spin: 0.9, dash: 1.25, end: 1.75, speed: 1500 };
function startSanzen(h) {
  h.hitSet = new Set();
  say(h, h.char === 'inosuke' ? 'SOUFFLE DE LA BÊTE… CROCS FOUS !' : 'SANZEN SEKAI !');
  audio.play('ultraCharge', 0.7, 1.5, 0);
}

function updateSanzen(h, dt) {
  h.inv = Math.max(h.inv, 0.1);
  if (h.t < SANZEN.spin) {
    if (Math.random() < 0.5) slashFX(h.x + rand(-50, 50), h.y - rand(60, 170), h.dir, { a0: rand(-3, 0), a1: rand(0, 3), r: rand(50, 100), c: trailOf(h), life: 0.18, w: 10 });
    if (Math.random() < 0.3) audio.slash(0.6);
  } else if (h.t < SANZEN.dash) {
    const nx = clamp(h.x + h.dir * SANZEN.speed * dt, camX + 40, camX + W - 40);
    for (const e of enemies) {
      if (!e.alive || h.hitSet.has(e) || e.state === 'down' || Math.abs(e.gz - h.gz) > 70) continue;
      if ((e.x - h.x) * h.dir > -20 && (e.x - nx) * h.dir < 40) { h.hitSet.add(e); e.sanzen = true; }
    }
    h.x = nx;
    particles.push({ x: h.x - h.dir * 40, y: h.y - rand(40, 160), vx: -h.dir * 500, vy: 0, t: 0, life: 0.3, c: trailOf(h), r: rand(2, 4) });
  } else if (!h.cut) {
    // Les ennemis traversés sont tranchés tous ensemble, après le passage
    h.cut = true; flash = 0.6; shake = 26; hitstop = 0.14;
    audio.play('ultraBoom', 1.1, 1.2, 0); audio.slash(1.6);
    for (const e of enemies) if (e.sanzen) {
      e.sanzen = false;
      damageEnemy(e, ULT_SOLO * (4 + h.power / 10), 500 * h.dir, -800, e.x, e.y - 110, hitOf(h));
      if (FX.zoro_x && h.char === 'zoro') animFX('zoro_x', e.x, e.y - 110 * WORLD, 300 * WORLD, 0.5);
      slashFX(e.x, e.y - 110, h.dir, { x: true, r: 120, c: trailOf(h), life: 0.45, w: 18 });
    }
    score += 2000;
  }
  if (h.t > SANZEN.end) { h.state = 'idle'; h.cut = false; }
}

// ---------- Ultime de Tanjiro : la danse du dieu du feu, trois grands arcs de flammes ----------
const HINOKAMI = { cuts: [0.45, 0.85, 1.25], end: 1.75, reach: 340 };
function startHinokami(h) {
  h.cutN = 0;
  say(h, 'HINOKAMI KAGURA !');
  audio.play('transform', 0.8, 1.3, 0);
}

function updateHinokami(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (Math.random() < 0.8) particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(0, 180), vx: rand(-30, 30), vy: rand(-240, -100), t: 0, life: 0.5, c: Math.random() < 0.5 ? '#ff7a1a' : '#ffd060', r: rand(3, 7) });
  if (h.cutN < HINOKAMI.cuts.length && h.t >= HINOKAMI.cuts[h.cutN]) {
    const last = ++h.cutN === HINOKAMI.cuts.length;
    if (FX.hinokami_v) animFX('hinokami_v', h.x + h.dir * 90, h.y - 120 * WORLD, (last ? 560 : 420) * WORLD, last ? 0.8 : 0.55, { rot: h.cutN * 1.3 });
    slashFX(h.x + h.dir * 90, h.y - 120, h.dir, { a0: [-1.6, 1.4, -3.1][h.cutN - 1], a1: [1.4, -1.6, 3.1][h.cutN - 1], r: last ? 210 : 170, w: last ? 46 : 34, c: '#ff8a2a', element: 'fire', life: 0.45 });
    shake = last ? 26 : 12; flash = last ? 0.6 : 0.2; audio.slash(1.5);
    if (last) audio.play('ultraBoom', 1, 1.2, 0);
    ultraHit(h, HINOKAMI.reach, ULT_SOLO * (4 + h.power / 10) / 3, 70, -80);
    if (last) score += 2000;
  }
  if (h.t > HINOKAMI.end) h.state = 'idle';
}

// ---------- Ultime de Kenshin : Kuzu Ryu Sen (neuf coups à la fois) puis Amakakeru Ryu no Hirameki ----------
const AMA = { nine: 0.5, dash: 0.95, dashEnd: 1.2, end: 1.7, speed: 1700 };
function startAmakakeru(h) {
  h.hitSet = new Set(); h.nined = false; h.cut = false;
  audio.play('ultraCharge', 0.7, 1.6, 0);
}

function updateAmakakeru(h, dt) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  if (!h.nined && h.t >= AMA.nine) {
    // Neuf coups simultanés, venus de toutes les directions
    h.nined = true; say(h, 'KUZU RYU SEN !'); shake = 14; audio.slash(1.5);
    for (const e of enemies) {
      const dx = (e.x - h.x) * h.dir;
      if (!e.alive || e.state === 'down' || dx < -40 || dx > 300 || Math.abs(e.gz - h.gz) > 60) continue;
      for (let k = 0; k < 9; k++) {
        const a = k / 9 * Math.PI * 2;
        fxs.push({ type: 'slash', x: e.x + Math.cos(a) * 30, y: e.y - 110 + Math.sin(a) * 30, dir: 1, t: -k * 0.02, life: 0.3, r: 70, w: 16, a0: a - 0.6, a1: a + 0.6, cross: false, c: trailOf(h) });
      }
      damageEnemy(e, dmg * 0.4, 200 * h.dir, null, e.x, e.y - 110, hitOf(h));
    }
  }
  if (h.t >= AMA.dash && h.t < AMA.dashEnd) {
    // Le dégainage le plus rapide : il traverse la rue, laissant des images rémanentes
    const nx = clamp(h.x + h.dir * AMA.speed * dt, camX + 40, camX + W - 40);
    for (const e of enemies) {
      if (!e.alive || h.hitSet.has(e) || e.state === 'down' || Math.abs(e.gz - h.gz) > 70) continue;
      if ((e.x - h.x) * h.dir > -20 && (e.x - nx) * h.dir < 40) { h.hitSet.add(e); e.sanzen = true; }
    }
    h.x = nx;
    if (Math.random() < 0.5) afterImage(h);
  } else if (h.t >= AMA.dashEnd && !h.cut) {
    h.cut = true; flash = 0.7; shake = 28; hitstop = 0.14;
    say(h, 'AMAKAKERU RYU NO HIRAMEKI !'); audio.play('ultraBoom', 1.2, 1.3, 0); audio.slash(1.8);
    for (const e of enemies) if (e.sanzen) {
      e.sanzen = false;
      damageEnemy(e, dmg * 0.8, 500 * h.dir, -850, e.x, e.y - 110, hitOf(h));
      slashFX(e.x, e.y - 110, h.dir, { x: true, r: 130, c: trailOf(h), life: 0.45, w: 20 });
    }
    slashFX(h.x - h.dir * 200, h.y - 110, h.dir, { a0: -0.15, a1: 0.15, r: 320, w: 40, c: '#ffffff', life: 0.4 });
    score += 2000;
  }
  if (h.t > AMA.end) h.state = 'idle';
}

// ---------- Ultime de Kakashi : Kamui, une distorsion qui aspire les ennemis ----------
function startKamui(h) { h.vortex = null; say(h, 'KAMUI !'); audio.play('ultraCharge', 0.7, 0.8, 0); }
function updateKamui(h, dt) {
  h.inv = Math.max(h.inv, 0.1);
  if (!h.vortex && h.t >= 0.8) {
    const e = nearestEnemy(h, 600);
    h.vortex = { x: e ? e.x : h.x + h.dir * 280, y: (e ? e.gz : h.gz) - 110, gz: e ? e.gz : h.gz, hitT: 0 };
    fxs.push({ type: 'vortex', x: h.vortex.x, y: h.vortex.y, r: 150, t: 0, life: 1.1 });
    flash = 0.4; shake = 14;
  }
  const V = h.vortex;
  if (V && h.t < 1.9) {
    for (const e of enemies) {
      if (!e.alive || e.state === 'down' || Math.abs(e.x - V.x) > 320 || Math.abs(e.gz - V.gz) > 120) continue;
      e.x += (V.x - e.x) * Math.min(1, dt * 4); e.gz += (V.gz - e.gz) * Math.min(1, dt * 3); if (e.state !== 'knock') e.y = e.gz;
    }
    if (h.t - V.hitT > 0.2) {
      V.hitT = h.t;
      for (const e of enemies) if (e.alive && e.state !== 'down' && Math.abs(e.x - V.x) < 90 && Math.abs(e.gz - V.gz) < 80) damageEnemy(e, (4 + h.power / 10) / 6, 0, null, e.x, e.y - 110, '#c9a0ff');
    }
  }
  if (V && h.t >= 1.9 && !h.cut) {
    h.cut = true; flash = 0.6; shake = 22; audio.play('ultraBoom', 1, 1.4, 0);
    for (const e of enemies) if (e.alive && e.state !== 'down' && Math.abs(e.x - V.x) < 160) damageEnemy(e, 3, 600 * (Math.sign(e.x - V.x) || h.dir), -800, e.x, e.y - 110, '#c9a0ff');
    score += 2000;
  }
  if (h.t > 2.3) { h.state = 'idle'; h.cut = false; }
}

// ---------- Ultime de Sasuke : Kirin, un dragon de foudre tombé du ciel sur tous les ennemis ----------
// Le ciel s'assombrit et l'orage tourne au-dessus de la rue pendant qu'il lève le bras ; puis le dragon de foudre
// tombe et frappe le SOL au pied de chaque ennemi (bas de l'éclair = profondeur gz de la cible), éclairs secondaires
// eux aussi jusqu'au sol, cratère lumineux, débris, et des arcs qui crépitent encore au sol un instant.
const KIRIN = { strike: 1.35, fall: 0.12, hold: 0.35, arcs: 0.5, end: 2.4 };
let kirin = null; // { t, h, hits: [{ x, gz, e }], hit }
function startKirin(h) {
  h.cut = false; kirin = { t: 0, h, hits: [], hit: false };
  say(h, 'KIRIN…'); audio.play('ultraCharge', 0.8, 1.2, 0);
}
function updateKirin(h) {
  h.inv = Math.max(h.inv, 0.1);
  const K = kirin && kirin.h === h ? kirin : (kirin = { t: h.t, h, hits: [], hit: false });
  K.t = h.t;
  // éclairs dans les nuages pendant la charge
  if (h.t < KIRIN.strike && Math.random() < 0.12) animFX('bolt', camX + rand(60, W - 60), rand(30, 110), rand(60, 110), 0.2, { h: rand(120, 200) });
  if (!h.cut && h.t >= KIRIN.strike) {
    // cibles : chaque ennemi à l'écran ; sans ennemi, le dragon frappe le sol devant Sasuke
    h.cut = true; audio.play('ultraThrow', 1, 0.7, 0);
    for (const e of enemies) {
      if (!e.alive || e.state === 'down' || e.x < camX - 40 || e.x > camX + W + 40) continue;
      K.hits.push({ x: e.x, gz: e.gz, e });
    }
    if (!K.hits.length) K.hits.push({ x: h.x + h.dir * 260, gz: h.gz, e: null });
  }
  if (h.cut && !K.hit && h.t >= KIRIN.strike + KIRIN.fall) {
    K.hit = true; flash = 1; shake = 34; hitstop = 0.16; audio.play('ultraBoom', 1.1, 0.8, 0);
    for (const T of K.hits) {
      const e = T.e;
      if (e && e.alive) { T.x = e.x; T.gz = e.gz; damageEnemy(e, ULT_SOLO * (4 + h.power / 9), 300 * (Math.sign(e.x - h.x) || h.dir), -900, e.x, e.y - 110, '#cfe0ff'); }
      for (let k = 0; k < 26; k++) particles.push({ x: T.x + rand(-30, 30), y: T.gz - rand(0, 20), vx: rand(-420, 420), vy: rand(-700, -200), t: 0, life: rand(0.4, 0.8), c: Math.random() < 0.6 ? '#dff2ff' : '#7fc4ff', r: rand(2, 5) });
      for (let k = 0; k < 14; k++) particles.push({ x: T.x + rand(-40, 40), y: T.gz - rand(0, 10), vx: rand(-300, 300), vy: rand(-520, -180), t: 0, life: rand(0.5, 0.9), c: Math.random() < 0.5 ? '#5a4a3c' : '#2e2622', r: rand(4, 9) });
    }
    say(h, 'KIRIN !!'); score += 2000;
  }
  if (h.t > KIRIN.end) { h.state = 'idle'; kirin = null; }
}
// un éclair dentelé de (x0, y0) jusqu'au point d'arrivée (x1, y1), recalculé à chaque image (scintillement)
function boltPath(x0, y0, x1, y1, jag, n = 14) {
  const pts = [[x0, y0]];
  for (let k = 1; k < n; k++) { const u = k / n; pts.push([x0 + (x1 - x0) * u + rand(-jag, jag) * (1 - u * 0.6), y0 + (y1 - y0) * u + rand(-8, 8)]); }
  pts.push([x1, y1]); return pts;
}
function strokeBolt(pts, layers) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [w, c] of layers) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
}
// derrière les personnages : ciel d'orage et cratère lumineux au sol
function drawKirinBack() {
  const K = kirin; if (!K) return;
  if (K.h.state !== 'ultra') { kirin = null; return; }
  const t = K.t, dark = t < KIRIN.strike ? Math.min(1, t / 0.6) : Math.max(0, Math.min(1, 1 - (t - (KIRIN.end - 0.4)) / 0.4));
  ctx.save();
  ctx.fillStyle = `rgba(8,12,40,${0.55 * dark})`; ctx.fillRect(-20, -20, W + 40, H + 40);
  // nuages d'orage qui tournent au-dessus de la rue
  const cx = W / 2, rot = t * 0.8;
  for (let k = 0; k < 14; k++) {
    const a = rot + k * 0.45, r = 120 + (k % 4) * 90, x = cx + Math.cos(a) * r * 1.6, y = 20 + Math.sin(a) * 26 + (k % 3) * 10;
    const g = ctx.createRadialGradient(x, y, 4, x, y, 110);
    g.addColorStop(0, `rgba(30,34,60,${0.85 * dark})`); g.addColorStop(1, 'rgba(30,34,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 150, 60, 0, 0, 7); ctx.fill();
  }
  // œil de l'orage, qui s'éclaire juste avant la chute
  if (t < KIRIN.strike + KIRIN.fall) {
    const glow = Math.max(0, (t - (KIRIN.strike - 0.4)) / 0.4) * dark;
    const g = ctx.createRadialGradient(cx, 10, 0, cx, 10, 180);
    g.addColorStop(0, `rgba(180,220,255,${0.6 * glow})`); g.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - 200, -20, 400, 220);
  }
  // cratère : ellipse brûlante au sol, à la profondeur de l'impact, puis onde de choc
  if (K.hit) {
    const u = (t - KIRIN.strike - KIRIN.fall) / (KIRIN.hold + KIRIN.arcs);
    for (const T of K.hits) {
      const sx = T.x - camX, a = Math.max(0, 1 - u);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(sx, T.gz, 0, sx, T.gz, 130);
      g.addColorStop(0, `rgba(230,245,255,${0.9 * a})`); g.addColorStop(0.4, `rgba(110,180,255,${0.55 * a})`); g.addColorStop(1, 'rgba(60,120,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, T.gz, 130, 30, 0, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(20,16,24,${0.6 * Math.min(1, a * 2)})`; ctx.beginPath(); ctx.ellipse(sx, T.gz + 2, 70, 14, 0, 0, 7); ctx.fill();
      const rr = 60 + Math.min(1, u * 3) * 260;
      ctx.strokeStyle = `rgba(200,230,255,${0.8 * Math.max(0, 1 - u * 3)})`; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(sx, T.gz, rr, rr * 0.22, 0, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
}
// devant les personnages : le dragon de foudre, les éclairs secondaires et les arcs résiduels au sol
function drawKirinFront() {
  const K = kirin; if (!K || !K.hits.length) return;
  const t = K.t - KIRIN.strike, fallT = KIRIN.fall, holdEnd = fallT + KIRIN.hold, arcEnd = holdEnd + KIRIN.arcs;
  if (t < 0 || t > arcEnd) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const MAIN = [[70, 'rgba(70,140,255,0.22)'], [38, 'rgba(120,190,255,0.45)'], [18, 'rgba(200,235,255,0.9)'], [7, '#ffffff']];
  const SIDE = [[16, 'rgba(90,160,255,0.35)'], [6, 'rgba(210,240,255,0.9)'], [2, '#ffffff']];
  for (const T of K.hits) {
    const sx = T.x - camX, gy = T.gz, top = -30, x0 = sx - 90;
    if (t < holdEnd) {
      // le dragon descend du ciel : sa tête atteint le sol en `fall` secondes, puis l'éclair reste planté au sol
      const p = Math.min(1, t / fallT), fy = top + (gy - top) * p, fx = x0 + (sx - x0) * p;
      ctx.globalAlpha = t > fallT && Math.random() < 0.15 ? 0.5 : 1;
      strokeBolt(boltPath(x0, top, fx, fy, 34), MAIN);
      // éclairs secondaires, ramifiés depuis le tronc, qui tombent eux aussi jusqu'au sol de part et d'autre
      if (p >= 1) for (let k = 0; k < 4; k++) {
        const u = 0.25 + k * 0.16, bx = x0 + (sx - x0) * u, by = top + (gy - top) * u, ex = sx + (k % 2 ? 1 : -1) * rand(60, 150);
        strokeBolt(boltPath(bx, by, ex, gy + rand(-6, 6), 22, 8), SIDE);
      }
      // tête du dragon : gueule ouverte et cornes, au front de l'éclair (elle se pose au sol)
      const hy = Math.min(fy, gy - 24), ang = Math.atan2(gy - top, sx - x0);
      ctx.save(); ctx.translate(fx, hy); ctx.rotate(ang - Math.PI / 2);
      ctx.fillStyle = 'rgba(210,240,255,0.95)'; ctx.shadowColor = '#7fc4ff'; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.moveTo(-34, -40); ctx.lineTo(34, -40); ctx.lineTo(18, 10); ctx.lineTo(4, -4); ctx.lineTo(0, 30); ctx.lineTo(-4, -4); ctx.lineTo(-18, 10); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-26, -40); ctx.lineTo(-52, -86); ctx.lineTo(-14, -48); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(26, -40); ctx.lineTo(52, -86); ctx.lineTo(14, -48); ctx.closePath(); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
      // éclat à l'impact, posé sur le sol
      if (p >= 1) {
        const g = ctx.createRadialGradient(sx, gy, 0, sx, gy, 110);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(150,200,255,0.5)'); g.addColorStop(1, 'rgba(80,140,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, gy - 20, 110, 70, 0, 0, 7); ctx.fill();
      }
    } else {
      // arcs résiduels : petits éclairs qui sautent d'un point du sol à l'autre autour du cratère
      ctx.globalAlpha = Math.max(0, 1 - (t - holdEnd) / KIRIN.arcs);
      for (let k = 0; k < 4; k++) {
        if (Math.random() < 0.35) continue;
        const ax = sx + rand(-120, 120), bx = ax + rand(-70, 70), pts = boltPath(ax, gy + rand(-6, 6), bx, gy + rand(-6, 6), 14, 5);
        for (let i = 1; i < pts.length - 1; i++) pts[i][1] = gy - rand(0, 22); // l'arc se soulève un peu entre deux points du sol
        strokeBolt(pts, SIDE);
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// ---------- Ultime de Gohan : le Kamehameha père-fils (l'esprit de Sangoku derrière lui) ----------
const FSK = { fire: 1.1, end: 2.6 };
function startFatherSon(h) { h.beamed = false; h.ultraSheet = 'gohan_ssj'; say(h, 'PAPA…'); audio.play('ultraCharge', 0.9, 1, 0); }
function updateFatherSon(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (!h.beamed && h.t >= FSK.fire) {
    h.beamed = true; flash = 0.8; shake = 26; audio.voice(h, 'ultra');
    projs.push({ kind: 'beam', hand: true, owner: h, move: 'ultra', at: FSK.fire, end: FSK.end - 0.15, len: 1300, thick: 2, dmg: (4 + h.power / 10) / 9.5, color: '#7fd8ff', t: 0, hit: new Set(), multiT: 0, dir: h.dir, gz: h.gz });
    say(h, 'KAMEHAMEHA !!'); score += 2000;
  }
  // aura dorée et éclairs du Super Saiyan 2
  if (Math.random() < 0.8) particles.push({ x: h.x + rand(-45, 45), y: h.y - rand(10, 170), vx: rand(-20, 20), vy: rand(-260, -120), t: 0, life: 0.45, c: Math.random() < 0.7 ? '#ffd84a' : '#8fd8ff', r: rand(3, 6), soft: true });
  if (h.t > FSK.end) { h.state = 'idle'; h.ultraSheet = null; }
}

// ---------- Ultime d'Ichigo : un Getsuga Tensho géant ----------
function startMugetsu(h) { h.thrown = false; say(h, 'MUGETSU…'); audio.play('ultraCharge', 0.8, 0.9, 0); }
function updateMugetsu(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (Math.random() < 0.7) particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(0, 200), vx: 0, vy: rand(-200, -80), t: 0, life: 0.5, c: '#1a0008', r: rand(4, 8), soft: true });
  if (!h.thrown && h.t >= 1.4) {
    h.thrown = true; flash = 0.7; shake = 24; audio.play('ultraThrow', 1, 0.8, 0); audio.slash(1.4);
    projs.push({ kind: 'getsuga', filter: 'hue-rotate(160deg) saturate(2) brightness(0.8)', scale: 2.6, owner: h, x: h.x + h.dir * 100, y: h.y - 130, gz: h.gz, dir: h.dir, t: 0, speed: 800, life: 1.4, hit: new Set(), dmg: ULT_SOLO * (4 + h.power / 10), kb: 600, launch: -800 });
    say(h, 'GETSUGA TENSHO !!'); score += 2000;
  }
  if (h.t > 2.0) h.state = 'idle';
}

// ---------- Ultime de Jin-Woo : « ARISE », ses soldats de l'ombre jaillissent du sol et chargent ----------
function startArise(h) { h.punched = false; h.soldiers = 0; say(h, 'ARISE.'); audio.play('ultraCharge', 0.8, 0.7, 0); }
function updateArise(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (Math.random() < 0.8) particles.push({ x: h.x + rand(-200, 200), y: h.gz - rand(0, 40), vx: rand(-30, 30), vy: rand(-260, -120), t: 0, life: 0.6, c: Math.random() < 0.5 ? '#2a0a50' : '#a050ff', r: rand(4, 9), soft: true });
  // les ombres sortent du sol l'une après l'autre (silhouettes de Jin-Woo teintées), puis foncent devant
  const n = Math.floor((h.t - 0.5) / 0.12);
  while (h.t > 0.5 && h.soldiers <= n && h.soldiers < 7) {
    h.soldiers++;
    const k = h.soldiers, x = h.x + h.dir * (60 + k * 70);
    fxs.push({ type: 'ghost', x, y: h.gz, dir: h.dir, sheet: sheetFor(h, 'combo'), anim: 'combo', i: [2, 3, 5, 6][k % 4], t: 0, life: 0.9, alpha: 0.85, col: '#5a1aa0' });
    burst(x, h.gz - 10, '#a050ff', 8);
  }
  if (!h.punched && h.t >= 1.4) {
    h.punched = true; flash = 0.6; shake = 26; hitstop = 0.1; audio.play('ultraBoom', 1.1, 0.7, 0);
    popups.push({ x: h.x + h.dir * 300, y: h.y - 280, t: 0, text: 'ARMÉE DES OMBRES !!' });
    ultraHit(h, 820, ULT_SOLO * (4 + h.power / 10), 120);
    for (let k = 0; k < 4; k++) animFX('nen', h.x + h.dir * (180 + k * 170), h.y - 120, 300, 0.5 + k * 0.08, { filter: 'hue-rotate(60deg) saturate(1.5)' });
    score += 2000;
  }
  if (h.t > 2.0) h.state = 'idle';
}

// ---------- Ultime de Zenitsu et Killua : une suite d'éclairs qui traverse tous les ennemis ----------
const ZIG = { start: 0.45, every: 0.16, max: 7 };
function startZigzag(h) {
  h.zz = []; h.zzN = 0; say(h, h.char === 'zenitsu' ? 'HONOIKAZUCHI NO KAMI !' : 'GODSPEED !');
  audio.play('ultraCharge', 0.7, 1.6, 0);
}
function updateZigzag(h) {
  h.inv = Math.max(h.inv, 0.1);
  const n = Math.floor((h.t - ZIG.start) / ZIG.every);
  if (h.t >= ZIG.start && n >= h.zzN && h.zzN < ZIG.max) {
    h.zzN++;
    const targets = enemies.filter(e => e.alive && e.state !== 'down' && Math.abs(e.x - h.x) < 700);
    const e = targets.length ? targets[(h.zzN - 1) % targets.length] : null;
    afterImage(h);
    const tint = h.char === 'zenitsu' ? 'hue-rotate(-150deg) saturate(2)' : '';
    animFX('bolt', h.x, h.y - 130, 120, 0.25, { h: 300, filter: tint });
    if (e) { h.dir = Math.sign(e.x - h.x) || h.dir; h.x = e.x + h.dir * 70; h.gz = e.gz; h.y = e.gz; h.dir = -h.dir;
      damageEnemy(e, (4 + h.power / 10) / 4.4, 300 * -h.dir, h.zzN === ZIG.max ? -800 : null, e.x, e.y - 110, hitOf(h));
      slashFX(e.x, e.y - 110, h.dir, { x: true, r: 100, c: trailOf(h), life: 0.3 }); }
    else h.x = clamp(h.x + h.dir * 200, camX + 40, camX + W - 40);
    h.x = clamp(h.x, camX + 40, camX + W - 40);
    shake = Math.max(shake, 10); audio.zip(); audio.slash(1.5);
    if (h.zzN === ZIG.max) { flash = 0.6; score += 2000; audio.play('ultraBoom', 1, 1.5, 0); }
  }
  if (h.t > ZIG.start + ZIG.every * ZIG.max + 0.4) { h.state = 'idle'; h.zz = null; }
}

// ---------- Ultime d'Izuku et de Gon : un coup de poing titanesque qui balaie la rue ----------
const SMASH = { hit: 1.2, end: 1.9 };
function startSmash(h) {
  h.punched = false;
  say(h, { gon: 'PREMIER… DERNIER… JAJANKEN !', saitama: 'COUPS DE POING SÉRIEUX.' }[h.char] || 'ONE FOR ALL… 100 % !');
  audio.play('ultraCharge', 0.9, 1, 0);
}
function updateSmash(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (h.t < SMASH.hit && Math.random() < 0.5) {
    if (h.char === 'izuku') animFX('green_arc', h.x + rand(-45, 45), h.y - rand(50, 170), rand(40, 70), 0.18);
    else particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(0, 200), vx: rand(-30, 30), vy: rand(-220, -80), t: 0, life: 0.5, c: '#ffe680', r: rand(3, 6) });
  }
  if (!h.punched && h.t >= SMASH.hit) {
    h.punched = true; flash = 0.9; shake = 30; hitstop = 0.14;
    popups.push({ x: h.x + h.dir * 260, y: h.y - 270, t: 0, text: { gon: 'GU !!!', saitama: 'COUP DE POING SÉRIEUX !!' }[h.char] || 'UNITED STATES OF SMASH !!' });
    audio.play('ultraBoom', 1.3, 0.9, 0);
    for (let k = 0; k < 4; k++) animFX(h.char === 'gon' ? 'nen' : 'explosion', h.x + h.dir * (160 + k * 160), h.y - 120 - rand(-30, 30), 360 - k * 30, 0.6 + k * 0.08);
    ultraHit(h, 800, ULT_SOLO * (4 + h.power / 10), 110);
    for (let k = 0; k < 40; k++) particles.push({ x: h.x + h.dir * rand(100, 800), y: h.y - rand(20, 260), vx: h.dir * rand(500, 1100), vy: rand(-120, 120), t: 0, life: 0.45, c: '#ffffff', r: rand(2, 5) });
    score += 2000;
  }
  if (h.t > SMASH.end) h.state = 'idle';
}

// ---------- Ultime de Trunks : Shining Sword Attack, un grand coup d'épée vertical puis une décharge de ki ----------
const SHINE = { leap: 0.35, cut: 0.8, blast: 1.2, end: 1.9, reach: 340 };
function startShining(h) { h.cut = false; h.thrown = false; say(h, 'SHINING…'); audio.play('ultraCharge', 0.8, 1.2, 0); }
function updateShining(h) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  if (!h.cut && h.t >= SHINE.cut) {
    // la lame tombe du ciel : tout ce qui est devant est fendu
    h.cut = true; flash = 0.5; shake = 22; hitstop = 0.1; audio.slash(1.8);
    slashFX(h.x + h.dir * 120, h.y - 150, h.dir, { a0: -1.55, a1: 1.45, r: 220, w: 46, c: '#ffffff', life: 0.45 });
    ultraHit(h, SHINE.reach, dmg * 0.55, 80, -40, 150, 0); // l'ennemi reste au sol : la Burning Attack le cueille
    say(h, 'SWORD !!');
  }
  if (!h.thrown && h.t >= SHINE.blast) {
    h.thrown = true; flash = 0.6; shake = 24; audio.play('ultraBoom', 1.1, 1.2, 0);
    const hp = handPoint(h); // la boule naît devant les paumes, pas centrée sur Trunks
    projs.push({ kind: 'burning', owner: h, x: h.x + h.dir * ((hp ? hp[0] : 60) + PROJ_R.burning * 2.2), y: hp ? h.y + hp[1] : h.y - 120, gz: h.gz, dir: h.dir, t: 0, speed: 1000, life: 1.1, hit: new Set(), dmg: dmg * 0.45, kb: 700, launch: -800, scale: 2.2 });
    popups.push({ x: h.x + h.dir * 260, y: h.y - 270, t: 0, text: 'SHINING SWORD ATTACK !!' });
    score += 2000;
  }
  if (h.t > SHINE.end) h.state = 'idle';
}
// ---------- Ultime de Guts : il fend tout devant lui avec l'épée gigantesque, puis tire le canon de son bras ----------
const DRAGON = { leap: 0.4, cut: 0.9, blast: 1.35, end: 2.0, reach: 380 };
function startDragonslayer(h) { h.cut = false; h.thrown = false; say(h, 'TUEUR DE DRAGONS…'); audio.play('ultraCharge', 0.8, 0.9, 0); }
function updateDragonslayer(h) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  if (!h.cut && h.t >= DRAGON.cut) {
    h.cut = true; flash = 0.5; shake = 28; hitstop = 0.14; audio.slash(2);
    slashFX(h.x + h.dir * 140, h.y - 150, h.dir, { a0: -1.6, a1: 1.5, r: 250, w: 60, c: '#d8d8d8', life: 0.5 });
    ultraHit(h, DRAGON.reach, dmg * 0.6, 90, -40, 150, 0);
    say(h, 'HAAAAA !!');
  }
  if (!h.thrown && h.t >= DRAGON.blast) {
    h.thrown = true; flash = 0.4; shake = 20; audio.play('ultraBoom', 1, 0.8, 0);
    const hp = handPoint(h); // l'obus sort du bras de fer tendu, devant la main
    const sx0 = h.x + h.dir * ((hp ? hp[0] : 70) + PROJ_R.shell * 1.6), sy0 = hp ? h.y + hp[1] : h.y - 120;
    projs.push({ kind: 'shell', owner: h, x: sx0, y: sy0, gz: h.gz, dir: h.dir, t: 0, speed: 1300, life: 1.0, hit: new Set(), dmg: dmg * 0.4, kb: 700, launch: -800, scale: 1.6 });
    cannonFX(sx0 - h.dir * 18, sy0, h.dir, 1.5);
    popups.push({ x: h.x + h.dir * 260, y: h.y - 270, t: 0, text: 'TUEUR DE DRAGONS !!' });
    score += 2000;
  }
  if (h.t > DRAGON.end) h.state = 'idle';
}

// ---------- Ultime de Sanji : Hell Memories. Il tourne sur lui-même, bondit et écrase tout d'un talon en flammes ----------
const HELL = { leap: 0.35, rise: 0.6, slam: 1.0, burst: 1.3, end: 1.9, reach: 300, height: 170 };
function startHellMemories(h) { h.cut = false; h.thrown = false; say(h, 'HELL MEMORIES…'); audio.play('ultraCharge', 0.8, 1.1, 0); }
function updateHellMemories(h) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  legFlames(h, 3);
  // saut puis chute talon en avant
  if (h.t > HELL.leap && h.t < HELL.slam) { const u = (h.t - HELL.leap) / (HELL.slam - HELL.leap); h.y = h.gz - HELL.height * Math.sin(Math.PI * Math.min(1, u * 1.15)); }
  else h.y = h.gz;
  h.vy = 0; // reste « au sol » pour la physique : la hauteur est imposée ici, comme la Genkidama
  if (!h.cut && h.t >= HELL.slam) {
    h.cut = true; flash = 0.5; shake = 26; hitstop = 0.12; audio.slash(1.9); audio.play('ultraBoom', 0.9, 1.3, 0);
    ultraHit(h, HELL.reach * 0.75, dmg * 0.6, 90, -90, 80, 0);
    animFX('rupture', h.x + h.dir * 90, h.gz - 70, 260, 0.5);
    for (let k = 0; k < 40; k++) particles.push({ x: h.x + h.dir * rand(0, 200), y: h.gz - rand(0, 40), vx: rand(-300, 300), vy: rand(-500, -150), t: 0, life: 0.6, c: Math.random() < 0.5 ? '#ff6a1a' : '#ffd060', r: rand(4, 9) });
    say(h, 'CONCASSÉ !!');
  }
  if (!h.thrown && h.t >= HELL.burst) {
    // l'enfer remonte du sol : une colonne de flammes devant lui
    h.thrown = true; flash = 0.4; shake = 18;
    ultraHit(h, HELL.reach, dmg * 0.4, 100, -60);
    for (let k = 0; k < 70; k++) particles.push({ x: h.x + h.dir * rand(20, HELL.reach), y: h.gz - rand(0, 30), vx: rand(-60, 60), vy: rand(-700, -300), t: 0, life: 0.7, c: Math.random() < 0.5 ? '#ff4a10' : '#ffc040', r: rand(5, 11) });
    popups.push({ x: h.x + h.dir * 220, y: h.y - 270, t: 0, text: 'HELL MEMORIES !!' });
    score += 2000;
  }
  if (h.t > HELL.end) { h.y = h.gz; h.state = 'idle'; }
}
// ---------- Ultime de Shoto : un glacier géant jaillit devant lui, puis un brasier sort de sa main gauche ----------
const GLACIER = { ice: 0.7, fire: 1.35, end: 2.2, reach: 420 };
function startGlacier(h) { h.cut = false; h.thrown = false; say(h, 'GLACIER…'); audio.play('ultraCharge', 0.8, 1.0, 0); }
function updateGlacier(h) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  if (!h.cut && h.t >= GLACIER.ice) {
    h.cut = true; flash = 0.5; shake = 24; hitstop = 0.1; audio.slash(1.6);
    ultraHit(h, GLACIER.reach, dmg * 0.5, 100, -40, 60, 0); // pris dans la glace : le brasier le touche ensuite
    // pics de glace géants posés au sol devant lui (décor : les dégâts viennent d'ultraHit)
    projs.push({ kind: 'glacier', owner: h, x: h.x + h.dir * 60, y: h.gz, gz: h.gz, dir: h.dir, t: 0, speed: 0, life: GLACIER.end - GLACIER.ice + 0.3, hit: new Set(), dmg: 0, len: GLACIER.reach });
  }
  if (!h.thrown && h.t >= GLACIER.fire) {
    // brasier continu depuis le bout de la main gauche tendue (il suit la main, voir updateProjs)
    h.thrown = true; flash = 0.4; shake = 16; audio.play('waveFire', 1.1, 0.8, 0);
    projs.push({ kind: 'flamejet', owner: h, move: 'ultra', end: GLACIER.end - 0.15, len: 0, reach: 520, x: h.x, y: h.y - 120, gz: h.gz, dir: h.dir, t: 0, hit: new Set(), multiT: 0, dmg: dmg * 0.5 / 9 });
    popups.push({ x: h.x + h.dir * 240, y: h.y - 270, t: 0, text: 'GLACIER ET BRASIER !!' });
    score += 2000;
  }
  if (h.t > GLACIER.end) h.state = 'idle';
}

// ---------- Ultime de Saber : Excalibur, l'épée levée tranche puis libère un faisceau doré depuis la lame ----------
const EXCAL = { raise: 0.35, slash: 0.75, beam: 1.1, end: 2.25 };
function startExcalibur(h) { h.cut = false; h.beamed = false; say(h, 'EX…'); audio.play('ultraCharge', 0.9, 1.15, 0); }
function updateExcalibur(h) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  if (h.t < EXCAL.slash && Math.random() < 0.7) particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(60, 300), vx: rand(-30, 30), vy: rand(-160, -60), t: 0, life: 0.5, c: Math.random() < 0.5 ? '#fff2a0' : '#ffd040', r: rand(2, 5) });
  if (!h.cut && h.t >= EXCAL.slash) {
    h.cut = true; flash = 0.4; shake = 16; hitstop = 0.08; audio.slash(1.6);
    slashFX(h.x + h.dir * 110, h.y - 150, h.dir, { a0: -1.55, a1: 1.45, r: 200, w: 40, c: '#fff2a0', life: 0.4 });
    ultraHit(h, 300, dmg * 0.3, 80);
  }
  if (!h.beamed && h.t >= EXCAL.beam) {
    // faisceau doré qui part de la pointe de la lame tendue (hand : suit le bout de l'épée dessinée)
    h.beamed = true; flash = 0.8; shake = 24; say(h, 'EXCALIBUR !!');
    audio.play('waveFire', 1.2, 0.7, 0); audio.play('ultraBoom', 0.9, 1.2, 0);
    projs.push({ kind: 'beam', hand: true, dy: 20, owner: h, move: 'ultra', at: EXCAL.beam, end: EXCAL.end - 0.12, len: 1200, thick: 1.9, dmg: dmg * 0.75 / 13, color: '#fff2a0', filter: 'hue-rotate(205deg) saturate(1.3) brightness(1.35)', t: 0, hit: new Set(), multiT: 0, dir: h.dir, gz: h.gz });
    popups.push({ x: h.x + h.dir * 260, y: h.y - 270, t: 0, text: 'EXCALIBUR !!' });
    score += 2000;
  }
  if (h.t > EXCAL.end) h.state = 'idle';
}

// ---------- Ultime de Mikasa : assaut tridimensionnel, des passages au grappin d'un bord à l'autre de l'écran ----------
const ODM = { start: 0.35, passes: 5, pass: 0.3, end: 2.45 };
function startOdm(h) { h.pass = -1; h.dir0 = h.dir; h.punched = false; say(h, 'ACKERMAN…'); audio.play('ultraCharge', 0.8, 1.3, 0); }
function updateOdm(h) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10), run = h.t - ODM.start, i = Math.floor(run / ODM.pass);
  if (run >= 0 && i < ODM.passes) {
    if (i !== h.pass) {
      // nouveau passage : elle repart du bord opposé, dans l'autre sens
      h.pass = i; h.passHit = new Set(); h.dir = i % 2 ? -h.dir0 : h.dir0;
      h.passX0 = h.dir > 0 ? camX + 40 : camX + W - 40; audio.whoosh(1.2); audio.slash(1.3);
    }
    const f = (run - i * ODM.pass) / ODM.pass;
    h.x = h.passX0 + h.dir * (W - 80) * f;
    for (const e of enemies) {
      if (!e.alive || e.state === 'down' || h.passHit.has(e) || Math.abs(e.x - h.x) > 70 || Math.abs(e.gz - h.gz) > 75) continue;
      h.passHit.add(e); damageEnemy(e, dmg * 0.8 / ODM.passes, 40 * h.dir, 0, e.x, e.y - 110, hitOf(h)); // sans projeter : le passage suivant la retrouve
      slashFX(e.x, e.y - 110, h.dir, { a0: -0.7, a1: 0.7, r: 90, w: 22, c: '#ffffff', life: 0.25 });
    }
    for (let k = 0; k < 3; k++) particles.push({ x: h.x - h.dir * rand(0, 60), y: h.y - rand(60, 150), vx: -h.dir * rand(100, 300), vy: rand(-40, 40), t: 0, life: 0.3, c: k ? '#e8eef4' : '#c8102e', r: rand(2, 5) });
  } else if (run >= 0 && !h.punched) {
    // dernière double entaille au centre
    h.punched = true; h.dir = h.dir0; flash = 0.5; shake = 20; hitstop = 0.1; audio.slash(1.8);
    // le dernier passage la laisse au bord de l'écran : elle revient au grappin juste devant l'ennemi le plus proche
    const tgt = enemies.filter(e => e.alive && e.x > camX && e.x < camX + W).sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x))[0];
    if (tgt) { afterImage(h, 0.2, 0.4, '#c8102e'); h.x = tgt.x - h.dir * 110; h.gz = h.y = tgt.gz; }
    slashFX(h.x + h.dir * 110, h.y - 130, h.dir, { x: true, r: 170, w: 40, c: '#ffffff', life: 0.4 });
    ultraHit(h, 260, dmg * 0.2, 80, -120);
    popups.push({ x: h.x + h.dir * 200, y: h.y - 260, t: 0, text: 'ASSAUT TRIDIMENSIONNEL !!' });
    score += 2000;
  }
  if (h.t > ODM.end) h.state = 'idle';
}

// ---------- Ultime de Revy : pluie de balles. Elle bondit et tourne en l'air en vidant ses deux pistolets, puis achève ----------
const RAIN = { leap: 0.3, end: 2.3, land: 0.55, every: 0.07, height: 120 };
function startBulletRain(h) { h.rainT = 0; h.cut = false; say(h, 'ON VA DANSER…'); audio.play('ultraCharge', 0.8, 1.3, 0); }
function updateBulletRain(h) {
  h.inv = Math.max(h.inv, 0.1);
  // ×1,25 : une partie de la pluie passe à côté (mesuré ~15 sans)
  const dmg = 1.25 * ULT_SOLO * (4 + h.power / 10), air0 = RAIN.leap, air1 = RAIN.end - RAIN.land;
  // en l'air, elle tourne sur elle-même : les balles partent des deux côtés et frappent tout l'écran
  if (h.t > air0 && h.t < air1) {
    const u = (h.t - air0) / (air1 - air0); h.y = h.gz - RAIN.height * Math.sin(Math.PI * u); h.vy = 0;
    if (h.t - h.rainT >= RAIN.every) {
      const share = (h.t - Math.max(h.rainT, air0)) / (air1 - air0); // part de la pluie depuis la rafale précédente
      h.rainT = h.t;
      const side = Math.floor(h.t / RAIN.every) % 2 ? 1 : -1;
      const by = h.y - 130 + rand(-15, 15);
      projs.push({ kind: 'bullet', fx: true, owner: h, x: h.x + side * 40, y: by, gz: h.gz, dir: side, t: 0, speed: 2200, life: 0.45, hit: new Set(), dmg: 0 });
      fxs.push({ type: 'muzzle', x: h.x + side * 34, y: by, dir: side, t: 0, life: 0.06, rot: rand(-0.3, 0.3) });
      audio.play('waveHit', 0.2, 2.6, 0.08);
      for (const e of enemies) {
        if (!e.alive || e.state === 'down' || e.x < camX - 20 || e.x > camX + W + 20 || Math.abs(e.gz - h.gz) > 110) continue;
        damageEnemy(e, dmg * 0.78 * share, 30 * Math.sign(e.x - h.x || 1), 0, e.x, e.y - rand(80, 150), '#ffe0a0');
      }
    }
  } else h.y = h.gz;
  // atterrissage : les deux pistolets ensemble, à bout portant
  if (!h.cut && h.t >= air1 + 0.1) {
    h.cut = true; flash = 0.5; shake = 20; hitstop = 0.1; audio.play('ultraBoom', 0.9, 1.4, 0);
    fireBullet(h, { dmg: 0, kb: 0, fx: true });
    ultraHit(h, 600, dmg * 0.25, 120, -200);
    popups.push({ x: h.x + h.dir * 220, y: h.y - 270, t: 0, text: 'PLUIE DE BALLES !!' });
    score += 2000;
  }
  if (h.t > RAIN.end) { h.y = h.gz; h.state = 'idle'; }
}

// ---------- Ultime de Gally : Panzer Kunst. Une rafale de coups en avançant, un coup de pied tournant, puis la paume ----------
const PANZER = { rush: 0.3, leap: 1.3, kick: 1.55, palm: 1.9, end: 2.35, every: 0.1 };
function startPanzer(h) { h.rushT = 0; h.cut = h.thrown = false; say(h, 'PANZER KUNST…'); audio.play('ultraCharge', 0.8, 1.4, 0); }
function updatePanzer(h, dt) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  if (h.t > PANZER.rush && h.t < PANZER.leap) {
    // rafale : elle avance coup après coup
    h.x = clamp(h.x + h.dir * 170 * dt, camX + 40, camX + W - 40);
    if (h.t - h.rushT >= PANZER.every) {
      h.rushT = h.t; audio.hit(false); afterImage(h, 0.2, 0.35, '#7ac8ff');
      ultraHit(h, 200, dmg * 0.5 / ((PANZER.leap - PANZER.rush) / PANZER.every), 70, -20, 90, 0);
    }
  }
  // coup de pied tournant en l'air
  if (h.t > PANZER.leap && h.t < PANZER.palm) { const u = (h.t - PANZER.leap) / (PANZER.palm - PANZER.leap); h.y = h.gz - 90 * Math.sin(Math.PI * u); h.vy = 0; } else h.y = h.gz;
  if (!h.cut && h.t >= PANZER.kick) {
    h.cut = true; shake = 16; hitstop = 0.06; audio.slash(1.5);
    slashFX(h.x + h.dir * 90, h.y - 110, h.dir, { a0: -3.1, a1: 3.1, r: 150, w: 30, c: '#bfe4ff', life: 0.3 });
    ultraHit(h, 260, dmg * 0.25, 80, -60, 120, 0);
  }
  // la paume finale : onde de choc
  if (!h.thrown && h.t >= PANZER.palm) {
    h.thrown = true; flash = 0.6; shake = 24; hitstop = 0.12; audio.play('ultraBoom', 1, 1.2, 0);
    shockFX(h.x + h.dir * 130, h.y - 120, h.dir);
    ultraHit(h, 280, dmg * 0.25, 90, -20);
    popups.push({ x: h.x + h.dir * 220, y: h.y - 270, t: 0, text: 'PANZER KUNST !!' });
    score += 2000;
  }
  if (h.t > PANZER.end) { h.y = h.gz; h.state = 'idle'; }
}

// ---------- Ultime de Livaï : le tourbillon du capitaine. Il traverse l'écran une fois en toupie, en spirale ----------
// (il monte et descend en tournant), coupant tout sur son passage à intervalles réguliers, puis double entaille finale.
const SPIRAL = { start: 0.3, run: 1.4, every: 0.12, height: 90, end: 2.3 };
function startSpiral(h) { h.spinT = 0; h.cut = false; h.spinHits = new Map(); h.dir0 = h.dir; h.runX0 = h.x; say(h, 'TCH…'); audio.play('ultraCharge', 0.8, 1.4, 0); }
function updateSpiral(h) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10), u = (h.t - SPIRAL.start) / SPIRAL.run;
  if (u >= 0 && u < 1) {
    // de sa position jusqu'au bord d'en face, en montant et descendant deux fois
    const x1 = h.dir0 > 0 ? camX + W - 70 : camX + 70;
    h.x = h.runX0 + (x1 - h.runX0) * u; h.y = h.gz - SPIRAL.height * Math.abs(Math.sin(Math.PI * 2 * u)); h.vy = 0;
    if (h.t - h.spinT >= SPIRAL.every) {
      h.spinT = h.t; audio.slash(1.4);
      slashFX(h.x, h.y - 110, h.dir, { a0: -3.1, a1: 3.1, r: 120, w: 22, c: '#ffffff', life: 0.18 });
      for (const e of enemies) {
        // un ennemi n'est dans le tourbillon que le temps de 3 coupes environ : 3 au plus, 25 % chacune
        const n = h.spinHits.get(e) || 0;
        if (!e.alive || e.state === 'down' || n >= 3 || Math.abs(e.x - h.x) > 110 || Math.abs(e.gz - h.gz) > 80) continue;
        h.spinHits.set(e, n + 1); damageEnemy(e, dmg * 0.25, 80 * h.dir, -160, e.x, e.y - 110, hitOf(h));
      }
    }
    for (let k = 0; k < 2; k++) particles.push({ x: h.x + rand(-40, 40), y: h.y - rand(60, 160), vx: -h.dir * rand(80, 240), vy: rand(-60, 60), t: 0, life: 0.3, c: '#e8eef4', r: rand(2, 4) });
  } else if (u >= 1 && !h.cut) {
    h.cut = true; h.y = h.gz; h.dir = -h.dir0; flash = 0.5; shake = 20; hitstop = 0.1; audio.slash(1.8);
    // il se retourne vers ce qu'il vient de traverser : double entaille en croix
    slashFX(h.x + h.dir * 110, h.y - 130, h.dir, { x: true, r: 170, w: 40, c: '#ffffff', life: 0.4 });
    ultraHit(h, 300, dmg * 0.25, 90, -60);
    popups.push({ x: h.x + h.dir * 200, y: h.y - 260, t: 0, text: 'TOURBILLON DU CAPITAINE !!' });
    score += 2000;
  }
  if (h.t > SPIRAL.end) { h.y = h.gz; h.state = 'idle'; }
}

// ---------- Ultime de Baki : l'assaut du Grappler. Une rafale de coups en avançant, la frappe fouet, puis le direct ----------
const GRAPPLER = { rush: 0.25, whip: 1.25, fist: 1.7, end: 2.3, every: 0.09 };
function startGrappler(h) { h.rushT = 0; h.cut = h.thrown = false; say(h, '…'); audio.play('ultraCharge', 0.8, 1.2, 0); }
function updateGrappler(h, dt) {
  h.inv = Math.max(h.inv, 0.1);
  const dmg = ULT_SOLO * (4 + h.power / 10);
  if (h.t > GRAPPLER.rush && h.t < GRAPPLER.whip) {
    h.x = clamp(h.x + h.dir * 140 * dt, camX + 40, camX + W - 40);
    if (h.t - h.rushT >= GRAPPLER.every) {
      h.rushT = h.t; audio.hit(false); afterImage(h, 0.18, 0.3, '#ff5040');
      ultraHit(h, 190, dmg * 0.45 / ((GRAPPLER.whip - GRAPPLER.rush) / GRAPPLER.every), 70, -20, 90, 0);
    }
  }
  if (!h.cut && h.t >= GRAPPLER.whip) {
    h.cut = true; shake = 16; hitstop = 0.06; audio.slash(1.3);
    slashFX(h.x + h.dir * 100, h.y - 120, h.dir, { a0: -0.9, a1: 0.5, r: 180, w: 28, c: '#ffd0c0', life: 0.3 });
    ultraHit(h, 240, dmg * 0.2, 80, -20, 140, 0);
  }
  // le direct dévastateur : onde de choc
  if (!h.thrown && h.t >= GRAPPLER.fist) {
    h.thrown = true; flash = 0.6; shake = 26; hitstop = 0.14; audio.play('ultraBoom', 1, 1.0, 0);
    shockFX(h.x + h.dir * 130, h.y - 120, h.dir);
    ultraHit(h, 300, dmg * 0.35, 90, -20);
    popups.push({ x: h.x + h.dir * 220, y: h.y - 270, t: 0, text: 'DOS DU DÉMON !!' });
    score += 2000;
  }
  if (h.t > GRAPPLER.end) h.state = 'idle';
}
// Visage de démon que dessinent les muscles du dos de Baki : esquissé en rouge sombre derrière ses épaules
function drawDemonBack(h, sx) {
  const p = 0.75 + 0.25 * Math.sin(sceneT * 5);
  ctx.save(); ctx.translate(sx - h.dir * 14, h.y - 150); ctx.scale(h.dir, 1); ctx.globalAlpha = 0.5 * p;
  ctx.strokeStyle = '#ff2a20'; ctx.fillStyle = 'rgba(120,0,10,0.35)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-62, -40); ctx.quadraticCurveTo(-78, 30, -30, 72); ctx.quadraticCurveTo(0, 86, 30, 72); ctx.quadraticCurveTo(78, 30, 62, -40); ctx.quadraticCurveTo(0, -70, -62, -40); ctx.fill(); ctx.stroke();
  // cornes, sourcils froncés, yeux, gueule aux crocs
  ctx.beginPath(); ctx.moveTo(-50, -42); ctx.lineTo(-74, -88); ctx.lineTo(-30, -52); ctx.moveTo(50, -42); ctx.lineTo(74, -88); ctx.lineTo(30, -52); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-44, -16); ctx.lineTo(-10, -2); ctx.moveTo(44, -16); ctx.lineTo(10, -2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,90,60,0.9)'; ctx.beginPath(); ctx.ellipse(-24, 6, 9, 5, 0.3, 0, 7); ctx.ellipse(24, 6, 9, 5, -0.3, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-30, 40); ctx.quadraticCurveTo(0, 30, 30, 40); ctx.quadraticCurveTo(0, 64, -30, 40); ctx.stroke();
  ctx.beginPath(); for (const x of [-18, -6, 6, 18]) { ctx.moveTo(x - 4, 40); ctx.lineTo(x, 50); ctx.lineTo(x + 4, 40); } ctx.stroke();
  ctx.restore();
}

// ---------- Ultime d'Itachi : Susanoo. Le guerrier spectral rouge se dresse derrière lui et abat son épée ----------
const SUSANOO = { rise: 0.9, slash: 1.5, end: 2.4, h: 450 };
// Katon : largeur de l'image à l'écran (×scale du tir) et centre de la boule dans l'image
const KATON = { w: 150, fx: 0.72, fy: 0.5 };
function startSusanoo(h) { h.cut = false; say(h, 'Susanoo.'); audio.play('ultraCharge', 0.9, 0.8, 0); }
function updateSusanoo(h) {
  h.inv = Math.max(h.inv, 0.1); h.vx = 0;
  if (!h.cut && h.t >= SUSANOO.slash) {
    h.cut = true; flash = 0.55; shake = 26; hitstop = 0.12; audio.slash(0.8); audio.play('ultraBoom', 1, 0.9, 0);
    slashFX(h.x + h.dir * 200, h.y - 170, h.dir, { a0: -1.6, a1: 1.2, r: 300, w: 60, c: '#ff4050', life: 0.5 });
    fxs.push({ type: 'shock', x: h.x + h.dir * 300, y: h.gz - 40, dir: h.dir, t: 0, life: 0.45 }); impactFX(h.x + h.dir * 300, h.y - 150, '#ff5060', true);
    for (let k = 0; k < 30; k++) particles.push({ x: h.x + h.dir * rand(150, 420), y: h.gz - rand(0, 40), vx: rand(-240, 240), vy: rand(-440, -120), t: 0, life: 0.7, c: Math.random() < 0.5 ? '#ff4050' : '#ffb0a0', r: rand(3, 7) });
    ultraHit(h, 460, ULT_SOLO * (4 + h.power / 10), 110, -30); // un seul coup : ~19 à 100 de ki
    popups.push({ x: h.x + h.dir * 260, y: h.y - 290, t: 0, text: 'SUSANOO !!' });
    score += 2000;
  }
  const fl = h.t < SUSANOO.rise ? 1.6 : h.t > SUSANOO.end - 0.45 ? 1.2 : 0.4;
  if (Math.random() < fl) particles.push({ x: h.x - h.dir * rand(-140, 220), y: h.gz - rand(0, h.t < SUSANOO.rise ? 120 : 420), vx: rand(-30, 30), vy: rand(-260, -100), t: 0, life: rand(0.4, 0.8), c: Math.random() < 0.6 ? '#ff3040' : '#ff9a80', r: rand(3, 7), soft: true });
  if (h.t > SUSANOO.end) h.state = 'idle';
}
function drawSusanoo(h, sx) {
  const img = IMG.fx_susanoo;
  if (img) return drawSusanooImg(h, sx, img);
  const t = h.t, a = Math.min(1, t / SUSANOO.rise) * (t > SUSANOO.end - 0.4 ? Math.max(0, (SUSANOO.end - t) / 0.4) : 1);
  const s = 0.5 + 0.28 * Math.min(1, t / SUSANOO.rise), red = al => `rgba(255,60,70,${al})`;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 * a;
  ctx.translate(sx - h.dir * 20, h.y); ctx.scale(h.dir * s, s);
  // corps : cage thoracique et épaules
  ctx.fillStyle = red(0.16); ctx.strokeStyle = red(0.8); ctx.lineWidth = 6;
  ctx.beginPath(); ctx.ellipse(0, -230, 120, 150, 0, 0, 7); ctx.fill(); ctx.stroke();
  for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(0, -280 + k * 30, 95 - k * 6, 14, 0, 0.15, Math.PI - 0.15); ctx.stroke(); }
  // tête : crâne à cornes et deux yeux
  ctx.beginPath(); ctx.ellipse(12, -405, 55, 62, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-28, -445); ctx.lineTo(-55, -505); ctx.lineTo(-8, -458); ctx.moveTo(48, -445); ctx.lineTo(82, -500); ctx.lineTo(32, -458); ctx.stroke();
  ctx.fillStyle = 'rgba(255,235,235,0.9)'; ctx.beginPath(); ctx.ellipse(0, -410, 11, 5, 0, 0, 7); ctx.ellipse(36, -410, 11, 5, 0, 0, 7); ctx.fill();
  // bras et épée : levée au ciel, puis abattue devant lui
  const u = clamp((t - SUSANOO.slash + 0.25) / 0.3, 0, 1);
  ctx.save(); ctx.translate(90, -320); ctx.rotate(-2.2 + u * 2.4);
  ctx.strokeStyle = red(0.9); ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(110, 0); ctx.stroke();
  ctx.fillStyle = red(0.5); ctx.strokeStyle = 'rgba(255,200,200,0.9)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(100, -14); ctx.lineTo(400, -6); ctx.lineTo(430, 0); ctx.lineTo(400, 6); ctx.lineTo(100, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore(); ctx.restore();
}

// Susanoo en image (assets/fx/susanoo.jpg, fond noir -> mode additif) : il se forme du bas vers le haut derrière
// Itachi, respire, arme son épée puis l'abat (rotation autour de l'épaule), et se dissipe
function drawSusanooImg(h, sx, img) {
  const t = h.t, S = SUSANOO, sc = Math.min(S.h, h.y - 30) / img.height, w = img.width * sc, hh = img.height * sc;
  const rev = clamp(t / S.rise, 0, 1), a = (0.35 + 0.65 * rev) * (t > S.end - 0.4 ? Math.max(0, (S.end - t) / 0.4) : 1);
  // épaule du bras armé dans l'image (fraction) : pivot de l'abattage
  const px = 0.42, py = 0.36;
  const ang = t < S.slash - 0.45 ? 0 : t < S.slash - 0.2 ? -0.44 * (t - S.slash + 0.45) / 0.25 : t < S.slash ? -0.44 + 1.05 * (t - S.slash + 0.2) / 0.2 : 0.61 - 0.3 * Math.min(1, (t - S.slash) / 0.6);
  const breathe = 1 + Math.sin(t * 4) * 0.012;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
  ctx.translate(sx - h.dir * 50, h.y + 8); ctx.scale(h.dir, 1);
  // révélation du bas vers le haut
  if (rev < 1) { ctx.beginPath(); ctx.rect(-w * 1.2, -hh * rev, w * 2.4, hh * rev + 40); ctx.clip(); }
  // la cage thoracique s'allume : lueur rouge au torse
  const cx = 0, cy = -hh * 0.55, glow = ctx.createRadialGradient(cx, cy, 5, cx, cy, w * 0.45);
  glow.addColorStop(0, `rgba(255,70,80,${0.35 * rev})`); glow.addColorStop(1, 'rgba(255,30,40,0)');
  ctx.fillStyle = glow; ctx.fillRect(-w, -hh, w * 2, hh);
  ctx.translate(-w * 0.5 + px * w, -hh + py * hh); ctx.rotate(ang); ctx.scale(1, breathe);
  ctx.drawImage(img, -px * w, -py * hh, w, hh);
  ctx.restore();
  // flash rouge au moment du coup
  if (t > S.slash && t < S.slash + 0.25) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,30,40,${0.35 * (1 - (t - S.slash) / 0.25)})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// ---------- Ultime d'Eren : le Titan Assaillant. Il se mord la main, l'éclair jaune tombe, le titan se dresse
// derrière lui dans la vapeur et écrase le sol d'un coup de poing devant lui ----------
const TITAN = { appear: 0.5, rise: 0.75, punch: 1.5, end: 2.4, fist: 400 }; // fist : poing à 400 px devant Eren
function startTitan(h) { h.cut = h.lit = h.risen = false; say(h, 'JE LES EXTERMINERAI TOUS !'); audio.play('ultraCharge', 0.9, 0.8, 0); }
function updateTitan(h) {
  h.inv = Math.max(h.inv, 0.1); h.vx = 0;
  if (!h.lit && h.t >= 0.4) {
    // la morsure : un éclair jaune frappe là où il se tient
    h.lit = true; flash = 0.7; shake = 18; audio.play('ultraBoom', 0.8, 1.3, 0);
    for (let k = 0; k < 6; k++) animFX('green_arc', h.x + rand(-40, 40), h.y - rand(40, 220), rand(60, 110), 0.3, { rot: rand(-1, 1), filter: 'hue-rotate(-70deg) saturate(1.6) brightness(1.3)' });
  }
  if (!h.risen && h.t >= TITAN.appear) {
    // le titan surgit : explosion de vapeur et second éclair
    h.risen = true; flash = 0.5; shake = 22; audio.play('ultraBoom', 0.9, 0.7, 0);
    for (let k = 0; k < 5; k++) animFX('green_arc', h.x - h.dir * rand(0, 120), h.y - rand(120, 420), rand(90, 150), 0.35, { rot: rand(-1, 1), filter: 'hue-rotate(-70deg) saturate(1.6) brightness(1.3)' });
    for (let k = 0; k < 60; k++) particles.push({ x: h.x - h.dir * rand(-60, 200), y: h.gz - rand(0, 300), vx: rand(-160, 160), vy: rand(-260, -60), t: 0, life: rand(0.8, 1.3), c: 'rgba(255,250,245,0.16)', r: rand(26, 50), soft: true }); // vapeur légère : beaucoup de bouffées très transparentes plutôt que des disques
  }
  // vapeur qui monte du corps du titan tant qu'il est là
  if (h.t > TITAN.appear && h.t < TITAN.end - 0.2 && Math.random() < 0.8) particles.push({ x: h.x - h.dir * rand(-80, 220), y: h.gz - rand(60, 420), vx: rand(-30, 30), vy: rand(-140, -60), t: 0, life: 1, c: 'rgba(255,245,240,0.13)', r: rand(20, 36), soft: true });
  if (!h.cut && h.t >= TITAN.punch) {
    h.cut = true; flash = 0.7; shake = 32; hitstop = 0.16; audio.play('ultraBoom', 1, 0.8, 0);
    const fx = h.x + h.dir * TITAN.fist;
    shockFX(fx, h.gz - 40, h.dir); impactFX(fx, h.gz - 260, '#fff0c0', true);
    for (let k = 0; k < 26; k++) particles.push({ x: fx + rand(-120, 80), y: h.gz - rand(0, 20), vx: rand(-200, 200), vy: rand(-420, -120), t: 0, life: 0.8, c: Math.random() < 0.5 ? '#8a7060' : '#5a4a40', r: rand(4, 10) });
    ultraHit(h, TITAN.fist + 60, ULT_SOLO * (4 + h.power / 10), 130, -30); // un seul coup : ~19 à 100 de ki
    popups.push({ x: fx, y: h.y - 320, t: 0, text: 'TITAN ASSAILLANT !!' });
    score += 2000;
  }
  // il se dissout en vapeur
  if (h.t > TITAN.end - 0.55 && h.t < TITAN.end && Math.random() < 0.9)
    for (let k = 0; k < 3; k++) particles.push({ x: h.x - h.dir * rand(-200, 240), y: h.gz - rand(40, 440), vx: rand(-60, 60), vy: rand(-180, -60), t: 0, life: 1.1, c: 'rgba(255,255,255,0.15)', r: rand(28, 50), soft: true });
  if (h.t > TITAN.end) { h.state = 'idle'; h.risen = false; }
}
// Le titan (images assets/fx/titan_rise.png et titan_punch.png, de profil vers la droite) : il grandit dans la
// vapeur derrière Eren, rugit, puis se fend d'un direct ; même échelle de corps pour les deux images, pieds au sol
function drawTitan(h, sx) {
  const t = h.t, rise = IMG.fx_titan_rise, punch = IMG.fx_titan_punch;
  if (!rise || !punch || t < TITAN.appear) return;
  const out = t > TITAN.end - 0.55 ? clamp((TITAN.end - t) / 0.55, 0, 1) : 1;
  const H = Math.min(470, h.y - 24), s = H / rise.height; // jamais au-dessus du haut de l'écran
  const g = clamp((t - TITAN.appear) / 0.28, 0, 1), grow = 0.55 + 0.45 * (1 - Math.pow(1 - g, 3)) + (g >= 1 && t < TITAN.punch - 0.2 ? 0.02 * Math.sin(t * 40) : 0);
  ctx.save(); ctx.globalAlpha = g * out;
  if (t < TITAN.punch - 0.18) {
    // debout derrière Eren, il hurle (léger tremblement)
    const w = rise.width * s * grow, hh = rise.height * s * grow, jit = g >= 1 ? rand(-2, 2) : 0;
    ctx.translate(sx - h.dir * 110 + jit, h.y); ctx.scale(h.dir, 1);
    ctx.drawImage(rise, -w / 2, -hh, w, hh);
  } else {
    // le direct : le corps se jette en avant, le poing (à droite de l'image) part vers h.dir
    const u = clamp((t - (TITAN.punch - 0.18)) / 0.18, 0, 1), lunge = 90 * (1 - Math.pow(1 - u, 2));
    const w = punch.width * s, hh = punch.height * s;
    ctx.translate(sx + h.dir * (TITAN.fist - w * 0.94 + lunge - 90), h.y); ctx.scale(h.dir, 1);
    ctx.drawImage(punch, 0, -hh, w, hh);
  }
  ctx.restore();
  // brume blanche au pied du titan
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * g * out;
  const fg = ctx.createRadialGradient(sx - h.dir * 60, h.y - 30, 10, sx - h.dir * 60, h.y - 30, 260);
  fg.addColorStop(0, 'rgba(255,250,240,0.6)'); fg.addColorStop(1, 'rgba(255,250,240,0)');
  ctx.fillStyle = fg; ctx.fillRect(sx - h.dir * 60 - 260, h.y - 290, 520, 300); ctx.restore();
}

// ---------- Ultime de Boruto : deux clones surgissent à ses côtés et les trois lancent ensemble un Rasengan évanescent ----------
const BORU = { clones: 0.35, throw: 1.15, end: 2.0, at: [[-80, -45], [-60, 45]] };
function startBoru(h) { h.thrown = false; say(h, 'MULTI-CLONAGE !'); audio.play('ultraCharge', 0.8, 1.3, 0); for (const [dx, dz] of BORU.at) puff(h.x + h.dir * dx, h.gz + dz); audio.whoosh(1.3); }
function updateBoru(h) {
  h.inv = Math.max(h.inv, 0.1); h.vx = 0;
  if (!h.thrown && h.t >= BORU.throw) {
    h.thrown = true; flash = 0.45; shake = 18; audio.play('ultraThrow', 0.9, 1.2, 0);
    const hp = handPoint(h) || [70, -120], dmg = ULT_SOLO * (4 + h.power / 10) / 3; // trois sphères : ~19 si toutes touchent
    // les sphères des clones touchent d'abord sans projeter ; celle de Boruto, partie un peu en retrait, arrive
    // la dernière et éjecte (sinon la 1re envoyait la cible au loin et les deux autres la manquaient)
    const from = [[-110, 0, 1.7, true], ...BORU.at.map(([dx, dz]) => [dx, dz, 1.1, false])];
    for (const [dx, dz, sc, main] of from)
      projs.push({ kind: 'vrasen', owner: h, x: h.x + h.dir * (dx + hp[0] + PROJ_R.vrasen * sc), y: h.y + dz + hp[1], gz: h.gz, dir: h.dir, t: 0, speed: 820, life: 1.1, scale: sc * 0.8, steady: true, hit: new Set(), dmg, kb: main ? 700 : 40, launch: main ? -700 : 0 });
    popups.push({ x: h.x + h.dir * 240, y: h.y - 280, t: 0, text: 'RASENGAN DES TROIS !!' });
    score += 2000;
  }
  if (h.t > BORU.end) { h.state = 'idle'; for (const [dx, dz] of BORU.at) puff(h.x + h.dir * dx, h.gz + dz); }
}

// ---------- Ultime d'Edward : la grande transmutation. Il frappe dans ses mains, pose les mains au sol : un cercle
// de transmutation géant s'allume devant lui, puis un poing de pierre géant jaillit du sol et frappe ----------
const ALCH = { clap: 0.35, circle: 0.5, rise: 1.1, hit: 1.4, end: 2.3, at: 250 };
function startAlchemy(h) { h.cut = h.clap = false; say(h, 'JE SUIS UN ALCHIMISTE !'); audio.play('ultraCharge', 0.85, 1.15, 0); }
function updateAlchemy(h) {
  h.inv = Math.max(h.inv, 0.1); h.vx = 0;
  if (!h.clap && h.t >= ALCH.clap) { h.clap = true; flash = 0.3; audio.slash(1.9); impactFX(h.x + h.dir * 40, h.y - 130, '#bfe8ff', true); }
  const cx = h.x + h.dir * ALCH.at;
  if (h.t > ALCH.circle && h.t < ALCH.hit && Math.random() < 0.5) animFX('green_arc', cx + rand(-150, 150), h.gz - rand(0, 30), rand(30, 60), 0.15, { rot: rand(-1.5, 1.5), filter: 'hue-rotate(95deg) saturate(1.3) brightness(1.3)' });
  if (h.t > ALCH.rise && h.t < ALCH.hit + 0.2 && Math.random() < 0.8)
    particles.push({ x: cx + rand(-90, 90), y: h.gz - rand(0, 20), vx: rand(-180, 180), vy: rand(-420, -160), t: 0, life: 0.6, c: Math.random() < 0.5 ? '#8a7a68' : '#5a5048', r: rand(4, 9) });
  if (!h.cut && h.t >= ALCH.hit) {
    h.cut = true; flash = 0.55; shake = 28; hitstop = 0.14; audio.play('ultraBoom', 1, 0.85, 0);
    shockFX(cx, h.gz - 30, h.dir);
    ultraHit(h, ALCH.at + 200, ULT_SOLO * (4 + h.power / 10), 130, 40); // un seul coup : ~19 à 100 de ki
    popups.push({ x: cx, y: h.y - 310, t: 0, text: 'GRANDE TRANSMUTATION !!' });
    score += 2000;
  }
  if (h.t > ALCH.end - 0.6 && h.t < ALCH.end && Math.random() < 0.9)
    particles.push({ x: cx + h.dir * rand(-60, 120), y: h.gz - rand(40, 170), vx: rand(-60, 60), vy: rand(60, 220), t: 0, life: 0.6, c: Math.random() < 0.5 ? '#7a7a80' : '#5a5048', r: rand(4, 9) });
  if (h.t > ALCH.end) h.state = 'idle';
}
// cercle de transmutation au sol (ellipse vue de biais) et poing de pierre qui sort de terre puis s'abat
function drawAlchemy(h, sx) {
  const t = h.t, cx = sx + h.dir * ALCH.at, gy = h.gz;
  if (t > ALCH.circle) {
    const a = Math.min(1, (t - ALCH.circle) / 0.25) * (t > ALCH.end - 0.4 ? Math.max(0, (ALCH.end - t) / 0.4) : 1), R = 190;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a; ctx.translate(cx, gy); ctx.scale(1, 0.28);
    ctx.strokeStyle = 'rgba(120,210,255,0.95)'; ctx.shadowColor = '#5ab8ff'; ctx.shadowBlur = 18; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke(); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, 7); ctx.stroke();
    // triangle et carré inscrits, qui tournent lentement
    const rot = t * 0.8;
    ctx.beginPath(); for (let k = 0; k <= 3; k++) { const q = rot + k * Math.PI * 2 / 3; ctx[k ? 'lineTo' : 'moveTo'](Math.cos(q) * R * 0.78, Math.sin(q) * R * 0.78); } ctx.stroke();
    ctx.beginPath(); for (let k = 0; k <= 4; k++) { const q = -rot + k * Math.PI / 2 + Math.PI / 4; ctx[k ? 'lineTo' : 'moveTo'](Math.cos(q) * R * 0.55, Math.sin(q) * R * 0.55); } ctx.stroke();
    for (let k = 0; k < 12; k++) { const q = rot * 0.5 + k * Math.PI / 6; ctx.beginPath(); ctx.arc(Math.cos(q) * R * 0.89, Math.sin(q) * R * 0.89, 7, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
  if (t > ALCH.rise) {
    // le bras de pierre (assets/fx/ed_fist.png) surgit du cercle, frappe vers l'avant au moment du coup, puis s'effrite
    const img = IMG.fx_ed_fist;
    if (!img) return;
    const W2 = 340, H2 = W2 * img.height / img.width;
    const up = clamp((t - ALCH.rise) / 0.25, 0, 1), punch = clamp((t - (ALCH.hit - 0.15)) / 0.15, 0, 1);
    const crumble = clamp((t - (ALCH.end - 0.6)) / 0.6, 0, 1), e = 1 - Math.pow(1 - up, 3);
    const jitter = up < 1 ? (Math.random() - 0.5) * 6 : 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - 600, gy - 700, 1200, 714); ctx.clip(); // rien sous le sol
    ctx.translate(cx + jitter, gy + 14 + (1 - e) * H2 + crumble * 40);
    ctx.scale(h.dir, 1);
    // la frappe : il se jette en avant et pivote un peu
    ctx.translate(-150 + punch * 110, 0); ctx.rotate(-0.12 + punch * 0.16);
    ctx.globalAlpha = 1 - crumble;
    ctx.drawImage(img, 0, -H2, W2, H2);
    ctx.restore();
  }
}

// ---------- Ultime de Gintoki : « Gin-san est sérieux ». Il se cure le nez, l'air de rien… puis une rafale de coups de
// sabre de bois en une seconde, et un dernier coup écrasant ----------
const GINSAN = { lazy: 0.9, every: 0.1, rushEnd: 1.9, smash: 2.05, end: 2.6, reach: 260 };
function startGinsan(h) { h.cut = false; h.stab = -1; say(h, 'Hein ? Déjà ?'); audio.play('ultraCharge', 0.6, 0.9, 0); }
function updateGinsan(h) {
  h.inv = Math.max(h.inv, 0.1); h.vx = 0;
  const dmg = ULT_SOLO * (4 + h.power / 10), n = Math.round((GINSAN.rushEnd - GINSAN.lazy) / GINSAN.every), i = Math.floor((h.t - GINSAN.lazy) / GINSAN.every);
  if (h.t >= GINSAN.lazy && i < n && i !== h.stab) {
    if (i === 0) { say(h, 'BON, D\'ACCORD.'); popups.push({ x: h.x + h.dir * 200, y: h.y - 270, t: 0, text: 'GIN-SAN EST SÉRIEUX !!' }); flash = 0.3; }
    h.stab = i; audio.slash(1.4 + (i % 3) * 0.2);
    const y = h.y - 140 + rand(-40, 40);
    slashFX(h.x + h.dir * 130, y, h.dir, { a0: rand(-1.4, -0.4), a1: rand(0.4, 1.4), r: 150, w: 22, c: '#f0e0b8', life: 0.12 });
    for (const e of enemies) {
      const dx = (e.x - h.x) * h.dir;
      if (!e.alive || e.state === 'down' || dx < -30 || dx > GINSAN.reach || Math.abs(e.gz - h.gz) > 80) continue;
      damageEnemy(e, dmg * 0.7 / n, 50 * h.dir, 0, e.x, y, hitOf(h));
    }
  }
  if (!h.cut && h.t >= GINSAN.smash) {
    h.cut = true; flash = 0.5; shake = 24; hitstop = 0.12; audio.play('ultraBoom', 0.9, 1.1, 0);
    slashFX(h.x + h.dir * 120, h.y - 130, h.dir, { a0: -1.8, a1: 1.3, r: 200, w: 46, c: '#ffffff', life: 0.4 });
    shockFX(h.x + h.dir * 170, h.gz - 30, h.dir);
    ultraHit(h, 280, dmg * 0.3, 90, -40);
    score += 2000;
  }
  if (h.t > GINSAN.end) h.state = 'idle';
}

// ---------- Itachi : flammes noires (Amaterasu) et corbeaux, dessinés sans mode « lighter » (le noir y serait invisible) ----------
let blackFlames = [], crows = [];
function amaterasu(h, A) {
  const tgt = enemies.filter(e => { const dx = (e.x - h.x) * h.dir; return e.alive && e.state !== 'down' && dx > 0 && dx < A.range && Math.abs(e.gz - h.gz) <= 110; }).sort((a, b) => (a.x - b.x) * h.dir)[0];
  blackFlames.push({ e: tgt || null, x: tgt ? tgt.x : h.x + h.dir * 260, y: tgt ? tgt.y : h.gz, owner: h, t: 0, dur: A.dur, dps: A.dps * (h.boost ? h.boost.dmg : 1), tick: 0 });
  flash = Math.max(flash, 0.2); shake = Math.max(shake, 10); audio.play('ultraBoom', 0.5, 0.7, 0);
}
function updateDarkFX(dt) {
  for (const b of blackFlames) {
    b.t += dt;
    if (b.e && !b.e.alive) b.e = null;
    if (b.e) { b.x = b.e.x; b.y = b.e.y; if ((b.tick -= dt) <= 0) { b.tick = 0.3; damageEnemy(b.e, b.dps * 0.3, 40 * b.owner.dir, 0, b.x, b.y - 100, '#ff2a3a'); } }
  }
  blackFlames = blackFlames.filter(b => b.t < b.dur);
  for (const c of crows) { c.t += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy -= 30 * dt; }
  crows = crows.filter(c => c.t < c.life);
}
function drawDarkFX() {
  for (const b of blackFlames) {
    const sx = b.x - camX, a = Math.max(0, Math.min(1, b.t / 0.15, (b.dur - b.t) / 0.4));
    const img = IMG.fx_amaterasu;
    if (img) {
      // flammes noires dessinées (assets/fx/amaterasu.png) : deux couches qui ondulent en décalé, lueur pourpre au pied
      const rise = Math.min(1, b.t / 0.25), hh = 230 * rise, ww = hh * img.width / img.height;
      ctx.save(); ctx.globalAlpha = a * 0.5; ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(sx, b.y - 10, 4, sx, b.y - 10, 90);
      g.addColorStop(0, 'rgba(150,0,60,0.6)'); g.addColorStop(1, 'rgba(60,0,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, b.y - 10, 90, 30, 0, 0, 7); ctx.fill(); ctx.restore();
      for (const [k, ph] of [[1, 0], [0.82, 2.1]]) {
        const sy = 1 + 0.06 * Math.sin(sceneT * 11 + ph), sk = 0.08 * Math.sin(sceneT * 7 + ph);
        ctx.save(); ctx.globalAlpha = a * (k === 1 ? 1 : 0.75); ctx.translate(sx, b.y + 6);
        if (ph) ctx.scale(-1, 1);
        ctx.transform(1, 0, sk, 1, 0, 0); ctx.drawImage(img, -ww * k / 2, -hh * k * sy, ww * k, hh * k * sy);
        ctx.restore();
      }
      continue;
    }
    ctx.save(); ctx.globalAlpha = a;
    for (let k = 0; k < 7; k++) {
      const ox = (k - 3) * 15, ph = sceneT * 9 + k * 1.7, h1 = 150 * (0.55 + 0.35 * Math.abs(Math.sin(ph))), w = 16 + 6 * Math.sin(ph * 1.3);
      const g = ctx.createLinearGradient(0, b.y, 0, b.y - h1); g.addColorStop(0, '#2a0a30'); g.addColorStop(0.5, '#0a0408'); g.addColorStop(1, 'rgba(10,4,8,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx + ox - w, b.y);
      ctx.quadraticCurveTo(sx + ox - w * 0.6 + Math.sin(ph) * 8, b.y - h1 * 0.55, sx + ox + Math.sin(ph * 0.7) * 10, b.y - h1);
      ctx.quadraticCurveTo(sx + ox + w * 0.6, b.y - h1 * 0.45, sx + ox + w, b.y); ctx.closePath(); ctx.fill();
    }
    // liseré pourpre autour des flammes noires
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.35;
    const g2 = ctx.createRadialGradient(sx, b.y - 70, 5, sx, b.y - 70, 90); g2.addColorStop(0, 'rgba(160,40,200,0.6)'); g2.addColorStop(1, 'rgba(160,40,200,0)');
    ctx.fillStyle = g2; ctx.fillRect(sx - 90, b.y - 160, 180, 180);
    ctx.restore();
  }
  for (const c of crows) {
    const k = 1 - c.t / c.life, fl = Math.sin(c.t * 22 + c.ph), s = c.s;
    ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.5); ctx.translate(c.x - camX, c.y); ctx.scale(c.vx < 0 ? -1 : 1, 1); ctx.fillStyle = '#0c0a10';
    ctx.beginPath(); ctx.ellipse(0, 0, 9 * s, 4 * s, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-3 * s, 0); ctx.lineTo(-9 * s, -13 * s * fl - 2); ctx.lineTo(3 * s, -1); ctx.lineTo(9 * s, -11 * s * fl - 2); ctx.lineTo(6 * s, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8 * s, -2); ctx.lineTo(14 * s, 0); ctx.lineTo(8 * s, 2); ctx.fill();
    ctx.restore();
  }
  // Mangekyô : deux points rouges qui brillent dans les yeux
  for (const h of players) {
    if (!h.boost?.eyes || h.out || h.state === 'knock' || h.state === 'floor') continue;
    const m = mouthPoint(h); if (!m) continue;
    const ex = h.x - camX + h.dir * (m[0] - (h.boost.oneEye ? 4 : 8)), ey = h.y + m[1] - 10;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 14); g.addColorStop(0, h.boost.eyeCol || 'rgba(255,60,60,0.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, 14, 0, 7); ctx.fill(); ctx.restore();
  }
}

// ---------- Ultime de Vegeta : Final Flash, un rayon jaune immense ----------
function startFinalFlash(h) { h.beamed = false; say(h, h.char === 'gojo' ? 'TECHNIQUE IMAGINAIRE…' : 'FINAL…'); audio.play('ultraCharge', 0.9, 1.1, 0); }
function updateFinalFlash(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (!h.beamed && h.t >= 0.95) {
    h.beamed = true; flash = 0.8; shake = 22; say(h, h.char === 'gojo' ? 'VIOLET !!' : 'FLASH !!');
    audio.play('waveFire', 1.2, 0.6, 0); audio.play('ultraBoom', 0.9, 1.2, 0);
    projs.push({ kind: 'beam', owner: h, move: 'ultra', at: 0.95, end: 2.2, len: 1200, thick: 1.8, dmg: (4 + h.power / 10) / 9, color: h.char === 'gojo' ? '#c97bff' : '#ffe680', filter: h.char === 'gojo' ? 'hue-rotate(70deg) saturate(1.8) brightness(1.1)' : 'hue-rotate(205deg) saturate(1.6) brightness(1.1)', t: 0, hit: new Set(), multiT: 0, dir: h.dir, gz: h.gz });
    score += 2000;
  }
  if (h.t > 2.3) h.state = 'idle';
}

// ---------- Ultime d'Ippo : un Dempsey Roll qui ne s'arrête plus, puis le coup final ----------
const DMAX = { end: 2.8 };
function startDempseyMax(h) { h.hitT = 0; h.punched = false; say(h, 'DEMPSEY ROLL !!'); }
function updateDempseyMax(h, dt) {
  h.inv = Math.max(h.inv, 0.1);
  if (h.t < DMAX.end - 0.5) {
    h.x = clamp(h.x + h.dir * 160 * dt, camX + 40, camX + W - 40);
    if (h.t - h.hitT > 0.11) {
      h.hitT = h.t; audio.hit(false);
      for (const e of enemies) {
        const dx = (e.x - h.x) * h.dir;
        if (!e.alive || e.state === 'down' || dx < -10 || dx > 170 || Math.abs(e.gz - h.gz) > 50) continue;
        if (e.state !== 'knock') { e.x = h.x + h.dir * 110; }
        damageEnemy(e, 0.45, 40 * h.dir, null, e.x, e.y - 120, hitOf(h));
      }
    }
  } else if (!h.punched) {
    h.punched = true; flash = 0.7; shake = 26; hitstop = 0.12; audio.play('ultraBoom', 1.2, 1.1, 0);
    animFX('explosion', h.x + h.dir * 140, h.y - 130, 340, 0.55);
    popups.push({ x: h.x + h.dir * 160, y: h.y - 260, t: 0, text: 'K.O. !!' });
    ultraHit(h, 260, ULT_SOLO * (3 + h.power / 15), 70);
    score += 2000;
  }
  if (h.t > DMAX.end) h.state = 'idle';
}

// ---------- Ultime de Naruto : Kurama, le renard à neuf queues, bondit sur les ennemis ----------
const KYU = { charge: 1.2, end: 2.2 };
function startKyubi(h) { h.punched = false; say(h, 'KURAMA !'); audio.play('ultraCharge', 0.9, 0.7, 0); shake = 10; }
function updateKyubi(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (Math.random() < 0.8) particles.push({ x: h.x + rand(-160, 160), y: h.y - rand(0, 300), vx: rand(-40, 40), vy: rand(-220, -80), t: 0, life: 0.5, c: Math.random() < 0.5 ? '#ff8a00' : '#ffd060', r: rand(3, 7) });
  if (!h.punched && h.t >= KYU.charge + 0.2) {
    h.punched = true; flash = 0.8; shake = 30; hitstop = 0.12; audio.play('ultraBoom', 1.3, 0.8, 0);
    popups.push({ x: h.x + h.dir * 300, y: h.y - 300, t: 0, text: 'BIJUU DAMA !!' });
    ultraHit(h, 820, ULT_SOLO * (4 + h.power / 10), 130);
    for (let k = 0; k < 3; k++) animFX('explosion', h.x + h.dir * (250 + k * 200), h.y - 140, 380, 0.6);
    score += 2000;
  }
  if (h.t > KYU.end) h.state = 'idle';
}

// ---------- Ennemis ----------
// Trois types : le voyou (corps à corps), la brute (lente, encaisse, frappe très fort)
// et le ninja (rapide, fragile, garde ses distances et lance des shurikens).
const ETYPES = {
  thug:  { sheet: 'thug', hp: 4, speed: [110, 150], reach: 105, windup: 0.4, dmg: 10, score: 500, h: 225 },
  brute: { sheet: 'brute', hp: 12, speed: [62, 78], reach: 125, windup: 0.75, dmg: 18, score: 1500, h: 270, armor: true },
  ninja: { sheet: 'ninja', hp: 3, speed: [210, 240], reach: 95, windup: 0.25, dmg: 8, score: 800, h: 190, glow: true },
  // Motard : fouette de loin avec sa chaîne, ou la fait tournoyer autour de lui
  biker: { sheet: 'biker', hp: 6, speed: [120, 150], reach: 200, windup: 0.35, dmg: 12, score: 1000, h: 215, ai: bikerAI, pose: bikerPose },
  // Samouraï : ruée éclair sabre au clair, ou grand coup vertical de près
  samurai: { sheet: 'samurai', hp: 8, speed: [140, 165], reach: 300, windup: 0.45, dmg: 14, score: 1600, h: 215, ai: samuraiAI, pose: samuraiPose },
  // Boss : le grand oni du sanctuaire, insensible aux petits coups, enragé à mi-vie
  boss: { sheet: 'boss', hp: 140, speed: [75, 85], reach: 190, windup: 0.6, dmg: 18, score: 30000, h: 330, armor: true, superArmor: true, ai: bossAI, pose: bossPose,
          isBoss: true, proj: 'fire', adds: ['thug', 'biker'], roar: 'GRAAAH !!' },
};
// Ennemis des niveaux à thème. Sbires : planches marche / attaque / chute de 8 étapes (voir minionPose) ;
// lunge : ruée en avant, ranged : projectile tiré de loin, slash : couleur de la traînée de lame.
const MINION = (sheet, o = {}) => ({ sheet, hp: 5, speed: [120, 150], reach: 115, windup: 0.35, dmg: 10, score: 800, h: 215, ai: minionAI, pose: minionPose, ...o });
// Boss : même gabarit de planches que le Kuro-Oni ; proj : son attaque de loin, adds : renforts appelés à mi-vie
const BOSS = (sheet, o = {}) => ({ ...ETYPES.boss, sheet, h: 290, ...o });
Object.assign(ETYPES, {
  op_pirate: MINION('op_pirate', { lunge: true, slash: '#e8f0ff' }),
  op_marine: MINION('op_marine', { ranged: 'bullet', hp: 4 }),
  op_boss: BOSS('op_boss', { proj: 'muggy', adds: ['op_pirate', 'op_marine'], roar: 'BARA BARA !!' }),
  ds_demon: MINION('ds_demon', { lunge: true, slash: '#ff3040', speed: [160, 190] }),
  ds_spider: MINION('ds_spider', { ranged: 'thread' }),
  ds_boss: BOSS('ds_boss', { proj: 'shock', projColor: '#6ad0ff', adds: ['ds_demon', 'ds_spider'], roar: 'HAKAI SATSU !!' }),
  bl_shinigami: MINION('bl_shinigami', { lunge: true, slash: '#d8ecff', hp: 6 }),
  bl_hollow: MINION('bl_hollow', { ranged: 'cero', hp: 9, armor: true, dmg: 14, h: 245, speed: [80, 100] }),
  bl_boss: BOSS('bl_boss', { proj: 'slash', projColor: '#ffe14d', adds: ['bl_shinigami', 'bl_hollow'], roar: 'AMUSE-MOI !!' }),
  hx_fighter: MINION('hx_fighter', { hp: 6, dmg: 11 }),
  hx_nen: MINION('hx_nen', { ranged: 'orb' }),
  hx_boss: BOSS('hx_boss', { proj: 'cards', adds: ['hx_fighter', 'hx_nen'], roar: 'BUNGEE GUM !' }),
  nr_sound: MINION('nr_sound', { lunge: true, slash: '#d0d0ff', speed: [150, 180] }),
  nr_rogue: MINION('nr_rogue', { ranged: 'kunai' }),
  nr_boss: BOSS('nr_boss', { proj: 'snake', adds: ['nr_sound', 'nr_rogue'], roar: 'KUKUKU…' }),
  db_elite: MINION('db_elite', { hp: 10, armor: true, dmg: 15, h: 245, speed: [90, 110] }),
  db_soldier: MINION('db_soldier', { ranged: 'ki' }),
  db_boss: BOSS('db_boss', { proj: 'beam', projColor: '#ff6ad8', adds: ['db_elite', 'db_soldier'], roar: 'IMPARDONNABLE !!' }),
  mh_villain: MINION('mh_villain', { hp: 9, armor: true, dmg: 15, h: 240, speed: [90, 110] }),
  mh_blaster: MINION('mh_blaster', { ranged: 'fireball' }),
  mh_boss: BOSS('mh_boss', { proj: 'shock', projColor: '#ff5050', adds: ['mh_villain', 'mh_blaster'], roar: 'GRAAAAH !!', h: 320 }),
  rk_ronin: MINION('rk_ronin', { lunge: true, slash: '#e8f0ff', hp: 6 }),
  rk_ninja: MINION('rk_ninja', { ranged: 'kunai' }),
  rk_boss: BOSS('rk_boss', { proj: 'slash', projColor: '#ff8a2a', adds: ['rk_ronin', 'rk_ninja'], roar: 'HOMURADAMA !!' }),
  op2_guard: MINION('op2_guard', { hp: 6, reach: 135, slash: '#dfe6ff' }),
  op2_agent: MINION('op2_agent', { lunge: true, speed: [160, 190] }),
  op2_boss: BOSS('op2_boss', { proj: 'slash', projColor: '#ffffff', adds: ['op2_guard', 'op2_agent'], roar: 'RANKYAKU !!' }),
  nr2_puppet: MINION('nr2_puppet', { lunge: true, slash: '#c9a0ff', hp: 6, front: 85 }),
  nr2_rain: MINION('nr2_rain', { ranged: 'kunai' }),
  nr2_boss: BOSS('nr2_boss', { proj: 'shock', projColor: '#c9a0ff', adds: ['nr2_puppet', 'nr2_rain'], roar: 'SHINRA TENSEI !!' }),
  ds2_demon: MINION('ds2_demon', { lunge: true, slash: '#ff3040', speed: [160, 190] }),
  ds2_obi: MINION('ds2_obi', { ranged: 'thread' }),
  ds2_boss: BOSS('ds2_boss', { proj: 'slash', projColor: '#ff6ad8', adds: ['ds2_demon', 'ds2_obi'], roar: 'HACHI-ENJIN !!' }),
  db2_jr: MINION('db2_jr', { lunge: true, speed: [180, 210], hp: 4, h: 170 }),
  db2_android: MINION('db2_android', { ranged: 'ki', hp: 7 }),
  db2_boss: BOSS('db2_boss', { proj: 'beam', projColor: '#7fd8ff', adds: ['db2_jr', 'db2_android'], roar: 'KAMEHAMEHA !!' }),
  jk_curse: MINION('jk_curse', { lunge: true, slash: '#b06aff', hp: 6 }),
  jk_user: MINION('jk_user', { ranged: 'orb' }),
  jk_boss: BOSS('jk_boss', { proj: 'slash', projColor: '#ff3040', adds: ['jk_curse', 'jk_user'], roar: 'DÉMANTÈLEMENT !!' }),
  sl_goblin: MINION('sl_goblin', { lunge: true, speed: [170, 200], hp: 4, h: 170 }),
  sl_knight: MINION('sl_knight', { hp: 10, armor: true, dmg: 15, h: 250, speed: [80, 100], slash: '#cfd8e0' }),
  sl_boss: BOSS('sl_boss', { proj: 'slash', projColor: '#ff2030', adds: ['sl_goblin', 'sl_knight'], roar: '…' }),
  opm_monster: MINION('opm_monster', { hp: 9, armor: true, dmg: 15, h: 240, speed: [90, 110] }),
  opm_alien: MINION('opm_alien', { ranged: 'ki' }),
  opm_boss: BOSS('opm_boss', { proj: 'beam', projColor: '#ff7a3a', adds: ['opm_monster', 'opm_alien'], roar: 'EFFONDREMENT STELLAIRE !!', h: 310 }),
  bl2_arrancar: MINION('bl2_arrancar', { lunge: true, slash: '#d8ecff', hp: 6 }),
  bl2_fraccion: MINION('bl2_fraccion', { hp: 10, armor: true, dmg: 15, h: 250, speed: [80, 100] }),
  // cinq mondes du 24/10
  aot_titan: MINION('aot_titan', { lunge: true, hp: 7, h: 230, speed: [100, 130] }),
  aot_soldier: MINION('aot_soldier', { ranged: 'bullet' }),
  aot_boss: BOSS('aot_boss', { proj: 'muggy', projColor: '#c8b8a0', adds: ['aot_titan', 'aot_soldier'], roar: 'LANCER DE ROCHERS !!' }),
  bk_soldier: MINION('bk_soldier', { hp: 9, armor: true, dmg: 14, h: 240, speed: [90, 110], reach: 140, slash: '#dfe6ff' }),
  bk_apostle: MINION('bk_apostle', { lunge: true, slash: '#ff3040', hp: 7, speed: [150, 180] }),
  bk_boss: BOSS('bk_boss', { proj: 'shock', projColor: '#3a0010', adds: ['bk_soldier', 'bk_apostle'], roar: 'C\'EST L\'ÉCLIPSE.' }),
  fz_skeleton: MINION('fz_skeleton', { lunge: true, slash: '#e8e8ff', hp: 5 }),
  fz_shadow: MINION('fz_shadow', { ranged: 'orb' }),
  fz_boss: BOSS('fz_boss', { proj: 'beam', projColor: '#ffd84a', adds: ['fz_skeleton', 'fz_shadow'], roar: 'GATE OF BABYLON !!' }),
  fm_chimera: MINION('fm_chimera', { lunge: true, slash: '#ffcf6a', hp: 7, speed: [150, 180] }),
  fm_soldier: MINION('fm_soldier', { ranged: 'bullet' }),
  fm_boss: BOSS('fm_boss', { proj: 'slash', projColor: '#ffffff', adds: ['fm_chimera', 'fm_soldier'], roar: 'L\'ŒIL ULTIME !!' }),
  rp_thug: MINION('rp_thug', { lunge: true, slash: '#e8f0ff', hp: 6 }),
  rp_gunman: MINION('rp_gunman', { ranged: 'bullet' }),
  rp_boss: BOSS('rp_boss', { proj: 'beam', projColor: '#ffb070', adds: ['rp_thug', 'rp_gunman'], roar: 'CHIEN DE CHASSE !!' }),
  bl2_boss: BOSS('bl2_boss', { proj: 'beam', projColor: '#6aff9a', adds: ['bl2_arrancar', 'bl2_fraccion'], roar: 'CERO OSCURAS.' }),
});
// Mini-boss, à mi-parcours de chaque monde : gabarit des boss (planches marche / attaque / spécial / chute), 70 % de
// leur vie, une taille en dessous, sans super-armure ni renforts ; il tire comme le boss de son monde
const MINI_ROAR = {
  tokyo: 'ÉCRASÉS !!', op: 'WHITE BLOW !!', ds: 'DORS…', bl: 'HIHIO ZABIMARU !!', hx: 'DOUBLE !', nr: 'SABAKU SÔSÔ !!',
  db: 'BODY CHANGE !!', mh: 'DÉSINTÉGRATION…', rk: 'SHUKUCHI !', op2: 'RANKYAKU !!', nr2: 'SHIKIGAMI NO MAI.', ds2: 'CHI GAMA !!',
  db2: 'ÉNERGIE ABSORBÉE.', jk: 'MUTATION OISIVE !', sl: 'FURTIVITÉ…', opm: 'SOUMETS-TOI !', bl2: 'GRAN REY CERO !!',
  aot: 'TU NE PASSERAS PAS !', bk: 'COMBATS, GUERRIER NOIR !', fz: 'GAE BOLG !!', fm: 'TRANSFORMATION !', rp: 'ADIOS, AMIGO.',
};
for (const L of LEVELS) {
  const B = ETYPES[L.boss];
  ETYPES[`${L.id}_mini`] = BOSS(`${L.id}_mini`, { proj: B.proj, projColor: B.projColor, hp: Math.round(B.hp * 0.7), h: 250, score: 12000,
    superArmor: false, adds: [], roar: MINI_ROAR[L.id], mini: true });
}
// Tant que leurs planches manquent, ces ennemis empruntent les animations d'un ennemi existant (samouraï pour
// ceux qui se ruent, motard pour les autres, Kuro-Oni pour les boss), recolorées
const STAND_IN = {
  op_pirate: 'hue-rotate(200deg) saturate(1.2)', op_marine: 'grayscale(0.7) brightness(1.5)', op_boss: 'hue-rotate(180deg) saturate(1.3)',
  ds_demon: 'grayscale(0.8) brightness(0.8)', ds_spider: 'grayscale(1) brightness(1.7)', ds_boss: 'hue-rotate(250deg) saturate(1.2)',
  bl_shinigami: 'grayscale(1) brightness(0.6)', bl_hollow: 'grayscale(1) contrast(1.4)', bl_boss: 'grayscale(0.7) brightness(1.1)',
  hx_fighter: 'sepia(0.6) brightness(1.2)', hx_nen: 'hue-rotate(260deg)', hx_boss: 'hue-rotate(300deg) saturate(1.4)',
  nr_sound: 'grayscale(0.7)', nr_rogue: 'hue-rotate(120deg) brightness(0.8)', nr_boss: 'grayscale(0.5) hue-rotate(260deg)',
  db_elite: 'hue-rotate(330deg) saturate(1.5)', db_soldier: 'hue-rotate(250deg) saturate(1.4)', db_boss: 'grayscale(0.6) brightness(1.5)',
  mh_villain: 'sepia(0.5) hue-rotate(-20deg)', mh_blaster: 'hue-rotate(20deg) saturate(1.6)', mh_boss: 'grayscale(0.9) brightness(0.5)',
  rk_ronin: 'grayscale(0.6)', rk_ninja: 'hue-rotate(200deg)', rk_boss: 'grayscale(0.8) brightness(1.4)',
  op2_guard: 'hue-rotate(200deg) saturate(1.3)', op2_agent: 'grayscale(1) brightness(0.5)', op2_boss: 'grayscale(1) brightness(0.6)',
  nr2_puppet: 'hue-rotate(260deg)', nr2_rain: 'grayscale(0.8)', nr2_boss: 'hue-rotate(10deg) saturate(1.4)',
  ds2_demon: 'hue-rotate(300deg)', ds2_obi: 'hue-rotate(290deg) saturate(1.6)', ds2_boss: 'hue-rotate(300deg) saturate(1.4)',
  db2_jr: 'hue-rotate(180deg)', db2_android: 'hue-rotate(80deg)', db2_boss: 'hue-rotate(70deg) saturate(1.4)',
  jk_curse: 'hue-rotate(260deg)', jk_user: 'grayscale(0.8)', jk_boss: 'hue-rotate(320deg) saturate(1.3)',
  sl_goblin: 'hue-rotate(90deg)', sl_knight: 'grayscale(1)', sl_boss: 'hue-rotate(340deg) saturate(1.5)',
  opm_monster: 'hue-rotate(340deg) saturate(1.5)', opm_alien: 'hue-rotate(260deg)', opm_boss: 'hue-rotate(200deg)',
  bl2_arrancar: 'grayscale(1) brightness(1.5)', bl2_fraccion: 'grayscale(0.8) brightness(1.3)', bl2_boss: 'grayscale(1) brightness(1.4)',
  // mini-boss : le Kuro-Oni recoloré, en attendant leurs planches
  tokyo_mini: 'hue-rotate(340deg) saturate(1.6)', op_mini: 'grayscale(0.9) brightness(1.5)', ds_mini: 'hue-rotate(240deg) brightness(0.8)',
  bl_mini: 'hue-rotate(330deg) saturate(1.8)', hx_mini: 'grayscale(0.6) brightness(1.4)', nr_mini: 'sepia(0.8) hue-rotate(-20deg) saturate(1.4)',
  db_mini: 'hue-rotate(260deg) saturate(1.5)', mh_mini: 'grayscale(0.7) hue-rotate(180deg) brightness(1.2)', rk_mini: 'hue-rotate(180deg) brightness(1.2)',
  op2_mini: 'grayscale(1) brightness(0.7)', nr2_mini: 'hue-rotate(200deg) saturate(1.3)', ds2_mini: 'hue-rotate(90deg) saturate(1.2)',
  db2_mini: 'grayscale(0.8) brightness(1.6)', jk_mini: 'hue-rotate(200deg) brightness(1.1)', sl_mini: 'grayscale(1) brightness(0.55)',
  opm_mini: 'hue-rotate(60deg) saturate(1.5)', bl2_mini: 'hue-rotate(170deg) saturate(1.6)',
};
for (const [k, f] of Object.entries(STAND_IN)) Object.assign(ETYPES[k], { alt: ETYPES[k].isBoss ? 'boss' : ETYPES[k].lunge ? 'samurai' : 'biker', altTint: f });
// Ennemis à la taille des héros (un sbire = un héros moyen, les boss restent plus grands)
const ENEMY_SIZE = 0.92, heroSheets = new Set(Object.keys(CHARS).flatMap(charSheets));
for (const sh of new Set(Object.values(ETYPES).map(T => T.sheet).filter(sh => sh && !heroSheets.has(sh))))
  for (const A of Object.values(SPRITES[sh] || {})) { A.scale *= ENEMY_SIZE; if (A.rate) A.rate /= ENEMY_SIZE; }
for (const T of Object.values(ETYPES)) if (T.h) T.h = Math.round(T.h * WORLD * ENEMY_SIZE);

// Avance vers le joueur jusqu'à la distance voulue, en se calant sur sa ligne de profondeur
function approach(e, dt, h, want) {
  const dx = h.x - e.x, dist = Math.abs(dx), dz = h.gz - e.gz;
  e.dir = Math.sign(dx) || e.dir;
  const mvx = dist > want + 10 ? e.dir : dist < want - 60 ? -e.dir : 0, mvz = Math.abs(dz) > 6 ? Math.sign(dz) : 0;
  e.x += mvx * e.speed * dt;
  e.gz = clamp(e.gz + mvz * e.speed * 0.6 * dt, Z_TOP, Z_BOT); e.y = e.gz;
  e.moving = !!(mvx || mvz); if (e.moving) e.walkT += dt;
  return { dist, dz };
}
const atk = (e, name) => { e.state = 'atk'; e.atk = name; e.t = 0; e.hitDone = false; };
// Coup d'ennemi : touche le joueur ciblé s'il est devant, à portée et sur la même ligne
function enemyHit(e, h, range, dmg, big, both = false) {
  const dx = h.x - e.x;
  if (e.hitDone || Math.abs(dx) > range || !inLane(e, h, 30) || (!both && Math.sign(dx) !== e.dir)) return;
  e.hitDone = true; hurtHero(h, dmg, Math.sign(dx) || e.dir, big);
}

function bikerAI(e, dt, h, heroDown) {
  if (e.state === 'walk') {
    const { dist, dz } = approach(e, dt, h, 170);
    if (heroDown) return true;
    if (dist < 230 && Math.abs(dz) < 18) { e.cool -= dt; if (e.cool <= 0) atk(e, dist < 120 && Math.random() < 0.5 ? 'spin' : 'whip'); }
    return true;
  }
  if (e.atk === 'whip') {
    if (e.t > 0.32 && e.t < 0.46) enemyHit(e, h, 235, ETYPES.biker.dmg, false);
    if (e.t > 0.38 && !e.snd) { e.snd = true; audio.play('swing', 0.8, 0.7); }
    if (e.t > 0.75) { e.state = 'walk'; e.snd = false; e.cool = rand(0.9, 1.8); }
  } else {
    if (e.t > 0.2 && e.t < 0.7) enemyHit(e, h, 170, 10, true, true);
    if (Math.random() < 0.3) audio.play('swing', 0.3, 1.2);
    if (e.t > 0.85) { e.state = 'walk'; e.cool = rand(1.2, 2); }
  }
  return true;
}
function bikerPose(e) {
  const t = e.t;
  switch (e.state) {
    case 'walk': return e.moving ? ['walk', ewalk(e, 10)] : ['attack', 0];
    case 'atk': return e.atk === 'whip' ? ['attack', step(t, [0.3, 0.5])] : ['attack', 4 + Math.floor(t * 8) % 2 * 0];
    case 'hurt': return ['fall', t < 0.15 ? 0 : 1];
    case 'knock': return ['fall', e.vy < 0 ? 2 : 3];
    case 'down': return ['fall', 4];
    case 'getup': return ['fall', 5 + step(t, [0.18, 0.34])];
    default: return ['attack', 0];
  }
}

function samuraiAI(e, dt, h, heroDown) {
  if (e.state === 'walk') {
    const { dist, dz } = approach(e, dt, h, 260);
    if (heroDown) return true;
    if (Math.abs(dz) < 18) {
      e.cool -= dt;
      if (e.cool <= 0) { if (dist < 130) atk(e, 'over'); else if (dist < 420) atk(e, 'dash'); }
    }
    return true;
  }
  if (e.atk === 'dash') {
    // dégaine puis traverse : coupe en croix sur son passage
    if (e.t < 0.45) { if (e.t < 0.05) say2(e, '!'); }
    else if (e.t < 0.75) {
      e.x += e.dir * 820 * dt; e.x = clamp(e.x, camX - 40, camX + W + 40);
      enemyHit(e, h, 70, ETYPES.samurai.dmg, true, true);
      if (Math.random() < 0.6) particles.push({ x: e.x - e.dir * 30, y: e.y - rand(40, 150), vx: -e.dir * 400, vy: 0, t: 0, life: 0.25, c: '#ff3040', r: 2 });
      if (!e.snd) { e.snd = true; audio.slash(1.3); slashFX(e.x, e.y - 110, e.dir, { a0: -0.3, a1: 0.3, r: 140, c: '#ff3040', life: 0.25, w: 16 }); }
    } else if (e.t > 1.1) { e.state = 'walk'; e.snd = false; e.cool = rand(1.4, 2.4); }
  } else {
    if (e.t > 0.4 && e.t < 0.55) { enemyHit(e, h, 150, ETYPES.samurai.dmg, false); if (!e.snd) { e.snd = true; audio.slash(1.1); slashFX(e.x + e.dir * 60, e.y - 110, e.dir, { a0: -1.6, a1: 1.2, r: 120, c: '#ff3040', life: 0.25 }); } }
    if (e.t > 0.9) { e.state = 'walk'; e.snd = false; e.cool = rand(1, 1.8); }
  }
  return true;
}
function samuraiPose(e) {
  const t = e.t;
  switch (e.state) {
    case 'walk': return e.moving ? ['walk', ewalk(e, 10)] : ['attack', 6];
    case 'atk': return e.atk === 'dash' ? ['attack', t < 0.45 ? 0 : t < 0.75 ? 1 : t < 0.9 ? 2 : 3] : ['attack', t < 0.4 ? 4 : 5];
    case 'hurt': return ['fall', t < 0.15 ? 0 : 1];
    case 'knock': return ['fall', e.vy < 0 ? 2 : 3];
    case 'down': return ['fall', 4];
    case 'getup': return ['fall', 5 + step(t, [0.18, 0.34])];
    default: return ['attack', 6];
  }
}
// Sbires des niveaux à thème : deux coups au corps à corps, et une ruée (lunge) ou un tir de loin (ranged).
// Planche d'attaque : 0 garde, 1 armé, 2 coup porté, 3 retour, 4 armé du 2e coup, 5 2e coup, 6 tir, 7 provocation.
function minionAI(e, dt, h, heroDown) {
  const T = ETYPES[e.type];
  if (e.state === 'walk') {
    const { dist, dz } = approach(e, dt, h, T.ranged ? 300 : T.reach - 15);
    if (heroDown) return true;
    e.cool -= dt;
    if (e.cool <= 0 && Math.abs(dz) < 18) {
      if (dist < T.reach + 10) atk(e, Math.random() < 0.5 ? 'hit' : 'hit2');
      else if (T.ranged && dist < 560) atk(e, 'shoot');
      else if (T.lunge && dist < 380) atk(e, 'lunge');
    }
    return true;
  }
  const t = e.t;
  switch (e.atk) {
    case 'hit': case 'hit2': {
      const [a, b, end] = e.atk === 'hit' ? [0.32, 0.46, 0.72] : [0.28, 0.42, 0.68];
      if (t > a && t < b) {
        enemyHit(e, h, T.reach + 20, T.dmg, !!T.armor);
        if (!e.snd) { e.snd = true; audio.whoosh(T.armor ? 1.5 : 1); if (T.slash) slashFX(e.x + e.dir * 60, e.y - 110, e.dir, { a0: -1.2, a1: 1, r: 100, c: T.slash, life: 0.22 }); }
      }
      if (t > end) { e.state = 'walk'; e.snd = false; e.cool = rand(0.9, 1.7); }
      break;
    }
    case 'shoot':
      if (t > 0.3 && !e.fired) { e.fired = true; minionShot(e, T.ranged); }
      if (t > 0.7) { e.state = 'walk'; e.fired = false; e.cool = rand(1.4, 2.4); }
      break;
    case 'lunge':
      if (t < 0.3) { if (t < 0.05) say2(e, '!'); }
      else if (t < 0.55) {
        e.x = clamp(e.x + e.dir * 720 * dt, camX - 40, camX + W + 40);
        enemyHit(e, h, 75, T.dmg, true, true);
        if (!e.snd) { e.snd = true; audio.slash(1.2); if (T.slash) slashFX(e.x, e.y - 110, e.dir, { a0: -0.3, a1: 0.3, r: 130, c: T.slash, life: 0.25, w: 14 }); }
      } else if (t > 0.9) { e.state = 'walk'; e.snd = false; e.cool = rand(1.3, 2.2); }
      break;
  }
  return true;
}
// Image de marche d'un ennemi : les marches tirées d'une vidéo (16 images) ont leur propre cadence
function ewalk(e, fps) {
  const A = SPRITES[ETYPES[e.type].sheet || e.type]?.walk;
  return A?.rate ? Math.floor(e.walkT * A.rate) % A.frames.length : Math.floor(e.walkT * fps) % 8;
}
function minionPose(e) {
  const t = e.t;
  switch (e.state) {
    case 'walk': return e.moving ? ['walk', ewalk(e, 10)] : ['attack', 0];
    case 'atk':
      switch (e.atk) {
        case 'hit': return ['attack', t < 0.32 ? 1 : t < 0.55 ? 2 : 3];
        case 'hit2': return ['attack', t < 0.28 ? 4 : 5];
        case 'shoot': return ['attack', t < 0.25 ? 0 : 6];
        case 'lunge': return ['attack', t < 0.3 ? 1 : t < 0.6 ? 2 : 3];
      }
      return ['attack', 0];
    case 'hurt': return ['fall', t < 0.15 ? 0 : 1];
    case 'knock': return ['fall', e.vy < 0 ? 2 : 3];
    case 'down': return ['fall', 4];
    case 'getup': return ['fall', 5 + step(t, [0.18, 0.34])];
    default: return ['attack', 0];
  }
}
// Petits projectiles (renvoyables d'un coup, comme les shurikens) : balle, fil, kunaï, sphère d'aura…
function minionShot(e, kind) {
  audio.whoosh(0.8);
  const speed = { bullet: 780, cero: 420, thread: 620 }[kind] || 540;
  stars.push({ kind, x: e.x + e.dir * 60, y: e.gz - (kind === 'cero' ? 140 : 125), gz: e.gz, vx: e.dir * speed, t: 0, dmg: kind === 'cero' ? 14 : Math.round(ETYPES[e.type].dmg * 0.8) });
}
// Attaque de loin des boss : boulet (Baggy), onde de choc (Akaza, Nomu), lame de reiatsu (Kenpachi),
// cartes (Hisoka), serpent (Orochimaru), Death Beam (Freezer), souffle de feu (Kuro-Oni)
function bossShot(e, kind) {
  const d = e.dir, x = e.x + d * 110, T = ETYPES[e.type];
  audio.play('waveFire', 1, 0.6, 0);
  if (kind === 'fire') { stars.push({ kind, x: e.x + d * 120, y: e.gz - 230, gz: e.gz, vx: d * 460, t: 0, dmg: 16 }); return; }
  if (kind === 'cards') { [160, 115, 70].forEach((y, k) => stars.push({ kind: 'card', x, y: e.gz - y, gz: e.gz, vx: d * (600 + k * 60), t: 0, dmg: 9 })); return; }
  const [y, v, dmg] = { muggy: [150, 430, 18], shock: [120, 520, 16], slash: [120, 640, 16], snake: [40, 380, 14], beam: [150, 1150, 13] }[kind];
  stars.push({ kind, x, y: e.gz - y, gz: e.gz, vx: d * v, vy: kind === 'muggy' ? -420 : 0, t: 0, dmg, color: T.projColor });
}
const say2 = (e, text) => popups.push({ x: e.x, y: e.y - ETYPES[e.type].h, t: 0, text, small: true, c: '#ff3040' });

function bossAI(e, dt, h, heroDown) {
  const T = ETYPES[e.type];
  // À mi-vie : il rugit, s'énerve et appelle des renforts
  if (!e.enraged && e.hp < e.maxHp / 2 && e.state === 'walk') {
    e.enraged = true; e.speed *= 1.35; atk(e, 'roar');
    flash = 0.5; shake = 26; audio.play('ultraBoom', 1, 0.6, 0); say2(e, T.roar);
    for (const t of T.adds) spawnEnemy(t);
    return true;
  }
  const fast = e.enraged ? 0.75 : 1;
  if (e.state === 'walk') {
    const { dist, dz } = approach(e, dt, h, 150);
    if (heroDown) return true;
    e.cool -= dt;
    if (e.cool <= 0) {
      if (dist > 380 && Math.random() < 0.5) atk(e, 'fire');
      else if (dist > 300) atk(e, 'charge');
      else if (Math.abs(dz) < 30 && dist < 230) atk(e, Math.random() < 0.55 ? 'smash' : 'swing');
    }
    return true;
  }
  const t = e.t / fast;
  switch (e.atk) {
    case 'smash':
      if (t > 0.75 && !e.slammed) {
        // le kanabo écrase le sol : onde de choc sur toute la ligne devant lui
        e.slammed = true; shake = 24; audio.play('ultraBoom', 0.9, 0.8, 0);
        animFX('rupture', e.x + e.dir * 170, e.gz - 60, 260, 0.5);
        for (const p of players) if (!p.out && inLane(e, p, 60) && Math.abs(p.x - (e.x + e.dir * 150)) < 200) hurtHero(p, T.dmg, e.dir, true);
      }
      if (t > 1.45) { e.state = 'walk'; e.slammed = false; e.cool = rand(0.9, 1.6) * fast; }
      break;
    case 'swing':
      if (t > 0.55 && t < 0.75) for (const p of players) if (!p.out) enemyHit(e, p, 260, 15, true);
      if (t > 0.55 && !e.snd) { e.snd = true; audio.whoosh(1.6); }
      if (t > 1.15) { e.state = 'walk'; e.snd = false; e.cool = rand(0.8, 1.4) * fast; }
      break;
    case 'charge':
      if (t > 0.35 && t < 1.05) {
        e.x = clamp(e.x + e.dir * 620 * dt, camX + 40, camX + W - 40);
        for (const p of players) if (!p.out) enemyHit(e, p, 90, 12, true, true);
        if (Math.random() < 0.5) burst(e.x, e.gz - 10, '#c9c2b0', 2);
      }
      if (t > 1.3) { e.state = 'walk'; e.cool = rand(0.8, 1.4) * fast; }
      break;
    case 'fire':
      if (t > 0.6 && !e.fired) {
        e.fired = true; bossShot(e, T.proj);
      }
      if (t > 1.2) { e.state = 'walk'; e.fired = false; e.cool = rand(1, 1.6) * fast; }
      break;
    case 'roar':
      if (Math.random() < 0.6) particles.push({ x: e.x + rand(-80, 80), y: e.y - rand(0, 280), vx: rand(-40, 40), vy: rand(-260, -100), t: 0, life: 0.5, c: '#ff5a00', r: rand(3, 7) });
      if (e.t > 1.4) { e.state = 'walk'; e.cool = 0.6; }
      break;
  }
  return true;
}
function bossPose(e) {
  const t = e.t / (e.enraged ? 0.75 : 1);
  switch (e.state) {
    case 'walk': return e.moving ? ['walk', ewalk(e, 8)] : ['attack', 0];
    case 'atk':
      switch (e.atk) {
        case 'smash': return ['attack', t < 0.55 ? 1 : t < 0.95 ? 2 : 3];
        case 'swing': return ['attack', t < 0.5 ? 4 : 5];
        case 'charge': return ['attack', 6];
        case 'fire': return ['special', t < 0.35 ? 0 : t < 0.6 ? 1 : t < 1.0 ? 2 : 3];
        default: return ['special', 5];
      }
    case 'hurt': return ['fall', 0];
    case 'knock': return ['fall', e.vy < 0 ? 2 : 3];
    case 'down': return ['fall', 4];
    case 'getup': return ['fall', 5 + step(e.t, [0.25, 0.5])];
    default: return ['attack', 0];
  }
}

function pickType() {
  const p = kills / STAGE.killsToClear, r = Math.random();
  const brutes = enemies.filter(e => e.alive && e.type === 'brute').length;
  if (p > 0.2 && brutes === 0 && r < 0.22) return 'brute';
  if (p > 0.08 && r < 0.5) return 'ninja';
  return 'thug';
}

function spawnEnemy(type = pickType()) {
  const T = ETYPES[type], side = Math.random() < 0.6 ? 1 : -1;
  const x = side > 0 ? camX + W + 60 : camX - 60, gz = rand(Z_TOP + 10, Z_BOT - 10);
  const lvl = Math.min(kills / STAGE.killsToClear, 1);
  enemies.push({
    type, x, y: gz, gz, vx: 0, vy: 0, dir: -side, state: 'walk', t: 0, alive: true,
    hp: T.hp * DIFF().hp * endlessHp() * (T.isBoss && players.length > 1 ? 1 + 0.5 * (players.length - 1) : 1), maxHp: T.hp * DIFF().hp * endlessHp() * (T.isBoss && players.length > 1 ? 1 + 0.5 * (players.length - 1) : 1), speed: rand(...T.speed) * (1 + lvl * 0.3), cool: rand(0.4, 1.2), walkT: rand(0, 1), flash: 0, hitDone: false,
    tint: type === 'thug' && Math.random() < 0.3 ? 'hue-rotate(35deg) saturate(1.3)' : '',
  });
}

function damageEnemy(e, dmg, kb, launch, fx, fy, col = '#ffe066') {
  const T = ETYPES[e.type];
  if (e.hp <= 0) return; // déjà vaincu (il retombe) : on ne le jongle plus
  e.hp -= dmg; e.flash = 0.1; e.dir = kb > 0 ? -1 : 1;
  combo++; comboT = 1.6;
  score += 100 * Math.round(dmg) * Math.min(combo, 10);
  hitstop = 0.06; shake = Math.max(shake, 6); audio.hit(dmg >= 2 || !!launch);
  burst(fx, fy, col, 10); impactFX(fx, fy, col, dmg >= 3 || !!launch);
  popups.push({ x: fx, y: fy - 20, t: 0, text: combo > 1 ? `${combo} HITS!` : 'POW!' });
  // La brute encaisse les petits coups sans broncher : seuls les gros coups la font tituber ou tomber
  if (T.superArmor && e.hp > 0) { e.x += kb * 0.02; return; }
  if (T.armor && e.hp > 0 && dmg < 3) { e.x += kb * 0.04; return; }
  if (e.hp <= 0 || launch) {
    e.state = 'knock'; e.vx = kb * (T.armor ? 0.8 : 1.4); e.vy = T.armor ? Math.max(launch || -520, -480) : (launch || -520); e.t = 0;
  } else {
    e.state = 'hurt'; e.t = 0; e.vx = kb;
  }
}

// Le héros peut-il être touché à cette position ? (même profondeur, pas trop haut en l'air)
const inLane = (e, h, tol = 22) => Math.abs(h.gz - e.gz) < tol && h.gz - h.y < 120;

// Cible d'un ennemi : le joueur le plus proche encore debout (revue de temps en temps, pour ne pas hésiter)
function targetOf(e) {
  if (e.tgt && !e.tgt.out && e.tgtT > 0) return e.tgt;
  let best = null, bd = Infinity;
  for (const h of players) {
    const d = Math.abs(h.x - e.x) + Math.abs(h.gz - e.gz) * 2;
    if (!h.out && !h.assist && d < bd) { bd = d; best = h; }
  }
  e.tgtT = 1; e.tgt = best || players[0];
  return e.tgt;
}

function updateEnemy(e, dt) {
  e.tgtT = (e.tgtT || 0) - dt;
  if (e.cool > 0) e.cool -= dt * (DIFF().aggr - 1); // difficulté : attaques plus ou moins rapprochées
  const T = ETYPES[e.type], h = targetOf(e);
  if (e.eject) { updateEject(e, dt); return; }
  e.t += dt; e.flash = Math.max(0, e.flash - dt);
  if (e.hop) return; // en plein saut par-dessus un trou (updatePits)
  const dx = h.x - e.x, dist = Math.abs(dx), dz = h.gz - e.gz;
  const heroDown = h.out || ['knock', 'floor', 'getup'].includes(h.state);
  // Ennemis à comportement propre (motard, samouraï, boss) : marche et attaques gérées à part
  if (T.ai && (e.state === 'walk' || e.state === 'atk') && T.ai(e, dt, h, heroDown)) return;

  switch (e.state) {
    case 'walk': {
      e.dir = Math.sign(dx) || e.dir;
      let mvx = 0;
      if (e.type === 'ninja') {
        // Garde ses distances : recule s'il est trop près, s'approche s'il est trop loin
        if (dist < 190 && !(e.x < camX + 40 || e.x > camX + W - 40)) mvx = -e.dir;
        else if (dist > 340) mvx = e.dir;
      } else {
        // Ne pas s'empiler : on attend derrière un ennemi déjà au contact sur la même ligne
        const blocker = enemies.some(o => o !== e && o.alive && o.state !== 'knock' && Math.abs(o.gz - e.gz) < 30 &&
          Math.sign(h.x - o.x) === e.dir && Math.abs(h.x - o.x) < dist && dist - Math.abs(h.x - o.x) < 80);
        if (dist > T.reach && !blocker) mvx = e.dir;
      }
      const mvz = Math.abs(dz) > 6 ? Math.sign(dz) : 0;
      e.x += mvx * e.speed * dt;
      e.gz = clamp(e.gz + mvz * e.speed * 0.55 * dt, Z_TOP, Z_BOT); e.y = e.gz;
      e.moving = !!(mvx || mvz); e.backing = mvx !== 0 && mvx !== e.dir;
      if (e.moving) e.walkT += dt;
      if (heroDown) break;
      if (e.type === 'ninja') {
        if (dist < 115 && Math.abs(dz) < 18) { e.cool -= dt * 2; if (e.cool <= 0) { e.state = 'slash'; e.t = 0; e.hitDone = false; } }
        else if (dist < 460 && Math.abs(dz) < 20) { e.cool -= dt; if (e.cool <= 0) { e.state = 'throw'; e.t = 0; e.hitDone = false; } }
      } else if (dist <= T.reach + 12 && Math.abs(dz) < 16) {
        e.cool -= dt; if (e.cool <= 0) { e.state = 'windup'; e.t = 0; }
      }
      break;
    }
    case 'windup':
      if (e.t > T.windup) { e.state = 'punch'; e.t = 0; e.hitDone = false; audio.whoosh(e.type === 'brute' ? 1.5 : 1); }
      break;
    case 'punch': {
      const range = e.type === 'brute' ? 160 : 135;
      if (!e.hitDone && e.t > 0.06 && e.t < 0.2 && dist < range && inLane(e, h) && Math.sign(dx) === e.dir) {
        e.hitDone = true;
        if (e.type === 'brute') hurtHero(h, T.dmg, e.dir, true);
        // Le coup du voyou passe au-dessus d'un héros baissé
        else if (['crouch', 'ckick'].includes(h.state)) popups.push({ x: h.x, y: h.y - 150, t: 0, text: 'ESQUIVE!' });
        else hurtHero(h, T.dmg, e.dir);
      }
      if (e.type === 'brute' && e.t >= 0.08 && !e.slammed) {
        // Le poing mécanique frappe le sol : onde de choc
        e.slammed = true; shake = Math.max(shake, 12); audio.play('body', 1, 0.7);
        burst(e.x + e.dir * 120, e.gz - 10, '#c9c2b0', 14);
      }
      if (e.t > (e.type === 'brute' ? 0.7 : 0.4)) { e.state = 'walk'; e.slammed = false; e.cool = e.type === 'brute' ? rand(1.4, 2.4) : rand(0.8, 1.8); }
      break;
    }
    case 'throw':
      if (!e.hitDone && e.t > 0.25) {
        e.hitDone = true; audio.whoosh(0.8);
        stars.push({ x: e.x + e.dir * 50, y: e.gz - 125, gz: e.gz, vx: e.dir * 540, t: 0 });
      }
      if (e.t > 0.55) { e.state = 'walk'; e.cool = rand(1.3, 2.4); }
      break;
    case 'slash':
      if (!e.hitDone && e.t > 0.25 && e.t < 0.4 && dist < 140 && inLane(e, h) && Math.sign(dx) === e.dir) { e.hitDone = true; hurtHero(h, T.dmg, e.dir); }
      if (e.t > 0.6) { e.state = 'walk'; e.cool = rand(0.8, 1.6); }
      break;
    case 'hurt':
      e.vx *= 0.85; e.x += e.vx * dt;
      if (e.t > 0.35) { e.state = 'walk'; e.cool = rand(0.3, 0.9); }
      break;
    case 'knock':
      if (e.juggled) break; // tenu en l'air par le jonglage (updateJuggle)
      e.vy += 1700 * dt; e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.smashT > 0) {
        // projeté par le coup final : traînée de poussière, et rebond s'il heurte le bord de l'écran (on peut le reprendre)
        e.smashT -= dt;
        if (Math.random() < 0.8) particles.push({ x: e.x - Math.sign(e.vx) * rand(20, 60), y: e.y - rand(40, 170), vx: -e.vx * 0.3, vy: rand(-40, 40), t: 0, life: 0.3, c: 'rgba(255,255,255,0.8)', r: rand(1.5, 3), streak: true });
        if ((e.vx < 0 && e.x < camX + 60) || (e.vx > 0 && e.x > camX + W - 60)) {
          const wx = e.vx < 0 ? camX + 30 : camX + W - 30;
          e.x = e.vx < 0 ? camX + 60 : camX + W - 60; e.vx = -e.vx * 0.3; e.vy = Math.min(e.vy, -560); e.smashT = 0;
          shake = Math.max(shake, 16); hitstop = Math.max(hitstop, 0.06); audio.play('body', 1); audio.play('ultraBoom', 0.5, 1.6, 0);
          impactFX(wx, e.y - 110, '#ffffff', true); shockFX(wx, e.y - 110, e.vx > 0 ? 1 : -1);
          popups.push({ x: e.x, y: e.y - 230, t: 0, text: 'REBOND !', small: true, c: '#ffe14d' });
        }
      }
      if (e.y >= e.gz && e.slam) {
        // écrasé par le coup plongeant : choc au sol, poussière, il rebondit une fois
        e.slam = false; e.y = e.gz - 1; e.vy = -420; e.vx *= 0.5;
        shake = Math.max(shake, 24); hitstop = Math.max(hitstop, 0.08); audio.play('ultraBoom', 0.8, 1.3, 0); audio.play('body', 1);
        shockFX(e.x, e.gz - 20, 1); impactFX(e.x, e.gz - 20, '#ffffff', true);
        for (let k = 0; k < 24; k++) particles.push({ x: e.x + rand(-60, 60), y: e.gz - rand(0, 10), vx: rand(-420, 420), vy: rand(-260, -60), t: 0, life: 0.6, c: 'rgba(210,200,185,0.75)', r: rand(5, 12), soft: true });
        break;
      }
      if (e.y >= e.gz) {
        e.y = e.gz; shake = Math.max(shake, e.type === 'brute' ? 10 : 4); burst(e.x, e.gz - 5, '#9ad1ff', 6); audio.play('body', 0.7);
        if (e.hp <= 0) {
          e.state = 'down'; e.t = 0; e.alive = false; kills++; score += T.score; audio.ko(); dropItem(e);
          if (T.isBoss) { flash = 1; shake = 40; hitstop = 0.4; for (let k = 0; k < 5; k++) animFX('explosion', e.x + rand(-120, 120), e.y - rand(40, 260), 320, 0.6 + k * 0.1); audio.play('ultraBoom', 1.3, 0.7, 0); }
        }
        else { e.state = 'down'; e.t = 0; e.getUp = true; }
      }
      break;
    case 'down':
      e.vx *= 0.9; e.x += e.vx * dt;
      if (e.getUp && e.t > 0.8) { e.getUp = false; e.state = 'getup'; e.t = 0; }
      break;
    case 'getup':
      if (e.t > 0.5) { e.state = 'walk'; e.cool = 1; }
      break;
  }
}

// ---------- Shurikens des ninjas ----------
let stars = [];
function updateStars(dt) {
  for (const s of stars) {
    s.t += dt; s.x += s.vx * dt;
    if (BIG_SHOTS.includes(s.kind)) { updateBigShot(s, dt); continue; }
    if (s.back) {
      // Shuriken renvoyé : il blesse les ennemis qu'il croise
      for (const e of enemies) {
        if (!e.alive || e.state === 'down' || Math.abs(e.x - s.x) > 40 || Math.abs(e.gz - s.gz) > 30) continue;
        s.done = true; damageEnemy(e, 3, 300 * Math.sign(s.vx), -420, e.x, s.y, '#ff6af0');
        break;
      }
      continue;
    }
    for (const h of players) {
      // Un coup en cours dont la portée couvre le shuriken le renvoie
      const m = h.move;
      if (!s.done && m && m.reach && h.t >= m.on - 0.04 && h.t <= m.off && Math.abs(s.gz - h.gz) < 30) {
        const dx = (s.x - h.x) * h.dir;
        if (dx > -10 && dx < m.reach[1] + 30 && Math.sign(s.vx) === -h.dir) {
          s.back = true; s.vx = h.dir * Math.abs(s.vx) * 1.4;
          impactFX(s.x, s.y, '#ff6af0', false); audio.play('swing', 0.7, 1.8); audio.tone(1400, 0.08, 'triangle', 0.1, 600);
          popups.push({ x: s.x, y: s.y - 30, t: 0, text: 'RENVOYÉ !', small: true });
          continue;
        }
      }
      if (s.dodged || s.done || h.out) continue;
      if (Math.abs(s.x - h.x) < 30 && inLane(s, h, 24) && h.gz - h.y < 60) {
        // Se baisser fait passer le shuriken au-dessus ; sauter ou changer de ligne l'évite aussi
        if (['crouch', 'ckick'].includes(h.state)) { s.dodged = true; popups.push({ x: h.x, y: h.y - 150, t: 0, text: 'ESQUIVE!' }); }
        else if (!['knock', 'floor', 'getup'].includes(h.state)) { s.done = true; hurtHero(h, s.dmg || ETYPES.ninja.dmg, Math.sign(s.vx)); }
      }
    }
  }
  stars = stars.filter(s => !s.done && Math.abs(s.x - camX - W / 2) < W);
}

// Gros projectiles des boss : impossibles à renvoyer, ils font tomber
const BIG_SHOTS = ['fire', 'muggy', 'shock', 'slash', 'snake', 'beam'];
function updateBigShot(s, dt) {
  if (s.kind === 'muggy') {
    // Le boulet décrit une courbe et explose en touchant le sol
    s.vy += 900 * dt; s.y += s.vy * dt;
    if (s.y >= s.gz - 30) {
      s.done = true; animFX('explosion', s.x, s.gz - 70, 260, 0.5); shake = Math.max(shake, 16); audio.play('ultraBoom', 0.8, 1.2, 0);
      for (const h of players) if (!h.out && Math.abs(h.x - s.x) < 130 && Math.abs(h.gz - s.gz) < 50) hurtHero(h, s.dmg, Math.sign(h.x - s.x) || 1, true);
    }
    return;
  }
  if (s.kind === 'fire' && Math.random() < 0.8) particles.push({ x: s.x - Math.sign(s.vx) * rand(0, 60), y: s.y + rand(-40, 40), vx: -s.vx * 0.2, vy: rand(-120, -20), t: 0, life: 0.4, c: Math.random() < 0.5 ? '#ff7a1a' : '#ffd060', r: rand(3, 6) });
  for (const h of players) if (!h.out && !s.done && Math.abs(s.x - h.x) < 60 && inLane(s, h, 40) && h.gz - h.y < 70 && !['knock', 'floor', 'getup'].includes(h.state)) { s.done = true; hurtHero(h, s.dmg || 16, Math.sign(s.vx), true); }
}
// Dessin des projectiles autres que le shuriken (renvoie false pour garder le shuriken par défaut)
function drawShot(s, sx, d) {
  const y = s.y, t = s.t;
  const glow = (r, c) => { const g = ctx.createRadialGradient(sx, y, 1, sx, y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, y, r, 0, 7); ctx.fill(); };
  ctx.save();
  switch (s.kind) {
    case 'bullet':
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,220,120,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx - d * 50, y); ctx.stroke();
      ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(sx, y, 4, 0, 7); ctx.fill(); break;
    case 'kunai':
      ctx.translate(sx, y); ctx.scale(d, 1); ctx.fillStyle = '#c8ccd8'; ctx.strokeStyle = '#141018'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-2, -5); ctx.lineTo(-2, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a2a20'; ctx.fillRect(-14, -2, 12, 4); ctx.strokeStyle = '#3a2a20'; ctx.beginPath(); ctx.arc(-18, 0, 4, 0, 7); ctx.stroke(); break;
    case 'thread':
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
      for (const o of [-6, 0, 6]) { ctx.beginPath(); ctx.moveTo(sx, y + o * 0.5); ctx.lineTo(sx - d * 90, y + o); ctx.stroke(); }
      break;
    case 'card':
      ctx.translate(sx, y); ctx.rotate(t * 20); ctx.fillStyle = '#fbfbff'; ctx.strokeStyle = '#201828'; ctx.lineWidth = 1.5;
      ctx.fillRect(-9, -13, 18, 26); ctx.strokeRect(-9, -13, 18, 26); ctx.fillStyle = '#d0103a'; ctx.font = 'bold 13px serif'; ctx.textAlign = 'center'; ctx.fillText('♥', 0, 5); break;
    case 'orb': ctx.globalCompositeOperation = 'lighter'; glow(26 + Math.sin(t * 30) * 3, 'rgba(200,120,255,0.8)'); break;
    case 'ki': ctx.globalCompositeOperation = 'lighter'; glow(22 + Math.sin(t * 30) * 3, 'rgba(255,230,120,0.85)'); break;
    case 'cero': ctx.globalCompositeOperation = 'lighter'; glow(36 + Math.sin(t * 25) * 4, 'rgba(255,40,60,0.85)'); break;
    case 'fireball':
      ctx.globalCompositeOperation = 'lighter'; glow(28, 'rgba(255,140,30,0.85)');
      if (Math.random() < 0.6) particles.push({ x: s.x - d * rand(0, 20), y: y + rand(-12, 12), vx: -s.vx * 0.15, vy: rand(-80, -20), t: 0, life: 0.3, c: '#ffb040', r: rand(2, 4) });
      break;
    case 'muggy':
      ctx.fillStyle = '#16121c'; ctx.beginPath(); ctx.arc(sx, y, 16, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(sx - 5, y - 5, 5, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = Math.random() < 0.5 ? '#ffd060' : '#ff7a1a'; ctx.beginPath(); ctx.arc(sx + rand(-3, 3), y - 20 + rand(-3, 3), 4, 0, 7); ctx.fill(); break;
    case 'shock': {
      // Onde de choc : anneaux qui s'élargissent en avançant
      ctx.globalCompositeOperation = 'lighter'; const c = s.color || '#6ad0ff';
      for (let k = 0; k < 3; k++) { const r = 30 + k * 22 + Math.sin(t * 20 + k) * 4; ctx.strokeStyle = c; ctx.globalAlpha = 0.8 - k * 0.22; ctx.lineWidth = 7 - k * 2; ctx.beginPath(); ctx.ellipse(sx - d * k * 18, y, r * 0.45, r * 1.2, 0, 0, 7); ctx.stroke(); }
      break;
    }
    case 'slash': {
      // Lame d'énergie en croissant
      ctx.globalCompositeOperation = 'lighter'; ctx.translate(sx, y); ctx.scale(d, 1); const c = s.color || '#ffe14d';
      for (const [w, a] of [[26, 0.35], [12, 0.8], [4, 1]]) { ctx.strokeStyle = a === 1 ? '#ffffff' : c; ctx.globalAlpha = a; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(-60, 0, 90, -1.1, 1.1); ctx.stroke(); }
      break;
    }
    case 'snake': {
      // Serpent qui ondule au ras du sol, gueule ouverte
      const N = 9;
      for (let k = N; k >= 0; k--) {
        const px = sx - d * k * 16, py = y + Math.sin(t * 14 - k * 0.8) * 10;
        ctx.fillStyle = k % 2 ? '#6b4a8a' : '#8a68a8'; ctx.strokeStyle = '#1a1024'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 13 - k * 0.6, 0, 7); ctx.fill(); ctx.stroke();
      }
      const hy = y + Math.sin(t * 14) * 10;
      ctx.fillStyle = '#7a5898'; ctx.beginPath(); ctx.ellipse(sx + d * 14, hy, 20, 13, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(sx + d * 18, hy - 5, 3, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ff3050'; ctx.beginPath(); ctx.moveTo(sx + d * 32, hy + 2); ctx.lineTo(sx + d * 44, hy + 2 + Math.sin(t * 40) * 4); ctx.stroke();
      break;
    }
    case 'beam': {
      // Death Beam : rayon fin et rapide
      ctx.globalCompositeOperation = 'lighter'; const c = s.color || '#ff6ad8';
      for (const [w, col] of [[12, c], [4, '#ffffff']]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = w > 5 ? 0.6 : 1; ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx - d * 160, y); ctx.stroke(); }
      glow(14, c); break;
    }
    default: ctx.restore(); return false;
  }
  ctx.restore();
  return true;
}

function drawStars() {
  for (const s of stars) {
    const sx = s.x - camX;
    if (s.kind && s.kind !== 'fire' && drawShot(s, sx, Math.sign(s.vx) || 1)) continue;
    if (s.kind === 'fire') { fxImg('fire_arc', Math.floor(s.t * 12), sx, s.y + 110, 200, 160, { flip: s.vx < 0, rot: 1.57 * Math.sign(s.vx) }); energyBall(sx, s.y + 110, 34, true); continue; }
    ctx.save(); ctx.translate(sx, s.y); ctx.rotate(s.t * 25);
    ctx.fillStyle = '#d6dbe8'; ctx.strokeStyle = '#1a1424'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) { const r = k % 2 ? 4 : 13, a = k * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // Traînée magenta
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,60,240,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, s.y); ctx.lineTo(sx - Math.sign(s.vx) * 40, s.y); ctx.stroke(); ctx.restore();
  }
}

// ---------- Vague d'énergie : une boule ronde qui file droit ----------
function updateWaves(dt) {
  for (const w of waves) {
    w.t += dt; w.x += w.dir * 820 * dt;
    if (Math.random() < 0.8) particles.push({ x: w.x - w.dir * rand(10, 50), y: w.y + rand(-18, 18), vx: -w.dir * rand(40, 140), vy: rand(-40, 40), t: 0, life: 0.35, c: w.gold ? '#ffe680' : '#7fdcff', r: rand(2, 4) });
    for (const e of enemies) {
      if (!e.alive || w.hit.has(e) || e.state === 'down') continue;
      if (Math.abs(e.x - w.x) < 60 && Math.abs(e.gz - w.gz) < 34) { w.hit.add(e); audio.play('waveHit', 0.8); damageEnemy(e, w.gold ? 5 : 3, 380 * w.dir, -520, e.x, w.y); }
    }
  }
  waves = waves.filter(w => Math.abs(w.x - camX - W / 2) < W);
}

// ---------- Particules ----------
function burst(x, y, c, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(150, 420);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.2, 0.4), c, r: rand(2, 4) });
  }
}
function ring(x, y) { particles.push({ x, y, t: 0, life: 0.18, ring: true }); }
function updateParticles(dt) {
  for (const p of particles) { p.t += dt; if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; } }
  particles = particles.filter(p => p.t < p.life);
  for (const p of popups) { p.t += dt; p.y -= 50 * dt; }
  popups = popups.filter(p => p.t < 0.7);
}

// ---------- Effets en images (src/fx.js, fond noir dessiné en mode « lighter ») ----------
// Dessine l'étape i de l'effet name centré en (x, y), large de w (hauteur h ou proportionnelle).
function fxImg(name, i, x, y, w, h, o = {}) {
  const L = typeof FX !== 'undefined' && FX[name];
  if (!L) return false;
  const f = L[((i % L.length) + L.length) % L.length], img = IMG[f.src];
  if (!img) return false;
  const hh = h ?? w * f.h / f.w;
  ctx.save(); ctx.globalCompositeOperation = name === 'explosion' || name === 'rupture' ? 'source-over' : 'lighter';
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (o.filter) ctx.filter = o.filter;
  ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot); if (o.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
  ctx.restore();
  return true;
}
// Effet animé qui joue ses étapes une fois (explosion, éclair…)
function animFX(name, x, y, w, life, o = {}) { fxs.push({ type: 'anim', name, x, y, w, h: o.h, filter: o.filter, rot: o.rot, t: 0, life }); }
// Teinte des petits arcs électriques (planche verte) selon le personnage
const boltTint = h => ({ zenitsu: 'hue-rotate(-75deg) saturate(1.6) brightness(1.2)', killua: 'hue-rotate(95deg) saturate(1.2) brightness(1.2)', kakashi: 'hue-rotate(95deg) saturate(1.2) brightness(1.2)', izuku: '' })[h.char] ?? 'hue-rotate(95deg)';

// ---------- Effets : traînées de lame, impacts, spirales, images rémanentes ----------
// Traînée de lame : un croissant lumineux qui se dessine en un éclair puis s'efface.
// a0 → a1 : angles de l'arc (radians, 0 = devant), r : rayon, w : épaisseur, x : coupe en croix.
function slashFX(x, y, dir, o) {
  fxs.push({ type: 'slash', x, y, dir, t: 0, life: o.life || 0.26, r: o.r || 110, w: o.w || 30, a0: o.a0 ?? -1.2, a1: o.a1 ?? 0.9, cross: !!o.x, c: o.c || '#ffffff' });
  // Souffle de l'eau : gouttelettes ; souffle du feu : braises
  if (o.element === 'water' || o.element === 'fire')
    fxs.push({ type: 'anim', name: o.element === 'fire' ? 'fire_arc' : 'water_arc', x: x + dir * (o.r || 110) * 0.3, y, w: (o.r || 110) * 2.4, t: 0, life: (o.life || 0.26) + 0.12 });
  if (o.element === 'thunder') fxs.push({ type: 'anim', name: 'bolt', x: x + dir * 40, y, w: 70, h: (o.r || 110) * 1.6, t: 0, life: 0.2 });
  if (o.element === 'water' || o.element === 'fire') for (let k = 0; k < 14; k++) {
    const a = rand(Math.min(o.a0 ?? 0, o.a1 ?? 0), Math.max(o.a0 ?? 0, o.a1 ?? 0)), r = o.r || 110;
    particles.push({ x: x + Math.cos(a) * r * dir, y: y + Math.sin(a) * r, vx: Math.cos(a) * dir * rand(60, 200), vy: Math.sin(a) * rand(60, 200) - (o.element === 'fire' ? 120 : 0), t: 0, life: rand(0.3, 0.55),
      c: o.element === 'fire' ? (Math.random() < 0.5 ? '#ff7a1a' : '#ffd060') : (Math.random() < 0.5 ? '#5ad1ff' : '#e8fbff'), r: rand(2.5, 5) });
  }
}
// Impact façon manga : éclair blanc, rayons et anneau de couleur
function impactFX(x, y, c, big) {
  fxs.push({ type: 'impact', x, y, c, t: 0, life: big ? 0.32 : 0.2, r: big ? 95 : 58, n: big ? 14 : 9, rot: rand(0, 1) });
  // gros coup : explosion filmée (tools/video2fx.py) par-dessus, façon FighterZ
  const boom = Math.random() < 0.5 ? 'hitboom_a' : 'hitboom_b';
  if (big && FX[boom]) { animFX(boom, x, y, 230 * WORLD, 0.5); audio.play('brutal', 0.5, 1, 0.1); }
}
// Spirale du Rasengan qui s'ouvre sur l'ennemi
function spiralFX(x, y, c) { fxs.push({ type: 'spiral', x, y, c, t: 0, life: 0.45 }); }
// Image rémanente (téléportation) : la pose du moment, qui s'efface sur place
function afterImage(h, life = 0.35, alpha = 0.5, col = null) {
  const [anim, i] = h.C.pose(h);
  fxs.push({ type: 'ghost', x: h.x, y: h.y, dir: h.dir, sheet: sheetFor(h, anim), anim, i, t: 0, life, alpha, col, lean: leanOf(h) });
}
// Dash puissant (champ lean du coup, en degrés) : le corps se couche vers l'avant pendant la ruée, puis se redresse
function leanOf(h) {
  const m = h.move;
  if (!m?.lean || !m.push) return 0;
  const at = m.pushAt ?? 0.06, len = m.pushDur ?? 0.44, k = (h.t - at) / len;
  if (k <= 0 || k >= 1.25) return 0;
  const env = Math.min(1, k * 6) * (k > 0.8 ? Math.max(0, 1 - (k - 0.8) / 0.45) : 1);
  return m.lean * Math.PI / 180 * env;
}

function updateFX(dt) {
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter(f => f.t < f.life);
}

// ghosts : true pour dessiner seulement les images rémanentes (derrière les personnages)
function drawFX(ghosts = false) {
  for (const f of fxs) {
    if ((f.type === 'ghost') !== ghosts) continue;
    if (f.t < 0) continue; // effet programmé un peu plus tard (coups en série)
    const k = f.t / f.life, sx = f.x - camX;
    if (f.type === 'anim') {
      const n = FX[f.name] ? FX[f.name].length : 1;
      if (f.name === 'bolt') {
        // L'éclair se dessine du ciel vers le sol en un éclair, puis s'éteint en vacillant
        const L = FX.bolt[Math.floor(f.x * 7 + f.y) % FX.bolt.length], hh = f.h ?? f.w * L.h / L.w, grow = Math.min(1, f.t / 0.07);
        ctx.save(); ctx.beginPath(); ctx.rect(sx - f.w, f.y - hh / 2, f.w * 2, hh * grow); ctx.clip();
        fxImg('bolt', FX.bolt.indexOf(L), sx, f.y, f.w, hh, { filter: f.filter, alpha: k > 0.5 ? (Math.random() < 0.7 ? (1 - k) * 2 : 0.2) : 1 });
        ctx.restore();
        continue;
      }
      fxImg(f.name, Math.min(n - 1, Math.floor(k * n)), sx, f.y, f.w, f.h, { filter: f.filter, rot: f.rot, alpha: k > 0.8 ? (1 - k) * 5 : 1 });
      continue;
    }
    if (f.type === 'vortex') {
      // Kamui : une distorsion qui tourne et aspire
      ctx.save(); ctx.translate(sx, f.y); ctx.globalCompositeOperation = 'lighter';
      const R = f.r * Math.min(1, f.t / 0.3) * (k > 0.85 ? (1 - k) / 0.15 : 1);
      for (let j = 0; j < 4; j++) {
        ctx.strokeStyle = j % 2 ? 'rgba(160,90,255,0.7)' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 6 - j;
        ctx.beginPath();
        for (let q = 0; q < 50; q++) { const a = q * 0.3 + j * 1.6 - f.t * 9, r = R * (1 - q / 50); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.85); }
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if (f.type === 'ghost') {
      ctx.globalAlpha = (f.alpha ?? 0.5) * (1 - k);
      drawAnim.lean = f.lean || 0;
      drawAnim(f.sheet, f.anim, f.i, sx, f.y, f.dir, f.col ? tintFilter(f.col) : 'brightness(1.8) saturate(0.4)');
      drawAnim.lean = 0;
      ctx.globalAlpha = 1;
      continue;
    }
    if (f.type === 'smoke') {
      // bouffée de fumée (grise, noire pour une explosion) qui grossit, dérive et s'éteint
      const x = sx + (f.vx || 0) * f.t, y = f.y + (f.vy || 0) * f.t, r = f.r * (1 + k * 1.6);
      ctx.save(); ctx.globalAlpha = (1 - k) * (f.dark ? 0.7 : 0.45); ctx.fillStyle = f.dark ? '#1c1816' : '#8a8680';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore(); continue;
    }
    if (f.type === 'cannon') {
      // éclair de bouche du canon : grande étoile orange et jaune, cœur blanc
      ctx.save(); ctx.translate(sx, f.y); ctx.scale((f.dir || 1) * f.big, f.big); ctx.rotate(f.rot); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
      const g = ctx.createRadialGradient(18, 0, 2, 18, 0, 70); g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.35, 'rgba(255,190,60,0.9)'); g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(18, 0, 70, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(95, 0); ctx.lineTo(0, 12); ctx.closePath(); ctx.fill();
      for (const a of [-0.9, -0.45, 0.45, 0.9]) { ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(55, 0); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill(); ctx.restore(); }
      ctx.restore(); continue;
    }
    if (f.type === 'blast') {
      // explosion de l'obus : boule de feu qui gonfle puis rougit, anneau de souffle
      const r = (40 + 90 * Math.sqrt(k)) * f.big;
      ctx.save(); ctx.translate(sx, f.y); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k * k;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, k < 0.3 ? '#fffbe0' : '#ffd070'); g.addColorStop(0.35, 'rgba(255,150,40,0.95)'); g.addColorStop(0.7, 'rgba(220,50,10,0.7)'); g.addColorStop(1, 'rgba(120,20,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,220,150,${0.8 * (1 - k)})`; ctx.lineWidth = 5 * f.big; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.5, r * 0.6, 0, 0, 7); ctx.stroke();
      ctx.restore(); continue;
    }
    if (f.type === 'edspike') {
      // pics de pierre d'Edward : ils jaillissent du sol (étirés du bas vers le haut, petit rebond), restent, puis rentrent sous terre
      const img = IMG.fx_ed_spike; if (!img) continue;
      const t = f.t, ob = u => 1 + 3.2 * Math.pow(u - 1, 3) + 2.2 * Math.pow(u - 1, 2);
      const rise = t < 0.15 ? Math.max(0, ob(t / 0.15)) : 1, sink = clamp((t - 0.45) / 0.27, 0, 1);
      const H = 135 * f.sc, w = H * (img.width / 2) / img.height;
      ctx.save(); ctx.beginPath(); ctx.rect(sx - w, f.y - H * 1.4, w * 2, H * 1.4 + 6); ctx.clip();
      ctx.translate(sx, f.y + 6 + sink * H); ctx.scale(f.dir, 1); ctx.globalAlpha = 1 - sink * 0.6;
      ctx.drawImage(img, f.half ? img.width / 2 : 0, 0, img.width / 2, img.height, -w / 2, -H * rise, w, H * rise);
      ctx.restore(); continue;
    }
    if (f.type === 'muzzle' || f.type === 'shock') {
      ctx.save(); ctx.translate(sx, f.y); ctx.scale(f.dir || 1, 1); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
      if (f.type === 'muzzle') {
        // éclair de bouche : une étoile jaune, longue vers l'avant
        ctx.rotate(f.rot); ctx.fillStyle = '#fff6c0';
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(34, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(14, -14); ctx.lineTo(12, 0); ctx.lineTo(14, 14); ctx.closePath(); ctx.fill();
        const g = ctx.createRadialGradient(6, 0, 1, 6, 0, 22); g.addColorStop(0, 'rgba(255,220,120,0.9)'); g.addColorStop(1, 'rgba(255,140,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(6, 0, 22, 0, 7); ctx.fill();
      } else {
        // onde de choc : anneaux ovales qui s'ouvrent vers l'avant
        for (let j = 0; j < 3; j++) {
          const u = Math.min(1, k * 1.4 + j * 0.12), rx = 30 + u * 120, ry = 60 + u * 70;
          ctx.strokeStyle = j ? 'rgba(140,200,255,0.7)' : '#ffffff'; ctx.lineWidth = (8 - j * 2) * (1 - k);
          ctx.beginPath(); ctx.ellipse(u * 60, 0, rx * 0.45, ry, 0, -1.4, 1.4); ctx.stroke();
        }
      }
      ctx.restore();
      continue;
    }
    ctx.save(); ctx.translate(sx, f.y); ctx.globalCompositeOperation = 'lighter';
    if (f.type === 'slash') {
      ctx.scale(f.dir, 1); ctx.globalAlpha = 1 - k * k;
      ctx.shadowColor = f.c; ctx.shadowBlur = 16; // halo de la lame
      const grow = Math.min(1, f.t / 0.06), cuts = f.cross ? [[-0.75, 0.75], [0.75, -0.75]] : null;
      if (cuts) {
        // Coupe en croix : deux longues lames fines qui se croisent
        for (const [a, b] of cuts) lens(-f.r * Math.cos(a), -f.r * Math.sin(a) * 0.8, f.r * Math.cos(a) * grow, f.r * Math.sin(b) * 0.8 * grow, f.w * 0.5, f.c);
      } else {
        const N = 18, a0 = f.a0, a1 = f.a0 + (f.a1 - f.a0) * grow;
        for (const [wk, col] of [[1, f.c], [0.38, '#ffffff']]) {
          ctx.strokeStyle = col; ctx.lineCap = 'round';
          for (let j = 0; j < N; j++) {
            const u = j / N, v = (j + 1) / N;
            ctx.lineWidth = Math.max(1, f.w * wk * Math.sin(Math.PI * (u + v) / 2) * (1 - k * 0.5));
            ctx.beginPath(); ctx.arc(0, 0, f.r * (0.92 + 0.08 * u), a0 + (a1 - a0) * u, a0 + (a1 - a0) * v, a1 < a0); ctx.stroke();
          }
        }
      }
    } else if (f.type === 'impact') {
      ctx.rotate(f.rot);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, f.r * 0.32 * (1 - k * 0.5), 0, 7); ctx.fill();
      ctx.strokeStyle = f.c; ctx.lineCap = 'round';
      for (let j = 0; j < f.n; j++) {
        const a = j / f.n * Math.PI * 2, r0 = f.r * (0.25 + k * 0.4), r1 = f.r * (0.7 + (j % 2) * 0.35 + k * 0.4);
        ctx.lineWidth = (j % 2 ? 3 : 6) * (1 - k);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
      }
      ctx.lineWidth = 4 * (1 - k); ctx.beginPath(); ctx.arc(0, 0, f.r * (0.4 + k * 0.9), 0, 7); ctx.stroke();
    } else if (f.type === 'speed') {
      // lignes de vitesse autour de l'impact du coup final : elles convergent puis s'effacent
      ctx.globalAlpha = 0.85 * (1 - k); ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
      for (let j = 0; j < 28; j++) {
        const a = j * 2.399 + (j % 3) * 0.2, r0 = 90 + 60 * k + (j % 4) * 14, r1 = r0 + 260 + (j % 5) * 70;
        ctx.lineWidth = j % 3 ? 2 : 5;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.7); ctx.stroke();
      }
      ctx.globalAlpha = 0.5 * (1 - k); ctx.strokeStyle = f.c; ctx.lineWidth = 10 * (1 - k);
      ctx.beginPath(); ctx.ellipse(0, 0, 70 + 180 * k, (70 + 180 * k) * 0.7, 0, 0, 7); ctx.stroke();
    } else if (f.type === 'spiral') {
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.c; ctx.lineWidth = 5 * (1 - k);
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        for (let s = 0; s < 40; s++) { const a = s * 0.35 + j * 2.1 + f.t * 20, r = s * (2 + k * 4); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.8); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// Lame fine en fuseau entre deux points
function lens(x1, y1, x2, y2, w, c) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L * w, ny = dx / L * w;
  for (const [s, col] of [[1, c], [0.4, '#ffffff']]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx + nx * s, my + ny * s, x2, y2); ctx.quadraticCurveTo(mx - nx * s, my - ny * s, x1, y1); ctx.fill();
  }
}

// ---------- Projectiles : rayon, lame d'air, vague d'eau ou de feu, Rasenshuriken ----------
function updateProjs(dt) {
  for (const p of projs) {
    p.t += dt;
    const h = p.owner;
    if (p.kind === 'beam') {
      // Le Kamehameha part des mains et s'allonge ; il touche en continu ce qui est sur sa ligne
      const hp = p.hand && handPoint(h); // Excalibur : depuis la pointe de la lame dessinée
      p.x = hp ? h.x + h.dir * (hp[0] + 6) : h.x + h.dir * 78; p.y = hp ? clamp(h.y + hp[1] + (p.dy || 0), h.y - 150, h.y - 40) : h.y - (p.high || 118) * WORLD; p.dir = h.dir; p.gz = h.gz;
      p.len = Math.min(p.reach ??= p.len, p.t * 2800); // le rayon s'allonge jusqu'à sa portée
      if (h.state !== p.move || h.t > p.end) { p.done = true; continue; }
      if (p.t - p.multiT >= 0.08) { p.multiT = p.t; p.hit.clear(); }
      for (const e of enemies) {
        const dx = (e.x - p.x) * p.dir;
        if (!e.alive || p.hit.has(e) || e.state === 'down' || dx < -20 || dx > p.len || Math.abs(e.gz - p.gz) > 45 * (p.thick || 1)) continue;
        p.hit.add(e); damageEnemy(e, p.dmg, 260 * p.dir, null, e.x, p.y, p.color || '#bff3ff');
      }
      if (Math.random() < 0.9) particles.push({ x: p.x + p.dir * rand(0, p.len), y: p.y + rand(-30, 30), vx: p.dir * rand(100, 400), vy: rand(-80, 80), t: 0, life: 0.3, c: '#bff3ff', r: rand(2, 4) });
      continue;
    }
    if (p.kind === 'flamejet') {
      // brasier de Shoto : part du bout de la main tendue, s'allonge, touche en continu ce qui est sur sa ligne
      const hp = handPoint(h);
      p.x = h.x + h.dir * ((hp ? hp[0] : 70) + 10); p.y = hp ? h.y + hp[1] : h.y - 120; p.dir = h.dir; p.gz = h.gz;
      p.len = Math.min(p.reach, p.t * 1800);
      if (h.state !== p.move || h.t > p.end) { p.done = true; continue; }
      if (p.t - p.multiT >= 0.08) { p.multiT = p.t; p.hit.clear(); }
      for (const e of enemies) {
        const dx = (e.x - p.x) * p.dir;
        if (!e.alive || p.hit.has(e) || e.state === 'down' || dx < -20 || dx > p.len || Math.abs(e.gz - p.gz) > 60) continue;
        p.hit.add(e); damageEnemy(e, p.dmg, 260 * p.dir, null, e.x, p.y, '#ffd0a0');
      }
      for (let k = 0; k < 3; k++) particles.push({ x: p.x + p.dir * rand(0, p.len), y: p.y + rand(-30, 30), vx: p.dir * rand(150, 450), vy: rand(-160, -20), t: 0, life: 0.35, c: Math.random() < 0.5 ? '#ff6a1a' : '#ffd060', r: rand(3, 7) });
      continue;
    }
    if (p.kind === 'glacier') { if (p.t > p.life) p.done = true; continue; } // décor : les coups sont portés par ultraHit
    if (p.kind === 'bullet' && p.fx) { p.x += p.dir * p.speed * dt; if (p.t > p.life) p.done = true; continue; } // balle de décor (pluie de balles)
    p.x += p.dir * p.speed * dt;
    if (p.kind === 'stonewall') {
      p.x0 ??= p.x - p.dir * p.speed * dt;
      // les pics jaillissent par vagues qui avancent avec le front du mur (image assets/fx/ed_spike.png)
      if (IMG.fx_ed_spike && p.t >= (p.nextW ??= 0)) {
        p.nextW += 0.2; p.wi = (p.wi || 0) + 1;
        fxs.push({ type: 'edspike', x: p.x, y: p.gz, dir: p.dir, t: 0, life: 0.72, half: p.wi % 2, sc: p.scale || 1 });
        shake = Math.max(shake, 6);
        for (let k = 0; k < 10; k++) particles.push({ x: p.x + rand(-60, 60), y: p.gz - rand(0, 12), vx: rand(-160, 160), vy: rand(-380, -120), t: 0, life: 0.55, c: Math.random() < 0.5 ? '#8a7a68' : '#5a5048', r: rand(3, 7) });
      }
      if (Math.random() < 0.5) particles.push({ x: p.x, y: p.gz - rand(0, 20), vx: rand(-80, 80), vy: rand(-240, -80), t: 0, life: 0.45, c: Math.random() < 0.5 ? '#9a8a78' : '#5a5048', r: rand(3, 6) });
    }
    if (p.kind === 'katon' && Math.random() < 0.9) for (let k = 0; k < 2; k++) particles.push({ x: p.x - p.dir * rand(20, 90) * (p.scale || 1), y: p.y + rand(-30, 30), vx: -p.dir * rand(60, 200), vy: rand(-160, -20), t: 0, life: rand(0.3, 0.55), c: Math.random() < 0.5 ? '#ffb030' : '#ff5a10', r: rand(2, 5) });
    if (p.kind === 'shell' && p.t - (p.smokeT || 0) > 0.025) { p.smokeT = p.t; fxs.push({ type: 'smoke', x: p.x - p.dir * 14, y: p.y + rand(-3, 3), r: rand(7, 11) * (p.scale || 1), t: 0, life: 0.5 }); }
    if (p.kind === 'icewall' && p.t > p.life - 0.25 && Math.random() < 0.9) for (let k = 0; k < 3; k++) particles.push({ x: p.x - p.dir * rand(0, 300), y: p.gz - rand(10, 150), vx: rand(-120, 120), vy: rand(-260, -40), t: 0, life: 0.5, c: Math.random() < 0.5 ? '#e8fbff' : '#9fe0ff', r: rand(3, 7) });
    if (p.kind === 'icewall') { p.x0 ??= p.x - p.dir * p.speed * dt; if (Math.random() < 0.7) particles.push({ x: p.x, y: p.gz - rand(0, 20), vx: rand(-60, 60), vy: rand(-200, -60), t: 0, life: 0.4, c: Math.random() < 0.5 ? '#e8fbff' : '#9fe0ff', r: rand(2, 5) }); }
    if (p.kind === 'shuriken') {
      p.y += ((h.y - (p.ult ? 110 : 130)) - p.y) * Math.min(1, dt * 4);
      if (p.stuckT != null && p.t - p.stuckT > 0.45) p.t = p.life + 1; // ultime : éclate après avoir broyé sa cible
      if (p.t - p.multiT >= 0.08) { p.multiT = p.t; p.hit.clear(); }
    }
    const R = (p.kind === 'shuriken' ? 95 : p.kind === 'airblade' ? 60 : p.kind === 'bullet' ? 40 : 75) * (p.scale || 1);
    for (const e of enemies) {
      if (!e.alive || p.hit.has(e) || e.state === 'down' || Math.abs(e.x - p.x) > R || Math.abs(e.gz - p.gz) > 45 * (p.scale || 1)) continue;
      p.hit.add(e);
      damageEnemy(e, p.dmg, (p.kb || 120) * p.dir, p.kind === 'shuriken' ? null : p.launch, e.x, e.y - 110, p.kind === 'firewave' ? '#ffd0a0' : p.kind === 'wave' ? '#bdf0ff' : '#e8fff0');
      // une balle s'arrête dans le premier ennemi touché et recharge un peu de ki
      if (p.burst) { p.t = p.life + 1; break; } // Rasen-shuriken : il éclate sur le premier ennemi touché
      if (p.ult && p.stuckT == null) { p.stuckT = p.t; p.speed = 0; } // ultime : il s'arrête dans le premier ennemi
      if (p.kind === 'shell') { blastFX(p.x + p.dir * 10, p.y, p.scale || 1); p.done = true; break; }
      if (p.kind === 'katon') { blastFX(e.x - p.dir * 10, p.y, 0.8); animFX('explosion', e.x, p.y, 220, 0.45, { filter: 'hue-rotate(-15deg) saturate(1.6)' }); continue; }
      if (p.kind === 'bullet') { p.done = true; if (h) h.ki = Math.min(100, h.ki + p.ki); impactFX(e.x - p.dir * 20, p.y, '#ffe0a0', false); break; }
      if (p.kind === 'airshot' || p.kind === 'red') animFX('explosion', e.x, e.y - 110, 200, 0.4, p.kind === 'red' ? { filter: 'hue-rotate(-30deg) saturate(2)' } : {});
      else if (p.kind !== 'shuriken') slashFX(e.x, e.y - 110, p.dir, { a0: -1.2, a1: 1.2, r: 70, c: projColor(p), life: 0.2 });
    }
    if (p.kind === 'rocks' && p.t - (p.lastRupt || 0) > 0.06) { p.lastRupt = p.t; animFX('rupture', p.x - p.dir * 20, p.gz - 70, 190, 0.45); shake = Math.max(shake, 5); }
    if (p.kind === 'rocks' && Math.random() < 0.8) particles.push({ x: p.x - p.dir * rand(0, 50), y: p.y + rand(-10, 20), vx: -p.dir * rand(30, 120), vy: rand(-160, -40), t: 0, life: 0.45, c: Math.random() < 0.5 ? '#a08868' : '#d8c09a', r: rand(3, 7) });
    if (p.kind === 'wave' || p.kind === 'firewave') for (let k = 0; k < 3; k++)
      particles.push({ x: p.x - p.dir * rand(0, 60), y: p.y + rand(-70, 70), vx: -p.dir * rand(50, 150), vy: rand(-80, 40) - (p.kind === 'firewave' ? 100 : 0), t: 0, life: 0.4, c: p.kind === 'firewave' ? (Math.random() < 0.5 ? '#ff7a1a' : '#ffd060') : (Math.random() < 0.5 ? '#5ad1ff' : '#e8fbff'), r: rand(2, 5) });
    if (p.t > p.life || Math.abs(p.x - camX - W / 2) > W) {
      p.done = true;
      if (p.kind === 'shell' && p.t > p.life) blastFX(p.x, p.y, (p.scale || 1) * 0.8);
      if (p.kind === 'shuriken') {
        // Explosion finale : une sphère de vent tranchant
        flash = p.burst ? 0.4 : 0.8; shake = p.burst ? 14 : 26; hitstop = 0.1; audio.play('ultraBoom', p.burst ? 0.8 : 1.2, 1.1, 0);
        impactFX(p.x, p.y, '#bff3ff', true); spiralFX(p.x, p.y, '#e8fbff');
        if (p.burst) shockFX(p.x, p.y, p.dir);
        // dôme de lames de vent (assets/fx/rsh_boom.png) : petit pour le spécial, géant pour l'ultime
        bombs.push({ owner: h, x: p.x, y: p.burst ? p.y : p.gz, gz: p.gz, r: 0, state: 'boom', t: 0, hit: new Set(), dir: p.dir, rsh: p.burst ? 0.45 : 1 });
        for (const e of enemies) if (e.alive && e.state !== 'down' && Math.abs(e.x - p.x) < (p.blast || 260)) damageEnemy(e, p.final, 600 * (Math.sign(e.x - p.x) || 1), -800, e.x, e.y - 110, '#bff3ff');
        if (!p.burst) score += 2000;
      }
    }
  }
  projs = projs.filter(p => !p.done);
}

const projColor = p => ({ airblade: '#e9fff2', wave: '#5ad1ff', firewave: '#ff8a2a', shuriken: '#bff3ff', rocks: '#d8c09a', getsuga: '#bfe8ff', airshot: '#d8ffe0', red: '#ff5060', kiball: '#bff3ff', burning: '#ffe066', hiken: '#ff8a2a', katon: '#ff8a2a', strikeair: '#cfe8ff', shell: '#ffb070', icewall: '#bfefff', flamejet: '#ff8a2a', glacier: '#bfefff', bullet: '#ffe0a0', vrasen: '#9fe0ff', stonewall: '#c8b8a0' })[p.kind] || '#ffffff';

// Balle de pistolet : part DEVANT le bout du canon (point le plus en avant du haut du corps), éclair de bouche.
// En forme Two Hands, chaque tir lâche deux balles (une par pistolet).
function fireBullet(h, S) {
  const hp = handPoint(h), dmg = S.dmg * (h.boost ? h.boost.dmg : 1), n = h.boost?.rapid ? 2 : 1;
  const px = h.x + h.dir * ((hp ? hp[0] : 70) + PROJ_R.bullet), py = hp ? h.y + hp[1] : h.y - 120;
  for (let k = 0; k < n; k++)
    projs.push({ kind: 'bullet', owner: h, x: px - h.dir * k * 14, y: py + k * 10, gz: h.gz, dir: h.dir, t: 0, speed: S.speed || 1900, life: 0.55, hit: new Set(), dmg: dmg / n * (n > 1 ? 1.3 : 1), kb: S.kb || 100, launch: S.launch, ki: S.noKi ? 0 : 3, fx: S.fx });
  fxs.push({ type: 'muzzle', x: px - h.dir * PROJ_R.bullet * 0.6, y: py, dir: h.dir, t: 0, life: 0.07, rot: rand(-0.2, 0.2) });
  audio.play('waveHit', 0.25, 2.4, 0.05); shake = Math.max(shake, 3);
}
// Onde de choc de la paume de Gally : anneaux qui s'ouvrent devant le point d'impact
// Canon de Guts : éclair de bouche en étoile orange devant le bras, fumée grise qui s'étire vers l'avant
function cannonFX(x, y, dir, big = 1) {
  fxs.push({ type: 'cannon', x, y, dir, t: 0, life: 0.16, big, rot: rand(-0.15, 0.15) });
  for (let k = 0; k < 7; k++) fxs.push({ type: 'smoke', x: x + dir * rand(10, 70) * big, y: y + rand(-14, 10), r: rand(10, 18) * big, vx: dir * rand(60, 180), vy: rand(-50, -10), t: 0, life: rand(0.5, 0.8) });
  for (let k = 0; k < 8; k++) particles.push({ x, y, vx: dir * rand(200, 600), vy: rand(-180, 120), t: 0, life: 0.25, c: Math.random() < 0.5 ? '#ffd060' : '#ff7a1a', r: rand(2, 4) });
}
// Explosion de l'obus : boule de feu, fumée noire qui monte, éclats, onde
function blastFX(x, y, big = 1) {
  fxs.push({ type: 'blast', x, y, t: 0, life: 0.55, big });
  for (let k = 0; k < 9; k++) fxs.push({ type: 'smoke', x: x + rand(-40, 40) * big, y: y + rand(-30, 10) * big, r: rand(16, 30) * big, vx: rand(-40, 40), vy: rand(-140, -60), t: -rand(0.05, 0.15), life: rand(0.8, 1.2), dark: true });
  for (let k = 0; k < 18; k++) particles.push({ x, y, vx: rand(-520, 520), vy: rand(-520, 120), t: 0, life: rand(0.3, 0.6), c: Math.random() < 0.4 ? '#ffe080' : Math.random() < 0.5 ? '#ff6a1a' : '#4a4038', r: rand(2, 5) });
  shake = Math.max(shake, 14 * big); hitstop = Math.max(hitstop, 0.05); audio.play('ultraBoom', 0.6 * big, 1.4, 0);
}
function shockFX(x, y, dir) { fxs.push({ type: 'shock', x, y, dir, t: 0, life: 0.38 }); impactFX(x, y, '#9fd8ff', true); }

// « Super flash » façon FighterZ : le décor s'assombrit le temps d'un coup spécial ou d'un ultime
let dimK = 0;
function superDim() {
  const on = players.some(h => h.state === 'ultra' || (h.move && h.move.cost));
  dimK += ((on ? 1 : 0) - dimK) * 0.12;
  if (dimK < 0.02) return;
  ctx.fillStyle = `rgba(4,2,16,${0.5 * dimK})`; ctx.fillRect(-20, -20, W + 40, H + 40);
}

// Kamehameha tiré d'une vidéo (tools/video2fx.py) : gerbe d'énergie aux mains, rayon en tronçons animés mis bout à
// bout à l'échelle (chacun décalé dans l'animation pour ne pas se répéter), boule au bout. Fond assombri autour.
const KAME = { th: 100, src: 165, fps: 14 };
// Rayons filmés par perso : corps du rayon, gerbe aux mains (src, ancrée à gauche) ou sphère (orb, centrée)
function beamFxOf(p) {
  const c = p.owner?.char;
  if ((c === 'goku' || (c === 'gohan' && p.move === 'ultra')) && FX.kame_body) return { body: 'kame_body', src: 'kame_src' };
  if (c === 'vegeta' && p.move === 'galick' && FX.galick_body) return { body: 'galick_body', src: 'galick_src' };
  if (c === 'gojo' && p.move === 'ultra' && FX.violet_body) return { body: 'violet_body', orb: 'violet_orb' };
  return null;
}
function drawKameBeam(p, sx, B = { body: 'kame_body', src: 'kame_src' }) {
  const body = FX[B.body], n = body.length, k = Math.floor(p.t * KAME.fps), th = KAME.th * (p.thick || 1) * WORLD;
  const s = th / body[0].h, tw = body[0].w * s, x2 = sx + p.dir * p.len;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.translate(sx, p.y); ctx.scale(p.dir, 1);
  for (let x = 40, j = 0; x < p.len; x += tw * 0.78, j++) {
    const f = body[(k + j * 7) % n], img = IMG[f.src];
    if (!img) continue;
    const w = Math.min(tw, p.len - x + 10);
    ctx.drawImage(img, 0, 0, f.w * (w / tw), f.h, x, -th / 2, w, th);
  }
  if (B.src && FX[B.src]) {
    const fs = FX[B.src][k % FX[B.src].length], simg = IMG[fs.src];
    if (simg) { const ss = KAME.src * WORLD * (p.thick || 1) / fs.h; ctx.drawImage(simg, -150 * ss, -300 * ss, fs.w * ss, fs.h * ss); }
  }
  if (B.orb && FX[B.orb]) {
    const L = FX[B.orb], fo = L[L.length - 1 - (k % 4)], oimg = IMG[fo.src];
    if (oimg) { const os = 230 * WORLD * (p.thick || 1) / fo.h; ctx.drawImage(oimg, -fo.w * os / 2, -fo.h * os / 2, fo.w * os, fo.h * os); }
  }
  ctx.restore();
  // boule de lumière aux mains : la naissance du rayon est ronde, jamais coupée
  const col = B.body === 'kame_body' ? false : 'violet';
  energyBall(sx + p.dir * 34 * WORLD, p.y, (46 + Math.sin(p.t * 33) * 5) * (p.thick || 1) * WORLD, col);
  energyBall(x2, p.y, (40 + Math.sin(p.t * 40) * 4) * (p.thick || 1) * WORLD, col);
}

const fadeCanvas = document.createElement('canvas');
const FILMED_PROJ = { katon: ['katon_v', 130, 0.74], hiken: ['hiken_v', 130, 0.89], burning: ['burning_v', 120, 0.67], strikeair: ['strikeair_v', 120, 0.9] };
function drawProjs() {
  for (const p of projs) {
    const sx = p.x - camX;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const bfx = p.kind === 'beam' && beamFxOf(p);
    if (bfx) { ctx.restore(); drawKameBeam(p, sx, bfx); continue; }
    if (p.kind === 'beam' && FX.beam) {
      // Rayon en images : éclat dans les mains, tronçon étiré, tête qui explose ; la couleur vient d'un filtre
      ctx.restore();
      const th = (p.thick || 1) * (64 + Math.sin(p.t * 50) * 5), x2 = sx + p.dir * p.len, o = { filter: p.filter, flip: p.dir < 0 };
      const body = FX.beam[1], img = IMG[body.src];
      if (img) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (p.filter) ctx.filter = p.filter;
        ctx.drawImage(img, 0, 0, body.w, body.h, Math.min(sx, x2), p.y - th / 2, Math.abs(x2 - sx), th);
        ctx.restore();
      }
      fxImg('beam', 0, sx, p.y, 110 * (p.thick || 1), null, o);
      fxImg('beam', 2, x2, p.y, 150 * (p.thick || 1) * (1 + Math.sin(p.t * 40) * 0.06), null, o);
      continue;
    }
    if (p.kind === 'beam') {
      // Rayon : halo coloré, cœur blanc qui ondule, boule au bout
      const w = 34 + Math.sin(p.t * 50) * 4, x2 = sx + p.dir * p.len;
      const g = ctx.createLinearGradient(0, p.y - w, 0, p.y + w);
      g.addColorStop(0, 'rgba(40,140,255,0)'); g.addColorStop(0.3, p.color); g.addColorStop(0.5, '#ffffff'); g.addColorStop(0.7, p.color); g.addColorStop(1, 'rgba(40,140,255,0)');
      ctx.fillStyle = g; ctx.fillRect(Math.min(sx, x2), p.y - w, Math.abs(x2 - sx), w * 2);
      ctx.restore();
      energyBall(sx, p.y, 30, false); energyBall(x2, p.y, 44 + Math.sin(p.t * 40) * 4, false);
      continue;
    }
    ctx.translate(sx, p.y); ctx.scale(p.dir, 1);
    if (p.kind === 'shuriken') { ctx.restore(); drawShuriken(sx, p.y, (p.scale || 1) * (p.ult ? Math.min(1, 0.55 + p.t * 1.8) : 1), p.t); continue; } // l'ultime grossit en s'éloignant
    // Croissants en images : lame d'air, Getsuga Tensho, vague d'eau ou de feu
    const sprite = { airblade: ['crescent', 'hue-rotate(-60deg) saturate(0.5) brightness(1.3)'], getsuga: ['crescent', p.filter || ''], wave: ['water_arc', ''], firewave: ['fire_arc', ''] }[p.kind];
    if (p.kind === 'getsuga' && FX.getsuga_v) {
      // Getsuga filmé : lame de flammes bleues, pointe en avant (91 % de l'image), traînée derrière
      ctx.restore();
      const L = FX.getsuga_v, f = L[Math.floor(p.t * 14) % L.length], img = IMG[f.src];
      if (img) {
        const hh = 190 * (p.scale || 1) * WORLD, ww = hh * f.w / f.h;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (p.filter) ctx.filter = p.filter;
        ctx.translate(sx + p.dir * 30, p.y); ctx.scale(p.dir, 1);
        ctx.drawImage(img, -ww * 0.91, -hh / 2, ww, hh); ctx.restore();
      }
      continue;
    }
    // Tirs filmés (fond noir, mode lumineux) : [effet, hauteur affichée, position de la pointe dans l'image (0-1)]
    const filmed = FILMED_PROJ[p.kind];
    if (filmed && FX[filmed[0]]) {
      const L = FX[filmed[0]], f = L[Math.floor(p.t * 16) % L.length], img = IMG[f.src];
      if (img) {
        const hh = filmed[1] * (p.scale || 1) * WORLD, ww = hh * f.w / f.h;
        // la traînée ne dépasse jamais en arrière du point de départ (devant la main) : elle se déroule en vol
        p.ox ??= p.x; const cut = -Math.abs(p.x - p.ox) - hh * 0.45; // la boule ou le poing restent entiers
        if (cut > -ww * filmed[2]) {
          // fondu : transparent au point de départ, opaque 70 px plus loin
          const c = fadeCanvas, g = c.getContext('2d'), x0 = (cut + ww * filmed[2]) * img.width / ww;
          c.width = img.width; c.height = img.height; g.drawImage(img, 0, 0);
          const lg = g.createLinearGradient(x0, 0, x0 + 70 * img.width / ww, 0);
          lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,1)');
          g.globalCompositeOperation = 'destination-in'; g.fillStyle = lg; g.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(c, -ww * filmed[2], -hh / 2, ww, hh);
        } else ctx.drawImage(img, -ww * filmed[2], -hh / 2, ww, hh);
        ctx.restore(); continue;
      }
    }
    if (sprite && FX[sprite[0]]) {
      ctx.restore();
      const sc = p.scale || 1, wv = sprite[0] === 'crescent';
      fxImg(sprite[0], Math.floor(p.t * 14), sx, p.y, (wv ? 140 : 230) * sc, (wv ? 250 : 200) * sc, { filter: sprite[1], flip: wv ? p.dir > 0 : p.dir < 0 });
      continue;
    }
    if (p.kind === 'red') {
      // Rouge de Gojo : une sphère rouge qui palpite, cœur blanc, traînée derrière elle
      const r = 26 + Math.sin(p.t * 45) * 4;
      for (let j = 3; j >= 0; j--) {
        const g = ctx.createRadialGradient(-j * 22, 0, 1, -j * 22, 0, r * (1 - j * 0.18));
        g.addColorStop(0, j ? 'rgba(255,120,120,0.5)' : '#ffffff'); g.addColorStop(0.35, j ? 'rgba(255,40,60,0.35)' : '#ff6070'); g.addColorStop(1, 'rgba(160,0,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-j * 22, 0, r * (1 - j * 0.18), 0, 7); ctx.fill();
      }
      ctx.restore(); continue;
    }
    if (p.kind === 'burning') {
      // Burning Attack de Trunks : une grosse boule jaune qui palpite, traînée de flammes dorées
      const r = (34 + Math.sin(p.t * 36) * 5) * (p.scale || 1);
      for (let j = 3; j >= 0; j--) {
        const g = ctx.createRadialGradient(-j * r * 0.4, 0, 1, -j * r * 0.4, 0, r * (1 - j * 0.2));
        g.addColorStop(0, j ? 'rgba(255,230,120,0.45)' : '#ffffff'); g.addColorStop(0.4, j ? 'rgba(255,190,40,0.35)' : '#ffe066'); g.addColorStop(1, 'rgba(255,140,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-j * r * 0.4, 0, r * (1 - j * 0.2), 0, 7); ctx.fill();
      }
      ctx.restore(); continue;
    }
    if (p.kind === 'bullet') {
      // balle : un trait brillant et sa traînée
      const L = 46, g = ctx.createLinearGradient(-L * 2, 0, 0, 0);
      g.addColorStop(0, 'rgba(255,200,90,0)'); g.addColorStop(1, 'rgba(255,230,150,0.85)');
      ctx.fillStyle = g; ctx.fillRect(-L * 2, -2, L * 2, 4);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 2.5, 0, 0, 7); ctx.fill();
      ctx.restore(); continue;
    }
    if (p.kind === 'strikeair') {
      // Strike Air de Saber : une rafale de vent tranchante, des spirales bleutées qui tournent en filant
      const r = 46 * (p.scale || 1);
      for (let j = 0; j < 4; j++) {
        const a0 = p.t * 18 + j * 1.6, rr = r * (1 - j * 0.16), x = -j * r * 0.5;
        ctx.strokeStyle = j ? `rgba(170,215,255,${0.55 - j * 0.1})` : 'rgba(240,250,255,0.9)'; ctx.lineWidth = (6 - j) * (p.scale || 1);
        ctx.beginPath(); ctx.ellipse(x, 0, rr * 0.6, rr, 0, a0, a0 + 4.2); ctx.stroke();
      }
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r); g.addColorStop(0, 'rgba(230,245,255,0.55)'); g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.8, r, 0, 0, 7); ctx.fill();
      ctx.restore(); continue;
    }
    if (p.kind === 'katon') {
      // Katon d'Itachi : la grande boule de feu (image assets/fx/katon.png, boule à droite, traînée de flammes à gauche)
      const img = IMG.fx_katon, sc = p.scale || 1;
      if (img) {
        const w = KATON.w * sc, hgt = w * img.height / img.width, pul = 1 + Math.sin(p.t * 22) * 0.04;
        // lueur orangée autour de la boule
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, w * 0.42);
        g.addColorStop(0, 'rgba(255,200,90,0.55)'); g.addColorStop(0.5, 'rgba(255,110,20,0.25)'); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w * 0.42, 0, 7); ctx.fill();
        // la boule elle-même, opaque, qui tourne doucement sur elle-même
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.rotate(Math.sin(p.t * 9) * 0.06); ctx.scale(pul, pul * (1 + Math.sin(p.t * 17) * 0.03));
        ctx.drawImage(img, -KATON.fx * w, -KATON.fy * hgt, w, hgt); ctx.restore();
        ctx.restore(); continue;
      }
      const r = (40 + Math.sin(p.t * 24) * 4) * sc;
      for (let j = 4; j >= 0; j--) {
        const x = -j * r * 0.45, rr = r * (1 - j * 0.14);
        const g = ctx.createRadialGradient(x, 0, 1, x, 0, rr);
        g.addColorStop(0, j ? 'rgba(255,190,70,0.5)' : '#fff2c0'); g.addColorStop(0.5, j ? 'rgba(255,90,10,0.45)' : '#ff9a2a'); g.addColorStop(1, 'rgba(180,20,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, Math.sin(p.t * 30 + j) * 5, rr, 0, 7); ctx.fill();
      }
      ctx.restore(); continue;
    }
    if (p.kind === 'hiken') {
      // Hiken d'Ace : un poing de flammes qui file, traînée de feu derrière
      const r = (34 + Math.sin(p.t * 30) * 4) * (p.scale || 1);
      for (let j = 4; j >= 0; j--) {
        const x = -j * r * 0.55, rr = r * (1 - j * 0.15);
        const g = ctx.createRadialGradient(x, 0, 1, x, 0, rr);
        g.addColorStop(0, j ? 'rgba(255,200,80,0.5)' : '#fff6d0'); g.addColorStop(0.45, j ? 'rgba(255,110,20,0.45)' : '#ffb040'); g.addColorStop(1, 'rgba(200,30,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, Math.sin(p.t * 40 + j) * 4, rr * 1.15, rr * 0.8, 0, 0, 7); ctx.fill();
      }
      // jointures du poing, en avant
      ctx.fillStyle = 'rgba(255,240,200,0.8)';
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.arc(r * 0.55, k * r * 0.32, r * 0.18, 0, 7); ctx.fill(); }
      ctx.restore(); continue;
    }
    if ((p.kind === 'icewall' || p.kind === 'glacier') && IMG.fx_shoto_ice) {
      // glace de Shoto (assets/fx/shoto_ice.png) : la vague de pics se révèle de gauche à droite derrière le front
      // du tir et jaillit du sol avec un petit rebond ; elle se brise en fondu à la fin
      ctx.restore(); ctx.save();
      const img = IMG.fx_shoto_ice, big = p.kind === 'glacier', sc = p.scale || 1;
      const H = big ? 300 : 160 * sc, Wf = H * img.width / img.height;
      const ob = u => 1 + 3.2 * Math.pow(u - 1, 3) + 2.2 * Math.pow(u - 1, 2), up = Math.max(0, ob(Math.min(1, p.t / (big ? 0.25 : 0.15))));
      const fade = Math.max(0, Math.min(1, (p.life - p.t) / (big ? 0.4 : 0.25)));
      const span = big ? Wf * Math.min(1, p.t / 0.3) : Math.abs(p.x - (p.x0 ?? p.x));
      const shown = Math.min(span, Wf), left = big ? p.x - camX : sx - p.dir * shown; // au-delà de sa longueur, la vague suit le front
      if (shown > 2) {
        ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = fade;
        ctx.translate(left, p.gz + 6); ctx.scale(p.dir, 1);
        // partie révélée : le début (bas) de la vague tant qu'elle grandit, puis toute l'image
        ctx.drawImage(img, 0, 0, img.width * (shown / Wf), img.height, 0, -H * up, shown, H * up);
        ctx.restore();
        // brume froide au pied
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * fade;
        const mg = ctx.createLinearGradient(0, p.gz - 40, 0, p.gz + 6); mg.addColorStop(0, 'rgba(200,240,255,0)'); mg.addColorStop(1, 'rgba(200,240,255,0.8)');
        ctx.fillStyle = mg; ctx.fillRect(Math.min(left, left + p.dir * shown), p.gz - 40, shown, 46);
      }
      ctx.restore(); continue;
    }
    if (p.kind === 'icewall' || p.kind === 'glacier' || p.kind === 'stonewall') {
      // pics de glace qui jaillissent du sol derrière la tête du mur (ou tout le glacier de l'ultime), puis s'effritent
      ctx.restore(); ctx.save();
      const big = p.kind === 'glacier', step = big ? 46 : 30, sc = (p.scale || 1);
      const span = big ? p.len : Math.min(Math.abs(p.x - (p.x0 ?? p.x)), 420), n = Math.max(1, Math.floor(span / step));
      const fade = big ? Math.min(1, (p.life - p.t) / 0.4) : Math.min(1, (p.life - p.t) / 0.25);
      for (let k = n; k >= 0 && (p.kind !== 'stonewall' || !IMG.fx_ed_spike); k--) {
        const grow = Math.min(1, big ? p.t * 5 - k * 0.08 : (k * step / p.speed) * 6 + 0.2);
        if (grow <= 0) continue;
        const x = sx - p.dir * (big ? -k * step : k * step), hh = (big ? 150 + 60 * Math.sin(k * 1.7) : (70 - k * 3) * sc) * grow, w = big ? 34 : 18 * sc;
        if (hh <= 4) continue;
        const g = ctx.createLinearGradient(0, p.gz - hh, 0, p.gz);
        if (p.kind === 'stonewall') { g.addColorStop(0, `rgba(200,188,170,${0.98 * fade})`); g.addColorStop(0.5, `rgba(140,126,110,${0.95 * fade})`); g.addColorStop(1, `rgba(80,70,62,${0.9 * fade})`); }
        else { g.addColorStop(0, `rgba(240,252,255,${0.95 * fade})`); g.addColorStop(0.5, `rgba(150,215,255,${0.85 * fade})`); g.addColorStop(1, `rgba(70,140,220,${0.75 * fade})`); }
        ctx.fillStyle = g; ctx.strokeStyle = p.kind === 'stonewall' ? `rgba(40,32,26,${0.9 * fade})` : `rgba(30,70,140,${0.8 * fade})`; ctx.lineWidth = 2;
        const lean = p.dir * (big ? 10 : 6);
        ctx.beginPath(); ctx.moveTo(x - w, p.gz + 4); ctx.lineTo(x + lean, p.gz - hh); ctx.lineTo(x + w, p.gz + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = p.kind === 'stonewall' ? `rgba(230,220,200,${0.35 * fade})` : `rgba(255,255,255,${0.6 * fade})`; ctx.beginPath(); ctx.moveTo(x - w * 0.3, p.gz); ctx.lineTo(x + lean * 0.8, p.gz - hh * 0.85); ctx.lineTo(x, p.gz); ctx.closePath(); ctx.fill();
      }
      if (p.kind === 'stonewall' && p.t < 0.5) {
        // cercle de transmutation là où les mains ont touché le sol, qui s'éteint
        const ox = (p.x0 ?? p.x) - camX - p.dir * 20, ca = 1 - p.t / 0.5;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(ox, p.gz); ctx.scale(1, 0.3); ctx.strokeStyle = `rgba(120,210,255,${0.9 * ca})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, 60, 0, 7); ctx.stroke(); ctx.beginPath(); for (let k = 0; k <= 3; k++) { const q = k * Math.PI * 2 / 3 + p.t * 3; ctx[k ? 'lineTo' : 'moveTo'](Math.cos(q) * 48, Math.sin(q) * 48); } ctx.stroke(); ctx.restore();
      }
      ctx.restore(); continue;
    }
    if (p.kind === 'flamejet' && IMG.fx_shoto_fire) {
      // brasier de Shoto (assets/fx/shoto_fire.png) étiré depuis la main jusqu'au front, qui ondule ; lueur et braises
      const img = IMG.fx_shoto_fire, L = Math.max(20, p.len), Hh = Math.min(230, L * 0.42) * (1 + 0.08 * Math.sin(p.t * 32)), st = 1 + 0.03 * Math.sin(p.t * 47);
      const gl = ctx.createRadialGradient(L * 0.75, 0, 10, L * 0.75, 0, Hh); gl.addColorStop(0, 'rgba(255,170,60,0.45)'); gl.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.ellipse(L * 0.7, 0, L * 0.5, Hh * 0.8, 0, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(img, -8, -Hh / 2, L * st + 8, Hh);
      ctx.restore(); continue;
    }
    if (p.kind === 'flamejet') {
      // brasier : cône de flammes qui s'élargit en partant de la main, cœur jaune
      const L = p.len, fl = Math.sin(p.t * 50) * 4; // repère déjà posé sur la main, tourné dans le sens du tir
      for (const [w, c0, c1] of [[60, 'rgba(255,70,0,0.55)', 'rgba(255,40,0,0)'], [36, 'rgba(255,170,40,0.7)', 'rgba(255,120,0,0)'], [16, 'rgba(255,250,210,0.9)', 'rgba(255,220,120,0)']]) {
        const g = ctx.createLinearGradient(0, 0, L, 0); g.addColorStop(0, c0); g.addColorStop(1, c1);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -w * 0.2); ctx.quadraticCurveTo(L * 0.5, -w - fl, L, -w * 0.6); ctx.lineTo(L, w * 0.6); ctx.quadraticCurveTo(L * 0.5, w + fl, 0, w * 0.2); ctx.closePath(); ctx.fill();
      }
      ctx.restore(); continue;
    }
    if (p.kind === 'shell') {
      // obus du bras-canon de Guts : ogive de fer sombre, ceinture de cuivre, culot chauffé et petite flamme ; la fumée est à part (fxs 'smoke')
      ctx.globalCompositeOperation = 'source-over';
      const sc = (p.scale || 1) * 1.1;
      ctx.scale(sc, sc);
      ctx.fillStyle = '#26262b'; ctx.strokeStyle = '#0b0b0d'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-16, -7); ctx.lineTo(6, -7); ctx.quadraticCurveTo(20, -6, 24, 0); ctx.quadraticCurveTo(20, 6, 6, 7); ctx.lineTo(-16, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a7a84'; ctx.beginPath(); ctx.moveTo(-12, -4.5); ctx.lineTo(8, -4.5); ctx.quadraticCurveTo(16, -4, 18, -2); ctx.lineTo(-12, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b8742e'; ctx.fillRect(-4, -7, 3, 14);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(-18, 0, 0, -18, 0, 14); g.addColorStop(0, '#fff2b0'); g.addColorStop(0.4, 'rgba(255,140,30,0.85)'); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-22, 0, 14 + Math.sin(p.t * 60) * 2, 7, 0, 0, 7); ctx.fill();
      ctx.restore(); continue;
    }
    if (p.kind === 'vrasen') {
      // Rasengan évanescent de Boruto : le Rasengan filmé de Naruto, en plus petit ; il s'efface en douceur à
      // mi-course et réapparaît juste avant l'impact (les sphères de l'ultime restent visibles : p.steady)
      const u = p.t / (p.life || 1), sc = p.scale || 1, ease = k => k * k * (3 - 2 * k);
      const vis = p.steady ? 1 : u < 0.22 ? 1 : u < 0.42 ? 1 - 0.88 * ease((u - 0.22) / 0.2) : u < 0.56 ? 0.12 : 0.12 + 0.88 * ease(Math.min(1, (u - 0.56) / 0.12));
      const r = (48 + Math.sin(p.t * 38) * 3) * sc;
      // légère traînée bleue derrière la boule
      for (let j = 1; j <= 4; j++) {
        ctx.globalAlpha = vis * (0.32 - j * 0.06);
        const g = ctx.createRadialGradient(-j * 22 * sc, 0, 0, -j * 22 * sc, 0, r * (1 - j * 0.14));
        g.addColorStop(0, 'rgba(170,225,255,0.9)'); g.addColorStop(1, 'rgba(60,140,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-j * 22 * sc, 0, r * (1 - j * 0.14), 0, 7); ctx.fill();
      }
      ctx.restore();
      if (!fxImg('rasen_v', Math.floor(p.t * 16), sx, p.y, r * 3.8, null, { alpha: vis, rot: p.dir * p.t * 6, flip: p.dir < 0 })) {
        // repli dessiné : cœur blanc, dégradé bleu, anneaux de vent qui tournent
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = vis; ctx.translate(sx, p.y);
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#c8efff'); g.addColorStop(0.75, 'rgba(90,180,255,0.7)'); g.addColorStop(1, 'rgba(40,120,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
        ctx.lineCap = 'round';
        for (let k = 0; k < 4; k++) {
          const a0 = p.t * 16 + k * Math.PI / 2, rr = r * (0.55 + 0.12 * (k % 2));
          ctx.strokeStyle = `rgba(230,250,255,${0.85 - k * 0.12})`; ctx.lineWidth = 3 * sc;
          ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 0.55, a0 * 0.3, a0, a0 + 2.2); ctx.stroke();
        }
        ctx.restore();
      }
      continue;
    }
    if (p.kind === 'kiball') {
      // Rafale de ki de Sangoku : une boule bleue qui palpite
      const r = 30 + Math.sin(p.t * 40) * 4, g = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#bff3ff'); g.addColorStop(1, 'rgba(80,190,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.restore(); continue;
    }
    if (p.kind === 'airshot') {
      // Delaware Smash : une onde de choc en anneaux qui file
      ctx.globalAlpha = 0.8; ctx.strokeStyle = '#e8fff0'; ctx.lineWidth = 6;
      for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.ellipse(-j * 34, 0, 18 + j * 6, 70 - j * 10, 0, -1.3, 1.3); ctx.stroke(); }
      ctx.restore(); continue;
    }
    if (p.kind === 'rocks' && FX.rupture) { ctx.restore(); fxImg('rupture', 1 + Math.floor(p.t * 12) % 2, sx, p.gz - 80, 230, null, { flip: p.dir < 0 }); continue; }
    if (p.kind === 'rocks') {
      // Do Ryu Sen : des blocs de pierre arrachés au sol qui jaillissent en vague
      ctx.globalCompositeOperation = 'source-over';
      for (let j = 0; j < 6; j++) {
        const bx = -j * 22, h2 = 26 + ((j * 37) % 30) + Math.sin(p.t * 30 + j) * 6;
        ctx.fillStyle = j % 2 ? '#8c7458' : '#b49a76'; ctx.strokeStyle = '#3a2c1c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx - 12, 30); ctx.lineTo(bx - 8, 30 - h2); ctx.lineTo(bx + 4, 30 - h2 - 10); ctx.lineTo(bx + 12, 30 - h2 * 0.5); ctx.lineTo(bx + 14, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore(); continue;
    }
    // Lame d'air, vague d'eau ou de feu : un grand croissant vertical qui file
    const c = projColor(p), H = p.kind === 'airblade' ? 80 : 95;
    for (const [wk, col, a] of [[1, c, 0.85], [0.35, '#ffffff', 1]]) {
      ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(0, -H); ctx.quadraticCurveTo(46 * (wk + 0.4), 0, 0, H); ctx.quadraticCurveTo(16 * wk, 0, 0, -H); ctx.fill();
    }
    ctx.globalAlpha = 0.35; ctx.fillStyle = c;
    for (let j = 1; j < 4; j++) { ctx.beginPath(); ctx.moveTo(-j * 26, -H * 0.8); ctx.quadraticCurveTo(-j * 26 + 30, 0, -j * 26, H * 0.8); ctx.quadraticCurveTo(-j * 26 + 12, 0, -j * 26, -H * 0.8); ctx.fill(); }
    ctx.restore();
  }
}

// Rasenshuriken : quatre pales de vent blanches autour d'une sphère bleue
function drawShuriken(x, y, s, t) {
  // Rasen-shuriken dessiné (assets/fx/rsh.png, fond noir détouré) : il tourne très vite, une 2e couche en sens inverse
  // donne le flou des pales ; halo de vent autour
  const img = IMG.fx_rsh;
  if (img) {
    const w = 240 * s, hh = w * img.height / img.width;
    ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.55);
    g.addColorStop(0, 'rgba(200,245,255,0.5)'); g.addColorStop(1, 'rgba(80,170,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w * 0.55, 0, 7); ctx.fill();
    ctx.save(); ctx.rotate(-t * 24); ctx.drawImage(img, -w / 2, -hh / 2, w, hh); ctx.restore();
    ctx.rotate(t * 11); ctx.globalAlpha = 0.35; ctx.drawImage(img, -w * 0.46, -hh * 0.46, w * 0.92, hh * 0.92);
    ctx.restore();
    return;
  }
  ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
  ctx.rotate(t * 25);
  ctx.fillStyle = 'rgba(230,248,255,0.75)';
  for (let j = 0; j < 4; j++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -12 * s); ctx.quadraticCurveTo(60 * s, -30 * s, 95 * s, 0); ctx.quadraticCurveTo(50 * s, -5 * s, 0, 12 * s); ctx.fill();
  }
  ctx.restore();
  energyBall(x, y, 26 * s, false);
}

// Rasengan : sphère bleue qui tourbillonne dans la paume
function drawRasengan(x, y, r, t) {
  energyBall(x, y, r, false);
  ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 2;
  for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.ellipse(0, 0, r * 0.9, r * 0.35, t * 12 + j * 1.05, 0, 5); ctx.stroke(); }
  ctx.restore();
}

// ---------- Écran de sélection des personnages ----------
// Le joueur 1 est celui qui a appuyé sur l'écran titre. Le joueur 2 rejoint en appuyant
// sur une touche du pavé numérique ou sur une autre manette.
const sel = { joined: [true, false, false, false], pick: [0, 1, 2, 3], vari: [0, 0, 0, 0], firstVar: [0, 0, 0, 0], ready: [false, false, false, false], dev: ['kb', null, null, null], first: [null, null, null, null], skip: false, go: 0 };

function openSelect() {
  scene = 'select'; sceneT = 0;
  for (const k of Object.keys(padOwner)) delete padOwner[k];
  p2Keyboard = false;
  sel.joined = [true, false, false, false]; sel.ready = [false, false, false, false]; sel.go = 0;
  sel.pick = [0, 1, 2, 3].map(k => k % CHAR_IDS.length); sel.first = [null, null, null, null]; sel.vari = [0, 0, 0, 0]; sel.firstVar = [0, 0, 0, 0];
  sel.dev = [lastDevice, null, null, null];
  if (lastDevice !== 'kb') padOwner[lastDevice] = 0;
  rebuildKeymap();
  netRejoin();
  audio.tone(660, 0.3, 'triangle', 0.15, 400);
}

// Un joueur rejoint : le clavier n'a que la place du joueur 2, une manette prend la première place libre
function joinPlayer(dev) {
  if (dev !== 'kb' && sel.dev.includes(dev)) return;
  const p = dev === 'kb' ? (sel.joined[1] ? -1 : 1) : [1, 2, 3].find(k => !sel.joined[k]);
  if (p === undefined || p < 0) return;
  sel.joined[p] = true; sel.dev[p] = dev; sel.ready[p] = false; sel.first[p] = null; sel.skip = true;
  if (dev === 'kb') { p2Keyboard = true; rebuildKeymap(); } else padOwner[dev] = p;
  audio.tone(880, 0.15, 'triangle', 0.12, 300);
}

function leavePlayer(p) {
  if (sel.dev[p] === 'net') return; // un joueur en ligne quitte en fermant sa connexion
  sel.joined[p] = false;
  if (sel.dev[p] === 'kb') { p2Keyboard = false; rebuildKeymap(); } else delete padOwner[sel.dev[p]];
  sel.dev[p] = null;
  audio.tone(300, 0.15, 'triangle', 0.1, -100);
}

// Cartes par rangée sur l'écran de sélection
const selCols = () => { const n = CHAR_IDS.length; return n <= 3 ? n : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : 6; };

function updateSelect(dt) {
  const n = CHAR_IDS.length;
  // le carrousel glisse vers le perso du joueur qui a bougé en dernier (par le plus court chemin)
  const target = sel.pick[sel.focus || 0];
  sel.cur ??= target;
  let d = target - sel.cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
  sel.cur = (sel.cur + d * Math.min(1, dt * 9) + n) % n;
  sel.flash = Math.max(0, (sel.flash || 0) - dt * 3);
  for (let p = 0; p < 4; p++) {
    if (!sel.joined[p] || (p > 0 && sel.skip)) continue;
    const I = INPUT[p], hit = a => I.pressed.has(a);
    if (!sel.ready[p]) {
      // ↑/↓ change de version quand la case en a plusieurs (Naruto enfant / Shippuden), sinon de case
      const nv = variantsOf(sel.pick[p]).length, vk = nv > 1 ? (hit('up') ? -1 : hit('down') ? 1 : 0) : 0;
      const dk = vk ? 0 : hit('left') || hit('up') ? -1 : hit('right') || hit('down') ? 1 : 0;
      if (vk) {
        sel.vari[p] = (sel.vari[p] + vk + nv) % nv; sel.focus = p; sel.flash = 1;
        audio.tone(700 + p * 120, 0.08, 'triangle', 0.08, 200);
      }
      if (dk) {
        sel.pick[p] = (sel.pick[p] + dk + n) % n; sel.vari[p] = 0; sel.focus = p; sel.flash = 1;
        audio.tone(520 + p * 120, 0.06, 'triangle', 0.08);
      }
      if (hit('punch') || hit('jump') || hit('start')) {
        // Équipe de deux : le premier choix est le combattant, le second son partenaire
        if (OPTS.tag && sel.first[p] === null && n > 1) { sel.first[p] = sel.pick[p]; sel.firstVar[p] = sel.vari[p]; sel.pick[p] = (sel.pick[p] + 1) % n; sel.vari[p] = 0; }
        else sel.ready[p] = true;
        audio.play('hitHeavy', 0.8); audio.tone(780, 0.25, 'triangle', 0.12, 300);
      } else if (hit('kick') || hit('pause')) {
        if (sel.first[p] !== null) { sel.pick[p] = sel.first[p]; sel.vari[p] = sel.firstVar[p]; sel.first[p] = null; }
        else if (p > 0) leavePlayer(p);
        else { scene = 'title'; sceneT = 0; }
      }
    } else if (hit('kick') || hit('pause')) sel.ready[p] = false;
  }
  sel.skip = false;
  if (scene !== 'select') return;
  // Tout le monde est prêt : petite pause pour voir les cartes validées, puis on se bat
  if (sel.joined.every((j, p) => !j || sel.ready[p])) {
    sel.go += dt;
    if (sel.go > 0.8) {
      const ps = [0, 1, 2, 3].filter(p => sel.joined[p]);
      sel.chars = ps.map(p => sel.first[p] !== null ? charAt(sel.first[p], sel.firstVar[p]) : charAt(sel.pick[p], sel.vari[p]));
      sel.partners = ps.map(p => sel.first[p] !== null ? charAt(sel.pick[p], sel.vari[p]) : null);
      if (gameMode === 'story') openMap(); else openLevels();
    }
  } else sel.go = 0;
}

// ---------- Écran de choix du niveau ----------
let levelPick = 0;
// Écran des niveaux : le niveau choisi en grand (son décor défile), le boss en carte, et une bande de
// vignettes inclinées qui glisse vers le niveau choisi. Gauche / droite pour changer, poing pour lancer.
const lvSel = { cur: 0, flash: 0 };
function openLevels() { scene = 'levels'; sceneT = 0; lvSel.cur = levelPick; lvSel.flash = 0; audio.tone(660, 0.3, 'triangle', 0.15, 400); }
function updateLevels(dt) {
  const n = LEVELS.length;
  lvSel.cur += (levelPick - lvSel.cur) * Math.min(1, dt * 10);
  lvSel.flash = Math.max(0, lvSel.flash - dt * 3);
  for (const I of INPUT) {
    const hit = a => I.pressed.has(a);
    const dk = hit('left') || hit('up') ? -1 : hit('right') || hit('down') ? 1 : 0;
    if (dk) {
      levelPick = (levelPick + dk + n) % n; lvSel.flash = 1;
      if (Math.abs(levelPick - lvSel.cur) > n / 2) lvSel.cur = levelPick - dk; // bouclage sans tout faire défiler
      audio.whoosh(0.7); audio.tone(520, 0.06, 'triangle', 0.08);
    }
    if (sceneT > 0.3 && (hit('punch') || hit('jump') || hit('start'))) {
      resetGame(sel.chars, levelPick);
      if (isEndless()) endlessStart();
      scene = 'play'; audio.play('hitHeavy', 0.8); audio.tone(780, 0.25, 'triangle', 0.12, 300);
      return;
    }
    if (hit('kick') || hit('pause')) { scene = 'select'; sceneT = 0; sel.ready = [false, false]; sel.go = 0; return; }
  }
}
// Décor d'un niveau dans un cadre : ciel, plan moyen et sol de sa première zone, qui défilent doucement.
// Les décors font 1376 px de large : les redessiner réduits à chaque image force le navigateur à les redécoder
// (saccades de plusieurs dixièmes de seconde). On garde donc, par niveau, des calques déjà réduits à deux tailles :
// vignette (THUMB_W) et plein écran, préparés une fois puis simplement recopiés.
const THUMB_W = 200, layerCache = {};
function levelLayers(L, bw) {
  const key = L.id + '|' + bw;
  if (layerCache[key]) return layerCache[key];
  const pv = key => IMG[key] || IMG['pv_' + key];
  const k = bw / W, bh = Math.round(H * k), Z = L.zones[0], sky = pv(Z.sky || L.sky), mid = pv(Z.mid), gr = pv(Z.ground);
  const bake = (img, w, h) => {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  };
  const C = { bh, k };
  if (sky) C.sky = bake(sky, bw * 1.2, bh);
  if (L.far && pv('far')) C.far = bake(pv('far'), pv('far').width * LAYERS.far.h / pv('far').height * k, LAYERS.far.h * k);
  if (mid) C.mid = bake(mid, mid.width * LAYERS.mid.h / mid.height * k, LAYERS.mid.h * k);
  if (gr) C.gr = bake(gr, LAYERS.street.w * k, LAYERS.street.h * k);
  return (layerCache[key] = C);
}
function drawLevelThumb(L, x, y, w, h, scroll = 0) {
  const bw = w > THUMB_W * 1.5 ? W : THUMB_W, C = levelLayers(L, bw), k = C.k, s = w / bw;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#1a1030'; ctx.fillRect(x, y, w, h);
  ctx.translate(x, y); ctx.scale(s, s);
  if (C.sky) ctx.drawImage(C.sky, -(scroll * 0.05 * k % (bw * 0.2)), 0);
  if (C.far) ctx.drawImage(C.far, 0, LAYERS.far.y * k);
  for (const [img, f, ly] of [[C.mid, 0.55, LAYERS.mid.y], [C.gr, 1, LAYERS.street.y]]) {
    if (!img) continue;
    for (let px = -(scroll * f * k % img.width); px < bw; px += img.width) ctx.drawImage(img, px, ly * k, img.width + 1, img.height);
  }
  ctx.restore();
}
// Prépare les calques de tous les niveaux, un par tranche de temps libre, pour que le menu ne saccade jamais
function warmLevelLayers() {
  const todo = LEVELS.flatMap(L => [[L, THUMB_W], [L, W]]);
  const step = () => { const j = todo.shift(); if (!j) return; levelLayers(...j); setTimeout(step, 30); };
  setTimeout(step, 300);
}
// Écran des univers, façon cinématique : les zones du monde défilent en fond (fondu + lent zoom), un grand bandeau
// incliné à gauche (numéro, univers, lieu, zones), le boss en grand à droite, un carrousel de vignettes en
// perspective en bas, et un coup de lame lumineux à chaque changement de monde.
const LV_COLOR = { aot: '#c8a060', bk: '#b0101a', fz: '#ffd84a', fm: '#ff8a2a', rp: '#3ad1a0', tokyo: '#ff2d8a', op: '#ff5a2a', ds: '#ff3340', bl: '#e8e8ff', hx: '#3ad17a', nr: '#ff8a00', db: '#3ad1a0',
  mh: '#2ab0ff', rk: '#c03aff', op2: '#ffb020', nr2: '#7a9cff', ds2: '#ff4fd8', db2: '#ffd040',
  jk: '#9a4aff', sl: '#3a8aff', opm: '#ffcf3a', bl2: '#cfe8ff' };
// Calques d'une zone pour le fond (aperçus réduits chargés à la demande) ; null tant qu'ils ne sont pas arrivés
function zoneLayers(L, zi) {
  const key = L.id + '|z' + zi;
  if (layerCache[key]) return layerCache[key];
  const Z = L.zones[zi], keys = [Z.sky || L.sky, Z.mid, Z.ground].filter(Boolean);
  const miss = keys.filter(k => !IMG[k] && !IMG['pv_' + k]);
  if (miss.length) { miss.forEach(k => want('pv_' + k, `assets/web/preview/${k}.webp`)); return null; }
  const pv = k => IMG[k] || IMG['pv_' + k], k = 1, bake = (img, w, h) => {
    const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  };
  const C = { k };
  if (pv(Z.sky || L.sky)) C.sky = bake(pv(Z.sky || L.sky), W * 1.2, H);
  if (L.far && pv('far')) C.far = bake(pv('far'), pv('far').width * LAYERS.far.h / pv('far').height, LAYERS.far.h);
  if (pv(Z.mid)) C.mid = bake(pv(Z.mid), pv(Z.mid).width * LAYERS.mid.h / pv(Z.mid).height, LAYERS.mid.h);
  if (pv(Z.ground)) C.gr = bake(pv(Z.ground), LAYERS.street.w, LAYERS.street.h);
  return (layerCache[key] = C);
}
function drawZoneBg(L, zi, scroll, zoom, alpha) {
  const C = zoneLayers(L, zi) || (zi ? zoneLayers(L, 0) : null);
  if (!C) { drawLevelThumb(L, 0, 0, W, H, scroll); return; }
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);
  if (C.sky) ctx.drawImage(C.sky, -(scroll * 0.05 % (W * 0.2)), 0);
  if (C.far) ctx.drawImage(C.far, 0, LAYERS.far.y);
  for (const [img, f, ly] of [[C.mid, 0.55, LAYERS.mid.y], [C.gr, 1, LAYERS.street.y]]) {
    if (!img) continue;
    for (let px = -(scroll * f % img.width); px < W; px += img.width) ctx.drawImage(img, px, ly, img.width + 1, img.height);
  }
  ctx.restore();
}
function drawLevels() {
  const n = LEVELS.length, L = LEVELS[levelPick], t = sceneT, col = LV_COLOR[L.id] || '#ffe14d';
  const nz = L.zones.length, per = 3.2, zt = t / per, zi = Math.floor(zt) % nz, zf = zt - Math.floor(zt);
  // Fond : les zones l'une après l'autre, fondu enchaîné sur la dernière demi-seconde, lent zoom
  drawZoneBg(L, zi, t * 50, 1.04 + zf * 0.06, 1);
  if (zf > 0.85) drawZoneBg(L, (zi + 1) % nz, t * 50, 1.04 + (zf - 0.85) * 0.06, (zf - 0.85) / 0.15);
  // Assombrissement : fort à gauche (texte) et en bas (carrousel), teinte du monde
  let g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(5,0,15,0.88)'); g.addColorStop(0.5, 'rgba(5,0,15,0.35)'); g.addColorStop(1, 'rgba(5,0,15,0.25)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createLinearGradient(0, H * 0.55, 0, H);
  g.addColorStop(0, 'rgba(5,0,15,0)'); g.addColorStop(1, 'rgba(5,0,15,0.95)');
  ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);
  // Bandeau incliné à gauche, liseré à la couleur du monde
  const slide = lvSel.flash * 120;
  ctx.save(); ctx.translate(-slide, 0);
  ctx.fillStyle = 'rgba(8,2,22,0.72)'; ctx.beginPath(); ctx.moveTo(0, 70); ctx.lineTo(520, 70); ctx.lineTo(450, 300); ctx.lineTo(0, 300); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(520, 70); ctx.lineTo(530, 70); ctx.lineTo(460, 300); ctx.lineTo(450, 300); ctx.fill();
  ctx.restore();
  // Numéro du monde en très grand, en filigrane
  ctx.save(); ctx.globalAlpha = 0.18; ctx.font = 'italic 900 210px Impact, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = col;
  ctx.fillText(String(levelPick + 1).padStart(2, '0'), 20 - slide, 270); ctx.restore();
  outlined(isEndless() ? 'MODE INFINI — CHOISIS TON MONDE' : 'CHOISIS TON UNIVERS', 24, 44, 26, '#ffe14d', 'left');
  if (isEndless()) outlined(`RECORD : ${bestScore(L.id) || '—'}`, 44 - slide, 344, 20, '#9fe8ff', 'left');
  outlined(`${levelPick + 1} / ${n}`, W - 24, 44, 22, '#fff', 'right');
  const [univ, place] = L.name.split(' — ');
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 18;
  outlined(univ, 40 - slide, 128, 30, col, 'left'); ctx.restore();
  outlined(place || L.sub, 40 - slide, 180, 48, '#fff', 'left');
  ctx.font = 'italic bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd6e8'; if (place) ctx.fillText(L.sub, 44 - slide, 208); // sans lieu, le sous-titre est déjà le grand titre
  // Zones : celle qu'on voit en fond s'allume
  L.zones.forEach((Z, k) => {
    const y = 226 + k * 22, on = k === zi;
    ctx.fillStyle = on ? col : 'rgba(255,255,255,0.25)'; ctx.fillRect(44 - slide, y, on ? 6 : 3, 16);
    ctx.font = `${on ? 'bold ' : ''}13px sans-serif`; ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.6)';
    ctx.fillText(`ZONE ${k + 1}  ·  ${Z.name}`, 58 - slide, y + 13);
  });
  // Boss en grand à droite, incliné, qui flotte
  const card = IMG['intro_' + L.boss];
  if (!card && ASSETS.ui['intro_' + L.boss]) want('intro_' + L.boss, ASSETS.ui['intro_' + L.boss]);
  if (card) {
    const bw = 330, bh = 200, bx = W - bw / 2 - 40 + slide * 0.6, by = 190 + Math.sin(t * 1.6) * 5;
    ctx.save(); ctx.translate(bx, by); ctx.rotate(-0.06);
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24; ctx.fillStyle = '#000'; ctx.fillRect(-bw / 2, -bh / 2, bw, bh); ctx.shadowBlur = 0;
    ctx.save(); ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.clip();
    const [fx, fy] = introFace(L.boss), s = bh / (0.7 * card.height), cw = card.width * s;
    ctx.drawImage(card, clamp(bw * 0.2 - fx * cw, bw / 2 - cw + 30, -bw / 2), -bh / 2 - fy * card.height * s + bh * 0.3, cw, card.height * s);
    const vg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0); vg.addColorStop(0, 'rgba(0,0,0,0.75)'); vg.addColorStop(0.45, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg; ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.restore();
    ctx.strokeStyle = '#ff3040'; ctx.lineWidth = 4; ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    // tampon BOSS
    ctx.save(); ctx.translate(-bw / 2 + 52, -bh / 2 + 4); ctx.rotate(-0.18);
    ctx.fillStyle = '#ff3040'; ctx.fillRect(-46, -16, 92, 30); outlined('BOSS', 0, 9, 22, '#fff');
    ctx.restore();
    outlined(ENEMY_INFO[L.boss]?.[0] || '', -bw / 2 + 16, bh / 2 - 14, 20, '#fff', 'left');
    ctx.restore();
  }
  // Carrousel de vignettes en perspective (les côtés tournent vers le fond), avec reflet
  const cw = 168, ch = 95, cy = 420;
  const items = [];
  for (let k = 0; k < n; k++) {
    let d = k - lvSel.cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
    if (Math.abs(d) <= 3.6) items.push([k, d]);
  }
  items.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [k, d] of items) {
    const on = k === levelPick, ad = Math.abs(d), turn = Math.max(0.35, 1 - ad * 0.22) * (on ? 1.15 : 1);
    const x = W / 2 + Math.sign(d) * (ad < 1 ? ad * 190 : 190 + (ad - 1) * 130), w = cw * turn, h = ch * (on ? 1.15 : Math.max(0.7, 1 - ad * 0.08));
    ctx.save(); ctx.globalAlpha = on ? 1 : Math.max(0.3, 0.85 - ad * 0.18);
    ctx.translate(x, cy + (on ? Math.sin(t * 4) * 3 : 10));
    drawLevelThumb(LEVELS[k], -w / 2, -h / 2, w, h, on ? t * 40 : 0);
    if (!on) { ctx.fillStyle = 'rgba(5,0,15,0.35)'; ctx.fillRect(-w / 2, -h / 2, w, h); }
    const c2 = LV_COLOR[LEVELS[k].id] || '#ffe14d';
    ctx.strokeStyle = on ? c2 : 'rgba(255,255,255,0.35)'; ctx.lineWidth = on ? 4 : 2;
    if (on) { ctx.shadowColor = c2; ctx.shadowBlur = 20; }
    ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.shadowBlur = 0;
    // reflet
    ctx.save(); ctx.globalAlpha *= 0.18; ctx.translate(0, h); ctx.scale(1, -1);
    drawLevelThumb(LEVELS[k], -w / 2, -h / 2 + 4, w, h * 0.5, 0); ctx.restore();
    ctx.font = `bold ${on ? 13 : 10}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = on ? c2 : '#d8d0ec';
    ctx.fillText(LEVELS[k].name.split(' — ')[0], 0, h / 2 + 16);
    ctx.restore();
  }
  // Coup de lame lumineux en diagonale au changement de monde
  if (lvSel.flash > 0) {
    const k = 1 - lvSel.flash, x = -200 + k * (W + 400);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = lvSel.flash;
    const sg = ctx.createLinearGradient(x - 80, 0, x + 80, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, col); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(x - 60, 0); ctx.lineTo(x + 100, 0); ctx.lineTo(x - 20, H); ctx.lineTo(x - 180, H); ctx.fill();
    ctx.restore();
  }
  const pulse = 1 + Math.sin(t * 6) * 0.12;
  outlined('◀', 24 - pulse * 4, cy + 10, 34 * pulse, col);
  outlined('▶', W - 24 + pulse * 4, cy + 10, 34 * pulse, col);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 30, W, 30);
  ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfd3ff';
  ctx.fillText(`${K('left')} ${K('right')} choisir     ${K('punch')} ou Entrée : COMBATTRE     ${K('kick')} retour`, W / 2, H - 10);
}

// ---------- Boucle principale ----------
// K.O. à faire pour finir le niveau (plus à deux)
const goal = () => Math.round(STAGE.killsToClear * (players.length > 1 ? 1.4 : 1));

function update(dt) {
  sceneT += dt;
  flash = Math.max(0, flash - dt * 1.5);
  if (updateModes(dt)) return;
  if (scene === 'select') { updateSelect(dt); return; }
  if (scene === 'levels') { updateLevels(dt); return; }
  if (scene === 'play' && anyPressed('pause') && !paused) { paused = true; openMenu(); }
  if (paused) return;
  // Carte de présentation d'un ennemi : le jeu attend (on peut la passer en appuyant sur un coup)
  if (level.card) {
    level.card.t += dt;
    if (level.card.t > 0.6 && ['punch', 'kick', 'start', 'jump'].some(anyPressed)) level.card.t = Math.max(level.card.t, CARD_T - 0.3);
    if (level.card.t > CARD_T) level.card = null;
    return;
  }
  // Pendant le petit gel d'impact, les touches appuyées sont gardées pour la suite (combos)
  if (hitstop > 0) { hitstop -= dt; INPUT.forEach(I => I.pressed.forEach(a => I.carry.add(a))); return; }
  INPUT.forEach(I => { I.carry.forEach(a => I.pressed.add(a)); I.carry.clear(); });

  if (gameLoading && scene === 'play') return; // la partie attend ses images
  if (scene === 'play' || scene === 'gameover' || scene === 'clear') {
    for (const h of [...players]) updatePlayer(h, dt);
    updateAssists();
    updateClones(dt);
    for (const e of enemies) updateEnemy(e, dt);
    enemies = enemies.filter(e => e.alive || e.t < 1.2 || e.getUp);
    updateWaves(dt);
    updateStars(dt);
    for (const b of bombs) updateBomb(b, dt);
    bombs = bombs.filter(b => !b.done);
    updateProjs(dt);
    updateDarkFX(dt);
    updateFX(dt);
    updateParticles(dt);

    comboT -= dt; if (comboT <= 0) combo = 0;

    // Caméra : ne recule jamais, suit le joueur le plus en avant sans laisser l'autre sortir de l'écran
    const xs = (players.some(h => !h.out) ? players.filter(h => !h.out) : players).map(h => h.x);
    const lead = Math.max(...xs), trail = Math.min(...xs);
    camX = Math.max(camX, Math.min(lead - W * (players.length > 1 ? 0.6 : 0.4), trail - 60, camLimit()));

    if (scene === 'play') {
      updateLevel(dt);
      // Un ennemi parti trop loin hors de l'écran revient au bord (sinon il bloquerait la fin du niveau)
      // Une fois entré à l'écran, un ennemi n'en ressort plus (sinon il frapperait hors de portée du joueur)
      for (const e of enemies) if (e.alive && e.state !== 'knock') {
        if (e.x > camX + 10 && e.x < camX + W - 10) e.entered = true;
        else if (!e.entered) e.x += Math.sign(camX + W / 2 - e.x) * 170 * dt; // il entre d'abord dans l'écran
        // 60 px de marge : le joueur (bloqué à 40 px du bord) peut toujours l'atteindre
        if (e.entered) e.x = clamp(e.x, camX + 60, camX + W - 60);
        if (e.x < camX - 140) e.x = camX - 60;
        if (e.x > camX + W + 260) e.x = camX + W + 60;
      }
    }
    // Après une victoire, on enchaîne sur le choix du niveau (le suivant est présélectionné)
    if (scene === 'clear' && sceneT > 1.5 && ['start', 'punch'].some(anyPressed)) {
      if (gameMode === 'story') storyCleared(); else { levelPick = (levelPick + 1) % LEVELS.length; openLevels(); }
    }
    if (scene === 'gameover' && isEndless() && sceneT > 1.5 && anyPressed('pause')) { scene = 'title'; sceneT = 0; }
    else if (scene === 'gameover' && sceneT > 1.5 && ['start', 'punch'].some(anyPressed)) {
      if (gameMode === 'story') openMap();
      else if (isEndless()) { resetGame(sel.chars, levelPick); endlessStart(); scene = 'play'; }
      else scene = 'title', sceneT = 0;
    }
  }
  shake *= 0.85;
}

// ---------- Rendu : décor ----------
const city = { far: makeSkyline(60, 0.35, 140, 320), mid: makeShops() };
function makeSkyline(n, dim, minH, maxH) {
  const b = []; let x = 0;
  for (let i = 0; i < n; i++) { const w = rand(40, 110); b.push({ x, w, h: rand(minH, maxH), neon: ['#ff2fd1', '#2ff3ff', '#ffe23b'][i % 3] }); x += w + rand(-10, 20); }
  return { b, len: x, dim };
}
function makeShops() {
  const s = []; let x = 0;
  for (let i = 0; i < 24; i++) { const w = rand(140, 220); s.push({ x, w, h: rand(150, 230), c: `hsl(${rand(220, 290)},35%,${rand(12, 20)}%)`, sign: ['#ff3b6b', '#3bf3ff', '#ffd23b', '#a64bff'][i % 4], kanji: '拳龍気夜街武魂光'[i % 8] }); x += w; }
  return { s, len: x };
}

// mirror : une copie sur deux est retournée, pour que les raccords ne se voient pas
// src : [haut, hauteur] d'une bande de l'image source, posée en reflet (bas d'un calque prolongé), sinon l'image entière
// alt : 2e image du même lieu ; les copies s'enchaînent alors A, B, A retournée, B retournée
// Raccords entre deux images différentes (A puis B) : elles se chevauchent sur SEAM de leur largeur et la suivante
// apparaît en fondu par-dessus, au lieu d'une coupure nette. Bords fondus calculés une fois par image.
const SEAM = 0.07, seamCache = new WeakMap();
function feathered(im, side) {
  let c = seamCache.get(im);
  if (!c) seamCache.set(im, c = {});
  if (c[side]) return c[side];
  const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
  const g = cv.getContext('2d'), f = im.width * SEAM;
  g.drawImage(im, 0, 0);
  const gr = side === 'L' ? g.createLinearGradient(0, 0, f, 0) : g.createLinearGradient(im.width, 0, im.width - f, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(0, 0, im.width, im.height);
  return c[side] = cv;
}
function drawTiled(img, factor, y, h, w = img.width * (h / img.height), mirror = false, src = null, alt = null) {
  // avec deux images, chaque copie recouvre la fin de la précédente (pas = w - chevauchement)
  const step = alt ? w * (1 - SEAM) : w, period = alt ? 4 : mirror ? 2 : 1, off = -((camX * factor) % (period * step));
  const put = (im, dx, dy) => {
    if (!src) return ctx.drawImage(im, dx, dy, w + 1, h);
    // bande retournée de haut en bas : son bord touche celui de l'image, sans raccord visible
    ctx.save(); ctx.translate(dx, dy + h); ctx.scale(1, -1); ctx.drawImage(im, 0, src[0], im.width, src[1], 0, 0, w + 1, h); ctx.restore();
  };
  for (let x = off - (alt ? step : 0), k = alt ? period - 1 : 0; x < W; x += step, k = (k + 1) % (period * 4)) {
    const flip = alt ? mirror && k % 4 >= 2 : mirror && k % 2;
    let im = alt && k % 2 ? alt : img;
    if (alt && !src) im = feathered(im, flip ? 'R' : 'L'); // le bord gauche à l'écran est fondu
    if (flip) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); put(im, 0, 0); ctx.restore(); }
    else put(im, x, y);
  }
}

function drawLayer(key) {
  const L = LAYERS[key];
  drawTiled(IMG[key], L.factor, L.y, L.h, L.w, L.mirror);
}

function drawBackground() {
  // Ciel
  if (ZONES.some(Z => Z.sky)) drawZoneLayer('sky');
  else if (IMG[LVL.sky]) drawTiled(IMG[LVL.sky], LAYERS.sky.factor, LAYERS.sky.y, LAYERS.sky.h);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0624'); g.addColorStop(0.55, '#3a1460'); g.addColorStop(1, '#ff3d8a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffe9f6'; ctx.beginPath(); ctx.arc(720 - camX * LAYERS.sky.factor % 1200, 110, 55, 0, 7); ctx.fill();
  }
  // Gratte-ciel lointains
  if (!LVL.far);
  else if (IMG.far) drawLayer('far');
  else {
    const L = city.far, off = (camX * LAYERS.far.factor) % L.len;
    for (let rep = 0; rep < 2; rep++) for (const b of L.b) {
      const x = b.x - off + rep * L.len; if (x > W || x + b.w < 0) continue;
      ctx.fillStyle = '#1a0f35'; ctx.fillRect(x, GROUND - 60 - b.h, b.w, b.h);
      ctx.fillStyle = b.neon; ctx.globalAlpha = 0.5;
      for (let wy = GROUND - 50 - b.h; wy < GROUND - 80; wy += 18) for (let wx = x + 6; wx < x + b.w - 8; wx += 14) if ((wx * 7 + wy) % 5 < 2) ctx.fillRect(wx, wy, 5, 7);
      ctx.globalAlpha = 1;
    }
  }
  // Boutiques au plan moyen
  if (IMG[ZONES[0].mid]) drawZoneLayer('mid');
  else {
    const L = city.mid, off = (camX * LAYERS.mid.factor) % L.len;
    for (let rep = 0; rep < 2; rep++) for (const s of L.s) {
      const x = s.x - off + rep * L.len; if (x > W || x + s.w < 0) continue;
      ctx.fillStyle = s.c; ctx.fillRect(x, GROUND - s.h, s.w, s.h);
      ctx.fillStyle = s.sign; ctx.shadowColor = s.sign; ctx.shadowBlur = 18;
      ctx.fillRect(x + s.w / 2 - 22, GROUND - s.h + 18, 44, 70);
      ctx.shadowBlur = 0; ctx.fillStyle = '#120a20'; ctx.font = 'bold 34px serif'; ctx.textAlign = 'center';
      ctx.fillText(s.kanji, x + s.w / 2, GROUND - s.h + 66);
      ctx.fillStyle = 'rgba(255,200,120,0.25)'; ctx.fillRect(x + 14, GROUND - 90, s.w - 28, 70);
    }
  }
  // Sol : trottoir et chaussée où l'on se déplace
  if (IMG[ZONES[0].ground]) drawZoneLayer('ground');
  else {
    const g = ctx.createLinearGradient(0, GROUND, 0, H);
    g.addColorStop(0, '#2a2140'); g.addColorStop(1, '#0d0918');
    ctx.fillStyle = g; ctx.fillRect(0, GROUND - 4, W, H - GROUND + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let x = -(camX % 120); x < W; x += 120) ctx.fillRect(x, GROUND + 30, 60, 4);
  }
  drawGates();
}

// ---------- Rendu : personnages ----------
// Les images regardent toutes vers la droite ; (ax, ay) = point posé au sol, au niveau du torse.
// rot : rotation (radians) autour du milieu du corps, pour la vrille du double saut.
function drawAnim(who, anim, i, x, y, dir, filter, rot = 0) {
  const A = SPRITES[who][anim], f = A.frames[clamp(i, 0, A.frames.length - 1)], img = IMG[f.src];
  if (!img) return;
  const s = A.scale;
  ctx.save();
  ctx.translate(x, y);
  if (dir < 0) ctx.scale(-1, 1);
  if (rot) { const cy = -f.h * s / 2; ctx.translate(0, cy); ctx.rotate(rot); ctx.translate(0, -cy); }
  if (drawAnim.lean) ctx.rotate(drawAnim.lean); // penché vers l'avant, pivot aux pieds (le miroir est déjà appliqué)
  if (drawAnim.grow) ctx.scale(drawAnim.grow, drawAnim.grow);
  if (drawAnim.breath) ctx.scale(1 - drawAnim.breath * 0.35, 1 + drawAnim.breath); // respiration, ancrée aux pieds
  if (filter) ctx.filter = filter;
  ctx.drawImage(img, -f.ax * s, -f.ay * s, f.w * s, f.h * s);
  ctx.restore();
}

// Étape d'une animation selon le temps écoulé et des seuils (en secondes)
const step = (t, marks) => { let i = 0; while (i < marks.length && t >= marks[i]) i++; return i; };

// Cycle de marche : nombre d'étapes de la planche affichée et vitesse (8 étapes à 12 i/s = 6 à 9 i/s)
function walkCycle(h) {
  const S = SPRITES[h.boost?.sheet || h.C.sheet];
  const A = S[h.back && S.back ? 'back' : 'walk'], n = A.frames.length;
  return [n, A.rate || n * 1.5]; // rate : vitesse calée pour que le pied posé ne glisse pas (marches tirées d'une vidéo)
}

// Vrille du double saut : la relance remet h.t à 0
const FLIP = 0.42;
const flipping = h => h.state === 'jump' && h.doubled && h.t < FLIP;
// Saut en 8 étapes : appel, poussée, montée, genoux qui remontent, boule, dépli, descente, réception
const jumpFrame = h => flipping(h) ? 4 : h.vy < -550 ? 2 : h.vy < -220 ? 3 : h.vy < 180 ? 4 : h.vy < 480 ? 5 : 6;

function heroPose(h) {
  const t = h.t;
  if (POSE_STATES.includes(h.state)) return airPose(h);
  if (h.state === 'juggle') return jugglePose(h);
  switch (h.state) {
    case 'walk': { const [n, fps] = walkCycle(h); return [h.back ? 'back' : 'walk', Math.floor(h.walkT * fps) % n]; }
    case 'crouch': return ['crouch', t < 0.06 ? 0 : 1];
    case 'ckick': return ['crouch', 2 + step(t, [0.1, 0.28])];
    case 'punch': return ['punch', 1 + step(t, [0.06, 0.18])];
    case 'cross': return ['pcombo', t < 0.2 ? 1 : 4];
    case 'uppercut': return ['pcombo', 2 + step(t, [0.1, 0.36])];
    case 'finisher': return ['pcombo', t < 0.1 ? 1 : 4];
    case 'kick': return ['kick', 1 + step(t, [0.08, 0.26, 0.36])];
    case 'spinkick': return ['kcombo', t < 0.12 ? 1 : t < 0.34 ? 2 : 4];
    case 'roundhouse': return ['kcombo', t < 0.1 ? 1 : t < 0.42 ? 3 : 4];
    case 'dash': return ['dash', step(t, [0.08, 0.14, 0.4])];
    case 'blast': return ['blast', step(t, [0.15, 0.3, 0.42])];
    case 'charge': return ['charge', t < 0.1 ? 0 : t < 0.2 ? 1 : 3];
    case 'transform': return ['transform', step(t, [0.3, 0.65, 0.95])];
    case 'ultra': return ['ultra', t < ULTRA.raise ? step(t, [0.6]) : t < ULTRA.throwAt ? 2 : 3];
    case 'prejump': return ['jump', t < 0.04 ? 0 : 1];
    case 'land': return ['jump', 7];
    case 'jump': return ['jump', jumpFrame(h)];
    case 'airkick': return ['jumpkick', 1 + step(t, [0.04, 0.09, 0.3, 0.48])];
    case 'hurt': return ['fall', t < 0.15 ? 0 : 1];
    case 'knock': return ['fall', h.vy < 0 ? 2 : 3];
    case 'floor': return ['getup', 0];
    case 'getup': return ['getup', step(t, [0.12, 0.26, 0.38])];
    default: return ['punch', 0]; // garde
  }
}

// Luffy. Planches : punch (garde, élan, bras étiré, retour), gatling (élan, deux rafales, fin),
// kicks (pied, fouet, jambe levée, hache), bazooka, fall (8), jump (8),
// lowair (accroupi, balayage | piétinement en l'air), rocket (fusée | charge), gigant.
function luffyPose(h) {
  const t = h.t;
  if (POSE_STATES.includes(h.state)) return airPose(h);
  if (h.state === 'juggle') return jugglePose(h);
  switch (h.state) {
    case 'walk': { const [n, fps] = walkCycle(h), i = Math.floor(h.walkT * fps) % n; return ['walk', h.back ? n - 1 - i : i]; }
    case 'crouch': return ['lowair', t < 0.06 ? 0 : 1];
    case 'ckick': return ['lowair', 1 + step(t, [0.1, 0.32])];
    case 'punch': case 'punch2': return ['punch', 1 + step(t, [0.12, 0.3])];
    case 'gatling': return ['gatling', t < 0.13 ? 0 : t > 0.8 ? 3 : 1 + Math.floor(t * 14) % 2];
    case 'kick': return ['kicks', 0];
    case 'whip': return ['kicks', t < 0.08 ? 0 : 1];
    case 'axe': return ['kicks', t < 0.36 ? 2 : 3];
    case 'dash': return ['rocket', step(t, [0.1, 0.18, 0.45])];
    case 'bazooka': return ['bazooka', step(t, [0.24, 0.32, 0.6])];
    case 'rocket': return ['bazooka', step(t, [0.2, 0.28, 0.5])];
    case 'charge': return ['rocket', 3]; // les étapes 4 et 5 ont un 2e chapeau dessiné par erreur
    case 'transform': return ['rocket', [3, 3, 6, 7][step(t, [0.25, 0.5, 0.8])]];
    case 'ultra': return ['gigant', step(t, [GIGANT.inflate, GIGANT.punch, GIGANT.end - 0.3])];
    case 'prejump': return ['jump', t < 0.04 ? 0 : 1];
    case 'land': return ['jump', 7];
    case 'jump': return ['jump', jumpFrame(h)];
    case 'airkick': return ['lowair', 4 + step(t, [0.06, 0.12, 0.42])];
    case 'hurt': return ['fall', t < 0.15 ? 0 : 1];
    case 'knock': return ['fall', h.vy < 0 ? 2 : 3];
    case 'floor': return ['fall', 4];
    case 'getup': return ['fall', 5 + step(t, [0.15, 0.3])];
    default: return ['punch', 0]; // garde
  }
}

function enemyPose(e) {
  const t = e.t;
  if (e.hop && SPRITES[ETYPES[e.type].sheet || e.type]?.fall) return ['fall', 2]; // en l'air, au-dessus d'un trou
  if (ETYPES[e.type].pose) return ETYPES[e.type].pose(e);
  if (e.type === 'brute') switch (e.state) {
    case 'walk': return e.moving ? ['walk', Math.floor(e.walkT * 6) % 4] : ['attack', 0];
    case 'windup': return ['attack', 1];
    case 'punch': return ['attack', t < 0.3 ? 2 : 3];
    case 'hurt': return ['fall', 0];
    case 'knock': return ['fall', e.vy < 0 ? 1 : 2];
    case 'down': return ['fall', 3];
    case 'getup': return ['fall', t < 0.25 ? 5 : 6];
    default: return ['attack', 0];
  }
  if (e.type === 'ninja') switch (e.state) {
    case 'walk': return !e.moving ? ['attack', 0] : e.backing && SPRITES.ninja.back ? ['back', Math.floor(e.walkT * 10) % SPRITES.ninja.back.frames.length] : ['run', Math.floor(e.walkT * 14) % 7];
    case 'throw': return ['attack', t < 0.25 ? 1 : 2];
    case 'slash': return ['attack', t < 0.25 ? 3 : 4];
    case 'hurt': return ['fall', 0];
    case 'knock': return ['fall', e.vy < 0 ? 1 : 2];
    case 'down': return ['fall', 3];
    case 'getup': return ['fall', t < 0.25 ? 4 : 5];
    default: return ['attack', 0];
  }
  switch (e.state) {
    case 'walk': return e.moving ? ['walk', Math.floor(e.walkT * 9) % 6] : ['punch', 0];
    case 'windup': return ['punch', 1];
    case 'punch': return ['punch', t < 0.22 ? 2 : 3];
    case 'hurt': return ['fall', t < 0.15 ? 0 : 1];
    case 'knock': return ['fall', e.vy < 0 ? 2 : 3];
    case 'down': return ['getup', 0];
    case 'getup': return ['getup', step(t, [0.15, 0.3, 0.42])];
    default: return ['punch', 0];
  }
}

// c1 : couleur du halo, c2 : couleur des flammes. Les langues de flamme montent en ondulant,
// plus hautes au centre, avec un cœur blanc ; le tout se dessine derrière le personnage.
// Teinte CSS qui transforme une silhouette noire en une couleur donnée (approximation par la teinte)
function tintFilter(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1;
  let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  // sepia donne un jaune-orangé (~38°) : on décale la teinte à partir de là
  return `brightness(0) invert(1) sepia(1) saturate(6) hue-rotate(${Math.round(hue - 38)}deg)`;
}

// Queues de chakra du démon renard : des langues rouges qui partent du bas du dos et ondulent derrière lui
function drawFoxCloak(h, sx, n) {
  const bx = sx - h.dir * 18, by = h.y - 92, t = sceneT;
  // halo rouge derrière le corps
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx, h.y - 105, 10, sx, h.y - 105, 140);
  g.addColorStop(0, 'rgba(200,20,10,0.4)'); g.addColorStop(1, 'rgba(120,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, h.y - 105, 90, 140, 0, 0, 7); ctx.fill();
  ctx.restore();
  // queues en rouge franc (sans mélange lumineux, qui les rendait orange), bord qui rougeoie
  ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(255,30,0,0.9)'; ctx.shadowBlur = 16;
  for (let k = 0; k < n; k++) {
    const spread = (k - (n - 1) / 2) * 0.55, len = 150 + k * 12, seg = 14;
    let px = bx, py = by;
    for (let j = 1; j <= seg; j++) {
      const u = j / seg, wave = Math.sin(t * 5 + k * 1.9 + u * 4) * 22 * u;
      const nx = bx - h.dir * (Math.cos(0.5 + spread) * len * u), ny = by - Math.sin(0.5 + spread) * len * u * 0.9 + wave;
      const w = 30 * (1 - u) + 5;
      ctx.strokeStyle = `rgba(${200 + 40 * u},${20 + 30 * u},10,${0.85 - 0.35 * u})`; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.strokeStyle = `rgba(255,110,60,${0.6 - 0.4 * u})`; ctx.lineWidth = w * 0.3;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      px = nx; py = ny;
    }
  }
  ctx.restore();
}

function bodyAura(h, sheet, anim, i, sx, col, power) {
  const f = tintFilter(col), t = sceneT;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // trois couches de lueur de plus en plus grandes et floues, qui palpitent
  for (const [k, a, blur] of [[1.08, 0.6, 3], [1.2, 0.42, 8], [1.36, 0.3, 14], [1.55, 0.18, 22]]) {
    ctx.globalAlpha = a * (0.8 + 0.2 * Math.sin(t * 22 + k * 9));
    drawAnim.grow = (k + 0.02 * Math.sin(t * 17 + k * 5)) * (0.9 + power * 0.1);
    drawAnim(sheet, anim, i, sx, h.y + 4, h.dir, `${f} blur(${blur}px)`);
  }
  drawAnim.grow = 0;
  ctx.restore();
  // flammes d'énergie qui montent le long du corps
  if (Math.random() < 0.9 * power) for (let k = 0; k < 2; k++)
    particles.push({ x: h.x + rand(-70, 70), y: h.y - rand(0, 200), vx: rand(-20, 20), vy: rand(-460, -260), t: 0, life: rand(0.2, 0.38), c: col, r: rand(2.5, 5), streak: true });
}

function saiyanAura(sx, y, filter, power) {
  if (!FX.ssj_aura) return drawAura(sx, y, 'rgba(255,220,90,0.6)', '#ffd84a', power);
  const pulse = 1 + Math.sin(sceneT * 18) * 0.03;
  // halo doux puis la flamme qui change de forme 12 fois par seconde
  const g = ctx.createRadialGradient(sx, y - 110, 10, sx, y - 110, 170 * power);
  g.addColorStop(0, filter ? 'rgba(120,200,255,0.35)' : 'rgba(255,230,120,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(sx, y - 110, 120 * power, 170 * power, 0, 0, 7); ctx.fill(); ctx.restore();
  fxImg('ssj_aura', Math.floor(sceneT * 12), sx, y - 118 * power, 175 * power * pulse, 290 * power * pulse, { filter, alpha: 0.9 });
}

function drawAura(sx, y, c1, c2, power) {
  const H = 210 * power, Wd = 72 * power, base = y + 6;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // Halo diffus
  const g = ctx.createRadialGradient(sx, y - H * 0.45, 10, sx, y - H * 0.45, H * 0.8);
  g.addColorStop(0, c1); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, y - H * 0.45, Wd * 1.5, H * 0.75, 0, 0, 7); ctx.fill();
  // Langues de flamme : deux couches (couleur puis cœur pâle)
  for (const [layer, col, alpha, shrink] of [[0, c2, 0.36, 1], [1, '#ffffff', 0.16, 0.6]]) {
    ctx.fillStyle = col; ctx.globalAlpha = alpha;
    const N = 11;
    for (let k = 0; k < N; k++) {
      const u = (k + 0.5) / N * 2 - 1;                          // -1 (gauche) → 1 (droite)
      const ph = sceneT * 3.2 + k * 1.7 + layer;
      const fh = H * shrink * (0.55 + 0.45 * Math.cos(u * 1.4)) * (0.82 + 0.18 * Math.sin(ph * 2.3));
      const x0 = sx + u * Wd * shrink, w = Wd * shrink * 0.42;
      const sway = Math.sin(ph) * 14 * power;
      ctx.beginPath();
      ctx.moveTo(x0 - w, base);
      ctx.quadraticCurveTo(x0 - w * 0.9 + sway * 0.3, base - fh * 0.55, x0 + sway, base - fh);   // pointe qui ondule
      ctx.quadraticCurveTo(x0 + w * 0.9 + sway * 0.3, base - fh * 0.55, x0 + w, base);
      ctx.fill();
    }
  }
  // Étincelles qui s'envolent
  ctx.globalAlpha = 1; ctx.fillStyle = c2;
  for (let k = 0; k < 10; k++) {
    const ph = (sceneT * 1.6 + k * 0.137) % 1, x = sx + Math.sin(k * 12.9) * Wd * 1.1;
    ctx.globalAlpha = (1 - ph) * 0.9;
    ctx.fillRect(x, base - ph * H * 1.1, 2.5, 7);
  }
  ctx.restore();
}

// Petits éclairs autour du personnage (forme dorée)
function drawSparks(sx, y, c = '#fff6b0') {
  if (Math.random() > 0.35) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 10;
  let x = sx + rand(-50, 50), yy = y - rand(40, 200);
  ctx.beginPath(); ctx.moveTo(x, yy);
  for (let k = 0; k < 4; k++) { x += rand(-18, 18); yy += rand(8, 22); ctx.lineTo(x, yy); }
  ctx.stroke(); ctx.restore();
}

// Éclairs du Super Saiyan, comme dans l'anime : arcs bleu électrique qui crépitent autour du corps,
// avec un halo, un cœur blanc et une ramification. Chaque arc vit un instant (il ne clignote pas d'une image à l'autre).
function drawSaiyanSparks(h, sx) {
  const now = sceneT, list = (h._sparks = (h._sparks || []).filter(b => now - b.t0 < b.life));
  if (list.length < 2 && Math.random() < 0.16) {
    const pts = [];
    let x = rand(-55, 55), y = -rand(60, 210);
    const n = 3 + Math.floor(rand(0, 3)), dir = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < n; k++) { pts.push([x, y]); x += rand(-11, 11) + dir * 3; y += rand(7, 16); }
    const at = 1 + Math.floor(rand(0, n - 2)), br = [pts[at]];
    let bx = pts[at][0], by = pts[at][1];
    for (let k = 0; k < 2; k++) { bx += dir * rand(6, 12); by += rand(3, 9); br.push([bx, by]); }
    list.push({ t0: now, life: rand(0.09, 0.17), pts, br });
  }
  if (!list.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const path = (pts, flip) => { ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(sx + px * flip, h.y + py) : ctx.moveTo(sx + px * flip, h.y + py)); ctx.stroke(); };
  for (const b of list) {
    const a = 1 - (now - b.t0) / b.life;
    for (const [w, c, al] of [[5, 'rgba(40,120,255,0.4)', 0.8], [2.2, '#6fc8ff', 0.9], [1, '#ffffff', 0.9]]) {
      ctx.globalAlpha = a * al; ctx.strokeStyle = c; ctx.lineWidth = w;
      path(b.pts, h.dir); ctx.lineWidth = w * 0.6; path(b.br, h.dir);
    }
  }
  ctx.restore();
}

// Boule d'énergie ronde : halo, cœur blanc, anneau qui crépite
function energyBall(x, y, r, gold) {
  const [c1, c2, c3] = gold === 'violet' ? ['#ffffff', '#d79bff', 'rgba(140,40,255,0)'] : gold ? ['#fffbe0', '#ffe066', 'rgba(255,170,0,0)'] : ['#ffffff', '#8fe9ff', 'rgba(30,110,255,0)'];
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.2);
  halo.addColorStop(0, c2); halo.addColorStop(1, c3);
  ctx.globalAlpha = 0.55; ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  const core = ctx.createRadialGradient(x, y, 0, x, y, r);
  core.addColorStop(0, c1); core.addColorStop(0.55, c1); core.addColorStop(0.8, c2); core.addColorStop(1, c3);
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = c2; ctx.lineWidth = Math.max(1.5, r * 0.06);
  for (let k = 0; k < 3; k++) {
    const a = rand(0, Math.PI * 2);
    ctx.beginPath(); ctx.arc(x, y, r * rand(0.95, 1.25), a, a + rand(0.4, 1.2)); ctx.stroke();
  }
  ctx.restore();
}

// Planche affichée : celle de la forme (dorée, Gear 5) si elle a cette animation, sinon la normale
// Bout de la main sur l'étape affichée : point le plus en avant du haut du corps (60 % du haut), mesuré une fois
// par image puis gardé. Renvoie [devant, hauteur] par rapport au point posé au sol, à l'échelle du jeu.
const HAND_SHOTS = ['shuriken', 'airshot', 'kiball', 'red', 'burning', 'hiken', 'shell', 'icewall', 'strikeair', 'vrasen', 'stonewall'], handCache = {};
// rayon des grosses boules : leur centre est avancé d'autant pour qu'elles partent DEVANT la main
// décalage vertical du départ (vers le bas) : la pointe de l'épée levée de Saber partait trop haut
const PROJ_DY = { strikeair: 38 };
const PROJ_R = { shuriken: 52, vrasen: 40, katon: 52, burning: 34, kiball: 26, hiken: 34, shell: 12, icewall: 18, strikeair: 30, bullet: 12, stonewall: 18 };
function handPoint(h) {
  const [anim, i] = h.C.pose(h), sheet = sheetFor(h, anim), A = SPRITES[sheet]?.[anim];
  const f = A?.frames[clamp(i, 0, A.frames.length - 1)], img = f && IMG[f.src];
  if (!img) return null;
  if (!(f.src in handCache)) {
    let res = null;
    try {
      const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, f.w, f.h); // l'image peut être une version réduite
      const d = g.getImageData(0, 0, f.w, f.h).data;
      let top = -1;
      for (let y = 0; y < f.h && top < 0; y++) for (let x = 0; x < f.w; x++) if (d[(y * f.w + x) * 4 + 3] > 100) { top = y; break; }
      const y1 = top + Math.floor((f.h - top) * 0.6);
      let front = -1;
      for (let y = top; y < y1; y++) for (let x = f.w - 1; x > front; x--) if (d[(y * f.w + x) * 4 + 3] > 100) { front = x; break; }
      let sx = 0, sy = 0, n = 0;
      for (let y = top; y < y1; y++) for (let x = Math.max(0, front - 25); x <= front; x++) if (d[(y * f.w + x) * 4 + 3] > 100) { sx += x; sy += y; n++; }
      if (n) res = [(sx / n - f.ax) * A.scale, (sy / n - f.ay) * A.scale];
    } catch (e) { res = null; } // image d'une autre origine : on garde le départ par défaut
    handCache[f.src] = res;
  }
  return handCache[f.src];
}
// Bouche (Itachi) : le bout du visage, mesuré sur la bande de la bouche sous le sommet du crâne
const mouthCache = {};
function mouthPoint(h) {
  const [anim, i] = h.C.pose(h), sheet = sheetFor(h, anim), A = SPRITES[sheet]?.[anim];
  const f = A?.frames[clamp(i, 0, A.frames.length - 1)], img = f && IMG[f.src];
  if (!img) return null;
  if (!(f.src in mouthCache)) {
    let res = null;
    try {
      const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, f.w, f.h);
      const d = g.getImageData(0, 0, f.w, f.h).data;
      let top = -1;
      for (let y = 0; y < f.h && top < 0; y++) for (let x = 0; x < f.w; x++) if (d[(y * f.w + x) * 4 + 3] > 100) { top = y; break; }
      // la bouche est à ~27 px (à l'échelle du jeu) sous le sommet du crâne, quelle que soit la pose (accroupi ou debout)
      const k = 1 / A.scale, y0 = Math.floor(top + 19 * k), y1 = Math.floor(top + 35 * k);
      let front = -1;
      for (let y = y0; y < Math.min(y1, f.h); y++) for (let x = f.w - 1; x > front; x--) if (d[(y * f.w + x) * 4 + 3] > 100) { front = x; break; }
      if (front >= 0) res = [(front - f.ax) * A.scale, (top + 27 * k - f.ay) * A.scale];
    } catch (e) { res = null; }
    mouthCache[f.src] = res;
  }
  return mouthCache[f.src];
}
// Bout du pied (Sanji) : point le plus en avant sous la tête, mesuré une fois par image
const footCache = {};
function footPoint(h) {
  const [anim, i] = h.C.pose(h), sheet = sheetFor(h, anim), A = SPRITES[sheet]?.[anim];
  const f = A?.frames[clamp(i, 0, A.frames.length - 1)], img = f && IMG[f.src];
  if (!img) return null;
  if (!(f.src in footCache)) {
    let res = null;
    try {
      const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, f.w, f.h);
      const d = g.getImageData(0, 0, f.w, f.h).data;
      let top = -1;
      for (let y = 0; y < f.h && top < 0; y++) for (let x = 0; x < f.w; x++) if (d[(y * f.w + x) * 4 + 3] > 100) { top = y; break; }
      const y0 = top + Math.floor((f.h - top) * 0.2);
      let front = -1;
      for (let y = y0; y < f.h; y++) for (let x = f.w - 1; x > front; x--) if (d[(y * f.w + x) * 4 + 3] > 100) { front = x; break; }
      let sx = 0, sy = 0, n = 0;
      for (let y = y0; y < f.h; y++) for (let x = Math.max(0, front - 25); x <= front; x++) if (d[(y * f.w + x) * 4 + 3] > 100) { sx += x; sy += y; n++; }
      if (n) res = [(sx / n - f.ax) * A.scale, (sy / n - f.ay) * A.scale];
    } catch (e) { res = null; }
    footCache[f.src] = res;
  }
  return footCache[f.src];
}
// planche forcée le temps d'un ultime (Gohan en Super Saiyan 2), sinon celle de la forme
const formSheet = h => (h.state === 'ultra' && h.ultraSheet) || h.boost?.sheet;
const sheetFor = (h, anim) => formSheet(h) && SPRITES[formSheet(h)]?.[anim] ? formSheet(h) : h.C.sheet;

// Personnages à planches de 8 étapes (Sangoku, Zoro, Naruto, Tanjiro) : walk, jump, fall,
// combo (garde, 3 poings | 4 pieds), lowair (accroupi | en l'air), dashcharge (dash | charge), special (spécial | ultime).
// Les coups donnent leur propre pose (champ p).
function stdPose(h) {
  const t = h.t, m = h.move;
  if (POSE_STATES.includes(h.state)) return airPose(h);
  if (h.state === 'juggle') return jugglePose(h);
  if (m && m.cyc && t >= m.cyc.from) return [m.cyc.anim, t < m.cyc.to ? m.cyc.frames[Math.floor((t - m.cyc.from) * m.cyc.fps) % m.cyc.frames.length] : m.cyc.last];
  if (m && m.p) { const [a, f, marks] = m.p, v = f[Math.min(step(t, marks || []), f.length - 1)]; return Array.isArray(v) ? v : [a, v]; }
  switch (h.state) {
    case 'walk': { const [n, fps] = walkCycle(h), i = Math.floor(h.walkT * fps) % n; return ['walk', h.back ? n - 1 - i : i]; }
    case 'crouch': return ['lowair', t < 0.06 ? 0 : 1];
    case 'charge': return ['dashcharge', t < 0.15 ? 4 : h.C.chargeFrame ?? 5];
    case 'transform': return ['dashcharge', 4 + step(t, [0.2, 0.4, 0.6])];
    case 'ultra': return h.C.ultraPose(h);
    case 'prejump': return ['jump', t < 0.04 ? 0 : 1];
    case 'land': return ['jump', 7];
    case 'jump': return ['jump', jumpFrame(h)];
    case 'hurt': return ['fall', t < 0.15 ? 0 : 1];
    case 'knock': return ['fall', h.vy < 0 ? 2 : 3];
    case 'floor': return ['fall', 4];
    case 'getup': return ['fall', 5 + step(t, [0.15, 0.3])];
    default: return idleFrame(h) || ['combo', 0]; // garde (respiration filmée si le perso en a une)
  }
}
// Repos tiré d'une vidéo (tools/video2idle.py) : respiration, vêtements et cheveux qui bougent. Seulement si la
// planche affichée (forme comprise) a la sienne, sinon la garde fixe + la respiration calculée (breathOf).
const idleAnim = h => h.state === 'idle' && h.onGround ? SPRITES[h.boost?.sheet || h.C.sheet]?.idle : null;
function idleFrame(h) {
  const A = idleAnim(h);
  return A ? ['idle', Math.floor((sceneT + (h._bp || 0)) * A.rate) % A.frames.length] : null;
}

// Respiration au repos : le buste se soulève très légèrement (1,2 % de la hauteur, un cycle toutes les ~2,5 s),
// ancrée aux pieds. Chacun a son propre rythme, et l'effet arrive et repart en douceur quand il bouge.
function breathOf(o, idle) {
  o._bp ??= Math.random() * 6.28;
  o._bk = (o._bk || 0) + ((idle ? 1 : 0) - (o._bk || 0)) * 0.08;
  return o._bk * 0.012 * Math.sin(sceneT * 2.5 + o._bp);
}

function drawPlayer(h) {
  const C = h.C, F = h.boost;
  let sx = h.x - camX;
  if (h.respawn || h.aegis > 0) { drawRespawn(h, sx); if (h.respawn && !h.respawn.drop) return; }
  else if (h.inv > 0 && !['knock', 'floor', 'getup', 'transform', 'ultra'].includes(h.state) && Math.floor(h.inv * 20) % 2) return;



  shadow(sx, h);
  const [anim, i] = C.pose(h), sheet = sheetFor(h, anim), filter = F?.filter || '';
  // Aura façon anime, seulement en chargeant le ki ou en se transformant : une lueur qui épouse le corps
  // et des flammes qui montent. Or pour la forme dorée et les saiyans transformés, couleur du ki sinon.
  if (h.state === 'charge' || h.state === 'transform') {
    const N = h.state === 'transform' ? h.nextForm : F, gold = N?.sheet && ['gold', 'goku_ssj', 'vegeta_ssj', 'trunks_ssj', 'gohan_ssj'].includes(N.sheet);
    const col = N?.aura ? N.aura[1] : gold ? '#ffd84a' : C.kiColor;
    bodyAura(h, sheet, anim, i, sx, col, h.state === 'transform' ? 0.6 + Math.min(h.t, 1) * 0.6 : 0.9 + Math.min(h.t, 1) * 0.3);
  } else if (F?.foxCloak && !h.out) {
    drawFoxCloak(h, sx, F.foxCloak); // le liseré rouge qui épouse le corps vient du filtre de la forme
  } else if (F?.glow && !h.out) {
    // Forme qui brûle en permanence : halo coloré qui palpite derrière lui, puis la lueur qui épouse le corps
    const pulse = 0.8 + 0.2 * Math.sin(sceneT * 6);
    const g = ctx.createRadialGradient(sx, h.y - 110, 10, sx, h.y - 110, 150);
    g.addColorStop(0, F.glow + 'cc'); g.addColorStop(0.55, F.glow + '55'); g.addColorStop(1, F.glow + '00');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse; ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(sx, h.y - 110, 95, 150, 0, 0, 7); ctx.fill(); ctx.restore();
    bodyAura(h, sheet, anim, i, sx, F.glow, 0.3 + 0.08 * Math.sin(sceneT * 6));
  }
  if (F?.demon && !h.out && h.state !== 'transform') drawDemonBack(h, sx);
  // Charge du ki : le corps tremble sous la puissance
  if (h.state === 'charge' || h.state === 'transform') sx += Math.sin(sceneT * 70) * 1.6;
  // Double saut : une vrille avant, ralentie en fin de tour
  const rot = flipping(h) ? h.dir * 2 * Math.PI * (1 - (1 - h.t / FLIP) ** 2) : 0;
  // Asura : deux silhouettes fantômes de part et d'autre (les neuf sabres)
  if (F?.ghosts) {
    ctx.globalAlpha = 0.28;
    for (const o of [-26, 26]) drawAnim(sheet, anim, i, sx + o, h.y - 6, h.dir, 'brightness(0.6) sepia(1) hue-rotate(230deg) saturate(3)', rot);
    ctx.globalAlpha = 1;
  }
  // Rasenshuriken : deux clones aident Naruto à former la technique
  // Kurama : le renard à neuf queues se dresse derrière Naruto puis bondit
  if (h.char === 'naruto' && h.state === 'ultra' && h.C.ultra[0] === startKyubi) {
    const a = Math.min(1, h.t / 0.6) * (h.t > KYU.end - 0.3 ? (KYU.end - h.t) / 0.3 : 1);
    const lunge = h.t > KYU.charge ? Math.min(1, (h.t - KYU.charge) / 0.35) * 650 : 0;
    // il surgit des flammes, rugit, se ramasse puis bondit (planche animée), en respirant
    const fi = h.t < 0.6 ? 0 : h.t < KYU.charge - 0.2 ? 1 : h.t < KYU.charge ? 2 : 3, breathe = 1 + Math.sin(h.t * 9) * 0.04;
    fxImg(FX.kyubi_run ? 'kyubi_run' : 'kyubi', fi, sx + h.dir * (lunge - 30), h.y - 180 - (fi === 3 ? 40 : 0), 520 * breathe, null, { alpha: Math.max(0, a), flip: h.dir < 0 });
  }
  // Susanoo : le guerrier spectral d'Itachi se dresse derrière lui
  if (h.char === 'itachi' && h.state === 'ultra') drawSusanoo(h, sx);
  // Titan Assaillant : le titan se dresse derrière Eren dans la vapeur
  if (h.char === 'eren' && h.state === 'ultra') drawTitan(h, sx);
  // Grande transmutation : le cercle s'allume au sol devant Edward, le poing de pierre en sort
  if (h.char === 'edward' && h.state === 'ultra') drawAlchemy(h, sx);
  // Boruto : ses deux clones, dans la même pose que lui
  if (h.char === 'boruto' && h.state === 'ultra' && h.t > BORU.clones && h.t < BORU.end) {
    ctx.globalAlpha = 0.9;
    for (const [dx, dz] of BORU.at) drawAnim(sheet, anim, i, sx + h.dir * dx, h.y + dz, h.dir, 'brightness(0.92)');
    ctx.globalAlpha = 1;
  }
  // Kamehameha père-fils : l'esprit de Sangoku apparaît derrière Gohan, les mains jointes comme lui
  if (h.char === 'gohan' && h.state === 'ultra' && SPRITES.goku?.special) {
    const a = Math.min(1, h.t / 0.5) * (h.t > FSK.end - 0.4 ? Math.max(0, (FSK.end - h.t) / 0.4) : 1);
    ctx.globalAlpha = 0.42 * a;
    drawAnim('goku', 'special', h.t < FSK.fire ? 1 : 2, sx - h.dir * 70, h.y - 10, h.dir, 'brightness(1.4) saturate(0.4) hue-rotate(160deg)');
    ctx.globalAlpha = 1;
  }
  if (h.out) ctx.globalAlpha = 0.55;
  // Gon adulte : il grandit pendant son ultime
  drawAnim.grow = h.char === 'gon' && h.state === 'ultra' && h.t > 0.45 ? 1 + 0.55 * Math.min(1, (h.t - 0.45) / 0.3) : 0;
  drawAnim.breath = breathOf(h, h.state === 'idle' && !h.move && h.onGround && !idleAnim(h));
  drawAnim.lean = leanOf(h);
  // garde : légère aura bleutée qui faiblit avec la jauge ; charge du coup chargé : le corps s'embrase et tremble
  let shakeX = 0;
  if (h.state === 'smashcharge') {
    const k = Math.min(1, h.holdT / CHARGE.full);
    bodyAura(h, sheet, anim, i, sx, hitOf(h), 0.25 + 0.75 * k);
    if (k >= 1) shakeX = (Math.random() - 0.5) * 5;
  }
  drawAnim(sheet, anim, i, sx + shakeX, h.y, h.dir, filter, rot);
  drawAnim.lean = 0;
  drawAnim.breath = 0;
  drawAnim.grow = 0;
  ctx.globalAlpha = 1;
  if (F?.sparks === true) drawSaiyanSparks(h, sx);
  else if (F?.sparks) drawSparks(sx, h.y, F.sparks);
  const m = h.move;
  // Boule qui se forme entre les mains avant le tir (vague du héros, Kamehameha)
  if (h.state === 'blast' && !h.fired) {
    const p = handPos(h);
    energyBall(p.x - camX, p.y, 6 + 22 * Math.min(1, h.t / MOVES.blast.fire), !!F);
  }
  if (m?.beam && h.t < m.beam.at) {
    // la boule se forme entre les mains : à la hanche (Kamehameha, Galick) ou au-dessus de la tête (Masenko).
    // charge : un point par étape de la pose, en pixels de la planche par rapport au pied d'appui
    let bx = sx - h.dir * 18, by = h.y - 102 * WORLD;
    const ch = m.beam.charge, [anim, i] = h.C.pose(h), A = ch && SPRITES[sheetFor(h, anim)]?.[anim];
    if (A) { const c = ch[clamp(i, 0, ch.length - 1)]; bx = sx + h.dir * c[0] * A.scale; by = h.y + c[1] * A.scale; }
    energyBall(bx, by, 6 + 26 * Math.min(1, h.t / m.beam.at), m.beam.ball || false);
  }
  if (m?.heldShuriken && h.t < m.proj.at) drawShuriken(sx + h.dir * 18 * WORLD, h.y - 225 * WORLD, 0.25 + 0.3 * Math.min(1, h.t / m.proj.at), h.t);
  if (h.state === 'ultra' && h.C.ultra[0] === startShuriken && !h.thrown) drawShuriken(sx + h.dir * 30, h.y - 255 - 70 * Math.min(1, h.t / RSH.throwAt), 0.3 + 1.15 * Math.min(1, h.t / RSH.throwAt), h.t); // au-dessus de la main levée, sans cacher la tête
  if (m?.orb && h.t >= m.orb[0] && h.t <= m.orb[1]) {
    const r = 12 + 18 * Math.min(1, h.t / 0.3), low = m.orbFx === 'chidori' && h.t < m.p[2][1];
    const hp = !low && handPoint(h);
    const hx = hp ? sx + h.dir * (hp[0] + 6) : sx + h.dir * (low ? (h.t < m.p[2][0] ? 30 : -35) : 82), hy = hp ? h.y + hp[1] : h.y - (low ? 72 : 120);
    const orb = m.orbFx === 'chidori' && FX.chidori_v ? 'chidori_v' : !m.orbFx && FX.rasen_v ? 'rasen_v' : m.orbFx || 'rasengan', fox = h.boost && h.char === 'naruto';
    const orbFilter = orb === 'rasen_v' ? (fox ? 'hue-rotate(170deg) saturate(1.4)' : '') : fox ? 'hue-rotate(170deg) saturate(1.6)' : '';
    if (!fxImg(orb, Math.floor(h.t * 16), hx, hy, r * (orb === 'rasen_v' ? 3.8 : orb === 'chidori_v' ? 4.2 : 3.2), null, { filter: orbFilter })) drawRasengan(hx, hy, r, h.t);
  }
  if (h.char === 'gojo' && h.state === 'ultra' && h.t < 0.95 && FX.violet_orb) {
    const L = FX.violet_orb, i = Math.min(L.length - 1, Math.floor(h.t / 0.95 * L.length));
    fxImg('violet_orb', i, sx + h.dir * 70 * WORLD, h.y - 130 * WORLD, (120 + 160 * h.t) * WORLD, null);
  }
  if (h.char === 'luffy' && h.state === 'ultra' && h.t >= GIGANT.punch && FX.gigant_v) {
    const L = FX.gigant_v, k = (h.t - GIGANT.punch) / (GIGANT.end - GIGANT.punch), f = L[Math.min(L.length - 1, Math.floor(k * L.length))], img = IMG[f.src];
    if (img) {
      const w = 820 * WORLD, s2 = w / f.w;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(sx + h.dir * 90 * WORLD, h.y - 125 * WORLD); ctx.scale(h.dir, 1);
      ctx.drawImage(img, -170 * s2, -f.h * s2 / 2, w, f.h * s2); ctx.restore();
    }
  }
  if (h.char === 'vegeta' && h.state === 'ultra' && h.t < 0.95) {
    const close = h.t > 0.75; // mains ramenées devant la poitrine
    for (const o of close ? [0] : [-78, 70]) energyBall(sx + h.dir * (close ? 60 : o), h.y - (close ? 118 : 128), 6 + 18 * Math.min(1, h.t / 0.8), true);
  }
  if (m?.fistGlow && h.t >= m.fistGlow[0] && h.t <= m.fistGlow[1]) fxImg('nen', 1 + Math.floor(h.t * 12) % 3, sx + h.dir * 40, h.y - 110, 30 + 70 * (h.t / m.fistGlow[1]));
  // À deux : un repère de couleur au-dessus de la tête
  if (players.length > 1 && !h.out) {
    const y = h.y - 222, c = COLORS_P[h.idx];
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(sx - 8, y); ctx.lineTo(sx + 8, y); ctx.lineTo(sx, y + 10); ctx.fill();
    outlined(`J${h.idx + 1}`, sx, y - 4, 16, c);
  }
}

function drawEnemy(e) {
  const T = ETYPES[e.type], sx = e.x - camX;
  if (e.eject) { // éjecté : il tournoie, et rapetisse en s'éloignant vers le ciel
    if (e.eject.done) return;
    const [anim, i] = enemyPose(e), own = !!SPRITES[T.sheet];
    drawAnim.grow = e.eject.sky ? Math.max(0.2, 1 - e.eject.t * 1.1) : 0;
    drawAnim(own ? T.sheet : T.alt, anim, i, sx, e.y, e.dir, own ? '' : T.altTint, e.eject.rot);
    drawAnim.grow = 0; return;
  }
  if (!e.alive && e.t > 0.6 && Math.floor(e.t * 15) % 2) return; // clignote avant de disparaître
  shadow(sx, e, ETYPES[e.type].isBoss ? 2 : ETYPES[e.type].armor ? 1.4 : 1);
  const [anim, i] = enemyPose(e);
  const own = !!SPRITES[T.sheet], sheet = own ? T.sheet : T.alt;
  // Le ninja, tout en noir, reçoit un liseré lumineux pour rester visible dans la nuit
  const filter = [own ? '' : T.altTint, e.tint, e.enraged ? 'saturate(1.6) brightness(1.1) drop-shadow(0 0 6px #ff3000)' : '', T.glow ? 'drop-shadow(0 0 3px rgba(255,70,235,0.95))' : '', e.flash > 0 ? 'brightness(2.5)' : ''].filter(Boolean).join(' ');
  drawAnim.breath = breathOf(e, e.alive && e.state === 'walk' && !e.moving);
  drawAnim(sheet, anim, i, sx, e.y, e.dir, filter);
  drawAnim.breath = 0;
  if (e.state === 'windup') outlined('!', sx, e.y - T.h, 34, '#ff3355');
  // Jauge de vie de la brute
  if ((['brute', 'samurai', 'biker'].includes(e.type) || T.armor && !T.isBoss) && e.alive && e.hp < e.maxHp) {
    const w = 90, k = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - w / 2 - 2, e.y - T.h + 18, w + 4, 9);
    ctx.fillStyle = '#ff3355'; ctx.fillRect(sx - w / 2, e.y - T.h + 20, w * k, 5);
  }
}

// Ombre de contact : centrée juste sous les pieds (le perso est posé dessus, il ne flotte pas), sombre au centre
// et fondue sur les bords pour se voir aussi sur un sol sombre ; elle rapetisse et pâlit en l'air.
function shadow(sx, o, size = 1) {
  const air = clamp(1 - (o.gz - o.y) / 400, 0.3, 1), rx = 42 * air * size, ry = 10 * air * size;
  ctx.save(); ctx.translate(sx, o.gz - 1); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${0.62 * air})`); g.addColorStop(0.55, `rgba(0,0,0,${0.42 * air})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill();
  ctx.restore();
}

function drawWaves() {
  for (const w of waves) {
    const sx = w.x - camX, r = (w.gold ? 40 : 30) + Math.sin(w.t * 40) * 3;
    // Traînée qui s'amincit derrière la boule
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const tail = ctx.createLinearGradient(sx - w.dir * 200, 0, sx, 0);
    tail.addColorStop(0, 'rgba(0,0,0,0)'); tail.addColorStop(1, w.gold ? 'rgba(255,214,80,0.7)' : 'rgba(90,200,255,0.7)');
    ctx.fillStyle = tail;
    ctx.beginPath(); ctx.moveTo(sx, w.y - r * 0.8); ctx.lineTo(sx - w.dir * 200, w.y); ctx.lineTo(sx, w.y + r * 0.8); ctx.fill();
    ctx.restore();
    energyBall(sx, w.y, r, w.gold);
  }
}

// Explosion du Rasen-shuriken : la sphère de lames de vent jaillit, palpite en tournoyant puis se dissipe
function drawRshBoom(b) {
  const img = IMG.fx_rsh_boom, k = b.t / 1.1, sx = b.x - camX;
  const grow = Math.min(1, b.t / 0.22), sc = b.rsh * (0.35 + 0.65 * (1 - Math.pow(1 - grow, 3))) * (1 + Math.sin(b.t * 40) * 0.03);
  const w = 820 * sc, hh = w * img.height / img.width, cy = b.y - (b.rsh < 1 ? 0 : hh * 0.32);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = k < 0.6 ? 1 : Math.max(0, (1 - k) / 0.4);
  ctx.translate(sx, cy);
  ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
  ctx.globalAlpha *= 0.4; ctx.rotate(b.t * 3); ctx.drawImage(img, -w * 0.4, -hh * 0.4, w * 0.8, hh * 0.8);
  ctx.restore();
}

// Entei d'Ace : un soleil de flammes filmé (entei_v, fond noir posé en mode lumineux) dans un halo de chaleur ;
// à l'impact, un dôme de feu. Sans la vidéo : l'ancienne sphère passée au rouge-orangé.
const ENTEI_S = 2.25; // largeur de l'image / rayon du soleil
function drawBomb(b) {
  if (b.rsh && IMG.fx_rsh_boom) return drawRshBoom(b);
  if (!b.fire) return drawBombBody(b);
  const sx = b.x - camX;
  if (!FX.entei_v) { ctx.save(); ctx.filter = 'hue-rotate(170deg) saturate(2.2) brightness(1.05)'; drawBombBody(b); ctx.restore(); return; }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (b.state !== 'boom') {
    const r = b.r * (1 + Math.sin(sceneT * 23) * 0.04);
    const g = ctx.createRadialGradient(sx, b.y, r * 0.3, sx, b.y, r * 2.1);
    g.addColorStop(0, 'rgba(255,170,60,0.55)'); g.addColorStop(0.5, 'rgba(255,90,20,0.22)'); g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, b.y, r * 2.1, 0, 7); ctx.fill();
    ctx.restore();
    fxImg('entei_v', Math.floor(sceneT * 14), sx, b.y, r * ENTEI_S, null, { rot: sceneT * 0.6 * b.dir });
    return;
  }
  const k = b.t / 1.1, R = 120 + 560 * Math.sqrt(k);
  ctx.globalAlpha = 1 - k;
  const g = ctx.createRadialGradient(sx, b.y, 0, sx, b.y, R);
  g.addColorStop(0, '#fff6d0'); g.addColorStop(0.35, '#ffb040'); g.addColorStop(0.7, 'rgba(255,80,10,0.6)'); g.addColorStop(1, 'rgba(200,30,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, b.y, R, R * 0.8, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#ffd080'; ctx.lineWidth = 8 * (1 - k);
  ctx.beginPath(); ctx.ellipse(sx, b.y, R * 1.1, R * 0.2, 0, 0, 7); ctx.stroke();
  ctx.restore();
}
function drawBombBody(b) {
  const sx = b.x - camX;
  // Le Super Saiyan accompagne la sphère d'un bras tendu, sans faisceau (comme contre Buu) : juste une lueur dans la paume
  if (b.genki && b.state === 'clash' && b.owner.genki?.ssj) {
    const h = b.owner, hp = handPoint(h), flick = 1 + Math.sin(sceneT * 30) * 0.1;
    const hx = h.x + h.dir * ((hp ? hp[0] : 54) + 4) - camX, hy = h.y + (hp ? hp[1] : -113);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 22 * flick);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,230,120,0.45)'); g.addColorStop(1, 'rgba(255,190,50,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 22 * flick, 0, 7); ctx.fill();
    ctx.restore();
  }
  if (b.state !== 'boom') {
    // sphère filmée (genki_v) : 680 px d'image pour une sphère de ~560 px de diamètre
    const r = b.r * (1 + Math.sin(sceneT * 30) * 0.03);
    if (!(FX.genki_v && fxImg('genki_v', Math.floor(sceneT * 12), sx, b.y, r * 2.45, null))) energyBall(sx, b.y, r, false);
    return;
  }
  // Explosion : un dôme de lumière qui s'étend puis s'éteint
  const k = b.t / 1.1, R = 120 + 520 * Math.sqrt(k);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
  const g = ctx.createRadialGradient(sx, b.y, 0, sx, b.y, R);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#9fe8ff'); g.addColorStop(1, 'rgba(30,110,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, b.y, R, R * 0.75, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6 * (1 - k);
  ctx.beginPath(); ctx.ellipse(sx, b.y, R * 1.1, R * 0.2, 0, 0, 7); ctx.stroke();
  ctx.restore();
}

function drawParticles() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const k = 1 - p.t / p.life, sx = p.x - camX;
    if (p.ring) {
      ctx.strokeStyle = `rgba(255,255,255,${k})`; ctx.lineWidth = 4 * k;
      ctx.beginPath(); ctx.arc(sx, p.y, 10 + (1 - k) * 50, 0, 7); ctx.stroke();
    } else if (p.streak) {
      // trait de flamme qui file vers le haut
      ctx.globalAlpha = k; ctx.strokeStyle = p.c; ctx.lineWidth = p.r; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, p.y); ctx.lineTo(sx - p.vx * 0.05, p.y - p.vy * 0.07); ctx.stroke();
    } else {
      ctx.globalAlpha = k; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(sx, p.y, p.r, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
  ctx.textAlign = 'center';
  for (const p of popups) {
    ctx.globalAlpha = 1 - p.t / 0.7;
    ctx.font = `italic 900 ${p.small ? 22 : 26}px Impact, sans-serif`;
    ctx.lineWidth = 5; ctx.strokeStyle = '#1a0630'; ctx.strokeText(p.text, p.x - camX, p.y);
    ctx.fillStyle = p.c || '#ffe14d'; ctx.fillText(p.text, p.x - camX, p.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- Rendu : interface ----------
function bar(x, y, w, h, v, c1, c2, label, right = false) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  if (right) ctx.fillRect(x + w * (1 - v), y, w * v, h); else ctx.fillRect(x, y, w * v, h);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = right ? 'right' : 'left';
  ctx.fillText(label, right ? x + w : x, y - 7);
}

function outlined(text, x, y, size, fill = '#fff', align = 'center') {
  ctx.font = `italic 900 ${size}px Impact, "Arial Black", sans-serif`; ctx.textAlign = align;
  ctx.lineWidth = size / 6; ctx.strokeStyle = '#120420'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

// Position du visage dans chaque image de carte (fraction de la largeur, de la hauteur) et taille d'affichage
const FACES = {
  card_go: [0.6, 0.37, 4], card_goku: [0.62, 0.34, 4], card_hero: [0.66, 0.36, 4], card_ic: [0.38, 0.31, 5.5],
  card_ip: [0.55, 0.22, 4.2], card_iz: [0.62, 0.35, 4.4], card_ka: [0.46, 0.27, 4.4], card_kenshin: [0.54, 0.3, 4.4],
  card_ki: [0.53, 0.36, 4], card_luffy: [0.725, 0.34, 4.4], card_naruto: [0.6, 0.33, 4.2], card_tanjiro: [0.42, 0.29, 4.4],
  card_ve: [0.52, 0.37, 4], card_ze: [0.2, 0.36, 4.2], card_zoro: [0.47, 0.27, 4.4],
  card_jw: [0.765, 0.185, 6.5], card_sk: [0.6, 0.22, 5], card_gh: [0.5, 0.42, 3.4], card_gs: [0.5, 0.43, 3.6], card_sa: [0.56, 0.12, 7.5], card_gj: [0.52, 0.155, 7.5], card_in: [0.68, 0.27, 3.8], card_tr: [0.62, 0.29, 4.4], card_ac: [0.36, 0.33, 4.2], card_gt: [0.5, 0.29, 4.2], card_sj: [0.52, 0.15, 4.4], card_st: [0.57, 0.19, 4.2], card_sb: [0.39, 0.33, 4.0], card_mk: [0.55, 0.21, 4.0], card_rv: [0.56, 0.3, 4.0], card_ga: [0.62, 0.18, 4.0], card_lv: [0.57, 0.19, 4.0], card_bk: [0.41, 0.3, 4.0], card_it: [0.66, 0.2, 4.2], card_er: [0.38, 0.34, 4.0], card_ed: [0.56, 0.28, 4.2], card_gi: [0.38, 0.16, 4.0], card_bo: [0.6, 0.33, 4.0], card_ns: [0.51, 0.4, 3.2], // cartes en pied : visage repéré sur la carte
};
// Portrait rond du personnage, centré sur son visage
function medallion(C, x, y, r, ring) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
  const g = ctx.createLinearGradient(x, y - r, x, y + r); g.addColorStop(0, C.colors[0]); g.addColorStop(1, '#1a0630');
  ctx.fillStyle = g; ctx.fill(); ctx.clip();
  const img = IMG[C.card];
  if (img && (C.face || FACES[C.card])) {
    const [fx, fy, k] = C.face || FACES[C.card], s = r * k / img.height;
    ctx.drawImage(img, x - img.width * s * fx, y - img.height * s * fy, img.width * s, img.height * s);
  } else if (img) { const s = r * 3.4 / img.height; ctx.drawImage(img, x - img.width * s / 2, y - r * 1.1, img.width * s, img.height * s); }
  ctx.restore();
  ctx.strokeStyle = ring; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
}

// Vie et ki d'un joueur : le joueur 1 en haut à gauche, le joueur 2 en haut à droite (en miroir)
function drawPlayerHUD(h) {
  const C = h.C, p = h.idx, right = p % 2 === 1;
  if (p >= 2) return drawSmallHUD(h);
  const w = 230, mx = right ? W - 50 : 50, x = right ? W - 86 - w : 86;
  medallion(C, mx, 52, 30, players.length > 1 ? COLORS_P[p] : '#fff');
  if (players.length > 1) outlined(`J${p + 1}`, mx, 98, 16, COLORS_P[p]);
  drawLivesAndPartner(h, x, w, right, 104);
  bar(x, 34, w, 16, h.hp / h.maxHp, '#ff3355', '#ffb13b', h.out ? `${C.name} — K.O.` : C.name, right);
  const L = C.labels, k = (a) => K(a, p), cost = C.moves[C.special].cost, F = h.boost, next = formFor(h) || C.forms[0], up = F && formAfter(h);
  const kiLabel = F ? (up ? `${F.name} → ${up.name} [${k('transform')}]` : h.ki >= KI.formUltra ? `${F.name} — ${L.ultra} [${k('ultra')}]` : F.name)
    : h.ki >= KI.ultra ? `${L.ultra} PRÊT [${k('ultra')}]` : h.ki >= KI.transform ? `KI — ${next.name} [${k('transform')}]`
      : h.ki >= cost ? `KI — ${L.blast} [${k('blast')}]` : `KI  (charge : ${k('charge')})`;
  bar(x, 74, w, 11, h.ki / 100, F ? F.bar[0] : '#2a7bff', F ? F.bar[1] : '#7ff0ff', kiLabel, right);
  ctx.fillStyle = '#fff';
  for (const v of [cost, KI.transform, KI.ultra]) ctx.fillRect(right ? x + w - w * v / 100 - 1 : x + w * v / 100 - 1, 72, 2, 15);
}
// Vies (cœurs) et partenaire de relais (petit médaillon, sa vie et son ki)
function drawLivesAndPartner(h, x, w, right, y) {
  ctx.font = 'bold 15px sans-serif'; ctx.textAlign = right ? 'right' : 'left'; ctx.fillStyle = '#ff4d6d';
  ctx.fillText(h.lives > 0 ? '♥'.repeat(h.lives) : 'PLUS DE VIE', right ? x + w : x, y);
  const R = h.reserve;
  if (!R) return;
  const dir = right ? -1 : 1, mx = (right ? x + w : x) + dir * 120, bw = 64, bx = right ? mx - 20 - bw : mx + 20, k = R.hp / R.maxHp;
  medallion(R.C, mx, y - 5, 13, R.hp > 0 ? '#fff' : '#555');
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, y - 10, bw, 7);
  ctx.fillStyle = R.hp > 0 ? '#ff3355' : '#555'; ctx.fillRect(right ? bx + bw * (1 - k) : bx, y - 10, bw * k, 7);
  const duo = h.ki >= KI.ultra && R.ki >= KI.ultra;
  ctx.fillStyle = duo ? '#ffe14d' : '#7ff0ff'; ctx.fillRect(bx, y - 2, bw * R.ki / 100, 3);
  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = right ? 'right' : 'left'; ctx.fillStyle = h.tagCool > 0 ? '#8a80a8' : duo ? '#ffe14d' : '#fff';
  ctx.fillText(duo ? `DUO PRÊT [${K('tag', h.idx)}]` : `RELAIS [${K('tag', h.idx)}]`, right ? bx + bw : bx, y + 10);
}
// Joueurs 3 et 4 : cadre réduit en bas de l'écran
function drawSmallHUD(h) {
  const C = h.C, p = h.idx, right = p === 3, w = 150;
  const mx = right ? W - 34 : 34, x = right ? W - 62 - w : 62, y = H - 70;
  medallion(C, mx, y + 20, 22, COLORS_P[p]);
  outlined(`J${p + 1}`, mx, y + 58, 13, COLORS_P[p]);
  bar(x, y + 6, w, 12, h.hp / h.maxHp, '#ff3355', '#ffb13b', h.out ? 'K.O.' : C.name, right);
  bar(x, y + 30, w, 8, h.ki / 100, '#2a7bff', '#7ff0ff', '', right);
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = right ? 'right' : 'left'; ctx.fillStyle = '#ff4d6d';
  ctx.fillText(h.lives > 0 ? '♥'.repeat(h.lives) : 'PLUS DE VIE', right ? x + w : x, y + 56);
}

// Cartouche façon jeu de combat : bande inclinée avec le visage énervé du personnage et le nom de son ultime,
// en haut à gauche pour le joueur 1, en haut à droite pour le joueur 2.
const CUT = 1.3;
const CUT_FROM_CARD = new Set(); // tous les persos ont maintenant leur gros plan (assets/ui/cutin)
function drawCutins() {
  cutins = cutins.filter(c => (c.t += 1 / 60) < CUT);
  for (const c of cutins) {
    // bandeau du côté de l'écran opposé au perso (il s'élève pendant certains ultimes : le bandeau le cachait)
    c.right ??= c.duo ? c.h.idx % 2 === 0 : c.h.x - camX < W / 2;
    const h = c.h, right = c.right, img = IMG['cutin_' + h.char];
    ctx.globalAlpha = 0.95;
    const k = c.t / CUT, slide = c.t < 0.18 ? 1 - c.t / 0.18 : k > 0.85 ? (k - 0.85) / 0.15 : 0;
    // en haut, sous les jauges : on voit le visage sans cacher les combattants
    const bw = 360, bh = 78, y = 118, x = right ? W - bw + slide * (bw + 80) : -slide * (bw + 80), sk = 40;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + (right ? sk : 0), y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw - (right ? 0 : sk), y + bh); ctx.lineTo(x, y + bh); ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.fillStyle = h.C.colors[0]; ctx.fillRect(x, y, bw, bh);
    const card = CUT_FROM_CARD.has(h.char) && IMG[h.C.card];
    if (card) {
      // pas encore de gros plan dessiné : visage pris sur la carte en pied, centré dans la bande
      const [fx, fy] = FACES[h.C.card], z = 1.05 + k * 0.08, s = bh * 1.25 * z / (0.15 * card.height), iw = card.width * s, ih = card.height * s;
      ctx.save(); if (right) { ctx.translate(x * 2 + bw, 0); ctx.scale(-1, 1); }
      ctx.drawImage(card, x + bw * 0.55 - fx * iw, y + bh * 0.5 - fy * ih, iw, ih); ctx.restore();
    } else if (img) {
      // bande du visage (milieu de l'image), légèrement zoomée qui avance
      const z = 1.05 + k * 0.08, iw = bw * z, ih = iw * img.height / img.width;
      ctx.save(); if (right) { ctx.translate(x * 2 + bw, 0); ctx.scale(-1, 1); }
      ctx.drawImage(img, x - (iw - bw) / 2, y + bh / 2 - ih / 2, iw, ih); ctx.restore();
    }
    // lignes de vitesse
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    for (let j = 0; j < 9; j++) { const ly = y + ((j * 37 + c.t * 900) % bh); ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + bw * 0.25, ly); ctx.stroke(); }
    ctx.restore();
    ctx.lineWidth = 5; ctx.strokeStyle = h.C.colors[1]; ctx.stroke();
    ctx.restore();
    outlined(h.C.labels.ultra + ' !!', right ? x + 24 : x + bw - 24, y + bh + 24, 20, h.C.colors[1], right ? 'left' : 'right');
  }
}

function drawHUD() {
  drawCutins();
  drawBossBar();
  for (const h of players) if (!h.assist) drawPlayerHUD(h);
  outlined(String(score).padStart(7, '0'), W / 2, 42, 30, '#ffe14d');
  drawLevelProgress();
  if (combo > 1) outlined(`${combo} COMBO`, W / 2, 112, 34 + Math.min(combo, 10) * 2, '#7ff0ff');
  drawLevelOverlay();
  if (paused) drawPauseMenu();
}

// Écran titre : l'image de groupe, animée en code (lent zoom, braises qui montent, éclats de lumière)
const titleFx = Array.from({ length: 40 }, (_, k) => ({ x: Math.random() * W, y: Math.random() * H, v: 20 + Math.random() * 60, r: 1 + Math.random() * 2.5, c: k % 3 ? '#ffb347' : '#8fe9ff' }));
// Écran titre : une illustration tirée au hasard à chaque lancement (assets/ui/title/title_N.jpg), sinon l'ancienne
const TITLE_N = 6, titlePick = 1 + Math.floor(Math.random() * TITLE_N);
function drawTitle() {
  const art = IMG['title_art'] || IMG.title;
  if (art) {
    const z = 1.04 + Math.sin(sceneT * 0.25) * 0.03, s = Math.max(W / art.width, H / art.height) * z;
    const dx = Math.sin(sceneT * 0.17) * 12, dy = Math.cos(sceneT * 0.21) * 6;
    ctx.drawImage(art, (W - art.width * s) / 2 + dx, (H - art.height * s) / 2 + dy, art.width * s, art.height * s);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of titleFx) {
      p.y -= p.v / 60; p.x += Math.sin(sceneT * 2 + p.v) * 0.4;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(sceneT * 5 + p.v); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    // reflet de lumière qui balaie l'image de temps en temps
    const sw = (sceneT % 6) / 1.2;
    if (sw < 1) {
      const gx = -200 + sw * (W + 400), g = ctx.createLinearGradient(gx - 120, 0, gx + 120, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  } else { camX = sceneT * 40; drawBackground(); }
  ctx.fillStyle = 'rgba(5,0,20,0.25)'; ctx.fillRect(0, 0, W, H);
  if (IMG.logo) {
    const w = 400, h = IMG.logo.height * (w / IMG.logo.width);
    ctx.drawImage(IMG.logo, 28, 22 + Math.sin(sceneT * 2) * 4, w, h);
  } else {
    outlined('BROKEN', W / 2, 150, 84, '#ff9a1f');
    outlined('WORLD', W / 2, 240, 96, '#4fc3ff');
  }
  drawTitleMenu();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 66, W, 66);
  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`J1 :  ${K('left')} ${K('right')} ${K('up')} ${K('down')}  bouger     ${K('jump')}  sauter     ${K('crouch')}  se baisser     ${K('punch')}  attaque (tenir : coup chargé)     ${K('kick')}  garde     ${K('blast')}  spécial     ${K('dash')}  dash`, W / 2, H - 42);
  ctx.fillText(`${K('charge')} (tenir)  ki     ${K('transform')}  transformation     ${K('ultra')}  ultime     ${K('pause')}  pause et commandes     —     J2 : pavé numérique ou 2e manette`, W / 2, H - 18);
}

// ---------- Nom de l'animé d'origine, en lettrage évocateur de la série (dessiné en code, aucun logo copié) ----------
// Chaque perso a une clé `anime` ; ANIME_STYLE donne le nom affiché et le style : police, dégradé de remplissage,
// contours (intérieur, extérieur), inclinaison, ombre, et un motif propre à la série (deco).
const CHAR_ANIME = {
  hero: 'masterclass', luffy: 'op', zoro: 'op', ace: 'op', sanji: 'op', goku: 'db', gohan: 'db', vegeta: 'db', trunks: 'dbz',
  naruto: 'naruto', sasuke: 'naruto', kakashi: 'naruto', itachi: 'naruto', naruto_s: 'naruto_s', boruto: 'boruto',
  tanjiro: 'ds', zenitsu: 'ds', inosuke: 'ds', kenshin: 'rk', ichigo: 'bleach', izuku: 'mha', shoto: 'mha', gon: 'hxh', killua: 'hxh',
  ippo: 'ippo', jinwoo: 'sl', saitama: 'opm', gojo: 'jjk', guts: 'berserk', saber: 'fate', mikasa: 'aot', levi: 'aot', eren: 'aot',
  revy: 'lagoon', gally: 'gunnm', baki: 'baki', edward: 'fma', gintoki: 'gintama',
};
for (const [id, a] of Object.entries(CHAR_ANIME)) if (CHARS[id]) CHARS[id].anime ??= a;
// Sélection : les persos rangés par famille (même univers côte à côte), dans l'ordre des séries ci-dessous
const FAMILY = { dbz: 'db', naruto_s: 'naruto', boruto: 'naruto' };
const familyOf = id => { const a = CHARS[id]?.anime || CHAR_ANIME[id]; return FAMILY[a] || a; };
const FAMILY_ORDER = ['masterclass', 'db', 'op', 'naruto', 'ds', 'bleach', 'mha', 'hxh', 'jjk', 'rk', 'opm', 'sl', 'ippo', 'aot', 'berserk', 'fate', 'fma', 'lagoon', 'gunnm', 'baki', 'gintama'];
{
  const rank = id => { const r = FAMILY_ORDER.indexOf(familyOf(id)); return r < 0 ? 99 : r; }, pos = Object.fromEntries(CHAR_IDS.map((id, i) => [id, i]));
  CHAR_IDS.sort((a, b) => rank(a) - rank(b) || pos[a] - pos[b]);
}
const IMPACT = 'Impact, "Arial Black", sans-serif', SERIF = '"Times New Roman", Georgia, serif', BRUSH = '"Brush Script MT", "Segoe Script", cursive';
const ANIME_STYLE = {
  masterclass: { name: 'MASTERCLASS', font: `italic 900 %px ${IMPACT}`, fill: ['#fff3a0', '#ff9a1a'], stroke: '#3a0a00', outer: '#ffe14d', skew: -0.12 },
  op: { name: 'ONE PIECE', font: `900 %px ${IMPACT}`, fill: ['#fff27a', '#ffc21a'], stroke: '#1a3a9a', outer: '#0a1a4a', wave: 0.06, deco: 'hat' },
  db: { name: 'DRAGON BALL', font: `900 %px ${IMPACT}`, fill: ['#ffe24a', '#ff7a1a'], stroke: '#c0101a', outer: '#2a0a00', arc: 0.18, deco: 'star' },
  dbz: { name: 'DRAGON BALL Z', font: `900 %px ${IMPACT}`, fill: ['#ffe24a', '#ff7a1a'], stroke: '#c0101a', outer: '#2a0a00', arc: 0.18, deco: 'star' },
  naruto: { name: 'NARUTO', font: `900 %px ${IMPACT}`, fill: ['#ffb04a', '#ff6a00'], stroke: '#140400', outer: '#ffe0a0', skew: -0.08, deco: 'spiral' },
  naruto_s: { name: 'NARUTO SHIPPUDEN', font: `900 %px ${IMPACT}`, fill: ['#ffb04a', '#ff6a00'], stroke: '#140400', outer: '#ffe0a0', skew: -0.08, deco: 'spiral' },
  boruto: { name: 'BORUTO', font: `900 %px ${IMPACT}`, fill: ['#ffffff', '#9fd8ff'], stroke: '#0a1a3a', outer: '#2a6aff', skew: -0.1, deco: 'spiral' },
  ds: { name: 'DEMON SLAYER', font: `bold %px ${BRUSH}`, fill: ['#1a1414', '#000000'], stroke: '#f2e6d0', skew: -0.05, plate: '#5a0a12', deco: 'checker' },
  rk: { name: 'RUROUNI KENSHIN', font: `bold %px ${BRUSH}`, fill: ['#ff3a3a', '#a00010'], stroke: '#140000', outer: '#f0e0c0', skew: -0.06, deco: 'ink' },
  bleach: { name: 'BLEACH', font: `300 %px ${SERIF}`, fill: ['#ffffff', '#d0d0d8'], plate: '#06060a', spacing: 6, deco: 'blade' },
  mha: { name: 'MY HERO ACADEMIA', font: `italic 900 %px ${IMPACT}`, fill: ['#7dff8a', '#1aa040'], stroke: '#0a2a10', outer: '#ff3a3a', skew: -0.16, deco: 'comic' },
  hxh: { name: 'HUNTER × HUNTER', font: `900 %px ${IMPACT}`, fill: ['#b8ff7a', '#2fa83a'], stroke: '#06240a', outer: '#f2ffe0', skew: -0.04 },
  ippo: { name: 'HAJIME NO IPPO', font: `italic 900 %px ${IMPACT}`, fill: ['#ffffff', '#ffd0d0'], stroke: '#b00010', outer: '#200000', skew: -0.14, deco: 'glove' },
  sl: { name: 'SOLO LEVELING', font: `900 %px ${IMPACT}`, fill: ['#e6f4ff', '#6ab8ff'], stroke: '#0a1440', neon: '#3a9cff', spacing: 3 },
  opm: { name: 'ONE PUNCH MAN', font: `900 %px ${IMPACT}`, fill: ['#ffe14d', '#ffb000'], stroke: '#c00010', outer: '#200000', skew: -0.06, deco: 'fist' },
  jjk: { name: 'JUJUTSU KAISEN', font: `900 %px ${IMPACT}`, fill: ['#d6a0ff', '#6a1aa8'], stroke: '#0a0010', outer: '#f0e0ff', skew: -0.04, deco: 'claw' },
  berserk: { name: 'BERSERK', font: `900 %px ${SERIF}`, fill: ['#2a0a0a', '#000000'], stroke: '#b00010', outer: '#ff4a4a', spacing: 4, deco: 'blood' },
  fate: { name: 'FATE / STAY NIGHT', font: `italic 700 %px ${SERIF}`, fill: ['#fff2b0', '#d8a020'], stroke: '#0a1a5a', outer: '#2a4aff', skew: -0.05, deco: 'sword' },
  aot: { name: "L'ATTAQUE DES TITANS", font: `900 %px ${SERIF}`, fill: ['#f4ead8', '#c8b48a'], stroke: '#3a2410', outer: '#120800', deco: 'wings' },
  lagoon: { name: 'BLACK LAGOON', font: '900 %px "Courier New", monospace', fill: ['#c8d8a0', '#7a8a4a'], stroke: '#141a06', outer: '#f0f4e0', stencil: '#141a06', deco: 'bullets' },
  gunnm: { name: 'GUNNM', font: `900 %px ${IMPACT}`, fill: ['#e8f0ff', '#7a8aa8'], stroke: '#0a1a3a', outer: '#5ab0ff', metal: true, spacing: 4 },
  baki: { name: 'BAKI', font: `900 %px ${IMPACT}`, fill: ['#ff6a4a', '#a00a00'], stroke: '#1a0000', outer: '#ffd0a0', skew: -0.1, deco: 'veins' },
  fma: { name: 'FULLMETAL ALCHEMIST', font: `700 %px ${SERIF}`, fill: ['#ffd0a0', '#c01a1a'], stroke: '#200000', outer: '#f0d080', deco: 'circle' },
  gintama: { name: 'GINTAMA', font: `900 %px ${IMPACT}`, fill: ['#ffffff', '#cfe6ff'], stroke: '#1a3aa0', outer: '#0a1430', skew: -0.06, deco: 'waves' },
};
const animeOf = id => ANIME_STYLE[CHARS[id]?.anime || CHAR_ANIME[id]];

// Dessine le nom de la série centré sur (x, y), ou partant de x si left ; size : hauteur de lettre
function drawAnimeTitle(id, x, y, size, left = false) {
  const S = animeOf(id);
  if (!S) return;
  ctx.save();
  ctx.font = S.font.replace('%', size); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${S.spacing || 0}px`;
  const tw = ctx.measureText(S.name).width, x0 = left ? x : x - tw / 2, cx = x0 + tw / 2;
  // plaque derrière le nom (encre, bandeau noir)
  if (S.plate) {
    ctx.fillStyle = S.plate; ctx.beginPath();
    ctx.moveTo(x0 - 16, y - size * 0.62); ctx.lineTo(x0 + tw + 22, y - size * 0.7); ctx.lineTo(x0 + tw + 14, y + size * 0.66); ctx.lineTo(x0 - 22, y + size * 0.6); ctx.fill();
  }
  animeDeco(S.deco, x0, y, tw, size, 'back');
  ctx.translate(cx, y); ctx.transform(1, 0, S.skew || 0, 1, 0, 0); ctx.translate(-cx, -y);
  // lettre par lettre quand le nom est courbé (arc) ou ondulé (wave), sinon d'un bloc
  const glyphs = [];
  if (S.arc || S.wave) {
    let gx = x0;
    [...S.name].forEach((c, i) => {
      const w = ctx.measureText(c).width + (S.spacing || 0), t = (gx + w / 2 - cx) / (tw / 2 || 1);
      glyphs.push([c, gx, y + (S.arc ? t * t * size * S.arc * 2 : Math.sin(i * 1.3) * size * S.wave), S.arc ? t * S.arc : 0]);
      gx += w;
    });
  } else glyphs.push([S.name, x0, y, 0]);
  const put = draw => { for (const [c, gx, gy, rot] of glyphs) { ctx.save(); ctx.translate(gx, gy); ctx.rotate(rot); draw(c); ctx.restore(); } };
  ctx.lineJoin = 'round';
  if (S.neon) { ctx.shadowColor = S.neon; ctx.shadowBlur = size * 0.6; }
  else { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3; ctx.shadowBlur = 4; }
  if (S.outer) { ctx.strokeStyle = S.outer; ctx.lineWidth = size * 0.3; put(c => ctx.strokeText(c, 0, 0)); ctx.shadowColor = 'transparent'; }
  if (S.stroke) { ctx.strokeStyle = S.stroke; ctx.lineWidth = size * (S.outer ? 0.16 : 0.12); put(c => ctx.strokeText(c, 0, 0)); }
  ctx.shadowColor = S.neon || 'transparent'; ctx.shadowBlur = S.neon ? size * 0.3 : 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  g.addColorStop(0, S.fill[0]); if (S.metal) g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, S.fill[1]);
  ctx.fillStyle = g; put(c => ctx.fillText(c, 0, 0));
  // pochoir : barres qui coupent les lettres
  if (S.stencil) { ctx.shadowColor = 'transparent'; ctx.fillStyle = S.stencil; for (let k = 0; k < 2; k++) ctx.fillRect(x0, y - size * 0.16 + k * size * 0.3, tw, size * 0.06); }
  ctx.restore();
  ctx.save(); animeDeco(S.deco, x0, y, tw, size, 'front'); ctx.restore();
}

// Petits motifs propres à chaque série, derrière (back) ou devant (front) les lettres
function animeDeco(deco, x0, y, tw, s, layer) {
  if (!deco) return;
  const R = x0 + tw, cx = x0 + tw / 2;
  if (layer === 'back') {
    if (deco === 'checker') { // damier vert et noir
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#0a0a0a' : '#1a8a5a'; ctx.fillRect(x0 - 26 - s * 0.6 + i * s * 0.15, y - s * 0.3 + j * s * 0.3, s * 0.15, s * 0.3); }
    } else if (deco === 'circle') { // cercle de transmutation
      ctx.strokeStyle = 'rgba(255,200,120,0.45)'; ctx.lineWidth = 2; const r = s * 0.95;
      ctx.beginPath(); ctx.arc(cx, y, r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, y, r * 0.78, 0, 7); ctx.stroke();
      ctx.beginPath(); for (let k = 0; k <= 3; k++) { const a = -Math.PI / 2 + k * 2.094; ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); } ctx.stroke();
    } else if (deco === 'blade') { // lame fine sous le nom
      ctx.fillStyle = '#e8e8f0'; ctx.beginPath(); ctx.moveTo(x0 - 10, y + s * 0.6); ctx.lineTo(R + 30, y + s * 0.55); ctx.lineTo(x0 - 10, y + s * 0.68); ctx.fill();
    } else if (deco === 'ink') { // tache d'encre au pinceau
      ctx.fillStyle = 'rgba(10,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(cx, y + s * 0.1, tw * 0.6, s * 0.55, -0.04, 0, 7); ctx.fill();
    } else if (deco === 'waves') { // vagues du kimono
      ctx.strokeStyle = 'rgba(120,170,255,0.6)'; ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x0 - 14 - k * s * 0.4, y + s * 0.2, s * 0.2, Math.PI, 0); ctx.stroke(); }
    } else if (deco === 'wings') { // deux ailes, blanche et bleue
      for (const [d, c] of [[-1, 'rgba(240,240,255,0.6)'], [1, 'rgba(70,110,200,0.65)']]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x0 - 20, y + s * 0.3);
        ctx.quadraticCurveTo(x0 - 20 + d * 14, y - s * 0.9, x0 - 20 + d * 22, y - s * 0.2); ctx.closePath(); ctx.fill();
      }
    } else if (deco === 'blood') { // éclaboussure
      ctx.fillStyle = 'rgba(150,0,10,0.75)';
      for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.arc(x0 + tw * (0.12 + k * 0.13), y + s * 0.58 + (k % 3) * 4, 2.5 + (k % 2) * 3, 0, 7); ctx.fill(); }
    }
    return;
  }
  const bx = R + s * 0.55;
  if (deco === 'star') { // boule orange à étoile rouge
    const r = s * 0.42, g = ctx.createRadialGradient(bx - r * 0.3, y - r * 0.3, 1, bx, y, r); g.addColorStop(0, '#fff3c0'); g.addColorStop(1, '#ff8a00');
    ctx.fillStyle = g; ctx.strokeStyle = '#7a2a00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d0101a'; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.2 : r * 0.48; ctx.lineTo(bx + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.fill();
  } else if (deco === 'spiral') { // spirale
    ctx.strokeStyle = '#ff6a00'; ctx.lineWidth = 3; ctx.beginPath();
    for (let a = 0; a < 12; a += 0.2) ctx.lineTo(bx + Math.cos(a) * a * s * 0.035, y + Math.sin(a) * a * s * 0.035); ctx.stroke();
  } else if (deco === 'hat') { // chapeau de paille
    ctx.fillStyle = '#ffd56a'; ctx.strokeStyle = '#3a2000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(bx, y + s * 0.1, s * 0.5, s * 0.14, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(bx, y - s * 0.02, s * 0.27, s * 0.26, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d0101a'; ctx.fillRect(bx - s * 0.27, y - s * 0.04, s * 0.54, s * 0.08);
  } else if (deco === 'comic') { // éclat de BD
    ctx.fillStyle = '#ffe14d'; ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, rr = k % 2 ? s * 0.22 : s * 0.46; ctx.lineTo(bx + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (deco === 'claw') { // griffures à travers les lettres
    ctx.strokeStyle = 'rgba(10,0,20,0.85)'; ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x0 + tw * 0.3 + k * 11, y - s * 0.55); ctx.lineTo(x0 + tw * 0.42 + k * 11, y + s * 0.55); ctx.stroke(); }
  } else if (deco === 'glove' || deco === 'fist') { // gant de boxe / poing
    ctx.fillStyle = deco === 'glove' ? '#d0101a' : '#ffe0b0'; ctx.strokeStyle = '#200000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(bx, y, s * 0.34, s * 0.3, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = deco === 'glove' ? '#ffffff' : '#ffe0b0'; ctx.fillRect(bx - s * 0.48, y - s * 0.12, s * 0.16, s * 0.24); ctx.strokeRect(bx - s * 0.48, y - s * 0.12, s * 0.16, s * 0.24);
  } else if (deco === 'sword') { // épée couchée sous le nom
    ctx.fillStyle = '#e8eef8'; ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y + s * 0.6); ctx.lineTo(R + 10, y + s * 0.6); ctx.lineTo(R + 24, y + s * 0.66); ctx.lineTo(R + 10, y + s * 0.72); ctx.lineTo(x0, y + s * 0.72); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d8a020'; ctx.fillRect(x0 - 6, y + s * 0.5, 6, s * 0.32); ctx.fillRect(x0 - 24, y + s * 0.62, 18, s * 0.08);
  } else if (deco === 'bullets') { // impacts de balles
    ctx.fillStyle = '#0a0a0a'; ctx.strokeStyle = '#c8d8a0'; ctx.lineWidth = 1.5;
    for (const [dx, dy] of [[0.2, -0.2], [0.62, 0.15], [0.9, -0.1]]) { ctx.beginPath(); ctx.arc(x0 + tw * dx, y + s * dy, s * 0.07, 0, 7); ctx.fill(); ctx.stroke(); }
  } else if (deco === 'veins') { // veine saillante
    ctx.strokeStyle = 'rgba(255,60,40,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(R + 6, y - s * 0.4); ctx.lineTo(R + 14, y - s * 0.1); ctx.lineTo(R + 8, y + s * 0.15); ctx.lineTo(R + 18, y + s * 0.4); ctx.stroke();
  }
}

// ---------- Écran de sélection : une carte par personnage ----------
// Écran de sélection façon jeu de combat : le portrait du perso en fond, le perso en grand dans sa garde avec son
// aura, son nom et ses coups, et en bas un carrousel de médaillons qui glisse vers le perso choisi.
// À plusieurs, chaque joueur a son perso en vitrine (côte à côte) et sa marque de couleur sur le carrousel.
// Vitrine de la sélection : persos dont la garde paraît trop grande à côté des autres
const SEL_SIZE = {}; // correction de taille d'un perso dans la vitrine (la taille réelle du jeu suffit en général)
function drawSelect() {
  const n = CHAR_IDS.length, ps = [0, 1, 2, 3].filter(p => sel.joined[p]), focus = sel.focus || 0;
  const pickOf = p => sel.first[p] !== null && sel.ready[p] ? sel.first[p] : sel.pick[p];
  const varOf = p => sel.first[p] !== null && sel.ready[p] ? sel.firstVar[p] : sel.vari[p];
  const cid = charAt(sel.pick[focus], sel.vari[focus]), C = CHARS[cid], art = IMG[C.card];
  // Fond : portrait agrandi, assombri, teinté aux couleurs du perso, qui dérive lentement
  ctx.fillStyle = '#05030c'; ctx.fillRect(0, 0, W, H);
  if (art) {
    const s = H * 1.5 / art.height, [fx, fy] = FACES[C.card] || [0.5, 0.25];
    ctx.save(); ctx.globalAlpha = 0.45; ctx.filter = 'blur(2px)';
    ctx.drawImage(art, W * 0.62 - fx * art.width * s + Math.sin(sceneT * 0.3) * 20, H * 0.32 - fy * art.height * s, art.width * s, art.height * s);
    ctx.restore();
  }
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(5,3,12,0.92)'); g.addColorStop(0.45, C.colors[0] + '55'); g.addColorStop(1, 'rgba(5,3,12,0.7)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Rayons qui tournent et lignes de vitesse
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.translate(W * 0.3, H * 0.55); ctx.rotate(sceneT * 0.15);
  ctx.fillStyle = C.colors[1]; ctx.globalAlpha = 0.06;
  for (let r = 0; r < 16; r++) { ctx.rotate(Math.PI / 8); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(700, -60); ctx.lineTo(700, 60); ctx.fill(); }
  ctx.restore();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
  for (let k = 0; k < 18; k++) { const x = W + 200 - ((k * 173 + sceneT * 700) % (W + 400)), y = 70 + (k * 97) % 320; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 80 + (k % 4) * 30, y); ctx.stroke(); }
  ctx.restore();
  // Titre
  ctx.save(); ctx.fillStyle = 'rgba(10,0,25,0.75)'; ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(470, 14); ctx.lineTo(440, 56); ctx.lineTo(0, 56); ctx.fill();
  ctx.fillStyle = '#ffe14d'; ctx.fillRect(0, 56, 440, 3); ctx.restore();
  outlined('CHOISIS TON COMBATTANT', 22, 46, 30, '#ffe14d', 'left');
  if (OPTS.tag) outlined(ps.some(p => !sel.ready[p] && sel.first[p] !== null) ? 'CHOISIS TON PARTENAIRE DE RELAIS' : 'ÉQUIPE DE DEUX : choisis 2 combattants', W - 20, 44, 16, '#ffe14d', 'right');
  // Vitrine : un emplacement par joueur
  const slotW = Math.min(W * 0.62, W / ps.length), y0 = 400;
  ps.forEach((p, q) => {
    const id = charAt(pickOf(p), varOf(p)), P = CHARS[id], cx = ps.length === 1 ? W * 0.3 : slotW * (q + 0.5);
    // à plusieurs, l'étiquette de version passe derrière le perso (sa tête peut la chevaucher)
    if (ps.length > 1) drawVariantTag(pickOf(p), varOf(p), cx, 158, p);
    const S = SPRITES[P.sheet], A = S && (S.idle || S.combo || S.punch);
    if (A) {
      const i = S.idle ? Math.floor(sceneT * A.rate) % A.frames.length : 0, f = A.frames[i], img = IMG[f.src];
      const an = S.idle ? 'idle' : S.combo ? 'combo' : 'punch'; // même correction de taille qu'en jeu (ANIM_SIZE)
      // taille réelle du jeu (échelle de la planche), agrandie d'un même facteur pour tous : un perso accroupi ou en manteau
      // n'est plus étiré à la hauteur d'un perso debout (190 px en jeu = 300 px ici)
      const zoom = (ps.length === 1 ? 300 : ps.length === 2 ? 250 : 200) / 190;
      const h = f.h * A.scale / WORLD * zoom * (SEL_SIZE[id] || 1), k = h / f.h; // l'échelle inclut déjà CHAR_SIZE et ANIM_SIZE
      if (img) {
        const pulse = 1 + Math.sin(sceneT * 3 + q) * 0.03, bob = sel.ready[p] ? 0 : Math.sin(sceneT * 2.5 + q) * 2;
        // aura derrière le perso
        const ag = ctx.createRadialGradient(cx, y0 - h * 0.5, 10, cx, y0 - h * 0.5, h * 0.75 * pulse);
        ag.addColorStop(0, P.kiColor + 'aa'); ag.addColorStop(0.6, P.colors[0] + '44'); ag.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = ag; ctx.beginPath(); ctx.ellipse(cx, y0 - h * 0.5, h * 0.55 * pulse, h * 0.75 * pulse, 0, 0, 7); ctx.fill(); ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(cx, y0 + 2, h * 0.28, h * 0.05, 0, 0, 7); ctx.fill();
        ctx.save(); if (sel.flash > 0 && p === focus) ctx.filter = `brightness(${1 + sel.flash})`;
        ctx.drawImage(img, cx - f.ax * k, y0 - f.ay * k + bob, f.w * k, f.h * k); ctx.restore();
      }
    }
    if (ps.length > 1) {
      outlined(`J${p + 1}`, cx, 76, 18, COLORS_P[p]);
      outlined(P.name, cx, 104, 26, '#fff');
      drawAnimeTitle(id, cx, 132, ps.length > 2 ? 12 : 15);
    }
    if (sel.ready[p]) outlined('PRÊT !', cx, y0 - 120, 44, COLORS_P[p]);
  });
  // Fiche du perso (un seul joueur : grande fiche à droite)
  if (ps.length === 1) {
    const x = W * 0.56, slide = sel.flash * 40;
    drawAnimeTitle(cid, x + 4 + slide, 74, 30, true); // plus grand, et décollé du nom du perso
    outlined(C.name, x + slide, 150, 64, '#fff', 'left');
    drawVariantTag(sel.pick[focus], sel.vari[focus], W * 0.3, 80, focus);
    outlined(C.title, x + 4 + slide, 184, 20, C.colors[1], 'left');
    C.stats.forEach(([label, v], r) => {
      const yy = 214 + r * 28;
      ctx.fillStyle = '#e4e6ff'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(label, x + 4, yy + 13);
      for (let q = 0; q < 5; q++) {
        ctx.fillStyle = q < v ? C.colors[1] : 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.moveTo(x + 120 + q * 34, yy + 16); ctx.lineTo(x + 130 + q * 34, yy); ctx.lineTo(x + 152 + q * 34, yy); ctx.lineTo(x + 142 + q * 34, yy + 16); ctx.fill();
      }
    });
    ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = '#ffd6e8';
    ctx.fillText(`SPÉCIAL : ${C.labels.blast}`, x + 4, 318); ctx.fillText(`ULTIME : ${C.labels.ultra}`, x + 4, 342);
    if (C.forms?.[0]) ctx.fillText(`TRANSFORMATION : ${C.forms.map(F => F.name).join(' → ')}`, x + 4, 366);
  }
  // Bandeau de vignettes inclinées (façon jeu de combat), qui glisse : la carte choisie est plus grande et lumineuse
  const cy = 452, tw = 66, th = 86, gap = 8, SK = -0.22, items = [];
  for (let k = 0; k < n; k++) {
    let d = k - sel.cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
    if (Math.abs(d) <= 7) items.push([k, d]);
  }
  items.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  // rail sombre derrière les vignettes
  ctx.save(); ctx.fillStyle = 'rgba(5,0,15,0.6)'; ctx.fillRect(0, cy - 42, W, 84); ctx.fillStyle = C.colors[1]; ctx.fillRect(0, cy - 43, W, 2); ctx.fillRect(0, cy + 41, W, 2); ctx.restore();
  for (const [k, d] of items) {
    const P = CHARS[k === sel.pick[focus] ? cid : CHAR_IDS[k]], img = IMG[P.card], on = Math.abs(d) < 0.5, ad = Math.abs(d);
    const sc = on ? 1.3 : 1 - Math.min(0.25, ad * 0.03), w = tw * sc, h = th * sc;
    const x = W / 2 + d * (tw + gap) + Math.sign(d) * (ad > 0.5 ? 14 : 0), y = cy - (on ? 8 + Math.sin(sceneT * 4) * 2 : 0);
    ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, SK, 1, 0, 0);
    ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.save(); ctx.clip();
    const g2 = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g2.addColorStop(0, P.colors[0]); g2.addColorStop(1, '#12031f');
    ctx.fillStyle = g2; ctx.fillRect(-w / 2, -h / 2, w, h);
    if (img) {
      ctx.transform(1, 0, -SK, 1, 0, 0); // portrait redressé dans le cadre incliné
      const [fx, fy, fk] = FACES[P.card] || [0.5, 0.2, 4], s2 = h * 0.55 * fk / img.height;
      ctx.drawImage(img, -img.width * s2 * fx, -h * 0.05 - img.height * s2 * fy, img.width * s2, img.height * s2);
    }
    ctx.restore();
    if (!on) { ctx.fillStyle = `rgba(5,0,15,${Math.min(0.65, 0.25 + ad * 0.07)})`; ctx.fillRect(-w / 2, -h / 2, w, h); }
    const who = ps.filter(p => sel.pick[p] === k);
    ctx.lineWidth = on ? 4 : 2; ctx.strokeStyle = who.length ? COLORS_P[who[0]] : on ? '#ffe14d' : 'rgba(255,255,255,0.35)';
    if (on || who.length) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = on ? 18 : 8; }
    ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.shadowBlur = 0;
    ctx.restore();
    who.forEach((p, q) => outlined(`J${p + 1}`, x + (q - (who.length - 1) / 2) * 26, y - h / 2 - 6, 13, COLORS_P[p]));
  }
  // début de chaque famille : un trait et le nom de la série au-dessus du bandeau
  for (const [k, d] of items) {
    const prev = CHAR_IDS[(k - 1 + n) % n];
    if (familyOf(prev) === familyOf(CHAR_IDS[k])) continue;
    const x = W / 2 + d * (tw + gap) + Math.sign(d) * (Math.abs(d) > 0.5 ? 14 : 0) - (tw + gap) / 2 - 6;
    if (x < 10 || x > W - 30) continue;
    ctx.save(); ctx.strokeStyle = 'rgba(255,225,77,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 10, cy - 40); ctx.lineTo(x - 10, cy + 40); ctx.stroke(); ctx.restore();
    const A = animeOf(CHAR_IDS[k]);
    if (A) { ctx.save(); ctx.font = 'italic 900 11px Impact, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(5,0,15,0.75)'; const tw2 = ctx.measureText(A.name).width; ctx.fillRect(x + 4, cy - 62, tw2 + 10, 15); ctx.fillStyle = '#ffe14d'; ctx.fillText(A.name, x + 9, cy - 51); ctx.restore(); }
  }
  const pulse = 1 + Math.sin(sceneT * 6) * 0.12;
  outlined('◀', 18 - pulse * 3, cy + 28, 30 * pulse, '#ffe14d');
  outlined('▶', W - 18 + pulse * 3, cy + 28, 30 * pulse, '#ffe14d');
  // Aide en bas d'écran
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 30, W, 30);
  ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfd3ff';
  ctx.fillText(`${K('left')} ${K('right')} choisir${variantsOf(sel.pick[focus]).length > 1 ? `    ${K('up')} ${K('down')} version` : ''}    ${K('punch')} valider    ${K('kick')} annuler${ps.length < 4 ? `    —    autres joueurs : ${K('punch', 1)} (pavé) ou A sur une manette${net.role === 'host' ? `   —   code en ligne : ${net.code}` : ''}` : ''}`, W / 2, H - 10);
  if (sel.go > 0) outlined('EN AVANT !', W / 2, H / 2 - 20, 70 + sel.go * 30, '#ffe14d');
}

// Étiquette « ▲ ENFANT ▼ » de la case qui a plusieurs versions (rien sinon)
function drawVariantTag(k, v, cx, y, p) {
  const V = variantsOf(k);
  if (V.length < 2) return;
  const id = V[Math.min(v || 0, V.length - 1)], label = VARIANT_LABEL[id] || CHARS[id].name, bob = Math.sin(sceneT * 5) * 2;
  ctx.save(); ctx.font = 'italic 900 15px Impact, sans-serif';
  const w = ctx.measureText(label).width + 56;
  ctx.fillStyle = 'rgba(10,0,25,0.78)'; ctx.strokeStyle = COLORS_P[p]; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + 8, y - 13); ctx.lineTo(cx + w / 2 + 4, y - 13); ctx.lineTo(cx + w / 2 - 8, y + 13); ctx.lineTo(cx - w / 2 - 4, y + 13); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  outlined(label, cx, y + 6, 15, '#fff');
  outlined('▲', cx - w / 2 + 12, y + 5 - bob, 12, COLORS_P[p]); outlined('▼', cx + w / 2 - 12, y + 5 + bob, 12, COLORS_P[p]);
  V.forEach((_, i) => { ctx.fillStyle = i === (v || 0) ? '#fff' : 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(cx + (i - (V.length - 1) / 2) * 10, y + 20, 2.5, 0, 7); ctx.fill(); });
}

// La carte est dessinée à sa taille de référence (w × h) puis réduite de S pour tenir dans la grille.
function drawCard(k, x, y, w, h, S = 1) {
  const C = CHARS[CHAR_IDS[k]];
  const who = [0, 1, 2, 3].filter(p => sel.joined[p] && sel.pick[p] === k), on = who.length > 0;
  const firsts = [0, 1, 2, 3].filter(p => sel.joined[p] && sel.first[p] === k);
  const lift = on ? -8 + Math.sin(sceneT * 4) * 3 : 0;
  ctx.save();
  ctx.translate(x + w * S / 2, y + h * S / 2 + lift);
  ctx.scale(S * (on ? 1.06 : 1), S * (on ? 1.06 : 1));
  const L = -w / 2, T = -h / 2, SK = -0.14, BAND = T + h - 104; // haut du bandeau du nom
  // Carte inclinée, comme dans les jeux de combat
  ctx.transform(1, 0, SK, 1, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(L + 12, T + 14, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(L, T, w, h); ctx.clip();
  const g = ctx.createLinearGradient(0, T, 0, T + h);
  g.addColorStop(0, C.colors[0]); g.addColorStop(0.65, '#3a0a3a'); g.addColorStop(1, '#12031f');
  ctx.fillStyle = g; ctx.fillRect(L, T, w, h);
  // Rayons qui tournent derrière le personnage
  ctx.save(); ctx.translate(0, T + h * 0.35); ctx.rotate(sceneT * (on ? 0.6 : 0.15));
  ctx.fillStyle = C.colors[1]; ctx.globalAlpha = on ? 0.22 : 0.1;
  for (let r = 0; r < 12; r++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(400, -40); ctx.lineTo(400, 40); ctx.fill(); }
  ctx.restore();
  // Trame de points façon manga
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let yy = T; yy < T + h; yy += 10) for (let xx = L + ((yy / 10) % 2) * 5; xx < L + w; xx += 10) ctx.fillRect(xx, yy, 2, 2);
  // Portrait (redressé, l'inclinaison ne s'applique qu'au cadre)
  const img = IMG[C.card];
  if (img) {
    ctx.save(); ctx.transform(1, 0, -SK, 1, 0, 0);
    // cadrage sur le visage (FACES) : visage au centre, à la même hauteur sur toutes les cartes ;
    // les cartes en pied (zoom plus fort dans FACES) sont agrandies d'autant
    const [fx, fy, fk] = FACES[C.card] || [0.5, 0.2, 4.4];
    const s = (h - 70) / img.height * clamp(fk / 4.4, 1, 2.1), iw = img.width * s, ih = img.height * s;
    let ix = 6 - fx * iw, iy = T + (BAND - T) * 0.42 - fy * ih;
    if (iw >= w) ix = clamp(ix, L + w - iw - w * 0.15, L + w * 0.15); // le bord de l'image ne rentre pas trop dans la carte
    iy = Math.max(iy, BAND + 4 - ih);               // ni de vide sous le buste
    ctx.drawImage(img, ix, iy, iw, ih);
    ctx.restore();
  }
  if (!on) { ctx.fillStyle = 'rgba(5,0,20,0.5)'; ctx.fillRect(L, T, w, h); }
  // Bandeau du nom, des caractéristiques et des coups spéciaux
  ctx.fillStyle = 'rgba(10,2,25,0.9)'; ctx.fillRect(L, BAND, w, 104);
  ctx.fillStyle = C.colors[1]; ctx.fillRect(L, BAND, w, 4);
  outlined(C.name, L + 16, BAND + 36, 32, '#fff', 'left');
  ctx.font = 'italic bold 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = C.colors[1];
  ctx.fillText(C.title, L + 18, BAND + 55);
  C.stats.forEach(([label, v], r) => {
    const yy = BAND + 66 + r * 13;
    ctx.fillStyle = '#e4e6ff'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(label, L + 18, yy + 8);
    for (let q = 0; q < 5; q++) { ctx.fillStyle = q < v ? C.colors[1] : 'rgba(255,255,255,0.15)'; ctx.fillRect(L + 92 + q * 20, yy, 16, 7); }
  });
  ctx.restore();
  // Cadre : couleur du ou des joueurs qui ont choisi cette carte
  ctx.lineWidth = on ? 5 : 2;
  if (on) {
    const b = ctx.createLinearGradient(L, 0, L + w, 0);
    b.addColorStop(0, COLORS_P[who[0]]); b.addColorStop(1, COLORS_P[who[who.length - 1]]);
    ctx.strokeStyle = b; ctx.shadowColor = COLORS_P[who[0]]; ctx.shadowBlur = 22;
  } else ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(L, T, w, h);
  ctx.shadowBlur = 0;
  // Validé : tampon « PRÊT ! »
  const ready = who.filter(p => sel.ready[p]);
  if (ready.length) {
    ctx.save(); ctx.translate(0, T + h * 0.42); ctx.rotate(-0.25);
    outlined('PRÊT !', 0, 0, 46, COLORS_P[ready[0]]);
    ctx.restore();
  }
  ctx.restore();
  // Pastilles J1 / J2 au-dessus de la carte
  who.forEach((p, q) => {
    const bx = x + w * S / 2 + (q - (who.length - 1) / 2) * 62, by = y + lift - 12;
    ctx.fillStyle = COLORS_P[p];
    ctx.beginPath(); ctx.moveTo(bx - 26, by - 16); ctx.lineTo(bx + 26, by - 16); ctx.lineTo(bx + 26, by + 4); ctx.lineTo(bx + 6, by + 4); ctx.lineTo(bx, by + 12); ctx.lineTo(bx - 6, by + 4); ctx.lineTo(bx - 26, by + 4); ctx.fill();
    ctx.fillStyle = '#120420'; ctx.font = 'italic 900 16px Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`J${p + 1}`, bx, by + 1);
  });
  // Combattant déjà choisi (équipe de deux) : marque « J1 ★ »
  firsts.forEach((p, q) => outlined(`J${p + 1} ★`, x + 20 + q * 50, y + h * S - 8, 16, COLORS_P[p], 'left'));
}

function draw() {
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (scene === 'loading') { ctx.fillStyle = '#05030c'; ctx.fillRect(0, 0, W, H); outlined('CHARGEMENT…', W / 2, H / 2, 40); return; }
  if (scene === 'title') { drawTitle(); return; }
  if (scene === 'select') { drawSelect(); return; }
  if (scene === 'levels') { drawLevels(); return; }
  if (drawModes()) return;
  if (gameLoading && scene === 'play') {
    ctx.fillStyle = '#05030c'; ctx.fillRect(0, 0, W, H);
    outlined('CHARGEMENT…', W / 2, H / 2 - 10, 40);
    const k = gameLoading.done / Math.max(1, gameLoading.total);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(W / 2 - 200, H / 2 + 30, 400, 10);
    ctx.fillStyle = '#ffe14d'; ctx.fillRect(W / 2 - 200, H / 2 + 30, 400 * k, 10);
    return;
  }

  const s = shake > 0.5 ? shake : 0;
  ctx.setTransform(RES, 0, 0, RES, rand(-s, s) * RES, rand(-s, s) * RES);
  drawBackground();
  superDim();
  drawKirinBack();
  drawFX(true);
  // Du plus au fond au plus en avant ; un corps au sol passe derrière ceux qui sont debout sur la même ligne
  const all = [
    ...enemies.map(e => ({ z: e.gz - (e.state === 'down' ? 6 : 0), f: () => drawEnemy(e) })),
    ...players.map(h => ({ z: h.gz + 0.5 - (h.out ? 6 : 0), f: () => drawPlayer(h) })),
    ...clones.map(c => ({ z: c.gz + 0.4, f: () => drawClone(c) })),
    ...levelDrawables(),
  ];
  all.sort((a, b) => a.z - b.z).forEach(o => o.f());
  drawStars();
  drawWaves();
  for (const b of bombs) drawBomb(b);
  drawDarkFX();
  drawProjs();
  drawWhips();
  drawZaps(1 / 60);
  drawFX();
  drawKirinFront();
  drawParticles();
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash)})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  drawHUD();

  drawEndlessHud();
  if (scene === 'gameover' && isEndless()) {
    // mode infini : score final et tableau des scores du monde
    ctx.fillStyle = `rgba(20,0,30,${Math.min(sceneT, 0.75)})`; ctx.fillRect(0, 0, W, H);
    outlined('FIN DE LA PARTIE', W / 2, 60, 48, '#ff3355');
    outlined(`SCORE ${score}  ·  TOUR ${ENDLESS.tour}  ·  ${ENDLESS.wave} VAGUES`, W / 2, 100, 22, '#fff');
    if (ENDLESS.lastRank === 0) outlined('NOUVEAU RECORD DU MONDE !', W / 2, 128, 20, '#ffe14d');
    drawScoreboard(LVL.id, 170);
    if (sceneT > 1.5) outlined('ENTRÉE : rejouer ce monde     ÉCHAP : titre', W / 2, H - 16, 18);
  } else if (scene === 'gameover') {
    ctx.fillStyle = `rgba(40,0,10,${Math.min(sceneT, 0.6)})`; ctx.fillRect(0, 0, W, H);
    outlined('GAME OVER', W / 2, H / 2 - 10, 90, '#ff3355');
    if (sceneT > 1.5) outlined(gameMode === 'story' ? 'ENTRÉE : retour au plateau pour réessayer' : 'ENTRÉE pour revenir au titre', W / 2, H / 2 + 60, 26);
  }
  if (scene === 'clear') {
    ctx.fillStyle = `rgba(0,10,40,${Math.min(sceneT, 0.5)})`; ctx.fillRect(0, 0, W, H);
    outlined('NIVEAU TERMINÉ !', W / 2, H / 2 - 10, 80, '#7ff0ff');
    if (sceneT > 1.5) outlined(`Score : ${score} — ENTRÉE`, W / 2, H / 2 + 60, 26);
  }
}

// Grondement d'aura pendant la charge et la transformation, plus discret une fois transformé
function updateLoops() {
  if (anyPressed('mute')) audio.toggleMute();
  audio.musicTick(['play', 'clear'].includes(scene), paused || scene === 'clear');
  const live = scene === 'play' && !paused && players;
  audio.loop('charge', live && players.some(h => ['charge', 'transform'].includes(h.state)), 'aura', 0.8);
  audio.loop('gold', live && players.some(h => h.boost), 'aura', 0.22, 1.3);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  pollPad();
  update(dt);
  updateLoops();
  draw();
  INPUT.forEach(I => I.pressed.clear());
  requestAnimationFrame(frame);
}

resetGame();
loadAll().then(() => { scene = 'title'; sceneT = 0; warmLevelLayers(); });
requestAnimationFrame(frame);
