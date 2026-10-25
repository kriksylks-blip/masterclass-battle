// Images du décor et de l'interface. Une image manquante est remplacée par un dessin en code.
const ASSETS = {
  backgrounds: {
    sky: 'assets/backgrounds/sky.png',
    far: 'assets/backgrounds/far.png',
    mid: 'assets/backgrounds/mid.png',
    street: 'assets/backgrounds/street.jpg',
    // Zones du niveau 1 (voir src/level.js)
    neon_mid: 'assets/backgrounds/neon_mid.png', neon_ground: 'assets/backgrounds/neon_ground.jpg',
    bridge_mid: 'assets/backgrounds/bridge_mid.png', bridge_ground: 'assets/backgrounds/bridge_ground.jpg',
    dock_mid: 'assets/backgrounds/dock_mid.png', dock_ground: 'assets/backgrounds/dock_ground.jpg',
    shrine_mid: 'assets/backgrounds/shrine_mid.png', shrine_ground: 'assets/backgrounds/shrine_ground.jpg',
    // 2es versions des plans moyens (en alternance avec les premières)
    street_mid2: 'assets/backgrounds/street_mid2.png', neon_mid2: 'assets/backgrounds/neon_mid2.png', bridge_mid2: 'assets/backgrounds/bridge_mid2.png',
    dock_mid2: 'assets/backgrounds/dock_mid2.png', shrine_mid2: 'assets/backgrounds/shrine_mid2.png',
  },
  ui: {
    title: 'assets/ui/title.png',
    logo: 'assets/ui/logo.png',
    // Objets cassables
    prop_crate: 'assets/fx/prop_crate.png', prop_crate_broken: 'assets/fx/prop_crate_broken.png',
    prop_can: 'assets/fx/prop_can.png', prop_can_broken: 'assets/fx/prop_can_broken.png',
    prop_barrel: 'assets/fx/prop_barrel.png', prop_barrel_broken: 'assets/fx/prop_barrel_broken.png',
    // Trous du décor : crevasse vue en plongée (drawPits)
    fx_pit: 'assets/fx/pit.png',
    // Edward : pics de pierre (spécial) et bras-poing de pierre (ultime)
    fx_ed_spike: 'assets/fx/ed_spike.png', fx_ed_fist: 'assets/fx/ed_fist.png',
    fx_katon: 'assets/fx/katon.png', fx_susanoo: 'assets/fx/susanoo.jpg',
    fx_rsh: 'assets/fx/rsh.png', fx_rsh_boom: 'assets/fx/rsh_boom.png', fx_amaterasu: 'assets/fx/amaterasu.png',
    fx_titan_rise: 'assets/fx/titan_rise.png', fx_titan_punch: 'assets/fx/titan_punch.png', fx_shoto_ice: 'assets/fx/shoto_ice.png', fx_shoto_fire: 'assets/fx/shoto_fire.png',
    // Effets en images Flow (tools/fx5_prompts.js, tools/process_fx_images.py) : voir gfx() dans game.js
    fx_sanji_spin: 'assets/fx/sanji_spin.png', fx_hell_pillar: 'assets/fx/hell_pillar.png', fx_blade_spin: 'assets/fx/blade_spin.png', fx_big_slash: 'assets/fx/big_slash.png',
    fx_fang_x: 'assets/fx/fang_x.png', fx_palm_wave: 'assets/fx/palm_wave.png', fx_whip_arc: 'assets/fx/whip_arc.png', fx_muzzle: 'assets/fx/muzzle.png', fx_amb_vortex: 'assets/fx/vortex.png', fx_cannon_boom: 'assets/fx/cannon_boom.png',
    // Cartes de présentation des ennemis
    intro_thug: 'assets/ui/intro/thug.jpg', intro_brute: 'assets/ui/intro/brute.jpg', intro_ninja: 'assets/ui/intro/ninja.jpg',
    intro_biker: 'assets/ui/intro/biker.jpg', intro_samurai: 'assets/ui/intro/samurai.jpg', intro_boss: 'assets/ui/intro/boss.jpg',
  },
};
// Les portraits des cartes (assets/ui/card_*.png) sont chargés d'après les fiches des personnages (game.js).
// Les effets spéciaux en images sont dans src/fx.js (généré par tools/slice_fx.py).

// Les animations des personnages sont dans src/sprites.js (généré par tools/slice_sheets.py).

// Plans du décor : vitesse de défilement par rapport à la caméra, position et hauteur d'affichage.
// Les images débordent volontairement sous l'écran pour le sol.
const LAYERS = {
  sky:    { factor: 0.05, y: 0,    h: 540 },
  far:    { factor: 0.2,  y: -120, h: 420 },
  mid:    { factor: 0.55, y: -40,  h: 384 },
  street: { factor: 1,    y: 330,  h: 240, w: 1150, mirror: true },
};

const STAGE = { killsToClear: 25 }; // sert au réglage de la difficulté des ennemis

// Musique de fond (jouée en boucle pendant les combats). Fichier absent : pas de musique.
const MUSIC = { battle: 'assets/music/battle.mp3', volume: 0.35, levels: {} };
// Une musique par niveau (fichier absent : on garde la musique de combat commune)
for (const id of ['tokyo', 'op', 'ds', 'bl', 'hx', 'nr', 'db', 'mh', 'rk', 'op2', 'nr2', 'ds2', 'db2', 'jk', 'sl', 'opm', 'bl2']) MUSIC.levels[id] = `assets/music/${id}.mp3`;
// cinq mondes du 24/10 : morceaux déjà présents qui collent à l'ambiance
Object.assign(MUSIC.levels, { aot: 'assets/music/nr2.mp3', bk: 'assets/music/bl2.mp3', fz: 'assets/music/jk.mp3', fm: 'assets/music/mh.mp3', rp: 'assets/music/tokyo.mp3', bu: 'assets/music/db2.mp3' });
