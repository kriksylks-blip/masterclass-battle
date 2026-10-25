// ---------- Écran tactile (téléphone, tablette) ----------
// En combat, le tactile ne sert à rien (on joue à la manette) : il fait seulement passer en plein écran sur Android.
// Dans les menus, on touche un élément pour le choisir (ou le valider s'il l'est déjà) et on glisse le doigt pour se
// déplacer (une case tous les ~60 px) ; un bouton « ◀ » en haut à gauche revient en arrière.
(() => {
  // Seulement les vrais téléphones et tablettes (écran tactile et pas de souris). ?touch=1 / ?touch=0 pour forcer.
  const q = location.search, TOUCH = /[?&]touch=1/.test(q) || (!/[?&]touch=0/.test(q) && matchMedia('(hover: none) and (pointer: coarse)').matches);
  if (!TOUCH) return;

  const css = document.createElement('style');
  css.textContent = `
    #tcBack { position: fixed; left: 8px; top: 8px; z-index: 6; width: 52px; height: 40px; border-radius: 12px; display: none;
      align-items: center; justify-content: center; font: 900 22px Impact, sans-serif; color: #fff; text-shadow: 0 1px 2px #000;
      background: rgba(10,0,25,.75); border: 2px solid rgba(255,225,77,.8); touch-action: none; user-select: none; -webkit-user-select: none; }
    #tcBack.on { background: rgba(255,225,77,.5); }
    #turn { position: fixed; inset: 0; z-index: 9; display: none; background: #05030c; color: #fff; font: 700 20px sans-serif;
      align-items: center; justify-content: center; text-align: center; flex-direction: column; gap: 14px; }
    #turn b { font: 900 italic 30px Impact, sans-serif; color: #ffe14d; }
    @media (orientation: portrait) { #turn { display: flex; } }
  `;
  document.head.appendChild(css);
  const turn = document.createElement('div'); turn.id = 'turn';
  turn.innerHTML = '<b>⟳</b>Tourne ton téléphone<br>à l\'horizontale';
  document.body.appendChild(turn);

  // Plein écran à chaque contact tant qu'on n'y est pas (le navigateur l'exige pendant un geste).
  // iPhone / iPad dans Safari : pas de plein écran possible pour une page ; on explique comment l'avoir
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
  if (iOS && !standalone) {
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:9;background:rgba(10,0,25,.9);color:#ffe14d;' +
      'font:bold 13px sans-serif;padding:8px 14px;border-radius:10px;border:1px solid #ffe14d;text-align:center;pointer-events:auto';
    tip.innerHTML = "Plein écran sur iPhone : bouton Partager <b>⎙</b> → « Sur l'écran d'accueil », puis lance le jeu depuis l'icône. (toucher pour fermer)";
    tip.addEventListener('pointerup', () => tip.remove());
    document.body.appendChild(tip); setTimeout(() => tip.remove(), 12000);
  }
  const goFull = e => {
    if (e?.target?.closest?.('#tcCode')) return; // pas pendant la saisie du code (le clavier se fermerait)
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    } catch (_) {}
  };
  addEventListener('pointerup', goFull, true);
  addEventListener('touchend', goFull, true);

  // ---- Menus au doigt ----
  const inMenu = () => typeof scene !== 'undefined' && (scene !== 'play' || paused) && scene !== 'loading';
  const press = a => { INPUT[0].pressed.add(a); audio.unlock(); };
  const arrow = d => {
    if (paused) { menuMove(d === 'up' ? -1 : d === 'down' ? 1 : 0, d === 'left' ? -1 : d === 'right' ? 1 : 0); return; }
    press(d);
  };
  const canvas = document.getElementById('game');
  const toGame = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  const inBox = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  const tick = () => audio.tone(1250, 0.025, 'sine', 0.03);

  // Toucher : on choisit l'élément touché ; s'il était déjà choisi, on le valide
  function tap(x, y) {
    if (paused) { const b = menu.hits.find(b => inBox(x, y, b)); if (b) b.tap(); return; }
    if (scene === 'title') {
      const k = TITLE_ITEMS.findIndex((_, k) => x < 400 && y > 286 + k * 44 - 30 && y < 286 + k * 44 + 12);
      if (k < 0) return;
      if (titleMenu.row === k) press('punch'); else { titleMenu.row = k; tick(); }
      return;
    }
    if (scene === 'options') {
      const k = OPT_ROWS.findIndex((_, k) => y > 130 + k * 52 - 30 && y < 130 + k * 52 + 20);
      if (k < 0) return;
      if (optMenu.row !== k) { optMenu.row = k; tick(); return; }
      // ligne réglable : à gauche de la valeur on baisse, à droite on monte
      if (['diff', 'lives', 'tag', 'music'].includes(OPT_ROWS[k])) press(x < W - 260 ? 'left' : 'right'); else press('punch');
      return;
    }
    if (scene === 'select') {
      if (sel.outfit[0]) { press(x < 226 ? 'left' : x < 452 ? 'right' : 'punch'); return; }
      const ps = [0, 1, 2, 3].filter(p => sel.joined[p]), G = selGrid(ps.length);
      const c = Math.floor((x - G.gx) / G.cell), r = Math.floor((y - G.gy) / G.cell), k = r * G.cols + c;
      if (c < 0 || c >= G.cols || r < 0 || k >= CHAR_IDS.length) return;
      if (sel.ready[0]) return;
      if (sel.pick[0] === k) press('punch');
      else { sel.pick[0] = k; sel.vari[0] = 0; sel.focus = 0; sel.flash = 1; sel.pf[0] = 1; tick(); }
      return;
    }
    if (scene === 'levels') { if (Math.abs(x - W / 2) < 260) press('punch'); else press(x < W / 2 ? 'left' : 'right'); return; }
    press('punch'); // carte, histoire, en ligne, fin de niveau : toucher = continuer
  }

  // Glisser : une direction par tranche de ~60 px, dans l'axe dominant
  let tid = null, sx = 0, sy = 0, lx = 0, ly = 0, moved = false;
  canvas.addEventListener('pointerdown', e => {
    if (!inMenu()) return;
    e.preventDefault(); tid = e.pointerId; [sx, sy] = toGame(e); lx = sx; ly = sy; moved = false;
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== tid || !inMenu()) return;
    const [x, y] = toGame(e), dx = x - lx, dy = y - ly, STEP = 60;
    if (Math.abs(x - sx) > 14 || Math.abs(y - sy) > 14) moved = true;
    if (Math.abs(dx) >= STEP && Math.abs(dx) > Math.abs(dy)) { arrow(dx > 0 ? 'right' : 'left'); lx = x; ly = y; }
    else if (Math.abs(dy) >= STEP) { arrow(dy > 0 ? 'down' : 'up'); lx = x; ly = y; }
  });
  canvas.addEventListener('pointerup', e => {
    if (e.pointerId !== tid) return;
    tid = null;
    if (!moved && inMenu()) { const [x, y] = toGame(e); tap(x, y); }
  });
  canvas.addEventListener('pointercancel', () => { tid = null; });

  // Bouton retour des menus
  const back = document.createElement('div'); back.id = 'tcBack'; back.textContent = '◀';
  document.body.appendChild(back);
  back.addEventListener('pointerdown', e => { e.preventDefault(); back.classList.add('on'); });
  back.addEventListener('pointerup', e => {
    e.preventDefault(); back.classList.remove('on');
    if (paused) menuBack(); else press('kick');
  });

  // Saisie du code d'une partie en ligne (clavier du téléphone)
  const box = document.createElement('div');
  box.id = 'tcCode';
  box.innerHTML = `<div class="t">CODE DE LA PARTIE</div><input maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false">
    <div class="r"><button data-k="ok">REJOINDRE</button><button data-k="no">ANNULER</button></div>`;
  css.textContent += `
    #tcCode { position: fixed; inset: 0; z-index: 8; touch-action: manipulation; pointer-events: auto; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 14px;
      background: rgba(5,3,12,.85); font: 900 italic 22px Impact, sans-serif; color: #ffe14d; }
    #tcCode input { touch-action: manipulation; -webkit-user-select: text; user-select: text; width: 220px; font: 900 44px Impact, sans-serif; text-align: center; letter-spacing: 12px; text-transform: uppercase;
      background: #120a24; color: #7ff0ff; border: 3px solid #7ff0ff; border-radius: 12px; padding: 8px; }
    #tcCode button { font: 900 italic 18px Impact, sans-serif; padding: 12px 22px; margin: 0 8px; border-radius: 10px; border: 0;
      background: #ff2d55; color: #fff; }
    #tcCode button[data-k=no] { background: #444; }`;
  document.body.appendChild(box);
  const inp = box.querySelector('input');
  const closeBox = () => { box.style.display = 'none'; inp.blur(); };
  inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') ok(); });
  const ok = () => { if (inp.value.length !== 4) { inp.focus(); return; } const c = inp.value; closeBox(); net.typing = false; netJoin(c); };
  const no = () => { closeBox(); net.typing = false; };
  for (const [k, f] of [['ok', ok], ['no', no]]) {
    const b = box.querySelector(`[data-k=${k}]`);
    b.addEventListener('pointerup', e => { e.preventDefault(); e.stopPropagation(); f(); });
    b.addEventListener('click', e => e.preventDefault());
  }
  inp.addEventListener('pointerup', e => { e.stopPropagation(); inp.focus(); });

  const loop = () => {
    if (typeof net !== 'undefined' && scene === 'online' && net.typing && box.style.display !== 'flex') {
      box.style.display = 'flex'; inp.value = ''; setTimeout(() => inp.focus(), 50);
    }
    // le bouton retour n'apparaît que dans les menus où il sert
    back.style.display = typeof scene !== 'undefined' && inMenu() && scene !== 'title' ? 'flex' : 'none';
    requestAnimationFrame(loop);
  };
  loop();
})();
