'use strict';
// Coopération en ligne (jusqu'à 4 joueurs) : l'hôte fait tourner le jeu et diffuse l'image et le son de sa
// partie (WebRTC, via PeerJS) ; chaque invité voit cette vidéo et envoie ses touches, qui pilotent un
// joueur de l'hôte (J2, J3 ou J4). Rejoindre = taper le code à 4 lettres affiché chez l'hôte.

const NET_PREFIX = 'mcbattle-v1-';
const net = { role: null, peer: null, code: '', status: '', guests: {}, conn: null, slot: -1, typed: '', row: 0, video: null, err: '' };

function openOnline() { scene = 'online'; sceneT = 0; net.row = 0; net.typed = ''; if (!net.role) net.status = ''; }
const ONLINE_ROWS = ['host', 'join', 'back'];

function updateOnline() {
  if (net.role === 'guest') return;
  const hit = a => anyPressed(a);
  if (net.role === 'host') {
    if (sceneT > 0.3 && ['start', 'punch', 'jump'].some(hit)) { gameMode = 'arcade'; openSelect(); }
    if (hit('kick')) netClose();
    return;
  }
  if (net.typing) return; // saisie du code au clavier (voir keydown plus bas)
  if (hit('up')) net.row = (net.row + 2) % 3;
  if (hit('down')) net.row = (net.row + 1) % 3;
  if (sceneT > 0.3 && ['start', 'punch', 'jump'].some(hit)) {
    const id = ONLINE_ROWS[net.row];
    if (id === 'host') netHost();
    if (id === 'join') { net.typing = true; net.typed = ''; net.err = ''; }
    if (id === 'back') { scene = 'title'; sceneT = 0; }
  }
  if (hit('kick')) { scene = 'title'; sceneT = 0; }
}

function drawOnline() {
  camX = sceneT * 40; drawBackground();
  ctx.fillStyle = 'rgba(8,2,24,0.84)'; ctx.fillRect(0, 0, W, H);
  outlined('EN LIGNE', W / 2, 66, 44, '#ffe14d');
  if (typeof Peer === 'undefined') outlined('Bibliothèque réseau non chargée (connexion Internet nécessaire)', W / 2, 110, 16, '#ff6070');
  if (net.role === 'host') {
    outlined('CODE DE LA PARTIE', W / 2, 150, 22, '#cfd3ff');
    outlined(net.code || '…', W / 2, 230, 84, '#7ff0ff');
    outlined(net.status, W / 2, 280, 18, '#fff');
    const names = [1, 2, 3].map(s => net.guests[s] ? `J${s + 1} : en ligne ✔` : `J${s + 1} : libre`);
    names.forEach((t, k) => outlined(t, W / 2, 330 + k * 30, 18, net.guests[k + 1] ? COLORS_P[k + 1] : '#8a80a8'));
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd6e8';
    ctx.fillText('Donne ce code à tes amis : menu EN LIGNE → REJOINDRE. Ils peuvent arriver aussi sur l\'écran de sélection.', W / 2, 425);
    ctx.fillStyle = '#7ff0ff'; ctx.fillText(`ou envoie ce lien : ${location.origin + location.pathname}?join=${net.code}`, W / 2, 450);
    ctx.fillText(`${K('punch')} / Entrée : aller au choix des combattants     ${K('kick')} : fermer la partie`, W / 2, 476);
    return;
  }
  if (net.role === 'guest') {
    outlined(net.status, W / 2, H / 2, 24, '#fff');
    if (net.err) outlined(net.err, W / 2, H / 2 + 40, 18, '#ff6070');
    outlined('Échap : quitter', W / 2, H - 30, 14, '#cfd3ff');
    return;
  }
  const labels = ['CRÉER UNE PARTIE', net.typing ? `CODE : ${net.typed.padEnd(4, '_')}` : 'REJOINDRE UNE PARTIE', 'RETOUR'];
  labels.forEach((t, k) => {
    const on = k === net.row, y = 180 + k * 70;
    if (on) { ctx.fillStyle = 'rgba(255,225,77,0.14)'; ctx.fillRect(W / 2 - 260, y - 36, 520, 54); }
    outlined(t, W / 2, y, on ? 32 : 26, on ? '#ffe14d' : '#fff');
  });
  if (net.err) outlined(net.err, W / 2, 400, 18, '#ff6070');
  ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd6e8';
  ctx.fillText(net.typing ? 'Tape les 4 lettres du code puis Entrée (Échap pour annuler)' : 'L\'hôte joue sur sa machine ; les invités voient sa partie et jouent J2, J3 ou J4.', W / 2, 450);
}

// ---------- Hôte ----------
function netHost() {
  if (typeof Peer === 'undefined') { net.err = 'PeerJS introuvable : vérifie la connexion Internet'; return; }
  audio.unlock();
  net.role = 'host'; net.code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  net.status = 'Ouverture de la partie…';
  net.peer = new Peer(NET_PREFIX + net.code);
  net.peer.on('open', () => { net.status = 'En attente de joueurs…'; });
  net.peer.on('error', e => { net.status = 'Erreur réseau : ' + (e.type || e.message); if (e.type === 'unavailable-id') { netClose(); netHost(); } });
  net.peer.on('connection', conn => conn.on('open', () => netAccept(conn)));
}
function netStream() {
  if (net.stream) return net.stream;
  const s = canvas.captureStream(30);
  if (audio.ctx) {
    net.dest = audio.ctx.createMediaStreamDestination();
    audio.out.connect(net.dest);
    for (const t of net.dest.stream.getAudioTracks()) s.addTrack(t);
  }
  return (net.stream = s);
}
function netAccept(conn) {
  const slot = [1, 2, 3].find(s => !net.guests[s] && !(scene === 'select' && sel.joined[s]));
  if (!slot) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
  net.guests[slot] = conn; conn.slot = slot;
  conn.send({ t: 'hello', slot });
  net.peer.call(conn.peer, netStream());
  net.status = `J${slot + 1} a rejoint la partie !`;
  audio.tone(880, 0.2, 'triangle', 0.12, 300);
  if (scene === 'select') netJoinSlot(slot);
  conn.on('data', m => netInput(conn.slot, m));
  conn.on('close', () => netLeave(conn.slot));
}
// Place les invités connectés sur l'écran de sélection (appelé aussi à chaque ouverture de cet écran)
function netRejoin() { for (const s of Object.keys(net.guests)) netJoinSlot(+s); }
function netJoinSlot(s) {
  sel.joined[s] = true; sel.ready[s] = false; sel.dev[s] = 'net'; sel.first[s] = null;
  sel.pick[s] = s % CHAR_IDS.length;
}
function netLeave(slot) {
  delete net.guests[slot];
  const I = INPUT[slot]; I.keys.clear(); I.pressed.clear();
  if (scene === 'select') sel.joined[slot] = false;
  net.status = `J${slot + 1} est parti.`;
}
function netInput(slot, m) {
  if (m.t !== 'k') return;
  const I = INPUT[slot], a = m.a;
  if (a === 'pause' || a === 'mute') return;
  if (m.d) {
    if (!I.keys.has(a)) {
      I.pressed.add(a);
      if (a === 'left' || a === 'right') {
        if (I.lastTap.a === a && performance.now() - I.lastTap.t < 250) I.pressed.add('dash');
        I.lastTap = { a, t: performance.now() };
      }
    }
    I.keys.add(a);
  } else I.keys.delete(a);
}
function netClose() {
  for (const c of Object.values(net.guests)) try { c.close(); } catch (e) { }
  try { net.peer?.destroy(); } catch (e) { }
  Object.assign(net, { role: null, peer: null, guests: {}, conn: null, stream: null, code: '', status: '' });
}

// ---------- Invité ----------
function netJoin(code) {
  if (typeof Peer === 'undefined') { net.err = 'PeerJS introuvable : vérifie la connexion Internet'; return; }
  audio.unlock();
  net.role = 'guest'; net.status = `Connexion à la partie ${code}…`; net.err = '';
  net.peer = new Peer();
  net.peer.on('error', e => { net.err = e.type === 'peer-unavailable' ? 'Aucune partie avec ce code.' : 'Erreur réseau : ' + (e.type || e.message); setTimeout(() => { if (net.role === 'guest' && !net.video) { netClose(); openOnline(); net.err = 'Aucune partie avec ce code.'; } }, 2500); });
  net.peer.on('open', () => {
    const conn = net.conn = net.peer.connect(NET_PREFIX + code, { reliable: true });
    conn.on('data', m => {
      if (m.t === 'hello') { net.slot = m.slot; net.status = `Connecté : tu es le joueur ${m.slot + 1}. Attente de l'image…`; }
      if (m.t === 'full') net.err = 'La partie est complète (4 joueurs).';
    });
    conn.on('close', () => { netShowVideo(null); netClose(); openOnline(); net.err = 'La partie a été fermée par l\'hôte.'; });
  });
  net.peer.on('call', call => { call.answer(); call.on('stream', s => netShowVideo(s)); });
}
function netShowVideo(stream) {
  if (!stream) { net.video?.remove(); net.video = null; canvas.style.visibility = ''; return; }
  const v = net.video || document.createElement('video');
  v.autoplay = true; v.playsInline = true; v.srcObject = stream;
  v.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000;z-index:5';
  if (!net.video) document.body.appendChild(v);
  net.video = v; v.play().catch(() => {});
  canvas.style.visibility = 'hidden';
}
// Touches de l'invité : ses commandes de joueur 1, envoyées à l'hôte
const netHeld = new Set();
function netSend(a, d) {
  if (!net.conn?.open) return;
  if (d ? netHeld.has(a) : !netHeld.has(a)) return;
  d ? netHeld.add(a) : netHeld.delete(a);
  net.conn.send({ t: 'k', a, d: d ? 1 : 0 });
}
const netActionsOf = code => { const out = Object.entries(binds[0].keys).filter(([, c]) => c.includes(code)).map(([a]) => a); if (code === 'Enter') out.push('start'); return out; };
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return; // la case de saisie (téléphone) gère elle-même ses touches
  if (scene === 'online' && net.typing) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code === 'Escape') net.typing = false;
    else if (e.code === 'Backspace') net.typed = net.typed.slice(0, -1);
    else if (e.code === 'Enter' && net.typed.length === 4) { net.typing = false; netJoin(net.typed); }
    else if (/^[a-z]$/i.test(e.key) && net.typed.length < 4) net.typed += e.key.toUpperCase();
    return;
  }
  if (net.role !== 'guest') return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.code === 'Escape' && !net.video) { netClose(); openOnline(); return; }
  if (e.code === 'F10') { netShowVideo(null); netClose(); openOnline(); return; }
  for (const a of netActionsOf(e.code)) netSend(a, true);
}, true);
addEventListener('keyup', e => {
  if (e.target instanceof HTMLInputElement) return;
  if (net.role !== 'guest') return;
  e.stopImmediatePropagation();
  for (const a of netActionsOf(e.code)) netSend(a, false);
}, true);
// Manette de l'invité
const netPadOn = new Set();
(function netPadLoop() {
  if (net.role === 'guest' && net.conn?.open) {
    const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
    if (gp) {
      const btn = gp.buttons.map(b => b.pressed || b.value > 0.5), on = new Set();
      for (const [a, list] of Object.entries(binds[0].pad)) if (list.some(i => btn[i])) on.add(a);
      if (btn[9]) on.add('start');
      const [ax, ay] = padAxes(gp);
      if (ax < -0.4) on.add('left'); if (ax > 0.4) on.add('right'); if (ay > 0.5) on.add('down'); if (ay < -0.5) on.add('up');
      for (const a of new Set([...on, ...netPadOn])) {
        if (on.has(a) && !netPadOn.has(a)) { netPadOn.add(a); netSend(a, true); }
        else if (!on.has(a) && netPadOn.has(a)) { netPadOn.delete(a); netSend(a, false); }
      }
    }
  }
  requestAnimationFrame(netPadLoop);
})();

// Lien d'invitation : index.html?join=ABCD rejoint directement la partie (pratique depuis un téléphone)
(() => {
  const code = (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) return;
  const wait = setInterval(() => { if (scene === 'title') { clearInterval(wait); openOnline(); netJoin(code); } }, 200);
})();
