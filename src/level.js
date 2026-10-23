'use strict';
// ---------- Niveaux ----------
// Chaque niveau est une longue rue découpée en zones (chacune son décor), jalonnée de vagues d'ennemis
// qui bloquent la caméra le temps du combat, d'objets à casser qui cachent de la nourriture,
// et d'un boss au bout. Chaque nouvel ennemi est présenté par une carte, chaque zone par un bandeau.

// ---------- Les niveaux ----------
// Néo-Tokyo (le premier) est fait main ; les autres suivent un même gabarit : trois zones, des vagues de leurs
// deux sbires, un boss au bout. Chaque niveau a son ciel, ses décors et ses ennemis (voir ETYPES dans game.js).
const TOKYO = {
  id: 'tokyo', name: 'NÉO-TOKYO', sub: 'La traversée de la ville', sky: 'sky', far: 'far', boss: 'boss', extra: 'thug',
  zones: [
    { id: 'street', name: 'RUELLES DE SHINJUKU', from: 0, mid: 'mid', mid2: 'street_mid2', ground: 'street' },
    { id: 'neon', name: 'QUARTIER NÉON', from: 2600, mid: 'neon_mid', mid2: 'neon_mid2', ground: 'neon_ground' },
    { id: 'bridge', name: 'LE GRAND PONT', from: 5400, mid: 'bridge_mid', mid2: 'bridge_mid2', ground: 'bridge_ground' },
    { id: 'dock', name: 'LE PORT', from: 8200, mid: 'dock_mid', mid2: 'dock_mid2', ground: 'dock_ground' },
    { id: 'shrine', name: 'LE SANCTUAIRE DU ONI', from: 10800, mid: 'shrine_mid', mid2: 'shrine_mid2', ground: 'shrine_ground' },
  ],
  end: 13400, // bord droit du niveau (l'arène du boss)
  // x : position de la caméra qui déclenche la vague ; elle se bloque là jusqu'à ce que tout soit battu
  waves: [
    { x: 450, foes: ['thug', 'thug'] },
    { x: 1250, foes: ['thug', 'thug', 'thug'] },
    { x: 1550, foes: ['thug', 'brute', 'thug'] },
    { x: 3000, foes: ['ninja', 'thug', 'ninja'] },
    { x: 3850, foes: ['ninja', 'thug', 'thug', 'ninja'] },
    { x: 4300, foes: ['brute', 'ninja', 'thug', 'thug'] },
    { x: 5750, foes: ['biker', 'biker'] },
    { x: 6650, foes: ['biker', 'ninja', 'thug', 'biker'] },
    { x: 7100, foes: ['brute', 'biker', 'ninja', 'biker'] },
    { x: 8550, foes: ['samurai', 'biker'] },
    { x: 9450, foes: ['samurai', 'brute', 'biker', 'ninja'] },
    { x: 9700, foes: ['samurai', 'samurai', 'ninja', 'biker'] },
    { x: 11250, foes: ['samurai', 'brute', 'samurai', 'biker'] },
    { x: 13400 - 960, foes: ['boss'], boss: true }, // 960 : largeur de l'écran (W n'existe pas encore ici)
  ],
  // Objets cassables (deux coups) et ce qu'ils cachent : la plupart sont vides, la nourriture est rare
  // (un soin par zone environ, le plus gros juste avant le boss)
  props: [
    [700, 'crate', null], [1700, 'barrel', null], [2150, 'can', 'onigiri'], [3400, 'crate', null],
    [4300, 'can', null], [4800, 'barrel', 'ramen'], [6200, 'crate', null], [7100, 'barrel', 'drink'],
    [7650, 'can', null], [8900, 'crate', null], [9900, 'barrel', 'ramen'], [10300, 'crate', null],
    [11800, 'can', null], [12300, 'crate', 'chicken'], [12450, 'barrel', null],
  ],
};

// Niveau au gabarit commun : a = sbire de corps à corps, b = sbire qui attaque de loin.
// 4 zones : la 4e (fichiers <monde>_z4_*, ajoutée le 23/10) se place avant celle du boss -> ordre z1, z2, z4, z3.
function themedLevel(id, name, sub, zoneNames, a, b) {
  const n = zoneNames.length, files = n === 4 ? [1, 2, 4, 3] : [1, 2, 3], from = files.map((_, k) => k * 2900), end = from[n - 1] + 3000;
  const waves = [], props = [], items = ['onigiri', 'ramen', 'drink', 'chicken'];
  from.forEach((x0, k) => {
    const last = k === n - 1;
    waves.push({ x: x0 + 450, foes: k ? [a, a, b] : [a, a] }, { x: x0 + 1250, foes: k ? [b, a, b, a] : [a, b, a] });
    if (!last) waves.push({ x: x0 + 1900, foes: k ? [a, b, a, a, b] : [b, a, a, b] });
    props.push([x0 + 800, 'crate', null], [x0 + 1800, 'barrel', items[k % items.length]], [x0 + 2250, 'crate', last ? 'onigiri' : null]); // rien devant la porte (limite - 230) ; un soin de plus avant le boss
  });
  waves.push({ x: end - 960, foes: [`${id}_boss`], boss: true });
  return {
    id, name, sub, sky: `${id}_sky`, boss: `${id}_boss`, extra: a, end, waves, props,
    zones: zoneNames.map((nm, k) => ({ id: `${id}_z${files[k]}`, name: nm, from: from[k], mid: `${id}_z${files[k]}_mid`, mid2: `${id}_z${files[k]}_mid2`, ground: `${id}_z${files[k]}_ground` })),
  };
}


const LEVELS = [
  TOKYO,
  themedLevel('op', 'ONE PIECE — LOGUETOWN', 'Du Vogue Merry à la place de l\'exécution',
    ['LE VOGUE MERRY', 'LE PORT DE LOGUETOWN', 'LA GRAND-RUE DE LOGUETOWN', 'LA PLACE DE L\'EXÉCUTION'], 'op_pirate', 'op_marine'),
  themedLevel('ds', 'DEMON SLAYER — LE TRAIN DE L\'INFINI', 'Une nuit à bord du train des démons',
    ['LE TRAIN DE L\'INFINI', 'SUR LE TOIT DU TRAIN', 'LA LOCOMOTIVE', 'LA CLAIRIÈRE À L\'AUBE'], 'ds_demon', 'ds_spider'),
  themedLevel('bl', 'BLEACH — SOUL SOCIETY', 'Jusqu\'à la colline du Sôkyoku',
    ['LE RUKONGAI', 'LE SEIREITEI', 'LA TOUR DU REPENTIR', 'LA COLLINE DU SÔKYOKU'], 'bl_shinigami', 'bl_hollow'),
  themedLevel('hx', 'HUNTER × HUNTER — LA TOUR CÉLESTE', 'Grimper jusqu\'au 200e étage',
    ['AU PIED DE LA TOUR', 'LE HALL DES COMBATTANTS', 'LES ARÈNES DU 100E ÉTAGE', 'L\'ARÈNE DU 200E ÉTAGE'], 'hx_fighter', 'hx_nen'),
  themedLevel('nr', 'NARUTO — KONOHA', 'Du village caché à la forêt de la mort',
    ['LES RUES DE KONOHA', 'LES PORTES DU VILLAGE', 'LE TERRAIN D\'ENTRAÎNEMENT', 'LA FORÊT DE LA MORT'], 'nr_sound', 'nr_rogue'),
  themedLevel('db', 'DRAGON BALL — NAMEK', 'L\'empereur de l\'univers vous attend',
    ['LES PLAINES DE NAMEK', 'LE VILLAGE NAMEK', 'LE VAISSEAU DE FREEZER', 'LE CHAMP DE BATAILLE'], 'db_elite', 'db_soldier'),
  themedLevel('mh', 'MY HERO ACADEMIA — L\'USJ', 'Les vilains ont envahi le centre d\'entraînement',
    ['L\'ENTRÉE DE L\'USJ', 'LA ZONE INCENDIE', 'LA ZONE DES ÉBOULEMENTS', 'LA PLACE CENTRALE'], 'mh_villain', 'mh_blaster'),
  themedLevel('rk', 'KENSHIN — KYOTO', 'De Tokyo jusqu\'au repaire de Shishio',
    ['TOKYO, ÈRE MEIJI', 'KYOTO EN FLAMMES', 'LE PORT D\'OSAKA', 'LE REPAIRE DE SHISHIO'], 'rk_ronin', 'rk_ninja'),
  themedLevel('op2', 'ONE PIECE — ENIES LOBBY', 'Sauver Robin à la tour de la Justice',
    ['LA GRANDE PORTE', 'LA VILLE JUDICIAIRE', 'LE PONT DE L\'HÉSITATION', 'LA TOUR DE LA JUSTICE'], 'op2_guard', 'op2_agent'),
  themedLevel('nr2', 'NARUTO — AMEGAKURE', 'Le village caché de la Pluie',
    ['LES TOURS DE LA PLUIE', 'LE PONT SUR LE LAC', 'L\'USINE SOUS LA PLUIE', 'LE SOMMET DE LA TOUR'], 'nr2_puppet', 'nr2_rain'),
  themedLevel('ds2', 'DEMON SLAYER — LE QUARTIER DES PLAISIRS', 'Yoshiwara, la nuit des démons',
    ['LA RUE DES LANTERNES', 'SUR LES TOITS', 'LA MAISON KYOGOKU', 'LE QUARTIER DÉVASTÉ'], 'ds2_demon', 'ds2_obi'),
  themedLevel('db2', 'DRAGON BALL Z — LE CELL GAME', 'Le tournoi de Cell',
    ['LE DÉSERT ROCHEUX', 'LES ABORDS DU TOURNOI', 'LA VILLE DÉVASTÉE', 'L\'ARÈNE DE CELL'], 'db2_jr', 'db2_android'),
  themedLevel('jk', 'JUJUTSU KAISEN — SHIBUYA', 'La nuit d\'Halloween où tout a basculé',
    ['LE CARREFOUR DE SHIBUYA', 'LA STATION SOUS-TERRAINE', 'LES RUES EN RUINE', 'LE SANCTUAIRE DE SUKUNA'], 'jk_curse', 'jk_user'),
  themedLevel('sl', 'SOLO LEVELING — LE DOUBLE DONJON', 'Le donjon où tout a commencé',
    ['LA PORTE BLEUE', 'LES PROFONDEURS DU DONJON', 'LE PONT SUR L\'ABÎME', 'LE TEMPLE DES STATUES'], 'sl_goblin', 'sl_knight'),
  themedLevel('opm', 'ONE PUNCH MAN — CITÉ Z', 'L\'invasion venue du ciel',
    ['LA CITÉ Z ABANDONNÉE', 'LE QG DE L\'ASSOCIATION', 'LE CENTRE-VILLE EN RUINE', 'LE VAISSEAU DES ENVAHISSEURS'], 'opm_monster', 'opm_alien'),
  themedLevel('bl2', 'BLEACH — HUECO MUNDO', 'Jusqu\'au sommet de Las Noches',
    ['LE DÉSERT DE LA NUIT ÉTERNELLE', 'LES COULOIRS DE LAS NOCHES', 'LA SALLE DU TRÔNE', 'LE DÔME DE LAS NOCHES'], 'bl2_arrancar', 'bl2_fraccion'),
];
// Images des niveaux : ciel, décor (plan moyen détouré, ou mur plein pour les intérieurs) et sol de chaque zone
for (const L of LEVELS.slice(1)) {
  ASSETS.backgrounds[L.sky] = `assets/backgrounds/levels/${L.sky}.jpg`;
  for (const Z of L.zones) {
    ASSETS.backgrounds[Z.mid] = `assets/backgrounds/levels/${Z.mid}.png`;
    if (Z.mid2) ASSETS.backgrounds[Z.mid2] = `assets/backgrounds/levels/${Z.mid2}.png`; // suite du même lieu, en alternance
    ASSETS.backgrounds[Z.ground] = `assets/backgrounds/levels/${Z.ground}.jpg`;
  }
}

// Passage d'une zone à la suivante : la caméra s'arrête juste avant la limite (on ne voit jamais deux décors
// côte à côte) ; quand la vague est finie, un élément de passage (porte, arche, sas…) attend au fond de la rue,
// juste avant la limite : les joueurs y remontent et y entrent, l'écran passe au noir et on reprend dans le nouveau
// décor. La porte est dessinée DE FACE, posée contre le fond (qui est lui aussi vu de face) et à sa vraie
// proportion : en travers de la chaussée ou étirée, elle paraissait déformée. Le train garde son échelle de profil.
// Image assets/backgrounds/gates/<id>.png ; mondes à 4 zones : g1 (z1→z2), g3 (z2→z4), g2 (z4→z3, l'antre du boss).
const GATES = { tokyo: ['tokyo_g1', 'tokyo_g2', 'tokyo_g3', 'tokyo_g4'] };
for (const id of ['op', 'ds', 'bl', 'hx', 'nr', 'db', 'mh', 'rk', 'op2', 'nr2', 'ds2', 'db2', 'jk', 'sl', 'opm', 'bl2'])
  GATES[id] = [`${id}_g1`, `${id}_g3`, `${id}_g2`];
for (const L of LEVELS) L.zones.forEach((Z, k) => { if (k) Z.gate = (GATES[L.id] || [])[k - 1]; });
// Porte au fond de la rue : centre à GATE.dx avant la limite de zone, pied sur la bordure du fond, hauteur fixe
const GATE = { dx: 230, base: 372, h: 300, maxW: 420 }; // base : juste derrière Z_TOP (378), défini plus tard dans game.js
// La forêt de la mort a son lointain (sinon le ciel du village et ses visages sculptés apparaissent entre les arbres)
LEVELS.find(L => L.id === 'nr').zones.find(Z => Z.id === 'nr_z3').sky = 'nr_z3_sky';
ASSETS.backgrounds.nr_z3_sky = 'assets/backgrounds/levels/nr_z3_sky.jpg';
// Passages où l'on grimpe (l'échelle au bout du wagon mène au toit du train)
const CLIMB = new Set(['ds_g1']), LADDER = 190; // l'échelle se dresse 190 px avant la limite
for (const list of Object.values(GATES)) for (const g of list) ASSETS.backgrounds[g] = `assets/backgrounds/gates/${g}.png`;
const GATE_H = 470;          // hauteur affichée de l'élément de passage (son pied est au bas de l'écran)
const TRANS = { walk: 0.75, black: 0.25, back: 0.6 };
// Passages filmés (vidéo Flow) : au noir, la vidéo montre le décor qui change (ex. Kyoto qui s'embrase)
const TRANS_VIDEO = { rk_z2: 'assets/web/trans/trans_rk.mp4', mh_z2: 'assets/web/trans/trans_mh.mp4' };

// Niveau en cours (choisi sur l'écran des niveaux)
let LVL = TOKYO, ZONES = TOKYO.zones, WAVES = TOKYO.waves, PROPS = TOKYO.props, LEVEL_END = TOKYO.end;
function setLevel(k) {
  LVL = LEVELS[k] || TOKYO;
  ({ zones: ZONES, waves: WAVES, props: PROPS, end: LEVEL_END } = LVL);
}

// Nourriture : vie rendue (et ki pour la boisson et le haricot magique). Ordre = planche items.
const ITEMS = {
  ramen: { i: 0, hp: 30, name: 'RAMEN +30' }, onigiri: { i: 1, hp: 15, name: 'ONIGIRI +15' },
  chicken: { i: 2, hp: 50, name: 'POULET +50' }, bean: { i: 3, hp: 100, ki: 100, name: 'HARICOT MAGIQUE !' },
  drink: { i: 4, ki: 60, name: 'KI +60' }, medkit: { i: 5, hp: 25, name: 'SOINS +25' },
};
const ENEMY_INFO = {
  thug: ['VOYOU DES RUELLES', 'Bagarreur des bas-fonds de Shinjuku'],
  brute: ['SUMO CYBORG', 'Encaisse les petits coups — frappe fort'],
  ninja: ['NINJA CYBER', 'Lance des shurikens — renvoie-les d\'un coup !'],
  biker: ['MOTARD À CHAÎNE', 'Fouette de loin avec sa chaîne d\'acier'],
  samurai: ['SAMOURAÏ ÉCARLATE', 'Dégaine éclair — méfie-toi de sa ruée'],
  boss: ['KURO-ONI', 'Seigneur de guerre du sanctuaire'],
  op_pirate: ['PIRATE DE BAGGY', 'Clown au sabre — se rue sur toi'],
  op_marine: ['SOLDAT DE LA MARINE', 'Tire au mousquet — renvoie ses balles !'],
  op_boss: ['BAGGY LE CLOWN', 'Capitaine de l\'équipage de Baggy'],
  ds_demon: ['DÉMON INFÉRIEUR', 'Griffes acérées — bondit sur sa proie'],
  ds_spider: ['DÉMON ARAIGNÉE', 'Tisse des fils tranchants de loin'],
  ds_boss: ['AKAZA', 'Troisième Lune supérieure'],
  bl_shinigami: ['SHINIGAMI', 'Faucheur d\'âmes du Gotei 13'],
  bl_hollow: ['HOLLOW', 'Esprit masqué — tire des Cero'],
  bl_boss: ['KENPACHI ZARAKI', 'Capitaine de la 11e division'],
  hx_fighter: ['COMBATTANT DE LA TOUR', 'Brute des étages inférieurs'],
  hx_nen: ['MANIPULATEUR DE NEN', 'Projette des sphères d\'aura'],
  hx_boss: ['HISOKA', 'Le magicien du 200e étage'],
  nr_sound: ['NINJA D\'OTO', 'Ninja du village du Son'],
  nr_rogue: ['NINJA DÉSERTEUR', 'Lance des kunaï — renvoie-les !'],
  nr_boss: ['OROCHIMARU', 'Le Sannin des serpents'],
  db_elite: ['GUERRIER D\'ÉLITE', 'Force spéciale — encaisse les coups'],
  db_soldier: ['SOLDAT DE FREEZER', 'Tire des boules de ki'],
  db_boss: ['FREEZER', 'L\'empereur de l\'univers'],
  mh_villain: ['VILAIN AU BRAS DE PIERRE', 'Alter de pierre — frappe fort'],
  mh_blaster: ['VILAIN EXPLOSIF', 'Lance des boules de feu'],
  mh_boss: ['NOMU', 'Créature conçue pour abattre All Might'],
  rk_ronin: ['RÔNIN', 'Sabreur sans maître — se rue sur toi'],
  rk_ninja: ['NINJA MERCENAIRE', 'Lance des kunaï — renvoie-les !'],
  rk_boss: ['SHISHIO MAKOTO', 'L\'homme couvert de bandages'],
  op2_guard: ['GARDE DU GOUVERNEMENT', 'Lancier d\'Enies Lobby'],
  op2_agent: ['AGENT DU CP9', 'Soru — il fond sur toi'],
  op2_boss: ['ROB LUCCI', 'L\'agent le plus dangereux du CP9'],
  nr2_puppet: ['MARIONNETTISTE', 'Sa marionnette frappe de près'],
  nr2_rain: ['NINJA DE LA PLUIE', 'Lance des kunaï — renvoie-les !'],
  nr2_boss: ['PAIN', 'Le dieu d\'Amegakure'],
  ds2_demon: ['DÉMON DE YOSHIWARA', 'Griffes acérées — bondit sur sa proie'],
  ds2_obi: ['DÉMON DE LA CEINTURE', 'Fouette de loin avec ses obi'],
  ds2_boss: ['DAKI', 'Sixième Lune supérieure'],
  db2_jr: ['CELL JUNIOR', 'Petit, rapide et sans pitié'],
  db2_android: ['ANDROÏDE DU RUBAN ROUGE', 'Tire des rafales de ki'],
  db2_boss: ['CELL', 'La forme parfaite'],
  jk_curse: ['FLÉAU', 'Malédiction née de la peur des hommes'],
  jk_user: ['EXORCISTE MAUDIT', 'Lance des malédictions de loin'],
  jk_boss: ['SUKUNA', 'Le roi des fléaux'],
  sl_goblin: ['GOBELIN DU DONJON', 'Petit, vif — bondit avec son gourdin'],
  sl_knight: ['STATUE GUERRIÈRE', 'Pierre vivante — encaisse les coups'],
  sl_boss: ['IGRIS LE SANGLANT', 'Chevalier commandant du donjon'],
  opm_monster: ['MONSTRE CRABE', 'Carapace dure — frappe fort'],
  opm_alien: ['ENVAHISSEUR', 'Tire au laser depuis le vaisseau'],
  opm_boss: ['BOROS', 'Seigneur conquérant de l\'univers'],
  bl2_arrancar: ['ARRANCAR', 'Hollow devenu sabreur'],
  bl2_fraccion: ['FRACCIÓN', 'Colosse au service d\'une Espada'],
  bl2_boss: ['ULQUIORRA', 'Quatrième Espada'],
};
for (const k of Object.keys(ENEMY_INFO)) if (k.includes('_')) ASSETS.ui[`intro_${k}`] = `assets/ui/intro/${k}.jpg`;

const level = { passed: 0, trans: null, wave: 0, lock: null, queue: [], spawnT: 0, cleared: true, goT: 0, card: null, banner: null, zone: -1, seen: new Set(), props: [], items: [], bossDead: false };

function resetLevel() {
  Object.assign(level, { passed: 0, trans: null, wave: 0, lock: null, queue: [], spawnT: 0, cleared: true, goT: 0, card: null, banner: null, zone: -1, seen: new Set(), items: [], bossDead: false });
  level.props = PROPS.map(([x, type, item], k) => ({ x, gz: k % 2 ? Z_TOP + 25 : Z_BOT - 30, type, item, hp: 2, broken: false, t: 0, shakeT: 0 }));
}

const zoneAt = x => { let k = 0; while (k + 1 < ZONES.length && x >= ZONES[k + 1].from) k++; return k; };

// Appelé à chaque image de jeu (hors pause)
function updateLevel(dt) {
  // Bandeau de zone quand la caméra entre dans un nouveau quartier
  const z = zoneAt(camX + W / 2);
  if (z !== level.zone) { level.zone = z; level.banner = { text: `ZONE ${z + 1} — ${ZONES[z].name}`, t: 0 }; }
  if (level.banner && (level.banner.t += dt) > 3) level.banner = null;

  if (updateTransition(dt)) return;
  const wv = WAVES[level.wave];
  // Déclenchement de la vague suivante
  if (wv && level.cleared && camX >= wv.x - 4) {
    level.cleared = false; level.lock = wv.x;
    const extra = players.length > 1 && !wv.boss ? [LVL.extra] : [];
    level.queue = [...wv.foes, ...extra]; level.spawnT = 0.3;
    if (wv.boss) { audio.tone(80, 1.5, 'sawtooth', 0.12, -30); shake = 20; }
  }
  // Apparition échelonnée des ennemis de la vague
  if (!level.cleared && level.queue.length) {
    level.spawnT -= dt;
    const living = enemies.filter(e => e.alive).length;
    if (level.spawnT <= 0 && living < 3 + players.length) {
      const type = level.queue.shift();
      spawnEnemy(type);
      if (!level.seen.has(type)) { level.seen.add(type); level.card = { type, t: 0 }; }
      level.spawnT = rand(0.6, 1.4);
    }
  }
  // Vague terminée : la caméra se libère, flèche « GO »
  if (!level.cleared && !level.queue.length && !enemies.some(e => e.alive)) {
    level.cleared = true; level.lock = null; level.goT = 3;
    if (wv) level.wave++;
    if (wv && wv.boss) { level.bossDead = true; scene = 'clear'; sceneT = 0; audio.tone(523, 0.6, 'triangle', 0.2, 500); }
  }
  level.goT = Math.max(0, level.goT - dt);

  updateProps(dt);
  updateItems(dt);
}

// Prochaine zone à franchir (son élément de passage), ou rien
const nextZone = () => ZONES[level.passed + 1];
// Caméra : jamais au-delà de la vague en cours, du prochain passage (il reste aux deux tiers de l'écran) ni de la fin
const camLimit = () => Math.min(level.lock ?? Infinity, LEVEL_END - W, nextZone() ? nextZone().from - W : Infinity);

// Scène de passage : déclenchée quand la vague est finie et qu'un joueur arrive à l'élément de passage
function updateTransition(dt) {
  const Z = nextZone();
  if (!level.trans) {
    if (!Z || !level.cleared || camX < Z.from - W - 4 || !players.some(h => !h.out && h.x > Z.from - (gateImg(Z) ? GATE.dx + 70 : 120))) return false;
    level.trans = { t: 0, Z, jumped: false, vt: 0 };
    level.goT = 0; audio.whoosh(0.8);
    if (TRANS_VIDEO[Z.id]) {
      const v = document.createElement('video');
      Object.assign(v, { src: TRANS_VIDEO[Z.id], muted: true, playsInline: true, preload: 'auto' });
      level.trans.vid = v;
    }
  }
  const T = level.trans;
  T.t += dt;
  // vidéo de passage : le noir dure le temps de la vidéo (7 s au plus si elle ne se charge pas)
  if (T.vid && T.t >= TRANS.walk && !T.vdone) {
    if (!T.vt) { T.vid.play().catch(() => {}); audio.play('boom', 0.7, 0.8, 0); }
    T.vt += dt; T.t = TRANS.walk;
    if (T.vid.ended || T.vt > 7 || (T.vt > 1.5 && T.vid.readyState < 2)) T.vdone = true;
  }
  if (!T.jumped && T.t >= TRANS.walk + TRANS.black / 2) {
    // dans le noir : on reprend juste après le passage, dans la nouvelle zone
    T.jumped = true; level.passed++;
    camX = T.Z.from + 40;
    players.forEach((h, i) => { h.x = camX + 150 + i * 70; h.y = h.gz; h.vx = h.vy = 0; h.onGround = true; });
    projs = []; stars = []; level.items = [];
  }
  if (T.t >= TRANS.walk + TRANS.black + TRANS.back) level.trans = null;
  return true;
}
// Pendant le passage, les joueurs marchent seuls vers l'élément de passage
function transitionWalk(h, dt) {
  const T = level.trans;
  h.move = null; h.inv = Math.max(h.inv, 0.2);
  if (h.out) return;
  if (!T.jumped && CLIMB.has(T.Z.gate) && h.x > T.Z.from - LADDER) {
    // il grimpe à l'échelle : il monte, collé au wagon, en enchaînant les poses de saut
    h.x = T.Z.from - LADDER; h.gz += (Z_TOP + 16 - h.gz) * Math.min(1, dt * 10); h.y = Math.min(h.y, h.gz) - 420 * dt; h.state = 'jump'; h.vy = -1; h.onGround = false; h.dir = 1;
  } else if (!T.jumped && gateImg(T.Z)) {
    // il remonte vers la porte au fond de la rue et y entre
    const gx = T.Z.from - GATE.dx;
    h.state = 'walk'; h.walkT += dt; h.dir = gx >= h.x ? 1 : -1;
    h.x += clamp(gx - h.x, -230 * dt, 230 * dt); h.gz += clamp(Z_TOP - h.gz, -200 * dt, 200 * dt); h.y = h.gz;
  } else if (!T.jumped) { h.state = 'walk'; h.dir = 1; h.x += 230 * dt; h.walkT += dt; }
  else if (T.t > TRANS.walk + TRANS.black + 0.15) { h.state = 'idle'; }
  else { h.state = 'walk'; h.dir = 1; h.x += 120 * dt; h.walkT += dt; }
}
// Opacité du voile noir de la scène de passage
function transitionFade() {
  const T = level.trans;
  if (!T) return 0;
  const a = TRANS.walk * 0.45, b = TRANS.walk + TRANS.black;
  if (T.t < a) return 0;
  if (T.t < TRANS.walk) return (T.t - a) / (TRANS.walk - a);
  if (T.t < b) return 1;
  return Math.max(0, 1 - (T.t - b) / TRANS.back);
}
// Éléments de passage (devant le décor, derrière les personnages) : l'échelle de fer posée contre le flanc du
// wagon, vue de profil comme le décor (une image de face jurait avec la vue de côté)
const gateImg = Z => Z.gate && !CLIMB.has(Z.gate) && IMG[Z.gate];
function drawGates() {
  for (const Z of ZONES) {
    const img = gateImg(Z);
    if (img) {
      // de face, à sa proportion, pied posé au fond de la rue ; les joueurs passent devant puis y entrent
      const s = Math.min(GATE.h / img.height, GATE.maxW / img.width), w = img.width * s, h = img.height * s, cx = Z.from - GATE.dx - camX;
      if (cx + w / 2 < -20 || cx - w / 2 > W + 20) continue;
      const g = ctx.createRadialGradient(cx, GATE.base, 10, cx, GATE.base, w * 0.6);
      g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - w * 0.6, GATE.base - 20, w * 1.2, 40);
      ctx.drawImage(img, cx - w / 2, GATE.base - h, w, h);
      continue;
    }
    if (!CLIMB.has(Z.gate)) continue;
    const sx = Z.from - LADDER - camX;
    if (sx < -80 || sx > W + 80) continue;
    drawHatch(sx + 4, 0);
    drawLadder(sx, Z_TOP + 14, -10);
  }
}
// Trappe ouverte au plafond du wagon : la nuit et la lune passent par l'ouverture
function drawHatch(x, y) {
  ctx.save();
  ctx.fillStyle = '#0a0d1e'; ctx.fillRect(x - 56, y, 112, 46);
  const g = ctx.createRadialGradient(x + 20, y + 10, 4, x, y + 20, 90); g.addColorStop(0, 'rgba(200,220,255,0.55)'); g.addColorStop(1, 'rgba(60,80,140,0)');
  ctx.fillStyle = g; ctx.fillRect(x - 56, y, 112, 46);
  ctx.fillStyle = '#2b2226'; ctx.fillRect(x - 64, y + 42, 128, 10); ctx.strokeStyle = '#050405'; ctx.lineWidth = 2; ctx.strokeRect(x - 64, y + 42, 128, 10);
  // abattant relevé
  ctx.fillStyle = '#3a3034'; ctx.beginPath(); ctx.moveTo(x + 56, y + 44); ctx.lineTo(x + 90, y - 4); ctx.lineTo(x + 96, y); ctx.lineTo(x + 64, y + 48); ctx.closePath(); ctx.fill(); ctx.stroke();
  // lumière de lune qui tombe dans le wagon
  const b = ctx.createLinearGradient(0, y + 46, 0, y + 330); b.addColorStop(0, 'rgba(180,200,255,0.22)'); b.addColorStop(1, 'rgba(180,200,255,0)');
  ctx.fillStyle = b; ctx.beginPath(); ctx.moveTo(x - 52, y + 46); ctx.lineTo(x + 52, y + 46); ctx.lineTo(x + 110, y + 330); ctx.lineTo(x - 80, y + 330); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawLadder(x, bot, top) {
  ctx.save();
  // ombre portée sur la tôle
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 18, top + 10, 44, bot - top);
  const rail = (rx, light) => {
    const g = ctx.createLinearGradient(rx - 5, 0, rx + 5, 0);
    g.addColorStop(0, '#1c1a1e'); g.addColorStop(0.45, light); g.addColorStop(1, '#141216');
    ctx.fillStyle = g; ctx.fillRect(rx - 5, top, 10, bot - top);
    ctx.strokeStyle = '#050405'; ctx.lineWidth = 2; ctx.strokeRect(rx - 5, top, 10, bot - top);
  };
  // barreaux, légèrement en biais (vue de trois quarts)
  for (let y = bot - 26; y > top + 10; y -= 34) {
    ctx.fillStyle = '#3a3438'; ctx.strokeStyle = '#050405'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x + 22, y - 6); ctx.lineTo(x + 22, y - 1); ctx.lineTo(x - 22, y + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(160,90,60,0.35)'; ctx.fillRect(x - 10, y - 1, 12, 3); // rouille
  }
  rail(x - 22, '#5a5258'); rail(x + 22, '#6a6066');
  // pattes de fixation au wagon
  for (const y of [top + 40, (top + bot) / 2, bot - 60]) { ctx.fillStyle = '#2a2628'; ctx.fillRect(x + 27, y - 4, 14, 8); ctx.strokeRect(x + 27, y - 4, 14, 8); }
  ctx.restore();
}

// Les coups des joueurs cassent les objets
function updateProps(dt) {
  for (const p of level.props) {
    p.shakeT = Math.max(0, p.shakeT - dt);
    if (p.broken) { p.t += dt; continue; }
    for (const h of players) {
      const m = h.move;
      if (!m || !m.reach || h.t < m.on || h.t > m.off) continue;
      if (h._propMove !== m || h._propT0 !== h.chain) { h._propMove = m; h._propT0 = h.chain; h._propHit = new Set(); }
      if (h._propHit.has(p)) continue;
      const dx = (p.x - h.x) * h.dir;
      if (Math.abs(p.gz - h.gz) < 40 && ((dx > -20 && dx < m.reach[1] + 40) || Math.abs(p.x - h.x) < 55)) {
        h._propHit.add(p); p.hp--; p.shakeT = 0.2; audio.play('body', 0.7, 1.3);
        burst(p.x, p.gz - 50, '#c9a46a', 10);
        if (p.hp <= 0) {
          p.broken = true; p.t = 0; shake = Math.max(shake, 6); audio.hit(true);
          if (p.item) level.items.push({ kind: p.item, x: p.x + h.dir * 30, gz: p.gz, y: p.gz - 60, vy: -300, t: 0 });
        }
      }
    }
  }
}

function dropItem(e) {
  // rare : seuls les gros ennemis lâchent parfois un petit en-cas
  const T = ETYPES[e.type];
  if (!(['brute', 'samurai'].includes(e.type) || T.armor && !T.isBoss) || Math.random() > 0.12) return;
  const kind = Math.random() < 0.7 ? 'onigiri' : 'drink';
  level.items.push({ kind, x: e.x, gz: e.gz, y: e.gz - 80, vy: -320, t: 0 });
}

function updateItems(dt) {
  for (const it of level.items) {
    it.t += dt;
    if (it.y < it.gz) { it.vy += 1500 * dt; it.y = Math.min(it.gz, it.y + it.vy * dt); }
    for (const h of players) {
      if (it.taken || h.out || !h.onGround || Math.abs(h.x - it.x) > 55 || Math.abs(h.gz - it.gz) > 34 || it.t < 0.4) continue;
      const I = ITEMS[it.kind];
      it.taken = true;
      if (I.hp) h.hp = Math.min(h.maxHp, h.hp + I.hp);
      if (I.ki) h.ki = Math.min(100, h.ki + I.ki);
      popups.push({ x: h.x, y: h.y - 230, t: 0, text: I.name, small: true, c: '#7dff9a' });
      audio.tone(880, 0.12, 'triangle', 0.12, 500); audio.tone(1320, 0.18, 'triangle', 0.08, 300);
      for (let k = 0; k < 16; k++) particles.push({ x: h.x + rand(-30, 30), y: h.y - rand(0, 160), vx: 0, vy: rand(-160, -60), t: 0, life: 0.6, c: '#9dffb0', r: rand(2, 4) });
    }
  }
  level.items = level.items.filter(it => !it.taken && it.t < 20);
}

// Éléments à dessiner triés avec les personnages (profondeur)
function levelDrawables() {
  const out = [];
  for (const p of level.props) out.push({ z: p.gz - 2, f: () => drawProp(p) });
  for (const it of level.items) out.push({ z: it.gz - 1, f: () => drawItem(it) });
  return out;
}

function drawProp(p) {
  if (p.broken && p.t > 3 && Math.floor(p.t * 10) % 2) return;
  if (p.broken && p.t > 4) return;
  const img = IMG[`prop_${p.type}${p.broken ? '_broken' : ''}`];
  const sx = p.x - camX + (p.shakeT > 0 ? Math.sin(p.shakeT * 90) * 4 : 0);
  if (!img || sx < -200 || sx > W + 200) return;
  const hgt = p.type === 'can' ? 100 : 105, s = (p.broken ? hgt * 0.7 : hgt) / img.height * (p.broken ? 1.2 : 1);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(sx, p.gz + 3, img.width * s * 0.42, 10, 0, 0, 7); ctx.fill();
  ctx.drawImage(img, sx - img.width * s / 2, p.gz - img.height * s + 6, img.width * s, img.height * s);
}

function drawItem(it) {
  if (it.t > 16 && Math.floor(it.t * 8) % 2) return;
  const sx = it.x - camX, bob = it.y >= it.gz ? Math.sin(it.t * 5) * 4 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(sx, it.gz + 2, 24, 6, 0, 0, 7); ctx.fill();
  // halo qui attire l'œil
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.2 * Math.sin(it.t * 6);
  const g = ctx.createRadialGradient(sx, it.y - 26, 2, sx, it.y - 26, 46); g.addColorStop(0, '#fff6c0'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, it.y - 26, 46, 0, 7); ctx.fill(); ctx.restore();
  const L = typeof FX !== 'undefined' && FX.items && FX.items[ITEMS[it.kind].i], img = L && IMG[L.src];
  if (img) { const w = 56, h = w * L.h / L.w; ctx.drawImage(img, sx - w / 2, it.y - h - 4 + bob, w, h); }
}

// Fond selon la zone : le décor de la zone d'avant cède la place à la suivante en fondu
function drawZoneLayer(kind) {
  const L = LAYERS[kind === 'mid' ? 'mid' : kind === 'sky' ? 'sky' : 'street'];
  // décors des niveaux à thème : une copie sur deux en miroir, pour qu'aucune coupure ne se voie entre deux copies
  const f = L.factor, mirror = kind === 'mid' ? LVL !== TOKYO : kind === 'sky' ? false : L.mirror;
  for (let k = 0; k < ZONES.length; k++) {
    const Z = ZONES[k], key = kind === 'sky' ? Z.sky || LVL.sky : Z[kind], img = IMG[key], next = ZONES[k + 1];
    if (!img) continue;
    // bornes de la zone à l'écran : à la vitesse du sol pour tous les plans, sinon le fond d'une zone
    // apparaît au-dessus du sol de la précédente (le calque lui-même défile toujours à la vitesse f)
    const sx0 = k === 0 ? -1e9 : Z.from - camX, sx1 = next ? next.from - camX : 1e9;
    if (sx1 < -200 || sx0 > W + 200) continue;
    ctx.save();
    // découpe nette sur la limite : l'élément de passage (porte, ponton…) recouvre la jointure
    ctx.beginPath(); ctx.rect(Math.max(-10, sx0), -20, Math.min(W + 20, sx1) - Math.max(-10, sx0), H + 40); ctx.clip();
    if (kind === 'mid') {
      // deux versions du plan moyen en alternance (la 2e prolonge le même lieu) : le décor ne se répète plus toutes les largeurs d'écran
      const alt = Z.mid2 && IMG[Z.mid2] ? harmonizedMid(Z.mid2, IMG[Z.mid2], Z.ground) : null;
      drawTiled(harmonizedMid(key, img, Z.ground), f, L.y, L.h, L.w, mirror, null, alt);
    }
    else if (kind === 'ground') {
      drawTiled(img, f, L.y, L.h, L.w, mirror);
      // ombre portée au pied du plan moyen : la jointure se lit comme une marche, un rebord
      const y0 = L.y, g = ctx.createLinearGradient(0, y0, 0, y0 + STEP.shadow);
      g.addColorStop(0, `rgba(0,0,0,${STEP.dark})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(-10, y0, W + 20, STEP.shadow);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-10, y0, W + 20, 2);
      // bordure de premier plan (muret, rambarde, rochers…) posée sur la jointure : la séparation devient un objet
      const S = STRIPS[Z.id], simg = S && IMG[S.img];
      if (simg) {
        const sh = S.h, sw = simg.width * sh / simg.height;
        ctx.save(); ctx.filter = `brightness(${groundLight(Z.mid, IMG[Z.mid])})`;
        drawTiled(simg, f, L.y + S.dy - sh, sh, sw, true);
        ctx.restore();
      }
    } else drawTiled(img, f, L.y, L.h, L.w, mirror);
    ctx.restore();
  }
}
// Bordures de premier plan par zone (tools/make_strip.py) : image, hauteur affichée, bas de la bordure sous le haut du sol
const STRIP = (img, h, dy) => ({ img: 'strip_' + img, h, dy });
const STRIPS = {
  street: STRIP('curb_city', 46, 22), neon: STRIP('curb_city', 46, 22), dock: STRIP('curb_city', 46, 22),
  bridge: STRIP('rail_metal', 64, 24), hx_z1: STRIP('curb_city', 46, 22), mh_z1: STRIP('curb_city', 46, 22),
  nr2_z1: STRIP('curb_city', 46, 22), ds2_z1: STRIP('curb_city', 46, 22),
  nr2_z2: STRIP('rail_metal', 64, 24), nr2_z3: STRIP('rail_metal', 64, 24), hx_z3: STRIP('rail_metal', 64, 24),
  op_z1: STRIP('rail_wood', 70, 26), rk_z3: STRIP('rail_wood', 70, 26), op_z2: STRIP('rail_wood', 70, 26), rk_z1: STRIP('rail_wood', 70, 26),
  shrine: STRIP('curb_city', 46, 22),
  op_z3: STRIP('balustrade', 56, 22), op2_z1: STRIP('balustrade', 56, 22), op2_z2: STRIP('balustrade', 56, 22),
  op2_z3: STRIP('balustrade', 56, 22), bl_z2: STRIP('balustrade', 56, 22), hx_z2: STRIP('balustrade', 56, 22),
  ds_z3: STRIP('rocks_grass', 60, 26), bl_z1: STRIP('rocks_grass', 60, 26), bl_z3: STRIP('rocks_grass', 60, 26),
  nr_z1: STRIP('rocks_grass', 60, 26), nr_z2: STRIP('rocks_grass', 60, 26), nr_z3: STRIP('rocks_grass', 60, 26),
  db_z1: STRIP('rocks_namek', 80, 30), db_z2: STRIP('rocks_namek', 80, 30),
  db_z3: STRIP('rubble', 70, 30), mh_z2: STRIP('rubble', 70, 30), mh_z3: STRIP('rubble', 70, 30),
  rk_z2: STRIP('rubble', 70, 30), ds2_z3: STRIP('rubble', 70, 30),
  db2_z1: STRIP('rocks_desert', 70, 28), db2_z2: STRIP('rocks_desert', 70, 28),
  jk_z1: STRIP('curb_city', 46, 22), jk_z2: STRIP('rail_metal', 64, 24), jk_z3: STRIP('rubble', 70, 30),
  sl_z1: STRIP('curb_city', 46, 22), sl_z2: STRIP('rubble', 70, 30), sl_z3: STRIP('rubble', 70, 30),
  opm_z1: STRIP('curb_city', 46, 22), opm_z2: STRIP('rail_metal', 64, 24), opm_z3: STRIP('rail_metal', 64, 24),
  bl2_z1: STRIP('rubble', 70, 30), bl2_z2: STRIP('balustrade', 56, 22), bl2_z3: STRIP('rubble', 70, 30),
  // 4es zones
  op_z4: STRIP('curb_city', 46, 22), ds_z4: STRIP('rail_metal', 64, 24), bl_z4: STRIP('balustrade', 56, 22), hx_z4: STRIP('rail_metal', 64, 24),
  nr_z4: STRIP('rocks_grass', 60, 26), db_z4: STRIP('rocks_namek', 80, 30), mh_z4: STRIP('rubble', 70, 30), rk_z4: STRIP('rail_wood', 70, 26),
  op2_z4: STRIP('balustrade', 56, 22), nr2_z4: STRIP('rail_metal', 64, 24), ds2_z4: STRIP('rail_wood', 70, 26), db2_z4: STRIP('rubble', 70, 30),
  jk_z4: STRIP('rubble', 70, 30), sl_z4: STRIP('rubble', 70, 30), opm_z4: STRIP('rubble', 70, 30), bl2_z4: STRIP('balustrade', 56, 22),
};
for (const S of new Set(Object.values(STRIPS).map(S => S.img))) ASSETS.backgrounds[S] = `assets/backgrounds/strips/${S.slice(6)}.png`;
// Éclairage de la zone (luminosité moyenne du plan moyen : jour ou nuit) : la bordure prend la même lumière que le décor
const lightCache = {};
function groundLight(key, img) {
  if (key in lightCache) return lightCache[key];
  let v = 1;
  try {
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 16);
    const d = g.getImageData(0, 0, 64, 16).data; let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { sum += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; n++; }
    v = Math.max(0.7, Math.min(1, sum / Math.max(1, n) / 100));
  } catch (e) { v = 1; }
  return (lightCache[key] = v);
}
// Jointure plan moyen / sol. Les deux calques défilent à des vitesses différentes : un fondu entre eux superpose
// deux textures (image double, floue). On garde donc une jointure nette, comme un rebord : ombre portée sur le haut
// du sol, et le bas du plan moyen assombri et teinté vers la couleur du sol pour que les deux se raccordent.
const STEP = { shadow: 28, dark: 0.5, tint: 0.45, shade: 0.25, from: 0.7 }, harmCache = {};
function harmonizedMid(key, img, groundKey) {
  const ck = key + '|' + groundKey;
  if (ck in harmCache) return harmCache[ck];
  const gimg = IMG[groundKey];
  let out = img;
  try {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const mean = (d, alpha) => { let r = 0, gg = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 16) if (!alpha || d[i + 3] > 128) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } return n ? [r / n, gg / n, b / n] : null; };
    const y0 = Math.floor(img.height * STEP.from), d = g.getImageData(0, y0, img.width, img.height - y0);
    let gc = null;
    if (gimg) {
      const t = document.createElement('canvas'); t.width = 200; t.height = 40;
      t.getContext('2d').drawImage(gimg, 0, 0, gimg.width, gimg.height * 0.12, 0, 0, 200, 40);
      gc = mean(t.getContext('2d').getImageData(0, 0, 200, 40).data, false);
    }
    const mc = mean(d.data, true), H2 = img.height - y0;
    for (let y = 0; y < H2; y++) {
      const w = y / H2, k = gc && mc ? STEP.tint * w : 0, dark = 1 - STEP.shade * w;
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const v = d.data[i + ch], tinted = k ? v * gc[ch] / Math.max(1, mc[ch]) : v;
          d.data[i + ch] = (v * (1 - k) + tinted * k) * dark;
        }
      }
    }
    g.putImageData(d, 0, y0);
    out = c;
  } catch (e) { out = img; }
  return (harmCache[ck] = out);
}

// ---------- Cartes et bandeaux ----------
function drawLevelOverlay() {
  const fade = transitionFade();
  if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
  const V = level.trans?.vid;
  if (V && level.trans.vt > 0 && !level.trans.vdone && V.readyState >= 2) {
    const d = V.duration || 5, c = V.currentTime, k = Math.max(0, Math.min(1, c / 0.35, (d - c) / 0.35));
    const s = Math.max(W / V.videoWidth, H / V.videoHeight), w = V.videoWidth * s, h = V.videoHeight * s;
    ctx.save(); ctx.globalAlpha = k; ctx.drawImage(V, (W - w) / 2, (H - h) / 2, w, h); ctx.restore();
  }
  // Flèche « GO » quand une vague est nettoyée
  if (level.goT > 0 && Math.floor(level.goT * 3) % 2 === 0 && scene === 'play') {
    outlined('GO  ▶', W - 110, H / 2 - 40, 48, '#ffe14d');
  }
  // Bandeau de zone
  if (level.banner) {
    const t = level.banner.t, a = t < 0.4 ? t / 0.4 : t > 2.5 ? (3 - t) / 0.5 : 1;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(5,0,20,0.7)'; ctx.fillRect(0, 150, W, 60);
    ctx.fillStyle = '#ff2d55'; ctx.fillRect(0, 150, W, 3); ctx.fillRect(0, 207, W, 3);
    outlined(level.banner.text, W / 2 + (1 - a) * 60, 192, 34, '#fff');
    ctx.restore();
  }
  // Carte de présentation d'un nouvel ennemi : le jeu se fige le temps de la lire
  if (level.card) {
    const c = level.card, t = c.t, info = ENEMY_INFO[c.type] || [c.type.toUpperCase(), ''], img = IMG['intro_' + c.type];
    const k = t < 0.25 ? t / 0.25 : t > CARD_T - 0.3 ? (CARD_T - t) / 0.3 : 1, boss = !!ETYPES[c.type]?.isBoss;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.55 * k})`; ctx.fillRect(0, 0, W, H);
    const bw = W, bh = boss ? 300 : 230, y = H / 2 - bh / 2, x = (1 - k) * (c.type.length % 2 ? -W : W);
    ctx.beginPath(); ctx.moveTo(x, y + 30); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + bh - 30); ctx.lineTo(x, y + bh); ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.fillStyle = boss ? '#2a0008' : '#140626'; ctx.fillRect(x, y, bw, bh);
    if (img) {
      // Cadrage sur le visage : l'image montre ~60 % de sa hauteur, visage au tiers haut du bandeau
      const fy = INTRO_FACE[c.type] ?? 0.2, s = bh / (0.62 * img.height), iw = img.width * s, ih = img.height * s;
      const ix = x + bw - iw + 40 - t * 30, iy = clamp(y + bh * 0.34 - fy * ih, y + bh - ih, y);
      ctx.drawImage(img, ix, iy, iw, ih);
      // bord gauche de l'image fondu dans le bandeau
      const gl = ctx.createLinearGradient(ix, 0, ix + 160, 0);
      gl.addColorStop(0, boss ? '#2a0008' : '#140626'); gl.addColorStop(1, boss ? 'rgba(42,0,8,0)' : 'rgba(20,6,38,0)');
      ctx.fillStyle = gl; ctx.fillRect(ix - 2, y, 162, bh);
    }
    const g = ctx.createLinearGradient(x, 0, x + bw * 0.6, 0); g.addColorStop(0, 'rgba(10,0,20,0.95)'); g.addColorStop(1, 'rgba(10,0,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, bw, bh);
    ctx.restore();
    ctx.strokeStyle = boss ? '#ff2030' : '#ff4fd8'; ctx.lineWidth = 4; ctx.stroke();
    outlined(boss ? '⚠ BOSS ⚠' : 'NOUVEL ENNEMI', x + 60, y + 70, 24, boss ? '#ff3040' : '#ff8ae6', 'left');
    outlined(info[0], x + 60, y + 70 + (boss ? 80 : 60), boss ? 72 : 52, '#fff', 'left');
    ctx.font = 'italic bold 18px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd6e8';
    ctx.fillText(info[1], x + 64, y + bh - 40);
    ctx.restore();
  }
}
const CARD_T = 2.1;
// Hauteur du visage dans chaque image de présentation (0 = haut de l'image, 1 = bas), relevée à l'œil
const INTRO_FACE = {
  thug: 0.25, brute: 0.3, ninja: 0.35, biker: 0.2, samurai: 0.35, boss: 0.3,
  op_pirate: 0.15, op_marine: 0.12, op_boss: 0.2, op2_agent: 0.08, op2_guard: 0.12, op2_boss: 0.12,
  ds_demon: 0.2, ds_spider: 0.12, ds_boss: 0.15, ds2_demon: 0.2, ds2_obi: 0.25, ds2_boss: 0.25,
  bl_shinigami: 0.2, bl_hollow: 0.15, bl_boss: 0.2, hx_fighter: 0.12, hx_nen: 0.12, hx_boss: 0.15,
  nr_sound: 0.12, nr_rogue: 0.1, nr_boss: 0.1, nr2_rain: 0.1, nr2_puppet: 0.15, nr2_boss: 0.12,
  db_soldier: 0.12, db_elite: 0.2, db_boss: 0.12, db2_jr: 0.15, db2_android: 0.12, db2_boss: 0.12,
  mh_villain: 0.15, mh_blaster: 0.1, mh_boss: 0.12, rk_ninja: 0.15, rk_ronin: 0.15, rk_boss: 0.1,
  jk_curse: 0.15, jk_user: 0.12, jk_boss: 0.12, sl_goblin: 0.2, sl_knight: 0.12, sl_boss: 0.12,
  opm_monster: 0.15, opm_alien: 0.12, opm_boss: 0.12, bl2_arrancar: 0.12, bl2_fraccion: 0.15, bl2_boss: 0.12,
};

// Jauge du boss en bas de l'écran
function drawBossBar() {
  const b = enemies.find(e => ETYPES[e.type].isBoss && e.alive);
  if (!b) return;
  const w = 560, x = W / 2 - w / 2, y = H - 40, k = Math.max(0, b.hp / b.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 4, y - 4, w + 8, 22);
  const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#ff2030'); g.addColorStop(1, b.enraged ? '#ff9a00' : '#a00018');
  ctx.fillStyle = g; ctx.fillRect(x, y, w * k, 14);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x - 4, y - 4, w + 8, 22);
  outlined(ENEMY_INFO[b.type]?.[0] || 'BOSS', x, y - 10, 20, '#ff6070', 'left');
}

// Progression : petite barre avec la position dans le niveau
function drawLevelProgress() {
  const w = 220, x = W / 2 - w / 2, y = 78, k = clamp(camX / (LEVEL_END - W), 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y, w, 6);
  for (const Z of ZONES) ctx.fillStyle = '#fff', ctx.fillRect(x + w * Z.from / (LEVEL_END - W) - 1, y - 2, 2, 10);
  ctx.fillStyle = '#ffe14d'; ctx.fillRect(x, y, w * k, 6);
  ctx.fillStyle = '#ff3040'; ctx.beginPath(); ctx.arc(x + w, y + 3, 6, 0, 7); ctx.fill();
}
