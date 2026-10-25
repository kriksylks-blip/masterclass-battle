// ---------- Décor vivant : petites animations discrètes ----------
// Animaux posés au fond de la rue qui s'enfuient quand un joueur approche (chat, rat, chien, pigeons, corbeaux),
// chauves-souris qui traversent parfois les lieux sombres, drapeaux qui ondulent, et lueurs animées posées sur les
// décors (vortex qui tourne, cristaux qui scintillent, flammes bleues qui vacillent). Images : src/ambient.js
// (tools/slice_ambient.py) et assets/fx/amb_vortex.png. Pas partout ni tout le temps : quelques-uns par zone.

// animaux possibles par monde (les intérieurs n'ont que des rats) ; chauves-souris : zones sombres
const AMB_WORLD = {
  tokyo: ['cat', 'rat', 'pigeon'], op: ['pigeon', 'cat', 'dog'], ds: ['crow', 'dog'], bl: ['crow', 'cat'], hx: ['pigeon', 'cat'],
  nr: ['crow', 'cat', 'dog'], db: ['crow'], mh: ['pigeon', 'rat', 'cat'], rk: ['cat', 'dog', 'crow'], op2: ['pigeon', 'rat'],
  nr2: ['rat', 'crow'], ds2: ['cat', 'crow'], db2: ['crow'], jk: ['crow', 'rat', 'pigeon'], sl: ['pigeon', 'rat'], opm: ['pigeon', 'rat', 'cat'],
  bl2: ['crow'], aot: ['crow', 'dog'], bk: ['crow', 'rat'], fz: ['cat', 'pigeon'], fm: ['pigeon', 'cat', 'dog'], rp: ['rat', 'cat', 'pigeon'],
  bu: ['pigeon', 'crow'],
};
const AMB_ROOMS = new Set(['ds_z1', 'hx_z2', 'hx_z3', 'jk_z2', 'sl_z2', 'sl_z3', 'opm_z3', 'bl2_z2', 'hx_z4', 'ds2_z4', 'sl_z4', 'bl2_z4', 'jk_z5',
  'bk_z2', 'fz_z3', 'fm_z4', 'fm_z3', 'rp_z2', 'rp_z3', 'bu_z3']);
const AMB_BATS = new Set(['sl_z2', 'sl_z3', 'sl_z4', 'bk_z3', 'bk_z4', 'fz_z3', 'nr_z3', 'ds_z3', 'jk_z3', 'bl2_z3', 'fm_z3', 'rk_z3', 'nr2_z3']);
const AMB_FLAGS = { aot_z1: [400, 1900], bk_z1: [700, 2100], bu_z1: [350, 1500, 2500], op_z2: [900], rk_z1: [1600] };
// hauteur à l'écran (px) de l'animal posé
const AMB_SIZE = { cat: 46, rat: 24, dog: 58, pigeon: 30, crow: 40, bat: 34 };
const AMB_BIRD = new Set(['pigeon', 'crow']);
// lueurs sur les bandes de décor (pixels de la bande, taille = diamètre) : vortex, cristaux, flammes
const AMB_SPOTS = {
  sl_z1_mid: [['vortex', 690, 541, 300]],
  sl_z2_mid: [['crystal', 1054, 197, 150], ['crystal', 235, 281, 150], ['crystal', 1316, 534, 140]],
  sl_z3_mid: [['flame', 1366, 543, 120], ['flame', 701, 533, 90]],
};

// petit hasard reproductible (même zone = mêmes animaux)
const ambRand = s => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function spawnAmbient() {
  level.critters = []; level.batT = 6;
  const world = LVL.id, list = AMB_WORLD[world];
  ZONES.forEach((Z, k) => {
    const len = (ZONES[k + 1]?.from ?? Z.from + 3000) - Z.from;
    for (const fx of AMB_FLAGS[Z.id] || []) level.critters.push({ kind: 'flag', x: Z.from + fx, gz: Z_TOP + 4, t: ambRand(fx) * 3 });
    if (!list) return;
    const pool = AMB_ROOMS.has(Z.id) ? ['rat'] : list, n = ambRand(k * 7 + world.length) < 0.25 ? 1 : 2;
    for (let j = 0; j < n; j++) {
      const r = ambRand(k * 13 + j * 5 + world.charCodeAt(0));
      if (r < 0.15) continue; // pas tout le temps
      const kind = pool[Math.floor(r * 97) % pool.length];
      // jamais trop près d'une porte de zone ni du départ
      const x = Z.from + 450 + (len - 1000) * (j + 0.3 + r * 0.4) / n;
      level.critters.push({ kind, x, gz: Z_TOP + 14 + r * 40, dir: r < 0.5 ? 1 : -1, t: r * 2, flee: false, vx: 0, vy: 0, y: 0 });
    }
  });
}
function updateAmbient(dt) {
  if (!level.critters) spawnAmbient();
  for (const c of level.critters) {
    c.t += dt;
    if (c.kind === 'flag') continue;
    if (!c.flee) {
      // un joueur (ou un ennemi éjecté) approche : il détale, loin de lui
      const near = [...players.filter(h => !h.out), ...enemies.filter(e => e.alive)].find(h => Math.abs(h.x - c.x) < (c.kind === 'rat' ? 200 : 280) && Math.abs(h.gz - c.gz) < 140);
      if (near) {
        c.flee = true; c.t = 0; c.dir = Math.sign(c.x - near.x) || 1;
        if (AMB_BIRD.has(c.kind) || c.kind === 'bat') { c.vx = c.dir * rand(220, 320); c.vy = -rand(260, 340); }
        else c.vx = c.dir * (c.kind === 'rat' ? 430 : c.kind === 'cat' ? 520 : 480);
        if (c.kind !== 'rat' && Math.random() < 0.5) audio.tone(c.kind === 'cat' ? 900 : c.kind === 'dog' ? 320 : 1500, 0.08, 'triangle', 0.035, c.kind === 'cat' ? -300 : 200);
      }
    } else {
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.vy) c.vy = Math.min(c.vy + 60 * dt, -120); // l'oiseau monte en s'éloignant
    }
  }
  // l'animal qui a quitté l'écran disparaît
  level.critters = level.critters.filter(c => c.kind === 'flag' || !c.flee || (c.x > camX - 300 && c.x < camX + W + 300 && c.y > -700));
  // chauves-souris : un petit vol traverse parfois les lieux sombres
  const Z = ZONES[zoneAt(camX + W / 2)];
  if (AMB_BATS.has(Z.id) && (level.batT -= dt) < 0) {
    level.batT = rand(10, 18);
    const dir = Math.random() < 0.5 ? 1 : -1, x0 = dir > 0 ? camX - 120 : camX + W + 120, y0 = rand(70, 190);
    for (let j = 0; j < 3 + Math.floor(Math.random() * 3); j++)
      level.critters.push({ kind: 'bat', x: x0 - dir * j * rand(40, 80), gz: Z_TOP - 300, y: y0 + rand(-40, 40), flee: true, dir, vx: dir * rand(260, 340), vy: 0, t: rand(0, 1), wob: rand(0, 6) });
  }
}
function ambFrame(kind, k) { const L = typeof AMB_FRAMES !== 'undefined' && AMB_FRAMES[kind]; if (!L) return null; const f = L[((k % L.length) + L.length) % L.length]; return IMG['amb_' + f.src] ? f : null; }
function drawCritter(c) {
  const sx = c.x - camX;
  if (sx < -200 || sx > W + 200) return;
  let k, size = AMB_SIZE[c.kind] || 40, y = c.gz;
  if (c.kind === 'flag') {
    const f = ambFrame('flag', Math.floor(c.t * 6)); if (!f) return;
    const img = IMG['amb_' + f.src], h = 190, w = f.w * h / f.h;
    ctx.drawImage(img, sx - w * 0.1, y - h, w, h); return;
  }
  if (c.kind === 'bat') { k = Math.floor(c.t * 12); y = c.y + Math.sin(c.t * 7 + c.wob) * 12; }
  else if (AMB_BIRD.has(c.kind)) {
    // posé : il picore de temps en temps ; envolé : battements d'ailes
    k = c.flee ? (c.t < 0.12 ? 1 : 2 + Math.floor(c.t * 12) % 4) : (Math.sin(c.t * 2.3) > 0.85 ? 1 : 0);
    y = c.gz + c.y;
  } else k = c.flee ? Math.floor(c.t * 14) : 0;
  const f = ambFrame(c.kind, k), f0 = ambFrame(c.kind, 0); if (!f || !f0) return;
  const img = IMG['amb_' + f.src], s = size / f0.h, w = f.w * s, h = f.h * s;
  if (!c.flee && c.kind !== 'bat' && !AMB_BIRD.has(c.kind)) y += Math.sin(c.t * 3) * 0.6; // il respire
  ctx.save();
  if (c.kind !== 'bat') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, c.gz, w * 0.3, 3, 0, 0, 7); ctx.fill(); }
  ctx.translate(sx, y); if ((c.dir || 1) < 0) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}
// lueurs animées posées sur une bande de décor : (x0, y0) position de la bande à l'écran, k son échelle
function drawSpots(key, x0, y0, k) {
  const L = AMB_SPOTS[key]; if (!L) return;
  const t = sceneT;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [type, px, py, d] of L) {
    const x = x0 + px * k, y = y0 + py * k, r = d * k / 2;
    if (x < -r || x > W + r) continue;
    if (type === 'vortex' && IMG.fx_amb_vortex) {
      // le portail tourne lentement et respire ; une 2e couche en sens inverse
      const im = IMG.fx_amb_vortex, p = 1 + Math.sin(t * 2.2) * 0.05;
      ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 0.55;
      ctx.rotate(t * 1.4); ctx.drawImage(im, -r * p, -r * p, 2 * r * p, 2 * r * p);
      ctx.rotate(-t * 2.4); ctx.globalAlpha = 0.25; ctx.drawImage(im, -r * 0.8, -r * 0.8, 1.6 * r, 1.6 * r);
      ctx.restore();
      if (Math.random() < 0.15) particles.push({ x: x + camX + rand(-r, r) * 0.7, y: y + rand(-r, r) * 0.7, vx: rand(-20, 20), vy: rand(-40, -10), t: 0, life: 0.6, c: '#9fe8ff', r: rand(1.5, 3) });
    } else {
      // cristaux : scintillement lent ; flammes : vacillement rapide
      const a = type === 'flame' ? 0.25 + 0.2 * Math.abs(Math.sin(t * 11 + px)) * Math.random() : 0.12 + 0.12 * Math.sin(t * 1.7 + px * 0.01);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.2);
      g.addColorStop(0, `rgba(140,220,255,${a})`); g.addColorStop(1, 'rgba(40,120,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}
