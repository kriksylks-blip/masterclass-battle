'use strict';
// Mode infini (24/10) : le joueur (seul ou à plusieurs) choisit un monde, qui se rejoue en boucle. Chaque tour
// reprend toutes les vagues du monde, plus nombreuses et plus coriaces, boss compris ; le but est le plus gros score.
// Un tableau des scores par monde est gardé dans le navigateur (localStorage, clé bw_scores) : 10 meilleurs par monde.
// Chargé avant game.js : les fonctions ne s'appellent qu'une fois le jeu lancé.

const ENDLESS = { tour: 1, wave: 0, lastRank: -1 };
const SCORE_KEY = 'bw_scores', SCORE_MAX = 10;

const isEndless = () => gameMode === 'endless';
// Difficulté : chaque tour rend les ennemis plus résistants, plus forts et plus nombreux ; chaque vague un peu aussi
const endlessHp = () => isEndless() ? (1 + 0.35 * (ENDLESS.tour - 1)) * (1 + 0.015 * ENDLESS.wave) : 1;
const endlessDmg = () => isEndless() ? 1 + 0.2 * (ENDLESS.tour - 1) : 1;

function loadScores() {
  try { return JSON.parse(localStorage.getItem(SCORE_KEY) || '{}'); } catch (e) { return {}; }
}
function bestScore(levelId) { return (loadScores()[levelId] || [])[0]?.score || 0; }

// Vagues d'un tour : celles du monde, avec des renforts selon le tour (le boss garde sa vague, avec une escorte)
function endlessWaves(L, tour) {
  const extra = Math.min(4, tour - 1);
  return L.waves.map(wv => {
    if (wv.boss) return { ...wv, foes: [...wv.foes, ...Array(Math.min(3, tour - 1)).fill(L.extra)] };
    const pool = wv.foes.filter(t => !t.endsWith('_mini'));
    return { ...wv, foes: [...wv.foes, ...Array.from({ length: extra }, (_, k) => pool[k % pool.length])] };
  });
}

// Début de partie : premier tour
function endlessStart() {
  Object.assign(ENDLESS, { tour: 1, wave: 0, lastRank: -1 });
  WAVES = endlessWaves(LVL, 1);
  level.banner = { text: 'MODE INFINI — TOUR 1', t: 0 };
}

// Boss du tour vaincu : on repart du début du monde, plus fort ; un peu de vie et de ki rendus aux joueurs
function endlessNextTour() {
  ENDLESS.tour++;
  WAVES = endlessWaves(LVL, ENDLESS.tour);
  resetLevel();
  camX = 0; level.zone = 0; // le bandeau du tour reste affiché (pas celui de la zone 1)
  players.forEach((h, i) => {
    if (h.out) return;
    h.x = 160 + i * 70; h.y = h.gz; h.vx = h.vy = 0; h.state = 'idle'; h.move = null; h.onGround = true;
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.3); h.ki = Math.min(100, h.ki + 30); h.inv = 1.5;
  });
  enemies = []; projs = []; stars = []; bombs = [];
  level.banner = { text: `TOUR ${ENDLESS.tour} — LES ENNEMIS SE RENFORCENT`, t: 0 };
  flash = 0.6; audio.tone(523, 0.6, 'triangle', 0.2, 500); audio.play('transform', 0.8, 1, 0);
  score += 5000 * (ENDLESS.tour - 1);
}

// Fin de partie : le score entre au tableau du monde s'il fait partie des 10 meilleurs
function endlessRecord() {
  const all = loadScores(), list = all[LVL.id] || [];
  const names = players.map(h => h.C.name).join(' + ');
  const entry = { score, tour: ENDLESS.tour, wave: ENDLESS.wave, who: names, n: players.length, date: new Date().toISOString().slice(0, 10) };
  list.push(entry); list.sort((a, b) => b.score - a.score);
  ENDLESS.lastRank = list.indexOf(entry);
  all[LVL.id] = list.slice(0, SCORE_MAX);
  if (ENDLESS.lastRank >= SCORE_MAX) ENDLESS.lastRank = -1;
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(all)); } catch (e) { }
}

// Tableau des scores du monde (fin de partie) ; la ligne de la partie qui vient de se terminer clignote
function drawScoreboard(levelId, y0 = 150) {
  const list = loadScores()[levelId] || [];
  const x = W / 2 - 300, w = 600;
  ctx.fillStyle = 'rgba(5,0,20,0.82)'; ctx.fillRect(x - 10, y0 - 34, w + 20, 40 + Math.max(1, list.length) * 26);
  outlined('TABLEAU DES SCORES', W / 2, y0 - 8, 24, '#ffe14d');
  ctx.font = 'bold 15px sans-serif';
  if (!list.length) { ctx.textAlign = 'center'; ctx.fillStyle = '#ccc'; ctx.fillText('Aucun score pour ce monde', W / 2, y0 + 22); return; }
  list.forEach((s, k) => {
    const y = y0 + 22 + k * 26, me = k === ENDLESS.lastRank;
    if (me && Math.floor(sceneT * 4) % 2) { ctx.fillStyle = 'rgba(255,225,77,0.25)'; ctx.fillRect(x, y - 17, w, 23); }
    ctx.fillStyle = me ? '#ffe14d' : k === 0 ? '#ffd27a' : '#e8e8ff';
    ctx.textAlign = 'left'; ctx.fillText(`${k + 1}.`, x + 6, y); ctx.fillText(s.who, x + 44, y);
    ctx.textAlign = 'right'; ctx.fillText(`tour ${s.tour} · vague ${s.wave}`, x + w - 150, y); ctx.fillText(String(s.score).padStart(7, '0'), x + w - 6, y);
  });
  ctx.textAlign = 'left';
}

// Indicateur en jeu : tour et vague, sous le score
function drawEndlessHud() {
  if (!isEndless() || scene !== 'play') return;
  outlined(`TOUR ${ENDLESS.tour} · VAGUE ${ENDLESS.wave + 1}`, W / 2, 104, 16, '#9fe8ff');
}
