'use strict';
// Jeu en ligne par l'état (25/10) : l'hôte fait tourner la partie et envoie ~30 fois par seconde l'état de tout ce qui
// se dessine (persos, ennemis, tirs, niveau, menus, scores, sons joués) au lieu d'une vidéo. Chaque invité redessine
// la partie lui-même à 60 images/s et prolonge les mouvements entre deux états (vitesses connues) : plus d'encodage
// vidéo, quelques Ko par état au lieu d'un flux d'images, et l'image reste nette.
// Encodage : objets simples et tableaux ; une référence à une donnée fixe du jeu (fiches des persos, coups, formes,
// ennemis, sprites…) devient { $: n } (même registre des deux côtés) ; un objet déjà vu dans le même état devient
// { '@': id } (persos visés par un tir, propriétaire d'une bombe…) ; les fonctions, sons et images sont ignorés.
// Chargé avant game.js : tout ne sert qu'une fois la partie en ligne lancée.

const NET_VER = 'state-3'; // l'hôte et l'invité doivent avoir le même code (même registre des données fixes)
const NET_HZ = 30;
// Variables du jeu envoyées à chaque état (comparées : une variable inchangée n'est pas renvoyée)
const NET_VARS = ['scene', 'players', 'enemies', 'bombs', 'projs', 'waves', 'stars', 'clones', 'zaps', 'kirin', 'blackFlames', 'crows', 'cutins',
  'ZONES', 'WAVES', 'storyDlg', 'gameMode', 'levelPick'];
const NET_SCALARS = ['sceneT', 'camX', 'shake', 'flash', 'hitstop', 'score', 'combo', 'comboT', 'kills', 'paused', 'dimK'];
// Objets d'état modifiés sur place (menus, niveau, sélection…) : recopiés champ par champ
const NET_OBJS = ['level', 'sel', 'lvSel', 'menu', 'titleMenu', 'optMenu', 'story', 'map', 'ENDLESS'];
// Listes qui ne font que grandir puis vieillir seules : seuls les nouveaux éléments sont envoyés, l'invité les fait vieillir
const NET_APPEND = ['particles', 'fxs', 'popups'];
// Champs qui ne servent qu'à la logique de l'hôte (inutiles au dessin)
const NET_SKIP = new Set(['hitSet', 'hit', 'carry', 'ultraSnd', 'snd']);

const NETV = {};
for (const n of [...NET_VARS, ...NET_SCALARS, ...NET_APPEND, 'LVL']) NETV[n] = { get: new Function('return typeof ' + n + ' === "undefined" ? undefined : ' + n), set: new Function('v', n + ' = v') };
for (const n of NET_OBJS) NETV[n] = { get: new Function('return typeof ' + n + ' === "undefined" ? undefined : ' + n) };

// ---------- Registre des données fixes (construit à l'identique chez l'hôte et l'invité) ----------
let NETC = null, NETC_IDX = null;
function netConsts() {
  if (NETC) return;
  NETC = []; NETC_IDX = new Map();
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || NETC_IDX.has(v) || d > 7) return;
    NETC_IDX.set(v, NETC.length); NETC.push(v);
    for (const k of Object.keys(v)) walk(v[k], d + 1);
  };
  for (const root of [CHARS, ETYPES, typeof ITEMS !== 'undefined' ? ITEMS : null, typeof FX !== 'undefined' ? FX : null, SPRITES]) walk(root, 0);
}

// ---------- Encodage (hôte) ----------
const netIds = new WeakMap(); let netIdN = 0;
const netNum = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : (v > 0 ? 1e9 : v < 0 ? -1e9 : 0);
function netEnc(v, seen) {
  if (v === null || v === undefined) return v === null ? null : undefined;
  const t = typeof v;
  if (t === 'number') return netNum(v);
  if (t === 'string' || t === 'boolean') return v;
  if (t !== 'object') return undefined; // fonctions
  const c = NETC_IDX.get(v);
  if (c !== undefined) return { $: c };
  if (Array.isArray(v)) return v.map(x => { const e = netEnc(x, seen); return e === undefined ? null : e; });
  if (v instanceof Set) return { $s: [...v].map(x => netEnc(x, seen)).filter(x => x !== undefined) };
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return undefined; // images, sons, éléments de la page
  let id = netIds.get(v);
  if (id === undefined) netIds.set(v, id = ++netIdN);
  if (seen.has(v)) return { '@': id };
  seen.add(v);
  const out = { '#': id };
  for (const k of Object.keys(v)) {
    if (NET_SKIP.has(k)) continue;
    const e = netEnc(v[k], seen);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

// ---------- Sons : l'hôte note les sons joués pendant l'image, l'invité les rejoue ----------
const netSfx = []; let netSfxIn = 0;
function netHookAudio() {
  if (audio.__net) return;
  audio.__net = true;
  for (const m of ['voice', 'play', 'tone', 'sweep']) {
    const orig = audio[m];
    audio[m] = function (...a) {
      if (net.role === 'host' && !netSfxIn && Object.keys(net.guests).length) netSfx.push([m, a]);
      netSfxIn++;
      try { return orig.apply(this, a); } finally { netSfxIn--; }
    };
  }
}

// ---------- Hôte : un état toutes les 1/30 s ----------
const netLast = {}; // dernier texte envoyé par variable (une variable inchangée n'est pas renvoyée)
const netSent = new WeakSet(); let netAcc = 0, netFull = true;
function netHostTick(dt) {
  if (net.role !== 'host') return;
  const guests = Object.values(net.guests).filter(c => c.open);
  if (!guests.length) { netSfx.length = 0; return; }
  netAcc += dt;
  if (netAcc < 1 / NET_HZ) return;
  netAcc = 0;
  // un invité qui ne suit pas (file d'envoi pleine) : on saute cet état plutôt que d'accumuler du retard
  if (guests.every(c => (c.dataChannel?.bufferedAmount || 0) > 256e3)) return;
  netConsts();
  const seen = new Set(), msg = netFull ? { t: 's', full: 1, v: {}, o: {}, a: {}, sc: {} } : { t: 's', v: {}, o: {}, a: {}, sc: {} };
  if (netFull) { for (const k of Object.keys(netLast)) delete netLast[k]; netFull = false; }
  msg.lvl = LVL?.id;
  for (const n of NET_SCALARS) msg.sc[n] = netEnc(NETV[n].get(), seen);
  for (const n of [...NET_VARS, ...NET_OBJS]) {
    const e = netEnc(NETV[n].get(), seen) ?? null, s = JSON.stringify(e);
    if (netLast[n] === s) continue;
    netLast[n] = s; (NET_OBJS.includes(n) ? msg.o : msg.v)[n] = e;
  }
  for (const n of NET_APPEND) {
    const list = NETV[n].get() || [], fresh = list.filter(x => !netSent.has(x));
    fresh.forEach(x => netSent.add(x));
    if (fresh.length) msg.a[n] = fresh.map(x => netEnc(x, seen));
  }
  if (netSfx.length) { msg.sfx = netSfx.map(([m, a]) => [m, a.map(x => netEnc(x, seen))]); netSfx.length = 0; }
  const txt = JSON.stringify(msg);
  net.bytes = (net.bytes || 0) * 0.9 + txt.length * 0.1; // taille moyenne d'un état (diagnostic)
  for (const c of guests) if ((c.dataChannel?.bufferedAmount || 0) < 256e3) try { c.send(txt); } catch (e) { }
}
// Nouvel invité : on lui renvoie tout au prochain état
function netResync() { netFull = true; }

// ---------- Invité : applique les états reçus, prolonge les mouvements entre deux ----------
const netObjs = new Map(); let netGen = 0;
function netDec(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(netDec);
  if ('$' in v) return NETC[v.$];
  if ('$s' in v) return new Set(v.$s.map(netDec));
  if ('@' in v) { let o = netObjs.get(v['@']); if (!o) netObjs.set(v['@'], o = { __g: netGen }); return o; }
  const id = v['#'];
  let o = netObjs.get(id);
  if (!o) netObjs.set(id, o = {});
  for (const k of Object.keys(o)) if (!(k in v) && !k.startsWith('__')) delete o[k];
  for (const k of Object.keys(v)) if (k !== '#') o[k] = netDec(v[k]);
  o.__g = netGen;
  return o;
}
const netQueue = [];
// chaque état ne contient que ce qui a changé : ils s'appliquent tous, dans l'ordre. Trop de retard (onglet en
// arrière-plan…) : on les oublie et on redemande un état complet à l'hôte
function netOnState(txt) {
  if (netQueue.length > 150) { netQueue.length = 0; netWaitFull = true; try { net.conn?.send({ t: 'resync' }); } catch (e) { } }
  const full = txt.startsWith('{"t":"s","full":1');
  if (netWaitFull && !full) return;
  if (full) netWaitFull = false;
  netQueue.push(txt);
}
let netWaitFull = false;
let netLvl = null, netChars = '', netSinceSnap = 0, netCam = { at: 0, v: 0 };
function netApply(txt) {
  netConsts();
  const m = JSON.parse(txt);
  netGen++;
  if (m.lvl && (!LVL || LVL.id !== m.lvl)) { const k = LEVELS.findIndex(L => L.id === m.lvl); if (k >= 0) setLevel(k); }
  for (const [n, v] of Object.entries(m.v)) NETV[n].set(netDec(v));
  for (const [n, v] of Object.entries(m.o)) { const o = NETV[n].get(); if (o && v) { const d = netDec(v); for (const k of Object.keys(d)) if (k !== '__g') o[k] = d[k]; } }
  const camWas = camX;
  for (const [n, v] of Object.entries(m.sc)) NETV[n].set(netDec(v));
  if (m.full) for (const n of NET_APPEND) NETV[n].set([]);
  for (const [n, list] of Object.entries(m.a)) { const arr = NETV[n].get(); for (const x of list) arr.push(netDec(x)); }
  for (const [fn, args] of m.sfx || []) try { audio[fn](...args.map(netDec)); } catch (e) { }
  // vitesse de la caméra (pour la prolonger entre deux états)
  netCam = { v: netSinceSnap > 0 ? (camX - camWas) / Math.max(netSinceSnap, 1 / 60) : 0 };
  netSinceSnap = 0;
  // images des persos et du niveau : chargées dès qu'ils changent
  const chars = (players || []).flatMap(h => [h.char, h.reserve?.char]).filter(Boolean).join(',');
  if (chars && (chars !== netChars || LVL?.id !== netLvl)) { netChars = chars; netLvl = LVL?.id; requireGame(chars.split(','), LVL); }
  // objets disparus depuis longtemps : oubliés
  if (netGen % 300 === 0) for (const [id, o] of netObjs) if (netGen - (o.__g || 0) > 300) netObjs.delete(id);
}
function netGuestTick(dt) {
  if (netQueue.length) {
    // en retard de plusieurs états : on applique tout, le dernier fait foi
    while (netQueue.length) netApply(netQueue.shift());
    net.live = true;
  } else if (net.live) {
    // entre deux états : on prolonge (le jeu de l'hôte avance pendant ce temps)
    netSinceSnap += dt;
    sceneT += dt;
    const play = ['play', 'gameover', 'clear'].includes(scene);
    if (play && netSinceSnap < 0.25 && !paused && !(hitstop > 0) && !level.card && players) {
      camX += netCam.v * dt;
      for (const list of [players, enemies, projs, bombs, clones]) for (const o of list || []) {
        if (typeof o.x === 'number' && typeof o.vx === 'number') o.x += o.vx * dt;
        if (typeof o.y === 'number' && typeof o.vy === 'number' && typeof o.gz === 'number' && list !== projs) o.y = Math.min(o.gz, o.y + o.vy * dt);
        if (typeof o.t === 'number') o.t += dt;
        if (o.state === 'walk' && typeof o.walkT === 'number') o.walkT += dt;
      }
    }
  }
  // étincelles, effets et textes : ils vieillissent chez l'invité
  if (particles) { updateParticles(dt); updateFX(dt); }
}
// Le registre des données fixes se construit au chargement de la page, avant toute partie : identique chez tous
addEventListener('load', () => { try { netConsts(); } catch (e) { } });
