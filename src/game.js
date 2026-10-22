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
  for (const [k, src] of Object.entries(ASSETS.ui)) if (!k.startsWith('intro_')) jobs.push(want(k, src)); // présentations : à la demande
  if (typeof FX !== 'undefined') for (const list of Object.values(FX)) for (const f of list) jobs.push(want(f.src, f.src));
  for (const C of Object.values(CHARS)) jobs.push(want(C.card, `assets/ui/${C.card}.png`)); // gros plans d'ultime : à la demande
  for (const L of LEVELS) for (const key of levelPreviewKeys(L)) jobs.push(want('pv_' + key, `assets/web/preview/${key}.webp`));
  return Promise.all(jobs);
}
const levelPreviewKeys = L => [L.zones[0].sky || L.sky, L.zones[0].mid, L.zones[0].ground, ...(L.far ? ['far'] : [])].filter(Boolean);
// Planches de sprites d'un personnage (avec ses formes) et d'un niveau (ennemis, boss et renforts)
const charSheets = id => { const C = CHARS[id]; return C ? [C.sheet, ...(C.forms || []).map(F => F.sheet).filter(Boolean)] : []; };
function levelNeeds(L) {
  const types = new Set(['thug', 'ninja', 'brute', L.extra, L.boss, ...(ETYPES[L.boss]?.adds || [])]);
  for (const w of L.waves || []) for (const t of w.foes) types.add(t);
  const known = [...types].filter(t => t && ETYPES[t]), sheets = known.map(t => ETYPES[t].sheet || t);
  const bgs = new Set([L.sky, ...(L.far ? ['far'] : [])]);
  for (const Z of L.zones) for (const k of [Z.sky, Z.mid, Z.ground]) if (k) bgs.add(k);
  for (const k of GATES[L.id] || []) bgs.add(k);
  return { sheets, bgs: [...bgs].filter(k => ASSETS.backgrounds[k]), intros: known.map(t => 'intro_' + t).filter(k => ASSETS.ui[k]) };
}
let gameLoading = null; // { done, total } pendant le chargement d'une partie
function requireGame(chars, L) {
  const sheets = new Set([...chars.flatMap(charSheets), ...levelNeeds(L).sheets]);
  const frames = [...sheets].flatMap(sh => Object.values(SPRITES[sh] || {}).flatMap(a => a.frames.map(f => f.src)));
  const { bgs, intros } = levelNeeds(L), cuts = chars.map(id => 'cutin_' + id);
  // on libère les sprites, décors et images de présentation qui ne servent plus (mémoire du téléphone)
  const keep = new Set([...frames, ...bgs, ...intros, ...cuts]);
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
  ['punch', 'Poing'], ['kick', 'Pied'], ['blast', 'Coup spécial'], ['dash', 'Dash'],
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
addEventListener('keyup', e => { const m = KEYMAP[e.code]; if (m) INPUT[m[0]].keys.delete(m[1]); });

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
const MENU_ROWS = ACTIONS.length + 4, ROW_DEFAULT = ACTIONS.length + 1, ROW_RESUME = ACTIONS.length + 2;

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
  const x0 = 170, xk = 520, xp = 720, top = 64, rh = 20, B = binds[menu.p];
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
      ctx.fillText(r === ROW_DEFAULT ? `↺  Commandes par défaut (joueur ${menu.p + 1})` : r === ROW_RESUME ? (scene === 'options' ? '▶  Retour aux options' : '▶  Reprendre la partie') : (scene === 'options' ? '' : '✕  Quitter la partie (écran titre)'), x0, y + 14);
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
    if (typeof SOUNDS === 'undefined') return;
    for (const [k, list] of Object.entries(SOUNDS))
      this.buf[k] = await Promise.all(list.map(uri => {
        const bin = atob(uri.split(',')[1]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return this.ctx.decodeAudioData(bytes.buffer);
      }));
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
    const target = this.muted || !on ? 0 : MUSIC.volume * (quiet ? 0.35 : 1);
    m.volume = clamp(m.volume + Math.sign(target - m.volume) * 0.02, 0, 1); // fondu
    if (Math.abs(m.volume - target) < 0.02) m.volume = target;
    if (on && m.paused && !this.muted) m.play().catch(() => {});
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
const MOVES = {
  punch:      { dur: 0.30, on: 0.06, off: 0.17, cancel: 0.17, reach: [20, 105], y: [-150, -95], dmg: 1, kb: 160, ki: 6 },
  cross:      { dur: 0.32, on: 0.05, off: 0.16, cancel: 0.17, reach: [20, 115], y: [-150, -95], dmg: 1, kb: 190, ki: 6 },
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
// Planches de combo refaites : genou armé puis pied tendu (5-6), circulaire haut (7), retourné sauté (8)
const NEWKICK = M => ({ ...M, kick: { ...M.kick, p: ['combo', [4, 5], [0.08]] }, roundhouse: { ...M.roundhouse, p: ['combo', [6]] }, spinback: { ...M.spinback, p: ['combo', [7]] } });
Object.assign(K_MOVES, NEWKICK(K_MOVES));
// Kakashi : taijutsu, Chidori, Kamui
const KA_MOVES = { ...FIST,
  dash:    { dur: 0.55, on: 0.12, off: 0.40, reach: [-60, 120], y: [-160, -50], dmg: 3, kb: 380, ki: 8, launch: -450, push: 1200, pushAt: 0.08, pushDur: 0.3, ghost: true, xcut: true, call: 'SHUNSHIN !', p: ['dashcharge', [0, 1, 2, 3], [0.08, 0.3, 0.48]] },
  chidori: { dur: 0.95, cost: 35, on: 0.38, off: 0.75, reach: [0, 140], y: [-170, -60], dmg: 5, kb: 650, ki: 0, launch: -650, push: 1450, pushAt: 0.36, pushDur: 0.32,
             orbFx: 'chidori', orb: [0, 0.78], bolts: true, stopOnHit: true, call: 'CHIDORI !', p: ['special', [0, 1, 2, 3], [0.36, 0.55, 0.82]] },
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
  galick: { dur: 1.3, cost: 35, beam: { at: 0.5, end: 1.15, len: 900, dmg: 0.55, color: '#c27bff', filter: 'hue-rotate(75deg) saturate(1.4)' }, call: 'GALICK GUN !', p: ['special', [0, 1, 2, 3], [0.22, 0.5, 1.18]] },
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
  punch:    { ...FIST.punch, p: ['combo', [0, 1], [0.04]] },
  cross:    { ...FIST.cross, p: ['combo', [2]] },
  uppercut: { ...FIST.uppercut, p: ['combo', [3]], dmg: 2.5 },
  kick:     { ...FIST.kick, p: ['combo', [4]], y: [-140, -80] },
  roundhouse: { ...FIST.roundhouse, p: ['combo', [5]], y: [-140, -80] },
  spinback: { ...FIST.spinback, p: ['combo', [6, 7], [0.14]], launch: -820, call: 'GAZELLE PUNCH !' },
  ckick:    { ...FIST.ckick, y: [-90, -20] }, airkick: FIST.airkick,
  dash:     { dur: 0.5, on: 0.12, off: 0.36, reach: [0, 120], y: [-150, -60], dmg: 3, kb: 420, ki: 8, launch: -480, push: 1000, pushAt: 0.05, pushDur: 0.3, p: ['dashcharge', [0, 1, 2, 3], [0.06, 0.2, 0.4]] },
  dempsey:  { dur: 1.7, cost: 35, on: 0.25, off: 1.55, multi: 0.13, reach: [0, 150], y: [-160, -60], dmg: 0.75, kb: 60, ki: 0, push: 220, pushAt: 0.2, pushDur: 1.4, keepPush: true,
              cyc: { anim: 'special', frames: [1, 2, 3, 4, 5], fps: 9, from: 0.2, to: 1.45, last: 7 }, call: 'DEMPSEY ROLL !', p: ['special', [0]] },
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
const KI = { transform: 50, ultra: 90, chargeRate: 32, regen: 4, goldDrain: 6 };

// Fiche de chaque personnage. Pour en ajouter un : ses planches dans tools/slice_sheets.py,
// son portrait (ui/card_<nom>.png), ses coups, ses formes, son ultime et sa fonction de poses.
// forms : transformations, la plus forte permise par le ki. Une forme a sa planche (sheet) ou une teinte (filter).
const CHARS = {
  hero: {
    name: 'KUNG-FU', title: 'Le maître de Néo-Tokyo', sheet: 'hero', card: 'card_hero',
    colors: ['#ff2d55', '#ffb13b'], kiColor: '#7fdcff', hit: '#ffe066', stats: [['PUISSANCE', 4], ['VITESSE', 3], ['PORTÉE', 2]],
    labels: { blast: "VAGUE D'ÉNERGIE", ultra: 'SPHÈRE ULTIME' },
    forms: [{ ki: 50, name: 'FORME DORÉE', sheet: 'gold', speed: 1.2, dmg: 1.6, at: 0.95, end: 1.35, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066' }],
    moves: MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'spinkick', 'roundhouse'] },
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
    moves: L_MOVES, chain: { punch: ['punch', 'punch2', 'gatling'], kick: ['kick', 'whip', 'axe'] },
    special: 'bazooka', speed: 265, pose: luffyPose, ultra: [startGigant, updateGigant],
  },
  goku: {
    name: 'SANGOKU', title: 'Le saiyan au grand cœur', sheet: 'goku', card: 'card_goku',
    colors: ['#ff7a1a', '#3a6bff'], kiColor: '#8fe9ff', hit: '#bff3ff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'KAMEHAMEHA', ultra: 'GENKIDAMA' },
    // Super Saiyan : cheveux dorés (planches à part), plus rapide et plus fort tant qu'il reste du ki
    forms: [{ ki: 50, name: 'SUPER SAIYAN', sheet: 'goku_ssj', speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066', hit: '#fff3b0' }],
    moves: GK_MOVES, chain: { punch: ['punch', 'cross', 'kiburst', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback', 'telekick'] },
    special: 'kamehameha', speed: 260, pose: stdPose, ultra: [startGenki, updateGenki], ultraPose: genkiPose,
  },
  zoro: {
    name: 'ZORO', title: 'Le sabreur aux trois lames', sheet: 'zoro', card: 'card_zoro',
    colors: ['#1f8a3a', '#e8f5d0'], kiColor: '#b8ffcf', hit: '#e8fff0', trail: '#e9fff2', stats: [['PUISSANCE', 5], ['VITESSE', 3], ['PORTÉE', 4]],
    labels: { blast: '36 POUND HO', ultra: 'SANZEN SEKAI' },
    forms: [{ ki: 50, name: 'ASURA', filter: 'contrast(1.2) brightness(0.92) saturate(1.2)', speed: 1.2, dmg: 1.8, at: 0.6, end: 1.0, aura: ['rgba(120,20,90,0.55)', '#b04bff'], ghosts: true, bar: ['#6a1b8a', '#d08bff'], color: '#c070ff', trail: '#e3b8ff' }],
    moves: Z_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'] },
    special: 'poundho', speed: 240, pose: stdPose, ultra: [startSanzen, updateSanzen], chargeFrame: 6,
    ultraPose: h => h.t < SANZEN.spin ? ['special', 4 + Math.floor(h.t * 14) % 3] : h.t < SANZEN.dash ? ['dashcharge', 1] : ['dashcharge', h.t < SANZEN.dash + 0.25 ? 2 : 3],
  },
  naruto: {
    name: 'NARUTO', title: 'Le ninja de Konoha', sheet: 'naruto', card: 'card_naruto',
    colors: ['#ff8a00', '#2a5cff'], kiColor: '#8fd0ff', hit: '#cfeaff', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'MULTI-CLONAGE', ultra: 'KURAMA' },
    // La rage : le manteau de chakra rouge du démon renard, avec ses queues
    forms: [{ ki: 50, name: 'CHAKRA DU RENARD', filter: 'sepia(0.3) saturate(1.5) hue-rotate(-20deg) brightness(1.04) drop-shadow(0 0 5px rgba(255,20,0,0.95)) drop-shadow(0 0 12px rgba(230,0,0,0.7))', speed: 1.3, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(255,40,20,0.55)', '#ff3a1a'], foxCloak: 3, bar: ['#c01010', '#ff8a50'], color: '#ff3a1a', hit: '#ffb090' }],
    moves: N_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'sidekick', 'axekick'] },
    special: 'bunshin', speed: 280, pose: stdPose, ultra: [startKyubi, updateKyubi],
    ultraPose: h => ['special', h.t < 0.6 ? 4 : h.t < KYU.charge ? 5 : h.t < KYU.charge + 0.3 ? 6 : 7],
  },
  tanjiro: {
    name: 'TANJIRO', title: 'Le pourfendeur de démons', sheet: 'tanjiro', card: 'card_tanjiro',
    colors: ['#1f6f5a', '#5ad1ff'], kiColor: '#8fe0ff', hit: '#bdf0ff', trail: '#5ad1ff', element: 'water', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'SURFACE DE L\'EAU', ultra: 'DANSE DU DIEU DU FEU' },
    forms: [{ ki: 50, name: 'HINOKAMI KAGURA', filter: 'sepia(0.3) saturate(1.5) hue-rotate(-12deg) brightness(1.06)', speed: 1.2, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,110,20,0.5)', '#ff8a2a'], flames: true, bar: ['#ff5a00', '#ffd060'], color: '#ff8a2a', trail: '#ff8a2a', element: 'fire', hit: '#ffd0a0' }],
    moves: T_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'] },
    special: 'surface', speed: 255, pose: stdPose, ultra: [startHinokami, updateHinokami],
    ultraPose: h => ['special', 4 + step(h.t, [0.4, 0.8, 1.2])],
  },
  kenshin: {
    name: 'KENSHIN', title: 'Le vagabond au sabre inversé', sheet: 'kenshin', card: 'card_kenshin',
    colors: ['#c2185b', '#ffe0ef'], kiColor: '#ffc0dc', hit: '#ffe0ef', trail: '#ffd6e8', stats: [['PUISSANCE', 4], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'DO RYU SEN', ultra: 'AMAKAKERU RYU' },
    forms: [{ ki: 50, name: 'BATTOSAI', filter: 'contrast(1.18) saturate(0.85) brightness(0.92)', speed: 1.25, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(150,0,30,0.5)', '#ff3355'], bar: ['#8a0020', '#ff5070'], color: '#ff3355', trail: '#ff5070', hit: '#ffb0c0' }],
    moves: KS_MOVES, chain: { punch: ['punch', 'cross', 'ryusho'], kick: ['kick', 'ryukan', 'ryutsui'] },
    special: 'doryu', speed: 275, pose: stdPose, ultra: [startAmakakeru, updateAmakakeru],
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < AMA.dash ? 5 : h.t < AMA.dashEnd ? 6 : 7],
  },
  kakashi: {
    name: 'KAKASHI', title: 'Le ninja copieur', sheet: 'kakashi', card: 'card_ka',
    colors: ['#4a6b8a', '#9fd0ff'], kiColor: '#9fd0ff', hit: '#cfe8ff', stats: [['PUISSANCE', 4], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'CHIDORI', ultra: 'KAMUI' },
    forms: [{ ki: 50, name: 'SHARINGAN', filter: 'contrast(1.12) saturate(1.2)', speed: 1.25, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(200,20,40,0.45)', '#ff3a4a'], bar: ['#a0001a', '#ff6070'], color: '#ff3a4a',
             glow: '#ff2a3a', arcs: 'hue-rotate(95deg) saturate(1.2) brightness(1.2)', handArcs: true }],
    moves: KA_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'chidori', speed: 265, pose: stdPose, ultra: [startKamui, updateKamui], chargeFrame: 5,
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.8 ? 5 : h.t < 1.8 ? 6 : 7],
  },
  ichigo: {
    name: 'ICHIGO', title: 'Le shinigami remplaçant', sheet: 'ichigo', card: 'card_ic',
    colors: ['#1a1a24', '#ff8a2a'], kiColor: '#bfe8ff', hit: '#e8f6ff', trail: '#cfeeff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'GETSUGA TENSHO', ultra: 'MUGETSU' },
    forms: [{ ki: 50, name: 'BANKAI', filter: 'contrast(1.25) brightness(0.86)', speed: 1.45, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(120,0,20,0.6)', '#ff2030'], bar: ['#3a0008', '#ff3040'], color: '#ff2030', trail: '#ff5060', hit: '#ffb0b0', proj: 'hue-rotate(160deg) saturate(1.6) brightness(0.9)' }],
    moves: IC_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'] },
    special: 'getsuga', speed: 255, pose: stdPose, ultra: [startMugetsu, updateMugetsu],
    ultraPose: h => ['special', step(h.t, [0.35, 0.7, 1.4]) + 4],
  },
  zenitsu: {
    name: 'ZENITSU', title: 'Le souffle de la foudre', sheet: 'zenitsu', card: 'card_ze',
    colors: ['#f2b705', '#fff3a0'], kiColor: '#ffe680', hit: '#fff6b0', trail: '#ffe14d', element: 'thunder', stats: [['PUISSANCE', 3], ['VITESSE', 5], ['PORTÉE', 4]],
    labels: { blast: 'HEKIREKI ISSEN', ultra: 'SHINSOKU' },
    forms: [{ ki: 50, name: 'ENDORMI', filter: 'brightness(1.08) saturate(1.2)', speed: 1.55, dmg: 1.6, at: 0.6, end: 1.0, aura: ['rgba(255,220,60,0.5)', '#ffe14d'], sparks: '#fff6b0', bar: ['#d0a000', '#fff07a'], color: '#ffe14d' }],
    moves: ZE_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'] },
    special: 'hekireki', speed: 270, pose: stdPose, ultra: [startZigzag, updateZigzag], chargeFrame: 5,
    ultraPose: h => h.zz && h.t > ZIG.start ? ['special', 6 + Math.floor(h.t * 10) % 2] : ['special', 4 + step(h.t, [0.3])],
  },
  izuku: {
    name: 'IZUKU', title: 'Le héros One For All', sheet: 'izuku', card: 'card_iz',
    colors: ['#1d6b45', '#7dff9a'], kiColor: '#9dffb0', hit: '#d8ffe0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'BLACK WHIP', ultra: 'UNITED STATES OF SMASH' },
    forms: [{ ki: 50, name: 'DARK DEKU', sheet: 'izuku_dark', speed: 1.45, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(20,120,60,0.55)', '#3dff7a'], arcs: true, bar: ['#0a4a24', '#5dff8a'], color: '#3dff7a' }],
    moves: IZ_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'blackwhip', speed: 265, pose: stdPose, ultra: [startSmash, updateSmash],
    ultraPose: h => ['special', h.t < 0.5 ? 4 : h.t < SMASH.hit - 0.1 ? 5 : h.t < SMASH.hit + 0.4 ? 6 : 7],
  },
  vegeta: {
    name: 'VEGETA', title: 'Le prince des saiyans', sheet: 'vegeta', card: 'card_ve',
    colors: ['#2a2f8a', '#ffd23b'], kiColor: '#c9a0ff', hit: '#e8d0ff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'GALICK GUN', ultra: 'FINAL FLASH' },
    forms: [{ ki: 50, name: 'SUPER SAIYAN', sheet: 'vegeta_ssj', speed: 1.3, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(255,220,90,0.6)', '#ffd84a'], sparks: true, bar: ['#ffb300', '#fff07a'], color: '#ffe066', hit: '#fff3b0' }],
    moves: VE_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'galick', speed: 255, pose: stdPose, ultra: [startFinalFlash, updateFinalFlash],
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.75 ? 5 : h.t < 0.95 ? 6 : 7],
  },
  gon: {
    name: 'GON', title: 'Le jeune hunter', sheet: 'gon', card: 'card_go',
    colors: ['#2e8b3e', '#ffe14d'], kiColor: '#ffe680', hit: '#fff3b0', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 3]],
    labels: { blast: 'JAJANKEN', ultra: 'GON ADULTE' },
    forms: [{ ki: 50, name: 'COLÈRE', filter: 'contrast(1.2) brightness(0.9)', speed: 1.3, dmg: 1.9, at: 0.6, end: 1.0, aura: ['rgba(255,200,40,0.45)', '#ffd23b'], bar: ['#8a6a00', '#ffe14d'], color: '#ffd23b' }],
    moves: GO_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'jajanken', speed: 270, pose: stdPose, ultra: [startSmash, updateSmash],
    ultraPose: h => ['special', h.t < 0.5 ? 4 : h.t < SMASH.hit - 0.1 ? 5 : h.t < SMASH.hit + 0.4 ? 6 : 7],
  },
  killua: {
    name: 'KILLUA', title: "L'assassin foudroyant", sheet: 'killua', card: 'card_ki',
    colors: ['#3a4a9a', '#bfe6ff'], kiColor: '#bfe6ff', hit: '#e0f4ff', trail: '#bfe6ff', element: 'thunder', stats: [['PUISSANCE', 3], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'NARUKAMI', ultra: 'GODSPEED' },
    forms: [{ ki: 50, name: 'GODSPEED', filter: 'brightness(1.1) saturate(1.2)', speed: 1.6, dmg: 1.5, at: 0.6, end: 1.0, aura: ['rgba(120,180,255,0.45)', '#9fd0ff'], sparks: '#dff2ff', bar: ['#2a5cff', '#bfe6ff'], color: '#9fd0ff' }],
    moves: KI_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'narukami', speed: 285, pose: stdPose, ultra: [startZigzag, updateZigzag],
    ultraPose: h => h.zz && h.t > ZIG.start ? ['special', 6 + Math.floor(h.t * 10) % 2] : ['special', 4 + step(h.t, [0.3])],
  },
  ippo: {
    name: 'IPPO', title: 'Le boxeur au cœur vaillant', sheet: 'ippo', card: 'card_ip',
    colors: ['#c81e2a', '#ffffff'], kiColor: '#ffb0a0', hit: '#ffe0d0', stats: [['PUISSANCE', 5], ['VITESSE', 3], ['PORTÉE', 2]],
    labels: { blast: 'DEMPSEY ROLL', ultra: 'DEMPSEY ROLL MAX' },
    forms: [{ ki: 50, name: 'ESPRIT DE COMBAT', filter: 'contrast(1.12) saturate(1.2)', speed: 1.25, dmg: 1.8, at: 0.6, end: 1.0, aura: ['rgba(255,60,40,0.45)', '#ff6a4a'], bar: ['#a01010', '#ff9a8a'], color: '#ff6a4a' }],
    moves: IP_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'dempsey', speed: 240, pose: stdPose, ultra: [startDempseyMax, updateDempseyMax],
    ultraPose: h => h.t < DMAX.end - 0.5 ? ['special', 1 + Math.floor(h.t * 10) % 6] : ['special', 7],
  },
  jinwoo: {
    name: 'JIN-WOO', title: 'Le monarque des ombres', sheet: 'jinwoo', card: 'card_jw',
    colors: ['#1a1030', '#b06aff'], kiColor: '#c9a0ff', hit: '#e0c8ff', trail: '#b06aff', stats: [['PUISSANCE', 5], ['VITESSE', 5], ['PORTÉE', 3]],
    labels: { blast: 'DOMAINE DU MONARQUE', ultra: 'ARISE' },
    forms: [{ ki: 50, name: 'MONARQUE', filter: 'contrast(1.15) saturate(1.2)', speed: 1.4, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(90,20,160,0.6)', '#a050ff'], bar: ['#2a0a50', '#c080ff'], color: '#a050ff',
             glow: '#7a2aff', arcs: 'hue-rotate(160deg) saturate(1.4)', trail: '#c080ff' }],
    moves: JW_MOVES, chain: { punch: ['punch', 'cross', 'rising'], kick: ['kick', 'spin', 'leap'] },
    special: 'shadowcut', speed: 275, pose: stdPose, ultra: [startArise, updateArise], chargeFrame: 5,
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.8 ? 5 : h.t < 1.6 ? 6 : 7],
  },
  saitama: {
    name: 'SAITAMA', title: 'Un héros pour le fun', sheet: 'saitama', card: 'card_sa',
    colors: ['#f2c400', '#ffffff'], kiColor: '#fff3a0', hit: '#ffffff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 2]],
    labels: { blast: 'COUP DE POING NORMAL', ultra: 'COUP DE POING SÉRIEUX' },
    forms: [{ ki: 50, name: 'MODE SÉRIEUX', filter: 'contrast(1.2) saturate(1.1)', speed: 1.35, dmg: 2.0, at: 0.6, end: 1.0, aura: ['rgba(255,240,180,0.5)', '#fff3a0'], bar: ['#a08000', '#fff07a'], color: '#fff3a0' }],
    moves: SA_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'serious', speed: 255, pose: stdPose, ultra: [startSmash, updateSmash],
    ultraPose: h => ['special', h.t < 0.5 ? 4 : h.t < SMASH.hit - 0.1 ? 1 : h.t < SMASH.hit + 0.4 ? 2 : 3],
  },
  gojo: {
    name: 'GOJO', title: 'Le plus fort des exorcistes', sheet: 'gojo', card: 'card_gj',
    colors: ['#101018', '#7fd8ff'], kiColor: '#9fe0ff', hit: '#e0f6ff', stats: [['PUISSANCE', 5], ['VITESSE', 4], ['PORTÉE', 4]],
    labels: { blast: 'ROUGE', ultra: 'VIOLET' },
    forms: [{ ki: 50, name: 'SIX YEUX', filter: 'contrast(1.12) saturate(1.2)', speed: 1.35, dmg: 1.7, at: 0.6, end: 1.0, aura: ['rgba(80,180,255,0.5)', '#7fd8ff'], bar: ['#0a3060', '#9fe0ff'], color: '#7fd8ff',
             glow: '#4ab0ff', proj: 'hue-rotate(200deg) saturate(1.6)' }],
    moves: GJ_MOVES, chain: { punch: ['punch', 'cross', 'uppercut'], kick: ['kick', 'roundhouse', 'spinback'] },
    special: 'red', speed: 260, pose: stdPose, ultra: [startFinalFlash, updateFinalFlash],
    ultraPose: h => ['special', h.t < 0.4 ? 4 : h.t < 0.95 ? 5 : 6],
  },
};
// Tailles relatives : les enfants et les persos plus petits le restent à l'écran (Naruto, Gon, Killua…).
// Toutes les planches du perso (formes comprises) sont réduites ; la cadence de marche suit, pour que le pied
// posé ne glisse pas.
const CHAR_SIZE = { naruto: 0.88, gon: 0.87, killua: 0.87, tanjiro: 0.92, izuku: 0.95 };
// Animation dessinée à une autre échelle que les autres poses du même perso (marche vidéo de Kenshin trop petite)
const ANIM_SIZE = { kenshin: { walk: 1.15, jump: 0.92, fall: 0.92, combo: 0.92, lowair: 0.92, dashcharge: 0.92, special: 0.92 } };
for (const [sh, anims] of Object.entries(ANIM_SIZE))
  for (const [an, k] of Object.entries(anims)) { const A = SPRITES[sh]?.[an]; if (A) { A.scale *= k; if (A.rate) A.rate /= k; } }
for (const [id, k] of Object.entries(CHAR_SIZE))
  for (const sh of charSheets(id)) for (const A of Object.values(SPRITES[sh] || {})) { A.scale *= k; if (A.rate) A.rate /= k; }
// Un personnage n'apparaît qu'une fois ses planches découpées (src/sprites.js)
const CHAR_IDS = Object.keys(CHARS).filter(id => SPRITES[CHARS[id].sheet]);
const COLORS_P = ['#4fe3ff', '#ff4fd8', '#7fff5a', '#ffb13b']; // couleur de chaque joueur

// Couleurs du moment (la forme les remplace) : traînée des lames, impacts, élément
const trailOf = h => h.boost?.trail || h.C.trail || '#ffffff';
const hitOf = h => h.boost?.hit || h.C.hit || '#ffe066';
const elementOf = h => h.boost?.element || h.C.element;
// La forme la plus forte que le ki permet
const formFor = h => h.C.forms.filter(f => h.ki >= f.ki).pop();

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
  enemies = []; waves = []; stars = []; bombs = []; projs = []; zaps = []; clones = []; fxs = []; particles = []; popups = []; cutins = [];
  if (scene !== 'loading') requireGame([...players, ...players.map(h => h.reserve).filter(Boolean)].map(h => h.char), LVL); // pas pour la partie fictive du démarrage
  resetLevel();
  camX = 0; shake = 0; flash = 0; hitstop = 0; score = 0; combo = 0; comboT = 0; kills = 0; spawnT = 1.5; sceneT = 0; paused = false;
}

// ---------- Joueurs ----------
const STATES_BUSY = ['hurt', 'prejump', 'charge', 'transform', 'ultra'];
const busy = h => !!h.move || STATES_BUSY.includes(h.state);
const say = (h, text) => popups.push({ x: h.x, y: h.y - 235, t: 0, text, small: true, c: h.C.colors[1] });

function startMove(h, name, chain = 0) {
  const m = h.C.moves[name];
  h.state = name; h.t = 0; h.move = m; h.hitSet = new Set(); h.multiT = 0; h.chain = chain; h.buffer = null;
  h.trailed = h.thrown = h.ported = h.beamed = h.struck = h.stopped = h.cloned = false;
  if (m.call) say(h, m.call);
  if (m.rubber) audio.stretch();
  if (m.trail) audio.slash();
  if (name === 'dash') { audio.zip(); audio.whoosh(1.3); }
  else if (name !== 'blast') audio.whoosh(/kick|round|whip|axe|bazooka|spin|leap/.test(name) ? 1.4 : 1);
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
  if (h.boost) { h.ki -= dt * KI.goldDrain; if (h.ki <= 0) { h.ki = 0; powerDown(h); } }
  else if (h.state !== 'ultra' && !h.out) h.ki = Math.min(100, h.ki + dt * KI.regen);
  formParticles(h);
  if (level.trans) { transitionWalk(h, dt); return; }
  if (h.aegis > 0) h.aegis -= dt;
  if (h.respawn) { updateRespawn(h, dt); return; }
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
      h.boost = F; flash = 0.8; shake = 16; ring(h.x, h.y - 110);
      burst(h.x, h.y - 120, F.color, 40);
      if (F.steam || F.cloud) for (let k = 0; k < 40; k++) particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(0, 180), vx: rand(-200, 200), vy: rand(-260, -60), t: 0, life: 0.9, c: 'rgba(255,240,240,0.6)', r: rand(6, 14), soft: true });
      audio.play('transform', 1, F.sheet === 'gold' ? 1 : 1.2, 0);
      if (F.sheet !== 'gold') { audio.sweep(0.8, 3000, 7000, 0.25, 0.6); say(h, F.name + ' !'); }
    }
    if (h.t > F.end) h.state = 'idle';
  }
  if (h.state === 'ultra') C.ultra[1](h, dt);

  // Combos : un coup demandé pendant le coup en cours s'enchaîne dès la fin de sa fenêtre active
  const m0 = h.move;
  if (m0 && m0.cancel && h.chain < C.chain.punch.length - 1) {
    if (pressed.has('punch')) h.buffer = 'punch';
    else if (pressed.has('kick')) h.buffer = 'kick';
    if (h.buffer && h.t >= m0.cancel && C.chain[h.buffer][h.chain + 1]) {
      if (mx) h.dir = mx;
      startMove(h, C.chain[h.buffer][h.chain + 1], h.chain + 1);
    }
  }
  if (h.move && h.t > h.move.dur) { h.state = h.onGround ? 'idle' : 'jump'; h.move = null; }

  const speed = h.boost ? h.boost.speed : 1;
  if (!busy(h)) {
    // Face à l'ennemi le plus proche : s'éloigner de lui = reculer en garde
    const near = nearestEnemy(h, 320);
    h.back = false;
    if (mx) {
      if (near && Math.sign(near.x - h.x) === -mx && h.onGround) { h.dir = -mx; h.back = true; }
      else h.dir = mx;
    } else if (near && h.onGround) h.dir = Math.sign(near.x - h.x) || h.dir;
    h.vx = mx * (h.back ? C.speed * 0.76 : C.speed) * speed;
    h.vz = mz * 165 * speed;

    if (h.onGround) {
      if (h.state !== 'land') {
        if (crouching) { if (h.state !== 'crouch') { h.state = 'crouch'; h.t = 0; } }
        else h.state = mx || mz ? 'walk' : 'idle';
      }
      const attack = ['punch', 'kick', 'blast', 'dash'].some(a => pressed.has(a));
      if (attack && mx) h.dir = mx; // la direction tenue choisit le côté du coup
      if (h.state === 'crouch') {
        h.vx = 0; h.vz = 0;
        if (pressed.has('punch') || pressed.has('kick')) startMove(h, 'ckick');
      }
      else if (pressed.has('jump')) { h.state = 'prejump'; h.t = 0; audio.play('swing', 0.4, 0.8); }
      else if (pressed.has('dash')) { startMove(h, 'dash'); h.vx = 0; }
      else if (pressed.has('punch')) startMove(h, 'punch');
      else if (pressed.has('kick')) startMove(h, 'kick');
      else if (pressed.has('blast')) {
        const cost = C.moves[C.special].cost;
        if (h.ki >= cost) { h.ki -= cost; startMove(h, C.special); if (C.special === 'blast') audio.blast(); }
        else denied(h);
      }
      else if (pressed.has('ultra')) {
        if (h.ki >= KI.ultra) { h.power = h.ki; h.ki = 0; powerDown(h); h.state = 'ultra'; h.t = 0; h.vx = 0; h.move = null; C.ultra[0](h); cutins = cutins.filter(c => c.h !== h); cutins.push({ h, t: 0 }); audio.sweep(0.5, 600, 4000, 0.3, 1); }
        else denied(h, 'KI PAS ASSEZ CHARGÉ');
      }
      else if (pressed.has('transform')) {
        if (h.boost) powerDown(h);
        else if (formFor(h)) { h.nextForm = formFor(h); h.state = 'transform'; h.t = 0; h.vx = 0; audio.tone(120, 1, 'sawtooth', 0.08, 200); }
        else denied(h, 'IL FAUT 50 DE KI');
      }
      else if (held('charge') && !h.boost) { h.state = 'charge'; h.t = 0; }
    } else {
      h.state = 'jump';
      if (mx) h.dir = mx;
      // Double saut : une seule relance en l'air
      if (pressed.has('jump') && !h.doubled) {
        h.doubled = true; h.vy = -700; h.t = 0;
        ring(h.x, h.y - 10); burst(h.x, h.y - 10, '#bfefff', 8); audio.zip();
      } else if (pressed.has('kick') || pressed.has('punch')) startMove(h, 'airkick');
    }
  }
  if (h.onGround && busy(h) && h.state !== 'hurt') { h.vx = 0; h.vz = 0; }
  if (h.state === 'hurt') { h.vx *= 0.88; h.vz = 0; }
  moveEffects(h, speed);

  // Physique
  if (!h.onGround) h.vy += 1900 * dt;
  // Profondeur : la ligne de sol bouge, le personnage (même en l'air) suit
  const nz = clamp(h.gz + h.vz * dt, Z_TOP, Z_BOT);
  h.y += nz - h.gz; h.gz = nz;
  h.x += h.vx * dt; h.y += h.vy * dt;
  if (h.y >= h.gz) {
    h.y = h.gz; h.vy = 0;
    if (!h.onGround) { h.onGround = true; h.doubled = false; h.move = null; h.state = 'land'; h.t = 0; audio.play('step', 0.6, 0.8); }
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
  if (m.push) {
    const at = m.pushAt ?? 0.06, len = m.pushDur ?? 0.44;
    if (h.t > at && h.t < at + len && !h.stopped) h.vx = h.dir * m.push * (m.keepPush ? 1 : 1 - (h.t - at) / len) * speed;
    if (h.stopped) h.vx = 0;
    if (Math.random() < 0.7) particles.push({ x: h.x - h.dir * 40, y: h.y - rand(10, 150), vx: -h.dir * rand(200, 400), vy: 0, t: 0, life: 0.25, c: h.boost ? h.boost.color : '#bfefff', r: rand(1.5, 3) });
    // Vitesse divine : des images rémanentes restent derrière lui
    if (m.ghost && h.t > at && h.t < at + len && Math.random() < 0.45) afterImage(h);
  }
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
    ring(h.x, h.y - 110); audio.zip();
  }
  if (m.clones && !h.cloned && h.t >= m.clones.at) { h.cloned = true; spawnClones(h, m.clones.n); }
  if (m.proj && !h.thrown && h.t >= m.proj.at) {
    h.thrown = true;
    const P = m.proj, kind = P.kind === 'wave' && elementOf(h) === 'fire' ? 'firewave' : P.kind;
    // les tirs lancés de la main (Rouge de Gojo, Delaware, rafale de ki) partent du bout de la main dessinée
    const hand = HAND_SHOTS.includes(kind) && handPoint(h);
    const px = hand ? h.x + h.dir * (hand[0] + 10) : h.x + h.dir * 80, py = hand ? h.y + hand[1] : h.y - (P.low ? 40 : 110);
    projs.push({ ...P, kind, filter: h.boost?.proj || '', owner: h, x: px, y: py, gz: h.gz, dir: h.dir, t: 0, hit: new Set(), dmg: P.dmg * (h.boost ? h.boost.dmg : 1) });
    if (hand) burst(px, py, projColor({ kind }), 10);
    shake = Math.max(shake, 8); audio.slash(1.4);
  }
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
  if (F.arcs && Math.random() < 0.35) animFX('green_arc', h.x + rand(-45, 45), h.y - rand(40, 180), rand(35, 60), 0.16, { rot: rand(-1, 1), filter: typeof F.arcs === 'string' ? F.arcs : '' });
  // Chidori qui crépite dans la main
  if (F.handArcs && Math.random() < 0.4) animFX('green_arc', h.x + h.dir * rand(30, 70), h.y - rand(90, 130), rand(25, 45), 0.12, { rot: rand(-1.5, 1.5), filter: F.arcs });
  // Manteau du renard : bulles de chakra rouge qui montent
  if (F.foxCloak && Math.random() < 0.7) particles.push({ x: h.x + rand(-40, 40), y: h.y - rand(10, 190), vx: rand(-25, 25), vy: rand(-170, -80), t: 0, life: 0.5, c: Math.random() < 0.6 ? 'rgba(255,50,20,0.8)' : 'rgba(255,150,60,0.8)', r: rand(3, 7) });
  if (F.flames && Math.random() < 0.7) particles.push({ x: h.x + rand(-40, 40), y: h.y - rand(0, 150), vx: rand(-20, 20), vy: rand(-200, -100), t: 0, life: 0.45, c: Math.random() < 0.5 ? '#ff8a2a' : '#ffd060', r: rand(3, 6) });
}

// ---------- Clones de Naruto ----------
let clones = [];
const puff = (x, y) => { for (let k = 0; k < 14; k++) particles.push({ x: x + rand(-40, 40), y: y - rand(20, 170), vx: rand(-120, 120), vy: rand(-120, 30), t: 0, life: 0.45, c: 'rgba(240,240,240,0.75)', r: rand(10, 20), soft: true }); };
function spawnClones(h, n) {
  const dz = [-45, 45, -20, 25];
  for (let k = 0; k < n; k++) {
    const c = { owner: h, x: h.x + h.dir * (30 + k * 25), gz: clamp(h.gz + dz[k % 4], Z_TOP, Z_BOT), dir: h.dir, t: -k * 0.07, state: 'rush', run: 0, kick: k % 2 === 1 };
    c.y = c.gz; clones.push(c); puff(c.x, c.y);
  }
  audio.whoosh(1.4); audio.zip();
}
function updateClones(dt) {
  for (const c of clones) {
    c.t += dt;
    if (c.t < 0.12) continue; // il apparaît dans la fumée, les mains jointes
    if (c.state === 'rush') {
      const e = enemies.filter(e => e.alive && e.state !== 'down' && (e.x - c.x) * c.dir > -30 && Math.abs(e.x - c.x) < 700)
        .sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
      const step = 900 * dt; c.x += c.dir * step; c.run += step;
      if (e) { c.gz += clamp(e.gz - c.gz, -260 * dt, 260 * dt); c.y = c.gz; }
      if (e && Math.abs(e.x - c.x) < 75 && Math.abs(e.gz - c.gz) < 35) {
        c.state = 'hit'; c.ht = 0;
        const h = c.owner, dmg = 1.6 * (h.boost ? h.boost.dmg : 1);
        damageEnemy(e, dmg, c.dir * 300, c.kick ? -420 : null, e.x, e.y - 110, h.C.hit);
      } else if (c.run > 650) c.state = 'poof';
    } else if (c.state === 'hit' && (c.ht += dt) > 0.22) c.state = 'poof';
    if (c.state === 'poof') { puff(c.x, c.y); c.done = true; }
  }
  clones = clones.filter(c => !c.done);
}
function drawClone(c) {
  const h = c.owner, sx = c.x - camX;
  const [anim, i] = c.t < 0.12 ? ['dashcharge', 5] : c.state === 'hit' ? ['combo', c.kick ? 5 : 2] : ['dashcharge', 1];
  shadow(sx, c);
  drawAnim(sheetFor(h, anim), anim, i, sx, c.y, c.dir, h.boost?.filter || '');
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
  dmg *= DIFF().dmg;
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
      if (allOut()) { scene = 'gameover'; sceneT = 0; }
    }
  } else {
    h.state = 'hurt'; h.vx = dir * 220; h.inv = 0.5;
  }
}

// Ultime qui frappe tous les ennemis devant (portée, tolérance de profondeur), avec un gros impact
function ultraHit(h, reach, dmg, laneTol = 70, back = -40) {
  for (const e of enemies) {
    const dx = (e.x - h.x) * h.dir;
    if (!e.alive || e.state === 'down' || dx < back || dx > reach || Math.abs(e.gz - h.gz) > laneTol) continue;
    damageEnemy(e, dmg, 600 * h.dir, -760, e.x, e.y - 110, hitOf(h));
  }
}

// ---------- Ultime du héros et de Sangoku : une énorme sphère d'énergie levée au-dessus de la tête ----------
const ULTRA = { raise: 1.5, throwAt: 1.75, end: 2.4, maxR: 115 };
function startUltra(h) {
  bombs.push({ owner: h, x: h.x, y: h.y - 300, r: 6, vx: 0, vy: 0, state: 'grow', t: 0, hit: new Set(), dir: h.dir });
  h.ultraSnd = audio.play('ultraCharge', 0.9, 1, 0);
  if (h.char === 'goku') say(h, 'GENKIDAMA !');
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
  palm: { goku: [52, -135], goku_ssj: [54, -113] } };
const easeOut = k => 1 - (1 - k) * (1 - k);
function startGenki(h) {
  const b = { owner: h, genki: true, x: h.x, y: h.y - 300, r: 6, vx: 0, vy: 0, state: 'grow', t: 0, hit: new Set(), dir: h.dir };
  bombs.push(b);
  h.genki = { phase: 'rise', b, ct: 0 };
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
      const F = h.C.forms[0];
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
  if (G.phase === 'clash') return ['special', 7]; // une seule main tendue qui pousse la sphère
  return ['jump', 6];
}
function updateGenkiBomb(b, dt) {
  const h = b.owner, G = h.genki;
  if (b.state === 'grow') {
    b.r = 6 + (GENKI.maxR - 6) * Math.min(1, b.t / GENKI.grow);
    b.x = h.x - h.dir * 6; b.y = Math.max(b.r * 0.7 + 6, h.y - 235 - b.r * 0.6);
    for (let k = 0; k < 3; k++) {
      const a = rand(0, Math.PI * 2), d = rand(250, 520);
      particles.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.2, vy: -Math.sin(a) * d * 2.2, t: 0, life: 0.42, c: '#9fe8ff', r: rand(2, 4) });
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
    b.r = 6 + (ULTRA.maxR - 6) * Math.min(1, b.t / ULTRA.raise);
    b.x = h.x - h.dir * 6; b.y = h.y - 250 - b.r * 0.85;
    // L'énergie de toute la ville converge vers la sphère
    for (let k = 0; k < 3; k++) {
      const a = rand(0, Math.PI * 2), d = rand(250, 520);
      particles.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.2, vy: -Math.sin(a) * d * 2.2, t: 0, life: 0.42, c: '#9fe8ff', r: rand(2, 4) });
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
    for (const e of enemies) {
      if (!e.alive || b.hit.has(e) || e.state === 'down') continue;
      if (Math.hypot(e.x - b.x, e.gz - 100 - b.y) < b.r + 60) { b.hit.add(e); damageEnemy(e, 6, 500 * b.dir, -700, e.x, e.y - 100, '#bff3ff'); }
    }
    if (b.y + b.r * 0.4 >= b.gz) {
      b.state = 'boom'; b.t = 0; b.y = b.gz;
      flash = 1; shake = 28; hitstop = 0.12;
      audio.play('ultraBoom', 1.2, 1, 0);
      const dmg = 4 + h.power / 10;
      for (const e of enemies) {
        if (!e.alive || e.state === 'down' || Math.abs(e.x - b.x) > 480) continue;
        damageEnemy(e, dmg, 600 * (Math.sign(e.x - b.x) || 1), -800, e.x, e.y - 100, '#bff3ff');
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
    ultraHit(h, GIGANT.reach, 4 + h.power / 10, 80);
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
    projs.push({ kind: 'shuriken', owner: h, x: h.x + h.dir * 40, y: h.y - 250, gz: h.gz, dir: h.dir, t: 0, speed: 560, life: 1.2, hit: new Set(), multiT: 0, dmg: 0.8, final: 4 + h.power / 10 });
    say(h, 'RASENSHURIKEN !');
    audio.play('ultraThrow', 1, 1.2, 0); shake = 12;
  }
  if (h.t > RSH.end) h.state = 'idle';
}

// ---------- Ultime de Zoro : Sanzen Sekai, il tourne comme une tornade puis traverse la rue ----------
const SANZEN = { spin: 0.9, dash: 1.25, end: 1.75, speed: 1500 };
function startSanzen(h) {
  h.hitSet = new Set();
  say(h, 'SANZEN SEKAI !');
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
      damageEnemy(e, 4 + h.power / 10, 500 * h.dir, -800, e.x, e.y - 110, hitOf(h));
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
    slashFX(h.x + h.dir * 90, h.y - 120, h.dir, { a0: [-1.6, 1.4, -3.1][h.cutN - 1], a1: [1.4, -1.6, 3.1][h.cutN - 1], r: last ? 210 : 170, w: last ? 46 : 34, c: '#ff8a2a', element: 'fire', life: 0.45 });
    shake = last ? 26 : 12; flash = last ? 0.6 : 0.2; audio.slash(1.5);
    if (last) audio.play('ultraBoom', 1, 1.2, 0);
    ultraHit(h, HINOKAMI.reach, (4 + h.power / 10) / 3, 70, -80);
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
  const dmg = 4 + h.power / 10;
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

// ---------- Ultime d'Ichigo : un Getsuga Tensho géant ----------
function startMugetsu(h) { h.thrown = false; say(h, 'MUGETSU…'); audio.play('ultraCharge', 0.8, 0.9, 0); }
function updateMugetsu(h) {
  h.inv = Math.max(h.inv, 0.1);
  if (Math.random() < 0.7) particles.push({ x: h.x + rand(-60, 60), y: h.y - rand(0, 200), vx: 0, vy: rand(-200, -80), t: 0, life: 0.5, c: '#1a0008', r: rand(4, 8), soft: true });
  if (!h.thrown && h.t >= 1.4) {
    h.thrown = true; flash = 0.7; shake = 24; audio.play('ultraThrow', 1, 0.8, 0); audio.slash(1.4);
    projs.push({ kind: 'getsuga', filter: 'hue-rotate(160deg) saturate(2) brightness(0.8)', scale: 2.6, owner: h, x: h.x + h.dir * 100, y: h.y - 130, gz: h.gz, dir: h.dir, t: 0, speed: 800, life: 1.4, hit: new Set(), dmg: 4 + h.power / 10, kb: 600, launch: -800 });
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
    ultraHit(h, 820, 4 + h.power / 10, 120);
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
      damageEnemy(e, (4 + h.power / 10) / 3, 300 * -h.dir, h.zzN === ZIG.max ? -800 : null, e.x, e.y - 110, hitOf(h));
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
    ultraHit(h, 800, 4 + h.power / 10, 110);
    for (let k = 0; k < 40; k++) particles.push({ x: h.x + h.dir * rand(100, 800), y: h.y - rand(20, 260), vx: h.dir * rand(500, 1100), vy: rand(-120, 120), t: 0, life: 0.45, c: '#ffffff', r: rand(2, 5) });
    score += 2000;
  }
  if (h.t > SMASH.end) h.state = 'idle';
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
    ultraHit(h, 260, 3 + h.power / 15, 70);
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
    ultraHit(h, 820, 4 + h.power / 10, 130);
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
  nr2_puppet: MINION('nr2_puppet', { lunge: true, slash: '#c9a0ff', hp: 6 }),
  nr2_rain: MINION('nr2_rain', { ranged: 'kunai' }),
  nr2_boss: BOSS('nr2_boss', { proj: 'shock', projColor: '#c9a0ff', adds: ['nr2_puppet', 'nr2_rain'], roar: 'SHINRA TENSEI !!' }),
  ds2_demon: MINION('ds2_demon', { lunge: true, slash: '#ff3040', speed: [160, 190] }),
  ds2_obi: MINION('ds2_obi', { ranged: 'thread' }),
  ds2_boss: BOSS('ds2_boss', { proj: 'slash', projColor: '#ff6ad8', adds: ['ds2_demon', 'ds2_obi'], roar: 'HACHI-ENJIN !!' }),
  db2_jr: MINION('db2_jr', { lunge: true, speed: [180, 210], hp: 4, h: 170 }),
  db2_android: MINION('db2_android', { ranged: 'ki', hp: 7 }),
  db2_boss: BOSS('db2_boss', { proj: 'beam', projColor: '#7fd8ff', adds: ['db2_jr', 'db2_android'], roar: 'KAMEHAMEHA !!' }),
});
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
};
for (const [k, f] of Object.entries(STAND_IN)) Object.assign(ETYPES[k], { alt: ETYPES[k].isBoss ? 'boss' : ETYPES[k].lunge ? 'samurai' : 'biker', altTint: f });

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
    hp: T.hp * DIFF().hp * (T.isBoss && players.length > 1 ? 1 + 0.5 * (players.length - 1) : 1), maxHp: T.hp * DIFF().hp * (T.isBoss && players.length > 1 ? 1 + 0.5 * (players.length - 1) : 1), speed: rand(...T.speed) * (1 + lvl * 0.3), cool: rand(0.4, 1.2), walkT: rand(0, 1), flash: 0, hitDone: false,
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
  e.t += dt; e.flash = Math.max(0, e.flash - dt);
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
      e.vy += 1700 * dt; e.x += e.vx * dt; e.y += e.vy * dt;
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
function impactFX(x, y, c, big) { fxs.push({ type: 'impact', x, y, c, t: 0, life: big ? 0.32 : 0.2, r: big ? 95 : 58, n: big ? 14 : 9, rot: rand(0, 1) }); }
// Spirale du Rasengan qui s'ouvre sur l'ennemi
function spiralFX(x, y, c) { fxs.push({ type: 'spiral', x, y, c, t: 0, life: 0.45 }); }
// Image rémanente (téléportation) : la pose du moment, qui s'efface sur place
function afterImage(h, life = 0.35, alpha = 0.5, col = null) {
  const [anim, i] = h.C.pose(h);
  fxs.push({ type: 'ghost', x: h.x, y: h.y, dir: h.dir, sheet: sheetFor(h, anim), anim, i, t: 0, life, alpha, col });
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
      drawAnim(f.sheet, f.anim, f.i, sx, f.y, f.dir, f.col ? tintFilter(f.col) : 'brightness(1.8) saturate(0.4)');
      ctx.globalAlpha = 1;
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
      p.x = h.x + h.dir * 78; p.y = h.y - (p.high || 118); p.dir = h.dir; p.gz = h.gz;
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
    p.x += p.dir * p.speed * dt;
    if (p.kind === 'shuriken') {
      p.y += ((h.y - 130) - p.y) * Math.min(1, dt * 4);
      if (p.t - p.multiT >= 0.08) { p.multiT = p.t; p.hit.clear(); }
    }
    const R = (p.kind === 'shuriken' ? 95 : p.kind === 'airblade' ? 60 : 75) * (p.scale || 1);
    for (const e of enemies) {
      if (!e.alive || p.hit.has(e) || e.state === 'down' || Math.abs(e.x - p.x) > R || Math.abs(e.gz - p.gz) > 45 * (p.scale || 1)) continue;
      p.hit.add(e);
      damageEnemy(e, p.dmg, (p.kb || 120) * p.dir, p.kind === 'shuriken' ? null : p.launch, e.x, e.y - 110, p.kind === 'firewave' ? '#ffd0a0' : p.kind === 'wave' ? '#bdf0ff' : '#e8fff0');
      if (p.kind === 'airshot' || p.kind === 'red') animFX('explosion', e.x, e.y - 110, 200, 0.4, p.kind === 'red' ? { filter: 'hue-rotate(-30deg) saturate(2)' } : {});
      else if (p.kind !== 'shuriken') slashFX(e.x, e.y - 110, p.dir, { a0: -1.2, a1: 1.2, r: 70, c: projColor(p), life: 0.2 });
    }
    if (p.kind === 'rocks' && p.t - (p.lastRupt || 0) > 0.06) { p.lastRupt = p.t; animFX('rupture', p.x - p.dir * 20, p.gz - 70, 190, 0.45); shake = Math.max(shake, 5); }
    if (p.kind === 'rocks' && Math.random() < 0.8) particles.push({ x: p.x - p.dir * rand(0, 50), y: p.y + rand(-10, 20), vx: -p.dir * rand(30, 120), vy: rand(-160, -40), t: 0, life: 0.45, c: Math.random() < 0.5 ? '#a08868' : '#d8c09a', r: rand(3, 7) });
    if (p.kind === 'wave' || p.kind === 'firewave') for (let k = 0; k < 3; k++)
      particles.push({ x: p.x - p.dir * rand(0, 60), y: p.y + rand(-70, 70), vx: -p.dir * rand(50, 150), vy: rand(-80, 40) - (p.kind === 'firewave' ? 100 : 0), t: 0, life: 0.4, c: p.kind === 'firewave' ? (Math.random() < 0.5 ? '#ff7a1a' : '#ffd060') : (Math.random() < 0.5 ? '#5ad1ff' : '#e8fbff'), r: rand(2, 5) });
    if (p.t > p.life || Math.abs(p.x - camX - W / 2) > W) {
      p.done = true;
      if (p.kind === 'shuriken') {
        // Explosion finale : une sphère de vent tranchant
        flash = 0.8; shake = 26; hitstop = 0.1; audio.play('ultraBoom', 1.2, 1.1, 0);
        impactFX(p.x, p.y, '#bff3ff', true); spiralFX(p.x, p.y, '#e8fbff');
        bombs.push({ owner: h, x: p.x, y: p.gz, gz: p.gz, r: 0, state: 'boom', t: 0, hit: new Set(), dir: p.dir });
        for (const e of enemies) if (e.alive && e.state !== 'down' && Math.abs(e.x - p.x) < 260) damageEnemy(e, p.final, 600 * (Math.sign(e.x - p.x) || 1), -800, e.x, e.y - 110, '#bff3ff');
        score += 2000;
      }
    }
  }
  projs = projs.filter(p => !p.done);
}

const projColor = p => ({ airblade: '#e9fff2', wave: '#5ad1ff', firewave: '#ff8a2a', shuriken: '#bff3ff', rocks: '#d8c09a', getsuga: '#bfe8ff', airshot: '#d8ffe0', red: '#ff5060', kiball: '#bff3ff' })[p.kind] || '#ffffff';

function drawProjs() {
  for (const p of projs) {
    const sx = p.x - camX;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
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
    if (p.kind === 'shuriken') { ctx.restore(); drawShuriken(sx, p.y, 1, p.t); continue; }
    // Croissants en images : lame d'air, Getsuga Tensho, vague d'eau ou de feu
    const sprite = { airblade: ['crescent', 'hue-rotate(-60deg) saturate(0.5) brightness(1.3)'], getsuga: ['crescent', p.filter || ''], wave: ['water_arc', ''], firewave: ['fire_arc', ''] }[p.kind];
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
const sel = { joined: [true, false, false, false], pick: [0, 1, 2, 3], ready: [false, false, false, false], dev: ['kb', null, null, null], first: [null, null, null, null], skip: false, go: 0 };

function openSelect() {
  scene = 'select'; sceneT = 0;
  for (const k of Object.keys(padOwner)) delete padOwner[k];
  p2Keyboard = false;
  sel.joined = [true, false, false, false]; sel.ready = [false, false, false, false]; sel.go = 0;
  sel.pick = [0, 1, 2, 3].map(k => k % CHAR_IDS.length); sel.first = [null, null, null, null];
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
  for (let p = 0; p < 4; p++) {
    if (!sel.joined[p] || (p > 0 && sel.skip)) continue;
    const I = INPUT[p], hit = a => I.pressed.has(a);
    if (!sel.ready[p]) {
      const dk = hit('left') ? -1 : hit('right') ? 1 : hit('up') ? -selCols() : hit('down') ? selCols() : 0;
      if (dk) {
        sel.pick[p] = (sel.pick[p] + dk + n) % n;
        audio.tone(520 + p * 120, 0.06, 'triangle', 0.08);
      }
      if (hit('punch') || hit('jump') || hit('start')) {
        // Équipe de deux : le premier choix est le combattant, le second son partenaire
        if (OPTS.tag && sel.first[p] === null && n > 1) { sel.first[p] = sel.pick[p]; sel.pick[p] = (sel.pick[p] + 1) % n; }
        else sel.ready[p] = true;
        audio.play('hitHeavy', 0.8); audio.tone(780, 0.25, 'triangle', 0.12, 300);
      } else if (hit('kick') || hit('pause')) {
        if (sel.first[p] !== null) { sel.pick[p] = sel.first[p]; sel.first[p] = null; }
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
      sel.chars = ps.map(p => CHAR_IDS[sel.first[p] ?? sel.pick[p]]);
      sel.partners = ps.map(p => sel.first[p] !== null ? CHAR_IDS[sel.pick[p]] : null);
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
function drawLevels() {
  const n = LEVELS.length, L = LEVELS[levelPick], t = sceneT;
  // Fond : le niveau choisi en plein écran, qui défile, assombri
  drawLevelThumb(L, 0, 0, W, H, t * 60);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(5,0,15,0.55)'); g.addColorStop(0.5, 'rgba(5,0,15,0.15)'); g.addColorStop(1, 'rgba(5,0,15,0.9)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (lvSel.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${lvSel.flash * 0.25})`; ctx.fillRect(0, 0, W, H); }
  // Lignes de vitesse
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
  for (let q = 0; q < 16; q++) { const x = W + 200 - ((q * 191 + t * 700) % (W + 400)), y = 120 + (q * 61) % 220; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60 + (q % 3) * 40, y); ctx.stroke(); }
  ctx.restore();
  // Titre
  ctx.save(); ctx.fillStyle = 'rgba(10,0,25,0.75)'; ctx.beginPath(); ctx.moveTo(0, 18); ctx.lineTo(430, 18); ctx.lineTo(400, 64); ctx.lineTo(0, 64); ctx.fill();
  ctx.fillStyle = '#ffe14d'; ctx.fillRect(0, 64, 400, 3); ctx.restore();
  outlined('CHOISIS TA SCÈNE', 24, 54, 34, '#ffe14d', 'left');
  outlined(`${levelPick + 1} / ${n}`, W - 24, 54, 24, '#fff', 'right');
  // Nom du niveau, sous-titre, zones
  const [univ, place] = L.name.split(' — ');
  const slide = (1 - Math.min(1, (1 - lvSel.flash) * 1.4)) * 60;
  outlined(univ, 40 + slide, 132, 26, '#ff8ae6', 'left');
  outlined(place || L.sub, 40 + slide, 176, 46, '#fff', 'left');
  ctx.font = 'italic bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd6e8';
  ctx.fillText(L.sub, 44 + slide, 204);
  L.zones.forEach((Z, k) => {
    const x = 44 + k * 196 + slide, y = 222;
    ctx.fillStyle = 'rgba(10,0,25,0.7)'; ctx.fillRect(x, y, 186, 26);
    ctx.fillStyle = '#ffe14d'; ctx.fillRect(x, y, 4, 26);
    ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(`${k + 1}. ${Z.name}`, x + 10, y + 17);
  });
  // Carte du boss (image de sa présentation), à droite
  const card = IMG['intro_' + L.boss];
  if (!card && ASSETS.ui['intro_' + L.boss]) want('intro_' + L.boss, ASSETS.ui['intro_' + L.boss]);
  if (card) {
    const bw = 300, bh = 160, bx = W - bw - 30 + slide * 0.5, by = 92;
    ctx.save(); ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate(-0.04);
    ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.save(); ctx.clip();
    const s = Math.max(bw / card.width, bh / card.height); ctx.drawImage(card, -card.width * s * 0.62, -card.height * s / 2, card.width * s, card.height * s);
    ctx.restore(); ctx.strokeStyle = '#ff3040'; ctx.lineWidth = 4; ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    ctx.restore();
    outlined('⚠ BOSS', bx + 10, by + bh + 22, 18, '#ff3040', 'left');
    outlined(ENEMY_INFO[L.boss]?.[0] || '', bx + 90, by + bh + 22, 18, '#fff', 'left');
  }
  // Bande de vignettes inclinées, centrée sur le niveau choisi
  const cw = 176, ch = 99, gap = 22, cy = 388;
  for (let k = 0; k < n; k++) {
    let d = k - lvSel.cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
    if (Math.abs(d) > 3.2) continue;
    const on = k === levelPick, sc = on ? 1.12 : 0.86 - Math.min(0.2, Math.abs(d) * 0.05);
    const x = W / 2 + d * (cw * 0.86 + gap), w = cw * sc, h = ch * sc;
    ctx.save(); ctx.translate(x, cy + (on ? -6 + Math.sin(t * 4) * 3 : 8)); ctx.transform(1, 0, -0.14, 1, 0, 0);
    ctx.globalAlpha = on ? 1 : 0.75 - Math.min(0.4, Math.abs(d) * 0.12);
    drawLevelThumb(LEVELS[k], -w / 2, -h / 2, w, h, on ? t * 40 : 0);
    if (!on) { ctx.fillStyle = 'rgba(5,0,15,0.35)'; ctx.fillRect(-w / 2, -h / 2, w, h); }
    ctx.strokeStyle = on ? '#ffe14d' : 'rgba(255,255,255,0.4)'; ctx.lineWidth = on ? 4 : 2; ctx.strokeRect(-w / 2, -h / 2, w, h);
    if (on) { ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 18; ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.shadowBlur = 0; }
    ctx.font = `bold ${on ? 13 : 11}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = on ? '#ffe14d' : '#d8d0ec';
    ctx.fillText(LEVELS[k].name.split(' — ')[0], 0, h / 2 + 16);
    ctx.restore();
  }
  // Flèches et aide
  const pulse = 1 + Math.sin(t * 6) * 0.12;
  outlined('◀', 30 - pulse * 4, cy + 10, 34 * pulse, '#ffe14d');
  outlined('▶', W - 30 + pulse * 4, cy + 10, 34 * pulse, '#ffe14d');
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 34, W, 34);
  ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = COLORS_P[0];
  ctx.fillText(`${K('left')} ${K('right')} choisir     ${K('punch')} ou Entrée : COMBATTRE     ${K('kick')} retour`, W / 2, H - 12);
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
    if (scene === 'gameover' && sceneT > 1.5 && ['start', 'punch'].some(anyPressed)) {
      if (gameMode === 'story') openMap(); else scene = 'title', sceneT = 0;
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
function drawTiled(img, factor, y, h, w = img.width * (h / img.height), mirror = false, src = null) {
  const off = -((camX * factor) % (mirror ? 2 * w : w));
  const put = (dx, dy) => {
    if (!src) return ctx.drawImage(img, dx, dy, w + 1, h);
    // bande retournée de haut en bas : son bord touche celui de l'image, sans raccord visible
    ctx.save(); ctx.translate(dx, dy + h); ctx.scale(1, -1); ctx.drawImage(img, 0, src[0], img.width, src[1], 0, 0, w + 1, h); ctx.restore();
  };
  for (let x = off, k = 0; x < W; x += w, k++) {
    if (mirror && k % 2) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); put(0, 0); ctx.restore(); }
    else put(x, y);
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
  if (drawAnim.grow) ctx.scale(drawAnim.grow, drawAnim.grow);
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
  switch (h.state) {
    case 'walk': { const [n, fps] = walkCycle(h); return [h.back ? 'back' : 'walk', Math.floor(h.walkT * fps) % n]; }
    case 'crouch': return ['crouch', t < 0.06 ? 0 : 1];
    case 'ckick': return ['crouch', 2 + step(t, [0.1, 0.28])];
    case 'punch': return ['punch', 1 + step(t, [0.06, 0.18])];
    case 'cross': return ['pcombo', t < 0.2 ? 1 : 4];
    case 'uppercut': return ['pcombo', 2 + step(t, [0.1, 0.36])];
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
    case 'charge': return ['rocket', t < 0.15 ? 4 : 5];
    case 'transform': return ['rocket', 4 + step(t, [0.25, 0.5, 0.8])];
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
  const [c1, c2, c3] = gold ? ['#fffbe0', '#ffe066', 'rgba(255,170,0,0)'] : ['#ffffff', '#8fe9ff', 'rgba(30,110,255,0)'];
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
const HAND_SHOTS = ['airshot', 'kiball', 'red'], handCache = {};
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
const sheetFor = (h, anim) => h.boost?.sheet && SPRITES[h.boost.sheet][anim] ? h.boost.sheet : h.C.sheet;

// Personnages à planches de 8 étapes (Sangoku, Zoro, Naruto, Tanjiro) : walk, jump, fall,
// combo (garde, 3 poings | 4 pieds), lowair (accroupi | en l'air), dashcharge (dash | charge), special (spécial | ultime).
// Les coups donnent leur propre pose (champ p).
function stdPose(h) {
  const t = h.t, m = h.move;
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
    default: return ['combo', 0]; // garde
  }
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
    const N = h.state === 'transform' ? h.nextForm : F, gold = N?.sheet && ['gold', 'goku_ssj', 'vegeta_ssj'].includes(N.sheet);
    const col = gold ? '#ffd84a' : N?.aura ? N.aura[1] : C.kiColor;
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
  if (h.char === 'naruto' && h.state === 'ultra') {
    const a = Math.min(1, h.t / 0.6) * (h.t > KYU.end - 0.3 ? (KYU.end - h.t) / 0.3 : 1);
    const lunge = h.t > KYU.charge ? Math.min(1, (h.t - KYU.charge) / 0.35) * 650 : 0;
    // il surgit des flammes, rugit, se ramasse puis bondit (planche animée), en respirant
    const fi = h.t < 0.6 ? 0 : h.t < KYU.charge - 0.2 ? 1 : h.t < KYU.charge ? 2 : 3, breathe = 1 + Math.sin(h.t * 9) * 0.04;
    fxImg(FX.kyubi_run ? 'kyubi_run' : 'kyubi', fi, sx + h.dir * (lunge - 30), h.y - 180 - (fi === 3 ? 40 : 0), 520 * breathe, null, { alpha: Math.max(0, a), flip: h.dir < 0 });
  }
  if (h.out) ctx.globalAlpha = 0.55;
  // Gon adulte : il grandit pendant son ultime
  drawAnim.grow = h.char === 'gon' && h.state === 'ultra' && h.t > 0.45 ? 1 + 0.55 * Math.min(1, (h.t - 0.45) / 0.3) : 0;
  drawAnim(sheet, anim, i, sx, h.y, h.dir, filter, rot);
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
  if (m?.beam && h.t < m.beam.at) energyBall(sx - h.dir * 18, h.y - 102, 6 + 26 * Math.min(1, h.t / m.beam.at), false);
  if (m?.orb && h.t >= m.orb[0] && h.t <= m.orb[1]) {
    const r = 12 + 18 * Math.min(1, h.t / 0.3), low = m.orbFx === 'chidori' && h.t < m.p[2][1];
    const hx = sx + h.dir * (low ? (h.t < m.p[2][0] ? 30 : -35) : 82), hy = h.y - (low ? 72 : 120);
    if (!fxImg(m.orbFx || 'rasengan', Math.floor(h.t * 20), hx, hy, r * 3.2, null, { filter: h.boost && h.char === 'naruto' ? 'hue-rotate(170deg) saturate(1.6)' : '' })) drawRasengan(hx, hy, r, h.t);
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
  if (!e.alive && e.t > 0.6 && Math.floor(e.t * 15) % 2) return; // clignote avant de disparaître
  shadow(sx, e, ETYPES[e.type].isBoss ? 2 : ETYPES[e.type].armor ? 1.4 : 1);
  const [anim, i] = enemyPose(e);
  const own = !!SPRITES[T.sheet], sheet = own ? T.sheet : T.alt;
  // Le ninja, tout en noir, reçoit un liseré lumineux pour rester visible dans la nuit
  const filter = [own ? '' : T.altTint, e.tint, e.enraged ? 'saturate(1.6) brightness(1.1) drop-shadow(0 0 6px #ff3000)' : '', T.glow ? 'drop-shadow(0 0 3px rgba(255,70,235,0.95))' : '', e.flash > 0 ? 'brightness(2.5)' : ''].filter(Boolean).join(' ');
  drawAnim(sheet, anim, i, sx, e.y, e.dir, filter);
  if (e.state === 'windup') outlined('!', sx, e.y - T.h, 34, '#ff3355');
  // Jauge de vie de la brute
  if ((['brute', 'samurai', 'biker'].includes(e.type) || T.armor && !T.isBoss) && e.alive && e.hp < e.maxHp) {
    const w = 90, k = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - w / 2 - 2, e.y - T.h + 18, w + 4, 9);
    ctx.fillStyle = '#ff3355'; ctx.fillRect(sx - w / 2, e.y - T.h + 20, w * k, 5);
  }
}

function shadow(sx, o, size = 1) {
  const s = clamp(1 - (o.gz - o.y) / 400, 0.3, 1) * size;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(sx, o.gz + 4, 45 * s, 10 * s, 0, 0, 7); ctx.fill();
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

function drawBomb(b) {
  const sx = b.x - camX;
  // Faisceau du Super Saiyan qui repousse la sphère
  if (b.genki && b.state === 'clash' && b.owner.genki?.ssj) {
    // part de la paume (fin à la main, large contre la sphère)
    const h = b.owner, [px, py] = GENKI.palm[h.boost?.sheet || h.C.sheet] || [54, -120];
    const hx = h.x + h.dir * (px + 6) - camX, hy = h.y + py, flick = 1 + Math.sin(sceneT * 50) * 0.12;
    const ang = Math.atan2(b.y - hy, sx - hx), nx = -Math.sin(ang), ny = Math.cos(ang);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [w0, w1, c] of [[22, b.r * 1.1, 'rgba(255,190,50,0.35)'], [11, b.r * 0.6, 'rgba(255,240,160,0.75)'], [4, b.r * 0.22, '#ffffff']]) {
      const a0 = w0 * flick / 2, a1 = w1 * flick / 2;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(hx + nx * a0, hy + ny * a0); ctx.lineTo(sx + nx * a1, b.y + ny * a1);
      ctx.lineTo(sx - nx * a1, b.y - ny * a1); ctx.lineTo(hx - nx * a0, hy - ny * a0); ctx.closePath(); ctx.fill();
    }
    // éclat dans la paume
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 30 * flick);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, 'rgba(255,230,120,0.7)'); g.addColorStop(1, 'rgba(255,190,50,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 30 * flick, 0, 7); ctx.fill();
    ctx.restore();
  }
  if (b.state !== 'boom') { energyBall(sx, b.y, b.r * (1 + Math.sin(sceneT * 30) * 0.03), false); return; }
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
  card_ip: [0.47, 0.33, 4], card_iz: [0.62, 0.35, 4.4], card_ka: [0.46, 0.27, 4.4], card_kenshin: [0.54, 0.3, 4.4],
  card_ki: [0.53, 0.36, 4], card_luffy: [0.71, 0.34, 4.4], card_naruto: [0.6, 0.33, 4.2], card_tanjiro: [0.42, 0.29, 4.4],
  card_ve: [0.52, 0.37, 4], card_ze: [0.2, 0.36, 4.2], card_zoro: [0.47, 0.27, 4.4],
  card_jw: [0.72, 0.18, 8.5], card_sa: [0.56, 0.12, 7.5], card_gj: [0.52, 0.155, 7.5], // cartes en pied : visage repéré sur la carte
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
  const L = C.labels, k = (a) => K(a, p), cost = C.moves[C.special].cost, F = h.boost, next = formFor(h) || C.forms[0];
  const kiLabel = F ? (h.ki >= KI.ultra ? `${F.name} — ${L.ultra} [${k('ultra')}]` : F.name)
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
const CUT_FROM_CARD = new Set(['jinwoo', 'saitama', 'gojo']); // en attendant leurs gros plans
function drawCutins() {
  cutins = cutins.filter(c => (c.t += 1 / 60) < CUT);
  for (const c of cutins) {
    const h = c.h, right = c.duo ? h.idx % 2 === 0 : h.idx % 2 === 1, img = IMG['cutin_' + h.char];
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
function drawTitle() {
  if (IMG.title) {
    const z = 1.04 + Math.sin(sceneT * 0.25) * 0.03, s = Math.max(W / IMG.title.width, H / IMG.title.height) * z;
    const dx = Math.sin(sceneT * 0.17) * 12, dy = Math.cos(sceneT * 0.21) * 6;
    ctx.drawImage(IMG.title, (W - IMG.title.width * s) / 2 + dx, (H - IMG.title.height * s) / 2 + dy, IMG.title.width * s, IMG.title.height * s);
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
    outlined('MASTERCLASS', W / 2, 150, 84, '#ff9a1f');
    outlined('BATTLE', W / 2, 240, 96, '#4fc3ff');
  }
  drawTitleMenu();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 66, W, 66);
  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`J1 :  ${K('left')} ${K('right')} ${K('up')} ${K('down')}  bouger     ${K('jump')}  sauter     ${K('crouch')}  se baisser     ${K('punch')}  poing     ${K('kick')}  pied     ${K('blast')}  spécial     ${K('dash')}  dash`, W / 2, H - 42);
  ctx.fillText(`${K('charge')} (tenir)  ki     ${K('transform')}  transformation     ${K('ultra')}  ultime     ${K('pause')}  pause et commandes     —     J2 : pavé numérique ou 2e manette`, W / 2, H - 18);
}

// ---------- Écran de sélection : une carte par personnage ----------
function drawSelect() {
  // La rue qui défile derrière, assombrie, traversée de lignes de vitesse
  camX = sceneT * 60; drawBackground();
  ctx.fillStyle = 'rgba(8,2,24,0.74)'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
  for (let k = 0; k < 22; k++) {
    const x = W + 200 - ((k * 173 + sceneT * 900) % (W + 400)), y = 30 + (k * 97) % 480;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 90 + (k % 4) * 30, y); ctx.stroke();
  }
  ctx.restore();
  outlined('CHOISIS TON COMBATTANT', W / 2, 50, 38, '#ffe14d');

  // Grille de cartes (3 par rangée au-delà de 3 personnages), réduites pour tenir à l'écran
  const n = CHAR_IDS.length, cols = selCols(), rows = Math.ceil(n / cols);
  // Réduction pour que toutes les rangées tiennent entre le titre et l'aide du bas
  const cw = 220, ch = rows > 1 ? 260 : 320, gx = cols > 3 ? 18 : 34, gy = 12;
  const S = rows > 1 ? Math.min(0.72, (H - 84 - 70 - (rows - 1) * gy) / (rows * ch), (W - 40 - (cols - 1) * gx) / (cols * cw)) : 1;
  const x0 = W / 2 - (cols * cw * S + (cols - 1) * gx) / 2;
  CHAR_IDS.forEach((id, k) => drawCard(k, x0 + (k % cols) * (cw * S + gx), 84 + Math.floor(k / cols) * (ch * S + gy), cw, ch, S));

  // Aide en bas d'écran
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 62, W, 62);
  ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = COLORS_P[0];
  ctx.fillText(`J1 :  ${K('left')} ${K('right')} choisir     ${K('punch')} ou Entrée valider     ${K('kick')} annuler     (manette : A valider, Y annuler)`, W / 2, H - 38);
  ctx.fillStyle = COLORS_P[1];
  const nj = sel.joined.filter(Boolean).length;
  if (sel.joined[1]) ctx.fillText(`J2 :  ${K('left', 1)} ${K('right', 1)} choisir     ${K('punch', 1)} valider     ${K('kick', 1)} annuler ou quitter${nj < 4 ? '     —     J3 / J4 : A sur une autre manette, ou en ligne' : ''}`, W / 2, H - 14);
  else if (Math.floor(sceneT * 2) % 2 === 0) ctx.fillText(`JOUEURS 2 à 4 : ${K('punch', 1)} (pavé numérique) ou A sur une autre manette pour rejoindre${net.role === 'host' ? `   —   code en ligne : ${net.code}` : ''}`, W / 2, H - 14);
  if (OPTS.tag) outlined([0, 1, 2, 3].some(p => sel.joined[p] && !sel.ready[p] && sel.first[p] !== null) ? 'CHOISIS TON PARTENAIRE DE RELAIS' : 'ÉQUIPE DE DEUX : choisis 2 combattants', W / 2, 76, 16, '#ff8ae6');
  if (sel.go > 0) outlined('EN AVANT !', W / 2, H / 2 + 10, 70 + sel.go * 30, '#ffe14d');
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
  drawProjs();
  drawWhips();
  drawZaps(1 / 60);
  drawFX();
  drawParticles();
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash)})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  drawHUD();

  if (scene === 'gameover') {
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
