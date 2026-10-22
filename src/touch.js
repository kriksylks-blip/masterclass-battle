// ---------- Version mobile : joystick et boutons tactiles (joueur 1) ----------
// Affichée seulement sur un écran tactile. Chaque bouton envoie au jeu les mêmes touches que le clavier du
// joueur 1 : le combat, les menus, la sélection et la pause marchent donc sans rien changer ailleurs.
// Commandes simplifiées : joystick (8 directions), Poing / Pied / Saut / Spécial, Dash, Ki (maintenir = charger,
// toucher quand la barre est assez pleine = se transformer), Ultime, Pause, Relais. Pas d'accroupi.
(() => {
  // Seulement les vrais téléphones et tablettes (écran tactile et pas de souris) : un ordinateur, même avec un écran
  // tactile, garde le clavier, sans boutons ni plein écran forcé. ?touch=1 / ?touch=0 pour forcer.
  const q = location.search, TOUCH = /[?&]touch=1/.test(q) || (!/[?&]touch=0/.test(q) && matchMedia('(hover: none) and (pointer: coarse)').matches);
  if (!TOUCH) return;

  const codeOf = a => binds[0].keys[a]?.[0];
  const send = (a, down) => {
    const code = a === 'pause' ? 'Escape' : codeOf(a);
    if (code) dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  };

  const css = document.createElement('style');
  css.textContent = `
    #tc { position: fixed; inset: 0; z-index: 5; touch-action: none; user-select: none; -webkit-user-select: none; pointer-events: none; }
    #tc .zone { position: absolute; left: 0; top: 0; bottom: 0; width: 45%; pointer-events: auto; }
    #tc .btn { position: absolute; border-radius: 50%; display: flex; align-items: center; justify-content: center; pointer-events: auto;
      font: 900 italic 13px Impact, sans-serif; color: #fff; text-shadow: 0 1px 2px #000; letter-spacing: .5px;
      background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.35), rgba(255,255,255,.08) 60%, rgba(0,0,0,.25));
      border: 2px solid rgba(255,255,255,.55); box-shadow: 0 2px 8px rgba(0,0,0,.5); }
    #tc .btn.on { transform: scale(.9); background: rgba(255,225,77,.55); }
    #tc .big { width: 68px; height: 68px; font-size: 15px; }
    #tc .small { width: 50px; height: 50px; font-size: 11px; }
    #tc .top { width: 44px; height: 30px; border-radius: 10px; font-size: 11px; }
    #tc .ready { border-color: #ffe14d; box-shadow: 0 0 14px #ffe14d; animation: tcp .6s infinite alternate; }
    @keyframes tcp { to { box-shadow: 0 0 26px #ffe14d; } }
    #tc .stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.4); background: rgba(255,255,255,.08); display: none; }
    #tc .knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
      background: rgba(255,255,255,.45); border: 2px solid #fff; }
    #tc .hint { position: absolute; left: 6%; bottom: 14%; color: rgba(255,255,255,.35); font: 700 12px sans-serif; }
    #turn { position: fixed; inset: 0; z-index: 9; display: none; background: #05030c; color: #fff; font: 700 20px sans-serif;
      align-items: center; justify-content: center; text-align: center; flex-direction: column; gap: 14px; }
    #turn b { font: 900 italic 30px Impact, sans-serif; color: #ffe14d; }
    @media (orientation: portrait) { #turn { display: flex; } }
  `;
  document.head.appendChild(css);

  const root = document.createElement('div'); root.id = 'tc';
  root.innerHTML = `
    <div class="zone"><div class="hint">joystick : pose ton pouce ici</div><div class="stick"><div class="knob"></div></div></div>
    <div class="btn big" data-a="jump"   style="right:92px; bottom:14px">SAUT</div>
    <div class="btn big" data-a="kick"   style="right:18px; bottom:88px">PIED</div>
    <div class="btn big" data-a="punch"  style="right:166px;bottom:88px">POING</div>
    <div class="btn big" data-a="blast"  style="right:92px; bottom:162px">SPÉCIAL</div>
    <div class="btn small" data-a="dash"  style="right:200px;bottom:178px">DASH</div>
    <div class="btn small" data-a="ki"    style="right:22px; bottom:186px" id="tcKi">KI</div>
    <div class="btn small" data-a="ultra" style="right:30px; bottom:248px" id="tcUlt">ULTIME</div>
    <div class="btn top" data-a="pause" style="left:50%; top:6px; margin-left:-50px">❚❚</div>
    <div class="btn top" data-a="tag"   style="left:50%; top:6px; margin-left:6px" id="tcTag">RELAIS</div>`;
  document.body.appendChild(root);
  const turn = document.createElement('div'); turn.id = 'turn';
  turn.innerHTML = '<b>⟳</b>Tourne ton téléphone<br>à l\'horizontale';
  document.body.appendChild(turn);

  // Plein écran et paysage au premier contact (refusé sur certains téléphones : on garde le message « Tourne »)
  // Plein écran à chaque contact tant qu'on n'y est pas (le navigateur l'exige pendant un geste, et on peut en sortir
  // d'un balayage). iPhone : Safari ne le permet pas ; « Ajouter à l'écran d'accueil » lance le jeu en plein écran.
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

  // Boutons : appui = touche enfoncée, relâché = touche relâchée (plusieurs doigts à la fois)
  for (const b of root.querySelectorAll('.btn')) {
    const a = b.dataset.a;
    let t0 = 0;
    const down = e => {
      e.preventDefault(); goFull(); b.setPointerCapture?.(e.pointerId); b.classList.add('on'); t0 = performance.now();
      if (a === 'ki') send('charge', true); else send(a, true);
    };
    const up = e => {
      if (!b.classList.contains('on')) return;
      e.preventDefault(); b.classList.remove('on');
      if (a === 'ki') {
        send('charge', false);
        // touche brève avec assez de ki : transformation (ou retour à la forme normale)
        const h = typeof players !== 'undefined' && players?.[0];
        if (performance.now() - t0 < 260 && h && (h.boost || h.ki >= KI.transform)) { send('transform', true); send('transform', false); }
      } else send(a, false);
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  // Joystick flottant : il apparaît là où le pouce se pose, dans la moitié gauche
  const zone = root.querySelector('.zone'), stick = root.querySelector('.stick'), knob = root.querySelector('.knob'), hint = root.querySelector('.hint');
  const R = 50, held = new Set();
  let sid = null, ox = 0, oy = 0;
  const setDirs = dirs => {
    for (const d of ['left', 'right', 'up', 'down']) {
      if (dirs.has(d) && !held.has(d)) { held.add(d); send(d, true); }
      if (!dirs.has(d) && held.has(d)) { held.delete(d); send(d, false); }
    }
  };
  zone.addEventListener('pointerdown', e => {
    e.preventDefault(); goFull();
    // un nouveau contact reprend toujours le joystick (un relâché perdu ne doit pas le bloquer)
    setDirs(new Set());
    sid = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch (_) {}
    ox = e.clientX; oy = e.clientY;
    stick.style.display = 'block'; stick.style.left = ox + 'px'; stick.style.top = oy + 'px'; hint.style.display = 'none';
    knob.style.transform = '';
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== sid) return;
    e.preventDefault();
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const dirs = new Set();
    if (d > 14) {
      if (dx < -R * 0.38) dirs.add('left'); if (dx > R * 0.38) dirs.add('right');
      if (dy < -R * 0.45) dirs.add('up'); if (dy > R * 0.45) dirs.add('down');
    }
    setDirs(dirs);
  });
  const release = e => {
    if (e.pointerId !== sid) return;
    sid = null; stick.style.display = 'none'; setDirs(new Set());
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
  zone.addEventListener('lostpointercapture', release);

  // État des boutons : Ultime qui brille quand il est prêt, Ki qui annonce la transformation, Relais si actif
  const ki = document.getElementById('tcKi'), ult = document.getElementById('tcUlt'), tag = document.getElementById('tcTag');
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

  const tick = () => {
    if (typeof net !== 'undefined' && scene === 'online' && net.typing && box.style.display !== 'flex') {
      box.style.display = 'flex'; inp.value = ''; setTimeout(() => inp.focus(), 50);
    }
    const h = typeof players !== 'undefined' && scene === 'play' ? players?.[0] : null;
    ult.classList.toggle('ready', !!h && h.ki >= KI.ultra);
    const canForm = !!h && !h.boost && h.ki >= KI.transform;
    ki.classList.toggle('ready', canForm);
    ki.textContent = h?.boost ? 'KI ▼' : canForm ? 'TRANSFO' : 'KI';
    tag.style.display = h?.reserve ? 'flex' : 'none';
    requestAnimationFrame(tick);
  };
  tick();
})();
