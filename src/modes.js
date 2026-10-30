'use strict';
// Modes de jeu : menu titre, options (difficulté, vies, relais, volume, commandes), vies, relais entre deux
// personnages et attaque à deux, mode histoire (plateau des mondes et dialogues).
// Chargé avant game.js : les fonctions ne s'appellent qu'une fois le jeu lancé.

// ---------- Options (gardées dans le navigateur) ----------
const DIFFS = [
  { name: 'FACILE', dmg: 0.6, hp: 0.75, aggr: 0.7, desc: 'Ennemis moins agressifs, coups moins forts' },
  { name: 'NORMAL', dmg: 1, hp: 1, aggr: 1, desc: 'L\'équilibre prévu' },
  { name: 'DIFFICILE', dmg: 1.35, hp: 1.3, aggr: 1.3, desc: 'Ennemis plus résistants et plus vifs' },
  { name: 'LÉGENDE', dmg: 1.8, hp: 1.6, aggr: 1.6, desc: 'Pour les maîtres : chaque erreur se paie' },
];
const OPTS = { diff: 1, lives: 3, tag: false, music: 7, unlockAll: false };
try { Object.assign(OPTS, JSON.parse(localStorage.getItem('kfm_opts') || '{}')); } catch (e) { }
const saveOpts = () => { try { localStorage.setItem('kfm_opts', JSON.stringify(OPTS)); } catch (e) { } };
const DIFF = () => DIFFS[OPTS.diff] || DIFFS[1];
const applyOpts = () => { if (typeof MUSIC !== 'undefined') MUSIC.volume = 0.05 * OPTS.music; };

// Mode en cours : 'arcade' (niveau au choix), 'story' (plateau des mondes) ou 'endless' (src/endless.js)
let gameMode = 'arcade';

// ---------- Menu de l'écran titre ----------
const TITLE_ITEMS = [
  ['story', 'MODE HISTOIRE', 'La Fracture des Mondes — de monde en monde sur le plateau'],
  ['arcade', 'COMBAT LIBRE', 'Choisis ton combattant et ta scène'],
  ['endless', 'MODE INFINI', 'Des vagues sans fin, de plus en plus dures : bats le record du monde'],
  ['online', 'EN LIGNE', 'Crée une partie ou rejoins des amis avec un code (jusqu\'à 4)'],
  ['options', 'OPTIONS', 'Difficulté, vies, relais, volume et touches'],
];
const titleMenu = { row: 0 };
function updateTitleMenu() {
  const hit = a => anyPressed(a);
  if (hit('up')) { titleMenu.row = (titleMenu.row + TITLE_ITEMS.length - 1) % TITLE_ITEMS.length; audio.tone(620, 0.05, 'triangle', 0.06); }
  if (hit('down')) { titleMenu.row = (titleMenu.row + 1) % TITLE_ITEMS.length; audio.tone(620, 0.05, 'triangle', 0.06); }
  if (sceneT > 0.3 && ['start', 'punch', 'jump'].some(hit)) {
    const id = TITLE_ITEMS[titleMenu.row][0];
    audio.tone(880, 0.12, 'triangle', 0.1, 300);
    if (id === 'options') openOptions();
    else if (id === 'online') openOnline();
    else { gameMode = id; openSelect(); }
  }
}
function drawTitleMenu() {
  const x = 40, y0 = 286;
  TITLE_ITEMS.forEach(([id, label], k) => {
    const on = k === titleMenu.row, y = y0 + k * 44, dx = on ? 14 + Math.sin(sceneT * 6) * 2 : 0;
    ctx.save(); ctx.translate(x + dx, y); ctx.transform(1, 0, -0.18, 1, 0, 0);
    ctx.fillStyle = on ? 'rgba(220,20,60,0.92)' : 'rgba(10,0,25,0.7)'; ctx.fillRect(0, -28, 330, 38);
    if (on) { ctx.fillStyle = '#ffe14d'; ctx.fillRect(0, -28, 8, 38); ctx.fillRect(0, 8, 330, 2); }
    ctx.restore();
    outlined(label, x + 34 + dx, y, on ? 26 : 22, on ? '#ffe14d' : '#fff', 'left');
  });
}

// ---------- Options ----------
const OPT_ROWS = ['diff', 'lives', 'tag', 'unlock', 'music', 'binds', 'reset', 'back'];
const optMenu = { row: 0, msg: '' };
const RESET_ASK = 'Appuie encore pour tout effacer : histoire, recrues, notes et défis';
function openOptions() { scene = 'options'; sceneT = 0; optMenu.row = 0; optMenu.msg = ''; }
function updateOptions() {
  const hit = a => anyPressed(a);
  const n = OPT_ROWS.length, id = OPT_ROWS[optMenu.row];
  if (hit('up')) { optMenu.row = (optMenu.row + n - 1) % n; optMenu.msg = ''; audio.tone(620, 0.05, 'triangle', 0.06); }
  if (hit('down')) { optMenu.row = (optMenu.row + 1) % n; optMenu.msg = ''; audio.tone(620, 0.05, 'triangle', 0.06); }
  const d = hit('left') ? -1 : hit('right') ? 1 : 0;
  if (d) {
    if (id === 'diff') OPTS.diff = clamp(OPTS.diff + d, 0, DIFFS.length - 1);
    if (id === 'lives') OPTS.lives = clamp(OPTS.lives + d, 1, 9);
    if (id === 'tag') OPTS.tag = !OPTS.tag;
    if (id === 'unlock') OPTS.unlockAll = !OPTS.unlockAll;
    if (id === 'music') OPTS.music = clamp(OPTS.music + d, 0, 10);
    saveOpts(); applyOpts(); audio.tone(700 + d * 80, 0.06, 'triangle', 0.08);
  }
  if (sceneT > 0.2 && ['start', 'punch', 'jump'].some(hit)) {
    if (id === 'tag') { OPTS.tag = !OPTS.tag; saveOpts(); }
    if (id === 'unlock') { OPTS.unlockAll = !OPTS.unlockAll; saveOpts(); }
    if (id === 'binds') { paused = true; openMenu('binds'); }
    if (id === 'reset') {
      // deux appuis : le premier prévient, le second efface (histoire, recrues, notes et défis)
      if (optMenu.msg !== RESET_ASK) optMenu.msg = RESET_ASK;
      else { story.unlocked = 1; story.node = 0; story.done = []; saveStory(); prog.cleared = []; prog.ranks = {}; prog.ch = {}; saveProg(); optMenu.msg = 'Progression effacée'; }
    }
    if (id === 'back') { scene = 'title'; sceneT = 0; }
    audio.tone(880, 0.1, 'triangle', 0.1);
  }
  if (hit('kick')) { scene = 'title'; sceneT = 0; }
}
function drawOptions() {
  camX = sceneT * 40; drawBackground();
  ctx.fillStyle = 'rgba(8,2,24,0.82)'; ctx.fillRect(0, 0, W, H);
  if (paused) { drawPauseMenu(); return; }
  outlined('OPTIONS', W / 2, 66, 44, '#ffe14d');
  const D = DIFF();
  const rows = {
    diff: ['DIFFICULTÉ', `◀  ${D.name}  ▶`, D.desc],
    lives: ['VIES PAR NIVEAU', `◀  ${OPTS.lives}  ▶`, `${'♥'.repeat(OPTS.lives)} — à chaque K.O., une vie en moins ; on repart à ${OPTS.lives} au niveau suivant`],
    unlock: ['TOUT DÉBLOQUER', OPTS.unlockAll ? '◀  OUI  ▶' : '◀  NON  ▶', OPTS.unlockAll ? 'Tous les combattants et toutes les tenues sont jouables' : `Sinon : termine les mondes pour recruter leurs maîtres, réussis les défis pour les tenues (${lockedCount()} à gagner)`],
    tag: ['ÉQUIPE DE DEUX (RELAIS)', OPTS.tag ? '◀  OUI  ▶' : '◀  NON  ▶', `Chaque joueur choisit 2 combattants : ${K('tag')} pour passer le relais, ${K('tag')} avec les deux jauges pleines = attaque à deux`],
    music: ['VOLUME DE LA MUSIQUE', `◀  ${'▮'.repeat(OPTS.music)}${'▯'.repeat(10 - OPTS.music)}  ▶`, ''],
    binds: ['TOUCHES ET MANETTES', 'MODIFIER…', 'Clavier et manette de chaque joueur'],
    reset: ['PROGRESSION', 'TOUT EFFACER', `Mondes de l'histoire : ${story.unlocked} / ${STORY_ORDER.length}  ·  défis réussis : ${Object.keys(prog.ch).length}`],
    back: ['', 'RETOUR', ''],
  };
  OPT_ROWS.forEach((id, k) => {
    const [label, value, help] = rows[id], on = k === optMenu.row, y = 124 + k * 47;
    if (on) { ctx.fillStyle = 'rgba(255,225,77,0.14)'; ctx.fillRect(120, y - 28, W - 240, 44); ctx.fillStyle = '#ffe14d'; ctx.fillRect(120, y - 28, 5, 44); }
    outlined(label, 150, y, 20, on ? '#fff' : '#cfd3ff', 'left');
    outlined(value, W - 150, y, 22, on ? '#ffe14d' : '#fff', 'right');
    if (on && help) { ctx.font = 'italic 13px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd6e8'; ctx.fillText(help, 150, y + 14); }
  });
  if (optMenu.msg) outlined(optMenu.msg, W / 2, H - 50, 18, '#7ff0ff');
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 34, W, 34);
  ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = COLORS_P[0];
  ctx.fillText(`↑ ↓ choisir     ← → régler     ${K('punch')} ou Entrée : valider     ${K('kick')} retour`, W / 2, H - 12);
}

// ---------- Vies ----------
// Appelé quand un joueur tombe K.O. (vie à 0) : relais automatique vers le partenaire s'il tient encore,
// sinon une vie en moins et retour en jeu ; sans vie, il reste au tapis.
function onKO(h) {
  run.kos++;
  if (h.reserve && h.reserve.hp > 0) { h.koSwap = 1.2; return; }
  h.lives = Math.max(0, (h.lives ?? 0) - 1);
}
const allOut = () => players.filter(p => !p.assist).every(p => p.out && !(p.lives > 0) && !p.koSwap);
// Retour en jeu après un K.O. (gérée dans updatePlayer au tapis)
function reviveCheck(h, dt) {
  if (h.koSwap) { h.koSwap -= dt; if (h.koSwap <= 0) { h.koSwap = 0; tagSwap(h, true); } return true; }
  if (h.lives > 0 && h.outT > 2.2) {
    h.out = false; h.hp = h.maxHp; h.ki = Math.max(h.ki, 50); h.boost = null;
    // il disparaît du sol, un éclair frappe, et il redescend du ciel (updateRespawn)
    h.state = 'respawn'; h.t = 0; h.inv = 99; h.vx = 0; h.vz = 0; h.respawn = { t: 0, drop: false };
    h.x = clamp(h.x, camX + 120, camX + W - 120);
    if (h.reserve) h.reserve.hp = Math.max(h.reserve.hp, h.reserve.maxHp * 0.5);
    return true;
  }
  return false;
}
// Retour du ciel : éclair (0,35 s), chute dans une colonne de lumière, atterrissage qui repousse les ennemis.
// Ensuite une aura le protège 2 s (au lieu du clignotement).
const RESPAWN = { strike: 0.35, from: 560, aegis: 2 };
function updateRespawn(h, dt) {
  const R = h.respawn;
  R.t += dt;
  if (!R.struck) {
    R.struck = true;
    for (let k = 0; k < 3; k++) zaps.push({ x1: h.x + rand(-20, 20), y1: -30, x2: h.x + rand(-12, 12), y2: h.gz - 4, t: 0, life: 0.45 + k * 0.08, seed: rand(0, 99) });
    flash = Math.max(flash, 0.7); shake = Math.max(shake, 12);
    burst(h.x, h.gz - 10, '#d8f0ff', 22); ring(h.x, h.gz - 10);
    audio.play('ultraBoom', 0.55, 1.4); audio.zip();
  }
  if (R.t < RESPAWN.strike) return;
  if (!R.drop) { R.drop = true; h.y = h.gz - RESPAWN.from; h.vy = 700; h.onGround = false; h.state = 'jump'; h.t = 0; }
  h.vy += 2600 * dt; h.y += h.vy * dt;
  if (Math.random() < 0.8) particles.push({ x: h.x + rand(-30, 30), y: h.y - rand(40, 200), vx: 0, vy: -rand(200, 500), t: 0, life: 0.3, c: h.C.colors[1], r: rand(3, 6) });
  if (h.y < h.gz) return;
  // Atterrissage
  h.y = h.gz; h.vy = 0; h.onGround = true; h.state = 'land'; h.t = 0; h.respawn = null;
  h.inv = RESPAWN.aegis; h.aegis = RESPAWN.aegis;
  shake = Math.max(shake, 16); flash = Math.max(flash, 0.4);
  ring(h.x, h.gz - 10); ring(h.x, h.gz - 60);
  for (let k = 0; k < 26; k++) { const a = rand(Math.PI, 2 * Math.PI); particles.push({ x: h.x, y: h.gz - 6, vx: Math.cos(a) * rand(200, 520), vy: Math.sin(a) * rand(60, 260), t: 0, life: 0.55, c: 'rgba(230,220,200,0.7)', r: rand(5, 11), soft: true }); }
  audio.play('hitHeavy', 0.9, 0.8);
  for (const e of enemies) {
    if (!e.alive || Math.abs(e.x - h.x) > 230 || Math.abs(e.gz - h.gz) > 70) continue;
    const d = Math.sign(e.x - h.x) || 1;
    damageEnemy(e, 1, d * 520, -420, e.x, e.y - 100, h.C.colors[1]);
  }
  popups.push({ x: h.x, y: h.y - 240, t: 0, text: `ENCORE ${h.lives} ${h.lives > 1 ? 'VIES' : 'VIE'} !` });
}
// Pendant la chute : colonne de lumière derrière le perso ; ensuite l'aura de protection
function drawRespawn(h, sx) {
  const R = h.respawn;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (R) {
    const a = R.drop ? 0.55 : Math.min(1, R.t / 0.1) * 0.8, w = R.drop ? 70 : 110;
    const g = ctx.createLinearGradient(sx - w, 0, sx + w, 0);
    g.addColorStop(0, 'rgba(150,210,255,0)'); g.addColorStop(0.5, `rgba(220,240,255,${a})`); g.addColorStop(1, 'rgba(150,210,255,0)');
    ctx.fillStyle = g; ctx.fillRect(sx - w, 0, w * 2, h.gz);
  } else if (h.aegis > 0) {
    const a = Math.min(1, h.aegis) * (0.45 + Math.sin(h.aegis * 14) * 0.15);
    const g = ctx.createRadialGradient(sx, h.y - 110, 20, sx, h.y - 110, 150);
    g.addColorStop(0, `rgba(255,255,255,${a * 0.5})`); g.addColorStop(0.6, h.C.colors[1] + '55'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = Math.min(1, h.aegis); ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(sx, h.y - 110, 110, 150, 0, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// ---------- Relais et attaque à deux ----------
// Le partenaire attend hors de l'écran (h.reserve) et récupère doucement sa vie et son ki.
function tagSwap(h, forced = false) {
  const R = h.reserve;
  if (!R || (!forced && (h.tagCool > 0 || R.hp <= 0))) return;
  const i = players.indexOf(h);
  const nh = Object.assign(R, { x: h.x - h.dir * 30, y: h.gz, gz: h.gz, dir: h.dir, vx: h.dir * 300, vy: 0, vz: 0, state: 'idle', t: 0, move: null,
    onGround: true, inv: 1.2, out: false, outT: 0, lives: h.lives, tagCool: 2.5, reserve: h, idx: h.idx });
  h.reserve = null; h.move = null; h.boost = null; h.state = 'idle'; h.out = false; h.koSwap = 0;
  players[i] = nh;
  burst(nh.x, nh.y - 110, nh.C.colors[1], 26); ring(nh.x, nh.y - 40);
  popups.push({ x: nh.x, y: nh.y - 240, t: 0, text: forced ? `À TOI, ${nh.C.name} !` : 'RELAIS !' });
  audio.zip(); audio.whoosh(1.2);
}
function updateReserve(h, dt) {
  h.tagCool = Math.max(0, (h.tagCool || 0) - dt);
  const R = h.reserve;
  if (!R) return;
  if (R.hp > 0) R.hp = Math.min(R.maxHp, R.hp + dt * 2.5);
  R.ki = Math.min(100, R.ki + dt * 3);
}
// Bouton de relais : passer la main, ou attaque à deux si les deux jauges de ki sont pleines
function tagPressed(h) {
  if (!h.reserve || h.out || busy(h) || !h.onGround) return;
  if (h.ki >= KI.ultra && h.reserve.ki >= KI.ultra && h.reserve.hp > 0) duoAttack(h);
  else if (h.tagCool > 0) denied(h, 'RELAIS BIENTÔT PRÊT');
  else if (h.reserve.hp <= 0) denied(h, 'PARTENAIRE À TERRE');
  else tagSwap(h);
}
// Attaque à deux : le partenaire surgit à côté et les deux lancent leur ultime en même temps
function duoAttack(h) {
  const R = h.reserve;
  const A = Object.assign(newPlayer(h.idx, R.char, 1), { x: h.x - h.dir * 90, gz: h.gz + 6, y: h.gz + 6, dir: h.dir, assist: true, inv: 99 });
  A.power = R.ki; R.ki = 0;
  players.push(A);
  for (const p of [h, A]) {
    p.power = p.power || h.ki; p.state = 'ultra'; p.t = 0; p.vx = 0; p.move = null;
    p.C.ultra[0](p); audio.voice(p, 'ultra'); cutins = cutins.filter(c => c.h !== p); cutins.push({ h: p, t: 0, duo: p === A });
  }
  h.power = h.ki; h.ki = 0; powerDown(h);
  flash = 0.6; shake = 20;
  popups.push({ x: h.x, y: h.y - 280, t: 0, text: `ATTAQUE DUO : ${h.C.name} × ${R.C.name} !!` });
  audio.sweep(0.6, 400, 5000, 0.35, 1.2);
}
// Le partenaire de l'attaque à deux repart une fois son ultime fini
function updateAssists() {
  for (const A of players.filter(p => p.assist)) {
    A.inv = 99;
    if (A.state !== 'ultra') { burst(A.x, A.y - 100, A.C.colors[1], 20); A.gone = true; }
  }
  if (players.some(p => p.gone)) players = players.filter(p => !p.gone);
}

// ---------- Mode histoire ----------
// Ordre des mondes sur le plateau (identifiants de LEVELS) et position des cases (écran 960 × 540)
const STORY_ORDER = ['tokyo', 'op', 'ds', 'hx', 'nr', 'bl', 'mh', 'rk', 'sl', 'op2', 'ds2', 'jk', 'nr2', 'opm', 'bl2', 'db', 'db2'];
// Les mondes sont des planètes sur une spirale autour du Sceau brisé (galaxie inclinée vue de biais, écran 960 × 540) :
// Tokyo au bord, le Cell Game tout près du cœur de la Fracture. [x, y, rayon]
const MAP_CX = 480, MAP_CY = 254;
const MAP_NODES = STORY_ORDER.map((_, k) => {
  const th = Math.PI / 2 + k * 0.66, rho = 1 - 0.64 * k / 16, y = MAP_CY + 170 * rho * Math.sin(th);
  return [MAP_CX + 430 * rho * Math.cos(th), y, 36 * Math.pow(rho, 0.55) * (0.8 + 0.2 * (y - MAP_CY) / 170)];
});
// Les maîtres recrutés dans chaque monde : la Masterclass (affichée en bas du plateau)
const RECRUITS = {
  tokyo: ['ippo', 'baki'], op: ['luffy', 'ace'], ds: ['tanjiro'], hx: ['gon', 'killua'], nr: ['naruto', 'kakashi', 'boruto'], bl: ['ichigo', 'eren'], mh: ['izuku', 'shoto', 'bakugo'],
  rk: ['kenshin', 'revy', 'gintoki'], sl: ['jinwoo', 'saber', 'edward'], op2: ['zoro', 'sanji'], ds2: ['zenitsu', 'inosuke'], jk: ['gojo', 'levi'], nr2: ['sasuke', 'itachi', 'naruto_s'], opm: ['saitama', 'mikasa'], bl2: ['guts', 'gally'],
  db: ['goku', 'vegeta', 'seiya'], db2: ['gohan', 'trunks', 'piccolo', 'gohan_a'], bu: ['buu', 'buu_kid'],
};
const story = { unlocked: 1, node: 0, done: [] };
try { Object.assign(story, JSON.parse(localStorage.getItem('kfm_story') || '{}')); } catch (e) { }
const saveStory = () => { try { localStorage.setItem('kfm_story', JSON.stringify({ unlocked: story.unlocked, node: story.node, done: story.done })); } catch (e) { } };

// Le texte : narrateur (N), héros du joueur 1 (H), boss du monde (B). {H} = nom du héros.
// Le Sceau a volé en seize éclats ; un éclat ne se recolle que porté par un maître de son monde. D'un monde à
// l'autre, le héros réunit ces maîtres : la Masterclass. Texte relu au Humanizer (passe légère, docs/histoire.md).
const STORY = {
  tokyo: {
    title: 'PROLOGUE — LA FRACTURE',
    intro: [['N', 'Tokyo, une nuit de pluie. Au sommet d\'un sanctuaire oublié, Kuro-Oni brise le Sceau des Mille Mondes.'],
      ['N', 'Le ciel se fend en failles rouges. Par chacune, un monde déborde sur un autre.'],
      ['H', 'Les rues sont pleines de choses qui n\'ont rien à faire ici. Je monte au sanctuaire.']],
    outro: [['B', 'Trop tard. Le Sceau a volé en seize éclats, et chacun s\'est trouvé un maître.'],
      ['N', 'Un jeune boxeur a tout vu depuis le toit de sa salle. Ippo n\'a jamais quitté Tokyo. Il prend son sac quand même.'],
      ['N', 'Dans l\'arène clandestine sous le Dôme de Tokyo, un garçon aux cheveux rouges a senti le Sceau se briser. Baki referme le poing : enfin des adversaires qui ne viennent pas de ce monde.'],
      ['N', 'Une faille aspire Kuro-Oni, et {H} avec lui. Ippo saute derrière, Baki aussi. La Masterclass compte trois élèves.'],
      ['N', 'De l\'autre côté s\'étend l\'Entre-Mondes, un ciel sans fond où chaque monde flotte comme une planète. Les failles les relient.'],
      ['N', 'Au centre tourne ce qui reste du Sceau, autour du tourbillon de la Fracture. Il y manque seize éclats.']],
  },
  op: {
    title: 'CHAPITRE 1 — LA VILLE DU COMMENCEMENT',
    intro: [['N', 'Loguetown. Sur l\'échafaud où Gold Roger a ri une dernière fois, un éclat brille.'],
      ['H', 'Et un clown s\'en est fait une couronne.']],
    outro: [['B', 'Mon nez n\'est PAS rouge à cause de ce caillou !!'],
      ['N', 'Dans la foule, un garçon au chapeau de paille rit à s\'en tenir le ventre. D\'autres mondes ? Luffy monte à bord avant qu\'on lui demande.'],
      ['N', 'Sur le quai, son grand frère Ace allume une cigarette du bout du doigt. Il suit le mouvement, pour garder un œil sur son petit frère.']],
  },
  ds: {
    title: 'CHAPITRE 2 — LE TRAIN DE L\'INFINI',
    intro: [['N', 'Un train file dans la nuit. Ses passagers dorment et ne se réveillent plus.'],
      ['H', 'Les démons sortent des wagons. L\'éclat est sur le toit, avec celui qui le garde.']],
    outro: [['B', 'Deviens un démon. Combats-moi pour l\'éternité !'],
      ['N', 'Akaza fuit l\'aube. Tanjiro essuie sa lame. Là où il y a des démons, il y a du travail pour lui.']],
  },
  hx: {
    title: 'CHAPITRE 3 — LA TOUR CÉLESTE',
    intro: [['N', 'Deux cent cinquante étages de combats. Tout en haut, un magicien joue avec un éclat comme avec une carte.'],
      ['B', 'Mmm… un fruit encore vert, venu d\'ailleurs. Montre-moi comment tu mûris ♠']],
    outro: [['B', 'Pas encore mûr… mais délicieux. Garde l\'éclat, on se reverra ♦'],
      ['N', 'Gon veut voir ce qu\'il y a au bout de la faille. Killua soupire. Il le suit, comme toujours.']],
  },
  nr: {
    title: 'CHAPITRE 4 — LE VILLAGE CACHÉ DE LA FEUILLE',
    intro: [['N', 'Konoha est assiégé. Orochimaru veut un corps éternel, et l\'éclat pourrait le lui donner.'],
      ['H', 'Il s\'est caché dans la forêt de la Mort. On y va.']],
    outro: [['B', 'Ce pouvoir venu d\'ailleurs… Un jour, il sera à moi.'],
      ['N', 'Naruto réclame sa place en criant plus fort que tout le monde. Kakashi lève les yeux de son livre : quelqu\'un doit surveiller ces élèves.'],
      ['N', 'Un garçon blond tombé d\'une faille du futur regarde Naruto sans y croire. Boruto ne dit pas qui il est. Il suit, c\'est tout.']],
  },
  bl: {
    title: 'CHAPITRE 5 — LA SOUL SOCIETY',
    intro: [['N', 'Les portes du Seireitei sont tombées. Un capitaine affamé de combats a avalé un éclat.'],
      ['B', 'Enfin quelqu\'un de solide ! Ne meurs pas trop vite !']],
    outro: [['B', 'Ha… HA HA ! C\'était bien ! Reviens quand tu veux !'],
      ['N', 'Kenpachi s\'endort dans les gravats. Ichigo était venu le calmer. Il repart avec vous à la place.'],
      ['N', 'Au pied des murailles blanches du Seireitei, un soldat à la cape verte serre ses lames. Des murs, Eren en a assez vu. Il veut savoir ce qu\'il y a derrière les failles.']],
  },
  mh: {
    title: 'CHAPITRE 6 — L\'USJ',
    intro: [['N', 'Le centre d\'entraînement de Yuei est envahi. Un Nomu a reçu un éclat en guise de cœur.'],
      ['H', 'Les élèves sont coincés dans la zone incendie. Pas une seconde à perdre.']],
    outro: [['B', '…GRAAAH…'],
      ['N', 'Izuku a noté chaque coup dans son carnet. Une école de héros venus de tous les mondes ? Impossible de rater ça.'],
      ['N', 'Shoto éteint les dernières flammes d\'un geste de la main droite. Il vient aussi. Il ne dit pas pourquoi.']],
  },
  rk: {
    title: 'CHAPITRE 7 — KYOTO EN FLAMMES',
    intro: [['N', 'Kyoto brûle. Un homme couvert de bandages veut renverser le gouvernement avec la force de mille mondes.'],
      ['B', 'Ce monde appartient aux forts. L\'éclat me l\'a confirmé.']],
    outro: [['B', 'Mon corps… brûle… Ce n\'est pas fini…'],
      ['N', 'Kenshin aide à éteindre le quartier avant de partir. Il a juré de ne plus tuer. Dans une classe pareille, il faudra quelqu\'un pour rappeler où s\'arrêter.'],
      ['N', 'Au port d\'Osaka, une femme tatouée descend d\'une vedette de contrebande, un pistolet dans chaque main. Revy était venue pour la paie. Elle reste pour la bagarre.'],
      ['N', 'Sur un banc, un samouraï aux cheveux argentés finit un lait-fraise, un sabre de bois à la ceinture. Gintoki dit qu\'il passait par là. Il suit quand même, parce que quelqu\'un doit bien payer le loyer.']],
  },
  sl: {
    title: 'CHAPITRE 8 — LE DOUBLE DONJON',
    intro: [['N', 'Une porte bleue s\'est ouverte en plein Séoul. Au fond, un temple où les statues sourient.'],
      ['N', 'Les règles sont gravées sur une tablette. La première dit : prosternez-vous.'],
      ['H', 'Je ne me prosterne pas. Je traverse.']],
    outro: [['B', '…'],
      ['N', 'Igris met un genou à terre, mais pas devant {H}. Derrière, dans l\'ombre, Jin-Woo vient de se relever. Lui seul a entendu le mot : « Arise ».'],
      ['N', 'Au fond du temple, une jeune femme en armure range une épée qu\'on ne voit pas. Ces statues de chevaliers lui ont rappelé une table ronde. Saber suit la troupe, la main sur la garde.'],
      ['N', 'Un garçon au manteau rouge relève les runes de la tablette : ce sont presque des cercles de transmutation. Edward veut savoir qui les a gravés. Il suit, et prie qu\'on ne le traite pas de petit.']],
  },
  op2: {
    title: 'CHAPITRE 9 — ENIES LOBBY',
    intro: [['N', 'L\'île judiciaire du Gouvernement mondial. Le CP9 garde un éclat dans la tour de la Justice.'],
      ['B', 'La justice des ténèbres se moque des mondes. Je vais t\'effacer.']],
    outro: [['B', 'Impossible… Mon Rokuogan…'],
      ['N', 'Zoro s\'était perdu dans la tour en cherchant la sortie. Il a trouvé la Masterclass. D\'après lui, c\'était voulu.'],
      ['N', 'Sanji suit, une cigarette aux lèvres. Quelqu\'un doit faire à manger à cette troupe, et ce ne sera pas l\'algue.']],
  },
  ds2: {
    title: 'CHAPITRE 10 — LE QUARTIER DES PLAISIRS',
    intro: [['N', 'Yoshiwara, la nuit. Une Lune supérieure cache un éclat dans ses ceintures de soie.'],
      ['B', 'Tu es laid. Les laids n\'ont pas le droit de toucher à ma beauté !']],
    outro: [['B', 'Grand frère !! Il m\'a frappée !!'],
      ['N', 'Zenitsu jure qu\'il ne viendra pas. Il s\'endort sur le seuil. Au réveil, il est déjà de l\'autre côté de la faille.'],
      ['N', 'Inosuke, lui, fonce dans la faille tête la première en hurlant qu\'il est le roi de la montagne. Personne n\'a eu besoin de l\'inviter.']],
  },
  jk: {
    title: 'CHAPITRE 11 — LA NUIT DE SHIBUYA',
    intro: [['N', 'Shibuya, le soir d\'Halloween. Un voile noir couvre le quartier. Personne n\'en sort.'],
      ['N', 'Au cœur du voile, le roi des fléaux a avalé un éclat comme un doigt de plus.'],
      ['B', 'Un intrus venu d\'un autre monde ? Distrais-moi un peu avant que je te découpe.']],
    outro: [['B', 'Tch. Ce corps ne me suffit pas. La prochaine fois, je prendrai le tien.'],
      ['N', 'Le voile tombe. Gojo remonte son bandeau, regarde la classe et sourit : « Des élèves de partout ? Je prends. »'],
      ['N', 'Un petit homme au foulard blanc essuie ses lames, l\'air dégoûté. Des géants qui mangent les gens, il en a déjà tué. Livaï suit la troupe. Il exige seulement qu\'on nettoie après.']],
  },
  nr2: {
    title: 'CHAPITRE 12 — AMEGAKURE',
    intro: [['N', 'Le village de la Pluie. Celui qui se fait appeler Dieu a absorbé un éclat pour imposer sa paix.'],
      ['B', 'Ressens la douleur. Pense à la douleur. Accepte la douleur.']],
    outro: [['B', 'La douleur… n\'était donc pas la seule réponse…'],
      ['N', 'Sous la pluie, quelqu\'un regardait depuis un toit. Sasuke ne dit pas qu\'il rejoint la classe. Il marche juste derrière.'],
      ['N', 'Un homme au manteau à nuages rouges attendait sous la pluie, les yeux rouges. Itachi regarde son petit frère, puis la classe. Il ne dit rien et les suit.']],
  },
  opm: {
    title: 'CHAPITRE 13 — L\'INVASION DE LA CITÉ Z',
    intro: [['N', 'Un vaisseau grand comme une ville flotte au-dessus de la Cité Z. Son seigneur a traversé l\'univers pour trouver un adversaire à sa taille.'],
      ['B', 'Cet éclat m\'a mené jusqu\'ici. Es-tu celui qui me donnera enfin un vrai combat ?']],
    outro: [['B', 'Ce n\'était donc… pas toi… le plus fort…'],
      ['N', 'Un homme chauve en cape traverse les ruines, un sac de courses à la main. Il demande si la Masterclass rapporte des points au classement. Personne ne sait. Saitama s\'inscrit quand même.'],
      ['N', 'Une soldate à l\'écharpe rouge redescend d\'un immeuble au grappin. Chez elle, les géants mangent les gens ; ici, un homme chauve les fait tomber d\'un coup. Mikasa veut apprendre à frapper aussi fort.']],
  },
  bl2: {
    title: 'CHAPITRE 14 — HUECO MUNDO',
    intro: [['N', 'Un désert blanc sous une lune qui ne se couche jamais. Au sommet de Las Noches, une Espada garde un éclat.'],
      ['B', 'Vous parlez de liens, de cœur. Montrez-le-moi, ce cœur. Où est-il ?']],
    outro: [['B', 'Je vois… C\'est donc là… qu\'il était…'],
      ['N', 'Ulquiorra s\'effrite comme de la cendre. Quatorze éclats. Les deux derniers brillent dans le monde des Saiyans.'],
      ['N', 'Dans les dunes, un homme en noir traîne une épée plus grande que lui. Une faille l\'a jeté ici en pleine traque. Il vous suit sans un mot : plus loin, il y a des monstres.'],
      ['N', 'Au pied d\'un tas d\'os blancs, une fille aux bras de métal se relève. Gally est tombée d\'une ville de ferraille par une faille. Ici aussi, tout n\'est que débris ; elle se sent presque chez elle.']],
  },
  db: {
    title: 'CHAPITRE 15 — NAMEK',
    intro: [['N', 'La planète Namek se meurt. L\'empereur de l\'univers a pris un éclat pour une Dragon Ball.'],
      ['B', 'Un singe venu d\'un autre monde ? Je vais te montrer ma véritable puissance… hohoho.']],
    outro: [['B', 'Moi… vaincu… par un étranger…'],
      ['N', 'Sangoku arrive en retard et s\'excuse en riant. Vegeta prévient qu\'il ne vient que pour battre tout le monde, Masterclass comprise.']],
  },
  db2: {
    title: 'CHAPITRE FINAL — LE CELL GAME',
    intro: [['B', 'Bienvenue. C\'est moi qui ai poussé Kuro-Oni à briser le Sceau. Chaque éclat m\'a appris vos techniques.'],
      ['B', 'Tous les guerriers de tous les mondes en un seul être. Moi. La forme vraiment parfaite.'],
      ['H', 'Tu as copié nos techniques. Tu n\'as pas copié la classe.']],
    outro: [['N', 'Une capsule tombe du ciel en sifflant. Un garçon aux cheveux mauves en sort, l\'épée dans le dos : Trunks, venu d\'un futur où Cell a déjà gagné.'],
      ['N', 'Un enfant s\'avance devant les autres. Gohan, onze ans, les cheveux dorés dressés, des éclairs autour des poings.'],
      ['B', 'Impossible… Je suis… PARFAIT…'],
      ['N', 'Le dernier éclat rejoint les quinze autres. Le Sceau se referme, et les failles avec lui.'],
      ['N', 'Chacun rentre chez soi. À Tokyo, sur la porte de la salle d\'Ippo, quelqu\'un a écrit à la craie : « MASTERCLASS — on recrute. » FIN.']],
  },
};

let storyDlg = null; // dialogue en cours : { lines, k, t, then }
function storyLevelIndex(node) { return LEVELS.findIndex(L => L.id === STORY_ORDER[node]); }
function openMap(arrive = false) {
  scene = 'map'; sceneT = 0;
  map.from = map.at = story.node; map.hop = 0; map.goal = -1;
  if (arrive && story.node + 1 < STORY_ORDER.length) { map.at = story.node + 1; map.hop = 0.001; }
}
const map = { at: 0, from: 0, hop: 0, cursor: 0, goal: -1, flash: 0 };
// voyage vers une planète débloquée (toucher sur mobile) : une faille après l'autre jusqu'à elle
function mapGoTo(k) {
  if (k < 0 || k >= story.unlocked || map.hop) return;
  if (k === story.node) { map.goal = -1; return; }
  map.goal = k; map.from = story.node; map.at = story.node + Math.sign(k - story.node); map.hop = 0.001; audio.whoosh(0.8);
}
function updateMap(dt) {
  if (map.hop > 0) {
    map.hop += dt / 1.1;
    if (map.hop >= 1) map.flash = 1;
    if (map.hop >= 1) {
      map.hop = 0; map.from = map.at; story.node = map.at; saveStory(); audio.play('hitHeavy', 0.5);
      if (map.goal >= 0 && map.goal !== story.node) mapGoTo(map.goal); else map.goal = -1; // trajet de plusieurs cases
    }
    return;
  }
  if (map.flash > 0) map.flash = Math.max(0, map.flash - dt / 0.45);
  const hit = a => anyPressed(a);
  const d = hit('right') || hit('up') ? 1 : hit('left') || hit('down') ? -1 : 0;
  if (d) {
    const nx = clamp(story.node + d, 0, story.unlocked - 1);
    if (nx !== story.node) { map.from = story.node; map.at = nx; map.hop = 0.001; audio.whoosh(0.8); }
    else audio.tone(200, 0.08, 'square', 0.05);
  }
  if (sceneT > 0.4 && ['start', 'punch', 'jump'].some(hit)) startStoryLevel(story.node);
  if (hit('kick') || hit('pause')) { scene = 'title'; sceneT = 0; }
}
function startStoryLevel(node) {
  const id = STORY_ORDER[node], S = STORY[id];
  levelPick = storyLevelIndex(node);
  openDialogue(S.intro, S.title, () => { resetGame(sel.chars, levelPick); scene = 'play'; });
}
// Fin d'un niveau en mode histoire : dialogue de fin, puis case suivante débloquée et trajet sur le plateau
function storyCleared() {
  const node = STORY_ORDER.indexOf(LVL.id), S = STORY[LVL.id];
  if (!story.done.includes(LVL.id)) story.done.push(LVL.id);
  story.unlocked = Math.max(story.unlocked, Math.min(STORY_ORDER.length, node + 2));
  story.node = node; saveStory();
  const last = node === STORY_ORDER.length - 1;
  openDialogue(S.outro, last ? 'ÉPILOGUE' : 'VICTOIRE !', () => { if (last) { scene = 'title'; sceneT = 0; } else openMap(true); });
}
function openDialogue(lines, title, then) {
  storyDlg = { lines, title, k: 0, t: 0, then };
  scene = 'story'; sceneT = 0;
}
function updateDialogue(dt) {
  const D = storyDlg;
  D.t += dt;
  const line = D.lines[D.k], full = dlgText(line).length;
  if (sceneT > 0.4 && ['start', 'punch', 'jump', 'kick'].some(anyPressed)) {
    if (D.t * 45 < full) D.t = full / 45;
    else if (++D.k >= D.lines.length) { storyDlg = null; D.then(); }
    else { D.t = 0; audio.tone(500, 0.04, 'triangle', 0.05); }
  }
  if (anyPressed('pause')) { storyDlg = null; D.then(); }
}
const dlgText = ([, txt]) => txt.replace(/\{H\}/g, players?.[0]?.C?.name || CHARS[sel.chars?.[0]]?.name || 'NOTRE HÉROS');
function drawDialogue() {
  const D = storyDlg, line = D.lines[D.k], who = line[0];
  const L = LEVELS[levelPick];
  drawLevelThumb(L, 0, 0, W, H, sceneT * 25);
  ctx.fillStyle = 'rgba(5,0,15,0.55)'; ctx.fillRect(0, 0, W, H);
  // titre du chapitre
  ctx.fillStyle = 'rgba(10,0,25,0.8)'; ctx.fillRect(0, 26, W, 52); ctx.fillStyle = '#ff2d55'; ctx.fillRect(0, 76, W, 3);
  outlined(D.title, W / 2, 62, 28, '#ffe14d');
  // portrait : héros à gauche, boss à droite (carte de présentation), narrateur sans portrait
  const C = CHARS[sel.chars?.[0]] || CHARS.hero;
  if (who === 'H' && IMG[C.card]) {
    const img = IMG[C.card], s = 330 / img.height;
    ctx.drawImage(img, 60, H - 150 - 330 + 40, img.width * s, 330);
  }
  if (who === 'B' && IMG['intro_' + L.boss]) {
    const img = IMG['intro_' + L.boss], bw = 420, bh = 240;
    ctx.save(); ctx.beginPath(); ctx.moveTo(W - bw - 30, 110); ctx.lineTo(W - 20, 100); ctx.lineTo(W - 20, 100 + bh); ctx.lineTo(W - bw - 40, 110 + bh); ctx.clip();
    const s = Math.max(bw / img.width, bh / img.height); ctx.drawImage(img, W - 20 - img.width * s, 100, img.width * s, img.height * s);
    ctx.restore(); ctx.strokeStyle = '#ff3040'; ctx.lineWidth = 4; ctx.strokeRect(W - bw - 30, 104, bw + 10, bh);
  }
  // bulle
  const bx = 40, by = H - 160, bw = W - 80, bh = 120;
  ctx.fillStyle = 'rgba(8,2,24,0.92)'; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = who === 'B' ? '#ff3040' : who === 'H' ? C.colors[1] : '#ffe14d'; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);
  const name = who === 'H' ? C.name : who === 'B' ? (ENEMY_INFO[L.boss]?.[0] || 'BOSS') : 'NARRATEUR';
  ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(bx + 20, by - 16, 12 + name.length * 13, 28);
  outlined(name, bx + 26, by + 6, 18, '#fff', 'left');
  const txt = dlgText(line).slice(0, Math.floor(D.t * 45));
  ctx.font = (who === 'N' ? 'italic ' : '') + '20px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
  wrapText(txt, bx + 26, by + 46, bw - 52, 28);
  if (D.t * 45 >= dlgText(line).length && Math.floor(sceneT * 3) % 2) outlined('▼', bx + bw - 30, by + bh - 14, 18, '#ffe14d');
  ctx.font = '12px sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = '#cfd3ff';
  ctx.fillText(`${K('punch')} / Entrée : suite      ${K('pause')} : passer`, W - 44, H - 14);
}
function wrapText(txt, x, y, maxW, lh) {
  let line = '';
  for (const w of txt.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; } else line = t;
  }
  if (line) ctx.fillText(line, x, y);
}

// Carte : l'Entre-Mondes. Le Sceau des Mille Mondes, brisé, tourne au centre ; chaque monde est une planète dont la
// surface montre son décor. Les failles relient les planètes ; on passe de l'une à l'autre par un vortex. Chaque éclat
// rapporté reprend sa place dans le Sceau, et le tourbillon rouge de la Fracture rétrécit d'autant.
const mapRnd = (k => () => (k = (k * 16807) % 2147483647) / 2147483647)(7);
const mapStars = Array.from({ length: 170 }, () => [mapRnd() * 960, mapRnd() * 540, mapRnd() * 1.5 + 0.3, mapRnd() * 6, mapRnd() < 0.5 ? 0.3 : 1]);
// poussière de la galaxie : [angle, rayon (0-1), taille, teinte]
const mapDust = Array.from({ length: 260 }, () => [mapRnd() * 7, 0.18 + Math.pow(mapRnd(), 0.7) * 0.95, mapRnd() * 1.6 + 0.4, mapRnd() < 0.5 ? '#ff8ae6' : '#8ad8ff']);
const mapCracks = STORY_ORDER.map(() => Array.from({ length: 2 }, () => { const a = mapRnd() * 7; return Array.from({ length: 4 }, () => [a + (mapRnd() - 0.5) * 0.9, mapRnd()]); }));
// point u (0-1) de la faille qui va de la planète k à la suivante : courbe qui s'écarte du centre
function mapPath(k, u) {
  const [x0, y0] = MAP_NODES[k], [x1, y1] = MAP_NODES[k + 1], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const d = Math.hypot(mx - MAP_CX, (my - MAP_CY) * 2.5) || 1, cx = mx + (mx - MAP_CX) / d * 46, cy = my + (my - MAP_CY) * 2.5 / d * 20;
  const v = 1 - u;
  return [v * v * x0 + 2 * v * u * cx + u * u * x1, v * v * y0 + 2 * v * u * cy + u * u * y1];
}
// image k d'un effet filmé de la carte (fond noir : à dessiner en mode lumineux) ; false s'il n'est pas encore chargé
function mapFx(name, k, x, y, w, a = 1) {
  const L = FX[name], f = L && IMG[L[((k % L.length) + L.length) % L.length].src];
  if (!f) return false;
  const h = w * f.height / f.width;
  ctx.globalAlpha = a; ctx.drawImage(f, x - w / 2, y - h / 2, w, h); ctx.globalAlpha = 1;
  return true;
}
// vortex : bras en spirale qui tournent (à dessiner en mode lumineux)
function mapVortex(x, y, r, t, col, arms = 3, a = 1) {
  if (r < 1) return;
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, r * 0.09);
  for (let b = 0; b < arms; b++) {
    ctx.globalAlpha = a * 0.8; ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const u = i / 16, an = t * 3 + b * 6.283 / arms + u * 4.2, rr = r * (0.12 + u * 0.88);
      const px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr * 0.55;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = a; const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.5);
  g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.5, r * 0.3, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
}
function drawMap() {
  const t = sceneT, shards = story.done.filter(id => id !== 'tokyo').length, N = STORY_ORDER.length - 1;
  // fond : espace profond et nébuleuses
  const g = ctx.createRadialGradient(MAP_CX, MAP_CY, 30, MAP_CX, MAP_CY, 640);
  g.addColorStop(0, '#2a0838'); g.addColorStop(0.45, '#0e0626'); g.addColorStop(1, '#020008');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const neb = IMG.map_nebula;
  if (neb) { // nébuleuse peinte (Flow), qui dérive et respire lentement
    const z = 1.08 + 0.03 * Math.sin(t * 0.15), nw = W * z, nh = H * z;
    ctx.drawImage(neb, (W - nw) / 2 + Math.sin(t * 0.07) * 18, (H - nh) / 2 + Math.cos(t * 0.05) * 10, nw, nh);
  }
  ctx.globalCompositeOperation = 'lighter';
  if (!neb) for (const [nx, ny, nr, col] of [[170, 150, 260, 'rgba(120,40,200,0.16)'], [800, 400, 300, 'rgba(30,110,200,0.14)'], [760, 110, 200, 'rgba(220,40,110,0.12)'], [220, 450, 220, 'rgba(40,160,180,0.1)']]) {
    const x = nx + Math.sin(t * 0.1 + nr) * 20, ng = ctx.createRadialGradient(x, ny, 0, x, ny, nr);
    ng.addColorStop(0, col); ng.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = ng; ctx.fillRect(x - nr, ny - nr, nr * 2, nr * 2);
  }
  ctx.fillStyle = '#fff';
  for (const [x, y, r, p, z] of mapStars) { ctx.globalAlpha = (0.35 + 0.35 * Math.sin(t * 2 + p)) * (z < 1 ? 0.6 : 1); ctx.fillRect((x - t * 4 * z + 960) % 960, y, r, r); }
  // poussière de la galaxie qui tourne autour du Sceau (plus vite près du centre)
  for (const [a0, rr, sz, col] of mapDust) {
    const a = a0 + t * 0.05 / rr;
    ctx.globalAlpha = 0.25 + 0.3 * (1 - rr); ctx.fillStyle = col;
    ctx.fillRect(MAP_CX + Math.cos(a) * rr * 470, MAP_CY + Math.sin(a) * rr * 185, sz, sz);
  }
  ctx.globalAlpha = 1;
  // cœur : le tourbillon rouge de la Fracture, qui se referme à mesure que les éclats reviennent
  const fk = Math.floor(t * 12);
  // le Sceau filmé : les éclats qui manquent y font des trous (secteurs assombris), ceux qui sont rapportés brillent ;
  // la Fracture tourne par-dessus, et se referme à mesure que les éclats reviennent
  const sealOk = mapFx('map_seal_v', fk, MAP_CX, MAP_CY + 4, 270, 0.55 + 0.45 * shards / N);
  if (sealOk) {
    ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 22;
    for (let i = shards; i < N; i++) {
      const a0 = t * 0.25 + i * 6.283 / N;
      ctx.strokeStyle = 'rgba(6,2,16,0.8)'; ctx.beginPath(); ctx.ellipse(MAP_CX, MAP_CY + 9, 107, 40, 0, a0, a0 + 6.283 / N); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
  }
  if (!mapFx('map_vortex_v', fk, MAP_CX, MAP_CY, 250 * (1 - 0.55 * shards / N), 0.95)) mapVortex(MAP_CX, MAP_CY, 70 - 42 * shards / N, -t * 0.7, '#ff2850', 4, 0.9);
  if (!sealOk) for (let i = 0; i < N; i++) {
    const a0 = t * 0.25 + i * 6.283 / N, a1 = a0 + 6.283 / N * 0.8, got = i < shards;
    ctx.globalAlpha = got ? 0.95 : 0.18; ctx.strokeStyle = got ? '#ffe14d' : '#c0b0ff'; ctx.lineWidth = got ? 6 : 3;
    ctx.beginPath(); ctx.ellipse(MAP_CX, MAP_CY, 78, 30, 0, a0, a1); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // failles entre les planètes : lumineuses et parcourues d'étincelles une fois ouvertes, à peine visibles sinon
  for (let k = 0; k + 1 < MAP_NODES.length; k++) {
    const open = k + 1 < story.unlocked;
    ctx.strokeStyle = open ? 'rgba(140,200,255,0.55)' : 'rgba(255,255,255,0.08)'; ctx.lineWidth = open ? 3 : 2;
    ctx.beginPath(); for (let i = 0; i <= 12; i++) { const [x, y] = mapPath(k, i / 12); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    if (!open) continue;
    ctx.fillStyle = '#e0f4ff';
    for (let j = 0; j < 4; j++) { const [x, y] = mapPath(k, (t * 0.35 + j / 4) % 1); ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
  }
  // rayons qui relient au Sceau les mondes dont l'éclat est rapporté
  ctx.lineWidth = 1;
  STORY_ORDER.forEach((id, k) => {
    if (!story.done.includes(id) || id === 'tokyo') return;
    const [x, y] = MAP_NODES[k]; ctx.strokeStyle = `rgba(255,225,77,${0.1 + 0.06 * Math.sin(t * 3 + k)})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(MAP_CX, MAP_CY); ctx.stroke();
  });
  ctx.globalCompositeOperation = 'source-over';
  // planètes, des plus lointaines (en haut) aux plus proches
  const order = STORY_ORDER.map((_, k) => k).sort((a, b) => MAP_NODES[a][1] - MAP_NODES[b][1]);
  for (const k of order) {
    const id = STORY_ORDER[k], [x, y, r0] = MAP_NODES[k], L = LEVELS.find(l => l.id === id), open = k < story.unlocked;
    const cur = k === story.node && !map.hop, r = cur ? r0 * 1.4 : r0, col = LV_COLOR[id] || '#8ad8ff', done = story.done.includes(id);
    // atmosphère
    ctx.globalCompositeOperation = 'lighter';
    const ag = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * (cur ? 1.7 : 1.4));
    ag.addColorStop(0, open ? col : '#401020'); ag.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = open ? (cur ? 0.7 + 0.2 * Math.sin(t * 4) : 0.45) : 0.5; ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // surface : le décor du monde qui défile, comme une planète qui tourne
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
    if (L) drawLevelThumb(L, x - r * 2.4, y - r * 1.25, r * 4.8, r * 2.7, open ? t * (cur ? 40 : 14) + k * 300 : k * 300);
    // ombre de la sphère (lumière venue d'en haut à gauche)
    const sg = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.15, x, y, r * 1.05);
    sg.addColorStop(0, 'rgba(255,255,255,0.18)'); sg.addColorStop(0.5, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,12,0.85)');
    ctx.fillStyle = sg; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    if (!open) {
      // monde encore englouti par la Fracture : éteint et fendu de rouge
      ctx.fillStyle = 'rgba(8,0,14,0.62)'; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.strokeStyle = `rgba(255,40,80,${0.35 + 0.25 * Math.sin(t * 3 + k)})`; ctx.lineWidth = 1;
      for (const cr of mapCracks[k]) {
        ctx.beginPath(); ctx.moveTo(x, y);
        cr.forEach(([a, d], i) => { const rr = r * (i + 1) / 4 * (0.7 + d * 0.5); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); });
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = cur ? '#ffe14d' : open ? col : 'rgba(255,60,90,0.35)'; ctx.lineWidth = cur ? 3 : 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    // anneau incliné autour de la planète choisie
    if (cur) {
      ctx.strokeStyle = 'rgba(255,225,77,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.42, -0.25, 0.12, 3.02); ctx.stroke();
    }
    // éclat rapporté : un cristal qui gravite autour de la planète
    if (done && id !== 'tokyo') {
      const a = t * 1.6 + k, ex = x + Math.cos(a) * r * 1.3, ey = y + Math.sin(a) * r * 0.45 - r * 0.1;
      ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.moveTo(ex, ey - 6); ctx.lineTo(ex + 3.5, ey); ctx.lineTo(ex, ey + 6); ctx.lineTo(ex - 3.5, ey); ctx.fill();
    }
    ctx.font = `bold ${cur ? 12 : 10}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = open ? '#fff' : '#b8a0c0';
    ctx.strokeStyle = 'rgba(4,0,12,0.9)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText((id === 'tokyo' ? 'TOKYO' : STORY[id]?.title.split(' — ')[1] || L?.name || id).replace(/^(LA |LE |L')/, ''), x, y + r + 13);
    ctx.fillText((id === 'tokyo' ? 'TOKYO' : STORY[id]?.title.split(' — ')[1] || L?.name || id).replace(/^(LA |LE |L')/, ''), x, y + r + 13);
    if (open) rankBadge(prog.ranks[id], x + r * 0.85, y - r * 0.8, cur ? 16 : 12);
  }
  // voyage : un vortex s'ouvre au départ et à l'arrivée, les combattants filent le long de la faille
  const k = map.hop ? Math.min(1, map.hop) : 1, e = k * k * (3 - 2 * k);
  let px, py;
  if (map.hop) {
    const a = Math.min(map.from, map.at), fw = map.at > map.from, glow = Math.sin(Math.PI * k);
    [px, py] = mapPath(a, fw ? e : 1 - e);
    const [fx, fy] = MAP_NODES[map.from], [tx, ty] = MAP_NODES[map.at];
    ctx.globalCompositeOperation = 'lighter';
    // portail filmé : il s'ouvre et se referme au départ, s'ouvre à l'arrivée (il s'y referme ensuite, map.flash)
    if (!mapFx('map_portal_v', Math.floor(Math.min(1, k * 1.4) * 15), fx, fy, 150)) mapVortex(fx, fy, 40 * Math.min(1, (1 - k) * 3), t * 2, '#9ad8ff');
    if (!mapFx('map_portal_v', Math.floor(Math.max(0, k - 0.35) / 0.65 * 9), tx, ty, 150)) mapVortex(tx, ty, 40 * Math.min(1, k * 2.5), t * 2, '#ffe14d');
    for (let j = 1; j <= 8; j++) { // traînée
      const [qx, qy] = mapPath(a, Math.max(0, Math.min(1, fw ? e - j * 0.03 : 1 - e + j * 0.03)));
      ctx.globalAlpha = glow * (1 - j / 9) * 0.8; ctx.fillStyle = '#bfe8ff'; ctx.beginPath(); ctx.arc(qx, qy, 7 - j * 0.6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  } else {
    [px, py] = MAP_NODES[map.at];
    if (map.flash > 0) { ctx.globalCompositeOperation = 'lighter'; mapFx('map_portal_v', 9 + Math.floor((1 - map.flash) * 6.9), px, py, 150); ctx.globalCompositeOperation = 'source-over'; }
    const rr = MAP_NODES[map.at][2] * 1.4;
    py += py - rr - 44 < 74 ? rr + 70 : -rr; // tout en haut : sous la planète (le bandeau les cacherait)
  }
  (sel.chars || []).forEach((c, q) => {
    const C = CHARS[c], bob = Math.sin(t * 4 + q) * 3;
    medallion(C, px - 13 * (sel.chars.length - 1) + q * 26, py - 26 + bob - q * 4, map.hop ? 16 : 18, COLORS_P[q]);
  });
  // panneau du monde choisi
  const id = STORY_ORDER[story.node], S = STORY[id], L = LEVELS.find(l => l.id === id);
  ctx.fillStyle = 'rgba(10,0,25,0.82)'; ctx.fillRect(0, 0, W, 64); ctx.fillStyle = '#ffe14d'; ctx.fillRect(0, 64, W, 3);
  outlined('LA FRACTURE DES MONDES', 24, 30, 22, '#ff8ae6', 'left');
  outlined(S.title, 24, 56, 18, '#fff', 'left');
  outlined(`ÉCLATS : ${story.done.filter(id => id !== 'tokyo').length} / ${STORY_ORDER.length - 1}`, W - 24, 30, 20, '#7fff9a', 'right');
  if (L) outlined(`BOSS : ${ENEMY_INFO[L.boss]?.[0] || ''}`, W - 24, 56, 16, '#ff6070', 'right');
  // défis du monde choisi, sous le bandeau
  ctx.fillStyle = 'rgba(10,0,25,0.7)'; ctx.fillRect(W - 330, 70, 330, 62);
  drawChallenges(id, W - 320, 87, 12, 18, 290);
  // la Masterclass : les maîtres recrutés dans les mondes terminés
  const crew = STORY_ORDER.filter(id => story.done.includes(id)).flatMap(id => RECRUITS[id] || []).filter(c => CHARS[c]);
  if (crew.length) {
    ctx.fillStyle = 'rgba(10,0,25,0.7)'; ctx.fillRect(0, H - 66, W, 36);
    outlined('MASTERCLASS', 16, H - 42, 14, '#ffe14d', 'left');
    // espacement resserré quand la troupe grandit, pour tenir sur la largeur de l'écran
    const step = Math.min(34, (W - 150) / crew.length), r = Math.min(14, step * 0.45);
    crew.forEach((c, q) => medallion(CHARS[c], 136 + q * step, H - 48, r, '#ffe14d'));
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 30, W, 30);
  ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfd3ff';
  ctx.fillText(`${K('left')} ${K('right')} voyager entre les mondes     ${K('punch')} ou Entrée : entrer dans ce monde     ${K('kick')} retour     Difficulté : ${DIFF().name} — ${OPTS.lives} vies`, W / 2, H - 10);
}

// ---------- Aiguillage des scènes ajoutées (appelé par update / draw de game.js) ----------
function updateModes(dt) {
  if (scene === 'title') { updateTitleMenu(); return true; }
  if (scene === 'options') { if (!paused) updateOptions(); return true; }
  if (scene === 'map') { updateMap(dt); return true; }
  if (scene === 'story') { updateDialogue(dt); return true; }
  if (scene === 'online') { updateOnline(dt); return true; }
  return false;
}
function drawModes() {
  if (scene === 'options') { drawOptions(); return true; }
  if (scene === 'map') { menuImages(); mapImages(); drawMap(); return true; }
  if (scene === 'story') { drawDialogue(); return true; }
  if (scene === 'online') { drawOnline(); return true; }
  return false;
}
applyOpts();
