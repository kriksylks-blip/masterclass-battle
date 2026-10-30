'use strict';
// Progression (30/10) : recrues à débloquer, note de fin de niveau (S, A, B, C) et défis par monde.
// - Au départ, seuls le héros et les maîtres de Tokyo sont jouables. Terminer un monde (histoire ou combat libre)
//   recrute ses maîtres (RECRUITS, modes.js). Certaines tenues se gagnent avec un défi (CH_REWARD).
// - Chaque niveau terminé reçoit une note sur 100 : survie (40), temps (20), plus long combo (20), parades (20).
// - Trois défis par monde : le finir avec un perso donné, un défi d'adresse, obtenir la note S.
// Option TOUT DÉBLOQUER (OPTS.unlockAll). En ligne, tout est ouvert (la sélection est celle de l'hôte).
// Gardé dans le navigateur (clé bw_prog). Chargé avant game.js : les fonctions ne s'appellent qu'une fois le jeu lancé.

const PROG_KEY = 'bw_prog';
const prog = { cleared: [], ranks: {}, ch: {} };
try { Object.assign(prog, JSON.parse(localStorage.getItem(PROG_KEY) || '{}')); } catch (e) { }
const saveProg = () => { try { localStorage.setItem(PROG_KEY, JSON.stringify(prog)); } catch (e) { } };

// ---------- Note de fin de niveau ----------
const RANKS = ['C', 'B', 'A', 'S'], RANK_MIN = [0, 50, 70, 85];
const RANK_COLOR = { S: '#ffe14d', A: '#ff6ad5', B: '#5ad1ff', C: '#b8b8cc' };
const DIFF_BONUS = [0.9, 1, 1.05, 1.1]; // Facile plafonne vers A, Légende pardonne un peu plus
const betterRank = (a, b) => RANKS.indexOf(a) > RANKS.indexOf(b);

// Mesures de la partie en cours (remises à zéro par resetGame)
const run = { time: 0, dmg: 0, kos: 0, parries: 0, maxCombo: 0, bossDmg: 0, result: null };
function runReset() { Object.assign(run, { time: 0, dmg: 0, kos: 0, parries: 0, maxCombo: 0, bossDmg: 0, result: null }); }
function runHurt(dmg) {
  run.dmg += dmg;
  if (enemies.some(e => e.alive && ETYPES[e.type]?.isBoss)) run.bossDmg += dmg;
}
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Détail de la note : [libellé, valeur affichée, points, sur]
function runParts() {
  const n = players.filter(h => !h.assist).length || 1;
  const surv = Math.max(0, 40 - 10 * run.kos / n - 8 * run.dmg / (100 * n));
  const time = 20 * clamp((600 - run.time) / (600 - 240), 0, 1); // plein sous 4 min, rien après 10 min
  return [
    ['SURVIE', `${Math.round(run.dmg)} dégâts · ${run.kos} K.O.`, surv, 40],
    ['TEMPS', fmtTime(run.time), time, 20],
    ['PLUS LONG COMBO', `${run.maxCombo} coups`, Math.min(20, run.maxCombo * 0.8), 20],
    ['PARADES', `${run.parries}`, Math.min(20, run.parries * 4), 20],
  ];
}

// ---------- Défis ----------
// Défi d'adresse de chaque monde : [type, valeur]
const CH_SKILL = {
  tokyo: ['combo', 20], op: ['time', 300], ds: ['parry', 5], hx: ['boss', 25], nr: ['combo', 30], bl: ['nodeath'],
  mh: ['time', 300], rk: ['parry', 6], sl: ['boss', 25], op2: ['combo', 35], ds2: ['nodeath'], jk: ['boss', 20],
  nr2: ['parry', 8], opm: ['time', 270], bl2: ['nodeath'], db: ['combo', 40], db2: ['boss', 20],
  aot: ['nodeath'], bk: ['parry', 6], fz: ['combo', 30], fm: ['time', 300], rp: ['combo', 30], bu: ['boss', 25],
};
const SKILL = {
  combo: { text: n => `Enchaîne un combo de ${n} coups`, ok: (R, n) => R.maxCombo >= n },
  time: { text: s => `Termine en moins de ${Math.round(s / 60 * 10) / 10} min`.replace('.', ','), ok: (R, s) => R.time <= s },
  parry: { text: n => `Réussis ${n} parades`, ok: (R, n) => R.parries >= n },
  boss: { text: p => `Bats le boss en perdant moins de ${p} PV`, ok: (R, p) => R.bossDmg < p * R.n },
  nodeath: { text: () => 'Termine sans perdre une seule vie', ok: R => R.kos === 0 },
};
// Perso imposé : le premier maître recruté du monde, sinon celui-ci
const CH_HERO = { aot: 'eren', bk: 'guts', fz: 'saber', fm: 'edward', rp: 'revy', bu: 'vegeta', db2: 'gohan' };
// Tenues gagnées par un défi
const CH_REWARD = { 'op2.hero': 'zoro@1', 'db.hero': 'goku@1', 'bu.hero': 'vegeta@1', 'db2.hero': 'gohan_a@2', 'db2.rank': 'gohan_a@1', 'opm.hero': 'saitama@1' };

function challengesOf(id) {
  const out = [], hero = CH_HERO[id] || (RECRUITS[id] || [])[0], sk = CH_SKILL[id];
  if (hero && CHARS[hero]) out.push({ key: id + '.hero', text: `Termine ce monde avec ${CHARS[hero].name}`, ok: R => R.chars.includes(hero) });
  if (sk) out.push({ key: id + '.skill', text: SKILL[sk[0]].text(sk[1]), ok: R => SKILL[sk[0]].ok(R, sk[1]) });
  out.push({ key: id + '.rank', text: 'Obtiens la note S', ok: R => R.rank === 'S' });
  return out.map(c => ({ ...c, reward: CHARS[CH_REWARD[c.key]] ? CH_REWARD[c.key] : null }));
}
const worldName = id => { const L = LEVELS.find(l => l.id === id); return L ? (L.name.split(' — ')[1] || L.name) : id; };

// ---------- Personnages et tenues verrouillés ----------
const RECRUIT_OF = {};
for (const [lv, ids] of Object.entries(RECRUITS)) if (lv !== 'tokyo') for (const c of ids) RECRUIT_OF[c] ??= lv;
const OUTFIT_OF = Object.fromEntries(Object.entries(CH_REWARD).map(([k, o]) => [o, k]));
const worldDone = id => prog.cleared.includes(id) || story.done.includes(id);
const locksOn = () => !OPTS.unlockAll && !net.role;
// id : une case (luffy) ou une tenue (zoro@1)
function charOpen(id) {
  if (OUTFIT_OF[id]) return !!prog.ch[OUTFIT_OF[id]];
  const lv = RECRUIT_OF[CHARS[id]?.base || id];
  return !lv || worldDone(lv);
}
const isLocked = id => locksOn() && !charOpen(id);
// Ce qu'il faut faire pour le débloquer : [ligne 1, ligne 2]
function lockHint(id) {
  const key = OUTFIT_OF[id];
  if (key) { const lv = key.split('.')[0], c = challengesOf(lv).find(c => c.key === key); return [`DÉFI : ${c?.text || ''}`, `(${worldName(lv)})`]; }
  return ['TERMINE LE MONDE', worldName(RECRUIT_OF[CHARS[id]?.base || id])];
}
const lockedCount = () => [...CHAR_IDS, ...Object.keys(OUTFIT_OF)].filter(id => CHARS[id] && !charOpen(id)).length;

// ---------- Fin de niveau : note, défis, recrues ----------
function levelCleared() {
  if (net.role === 'guest') return;
  const id = LVL.id, parts = runParts(), n = players.filter(h => !h.assist).length || 1;
  const pts = Math.round(Math.min(100, parts.reduce((a, p) => a + p[2], 0) * (DIFF_BONUS[OPTS.diff] ?? 1)));
  const rank = RANKS[RANK_MIN.filter(m => pts >= m).length - 1];
  const chars = [...new Set(players.flatMap(h => [h.char, h.reserve?.char]).filter(Boolean))];
  const R = { ...run, n, rank, chars };
  const recruits = (RECRUITS[id] || []).filter(c => CHARS[c] && CHAR_IDS.includes(c) && !charOpen(c));
  if (!prog.cleared.includes(id)) prog.cleared.push(id);
  const newBest = !prog.ranks[id] || betterRank(rank, prog.ranks[id]);
  if (newBest) prog.ranks[id] = rank;
  const done = challengesOf(id).filter(c => !prog.ch[c.key] && c.ok(R));
  for (const c of done) prog.ch[c.key] = 1;
  saveProg();
  run.result = { rank, pts, parts, newBest, recruits, done };
}

// Lettre de note dans un losange (plateau, liste des mondes)
function rankBadge(rank, x, y, s) {
  if (!rank) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(10,0,25,0.9)'; ctx.fillRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
  ctx.strokeStyle = RANK_COLOR[rank]; ctx.lineWidth = 2; ctx.strokeRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
  ctx.restore();
  outlined(rank, x, y + s * 0.36, s, RANK_COLOR[rank]);
}
// Les défis d'un monde, une ligne chacun (✓ réussi), alignés à gauche
function drawChallenges(id, x, y, size = 13, lh = 18, maxW = 380) {
  for (const c of challengesOf(id)) {
    const ok = !!prog.ch[c.key];
    ctx.font = `bold ${size}px sans-serif`; ctx.textAlign = 'left';
    ctx.fillStyle = ok ? '#7fff9a' : 'rgba(255,255,255,0.45)'; ctx.fillText(ok ? '✓' : '○', x, y);
    let txt = c.text + (c.reward ? `  →  ${VARIANT_LABEL[c.reward] || 'TENUE'}` : '');
    ctx.font = `${ok ? '' : 'bold '}${size}px sans-serif`;
    while (ctx.measureText(txt).width > maxW && txt.length > 8) txt = txt.slice(0, -2);
    ctx.strokeStyle = 'rgba(4,0,12,0.9)'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeText(txt, x + size + 4, y);
    ctx.fillStyle = ok ? '#b8ffc8' : '#fff'; ctx.fillText(txt, x + size + 4, y);
    y += lh;
  }
}
// Cadenas dessiné (les polices d'emoji varient d'un appareil à l'autre)
function drawLock(x, y, s, col = '#ffe14d') {
  ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = Math.max(2, s * 0.14);
  ctx.beginPath(); ctx.arc(x, y - s * 0.12, s * 0.28, Math.PI, 0); ctx.lineTo(x + s * 0.28, y + s * 0.05); ctx.moveTo(x - s * 0.28, y + s * 0.05); ctx.lineTo(x - s * 0.28, y - s * 0.12); ctx.stroke();
  ctx.fillRect(x - s * 0.42, y + s * 0.02, s * 0.84, s * 0.6);
  ctx.fillStyle = 'rgba(10,0,25,0.9)'; ctx.fillRect(x - s * 0.05, y + s * 0.18, s * 0.1, s * 0.25);
  ctx.restore();
}

// Écran de fin de niveau : la note s'écrase après le détail des points, puis les défis réussis et les recrues
function drawClear() {
  const R = run.result, t = sceneT;
  ctx.fillStyle = `rgba(0,6,30,${Math.min(t * 1.5, 0.82)})`; ctx.fillRect(0, 0, W, H);
  outlined('NIVEAU TERMINÉ !', W / 2, 62, 50, '#7ff0ff');
  // détail, ligne par ligne
  R.parts.forEach(([label, val, p, max], k) => {
    const a = clamp((t - 0.3 - k * 0.18) * 4, 0, 1); if (!a) return;
    const y = 128 + k * 44, x = 90 - (1 - a) * 40;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x - 10, y - 26, 470, 38);
    outlined(label, x, y, 18, '#cfd3ff', 'left');
    ctx.font = 'italic 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd6e8'; ctx.fillText(val, x + 190, y - 2);
    outlined(`${Math.round(p)} / ${max}`, x + 450, y, 20, p >= max * 0.95 ? '#ffe14d' : '#fff', 'right');
    ctx.restore();
  });
  // la note
  const ta = t - 1.2;
  if (ta > 0) {
    const e = Math.min(1, ta / 0.25), s = 1 + (1 - e) * 2.5, col = RANK_COLOR[R.rank];
    if (ta < 0.4) { shake = Math.max(shake, ta > 0.22 ? 10 : 0); }
    ctx.save(); ctx.translate(745, 230); ctx.scale(s, s); ctx.rotate(-0.12); ctx.globalAlpha = e;
    ctx.shadowColor = col; ctx.shadowBlur = 30 + Math.sin(t * 5) * 10; outlined(R.rank, 0, 70, 210, col);
    ctx.restore();
    outlined(`NOTE · ${R.pts} / 100`, 745, 108, 20, '#fff');
    if (R.newBest && ta > 0.4) outlined('NOUVEAU RECORD !', 745, 352, 22, '#7fff9a');
  }
  // défis réussis et recrues
  let y = 330;
  const lines = [...R.done.map(c => ['DÉFI RÉUSSI', c.text, c.reward ? `TENUE DÉBLOQUÉE : ${CHARS[c.reward].name} — ${VARIANT_LABEL[c.reward] || ''}` : '']), ];
  lines.forEach(([head, txt, rew], k) => {
    const a = clamp((t - 1.8 - k * 0.3) * 4, 0, 1); if (!a) return;
    ctx.save(); ctx.globalAlpha = a;
    outlined(`✓ ${head}`, 80, y, 16, '#7fff9a', 'left'); ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText(txt, 230, y - 1);
    if (rew) { y += 20; outlined(rew, 230, y, 15, '#ffe14d', 'left'); }
    ctx.restore(); y += 26;
  });
  if (R.recruits.length) {
    const a = clamp((t - 2 - lines.length * 0.3) * 3, 0, 1);
    if (a) {
      const y0 = Math.max(y + 10, 420);
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(255,225,77,0.12)'; ctx.fillRect(0, y0 - 30, W, 82);
      outlined(R.recruits.length > 1 ? 'NOUVELLES RECRUES !' : 'NOUVELLE RECRUE !', 80, y0 + 18, 26, '#ffe14d', 'left');
      R.recruits.forEach((c, k) => {
        const bx = 420 + k * 170, bob = Math.sin(t * 4 + k) * 3;
        medallion(CHARS[c], bx, y0 + 10 + bob, 30, '#ffe14d');
        outlined(CHARS[c].name, bx + 38, y0 + 18, 18, '#fff', 'left');
      });
      ctx.restore();
    }
  }
  if (t > 2.2) outlined('ENTRÉE pour continuer', W / 2, H - 14, 20, `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 4)})`);
}
