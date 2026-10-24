// Généré par tools/build_voice.py — cris et bruitages des personnages (chargés à part).
const VOICES = {
 "teleport": "assets/sounds/v/teleport.mp3",
 "teleport2": "assets/sounds/v/teleport2.mp3",
 "clone": "assets/sounds/v/clone.mp3",
 "boom": "assets/sounds/v/boom.mp3",
 "brutal": "assets/sounds/v/brutal.mp3",
 "aura": "assets/sounds/v/aura.mp3",
 "goku_special": "assets/sounds/v/goku_special.mp3",
 "vegeta_special": "assets/sounds/v/vegeta_special.mp3",
 "vegeta_ultra": "assets/sounds/v/vegeta_ultra.mp3",
 "luffy_special": "assets/sounds/v/luffy_special.mp3",
 "luffy_ultra": "assets/sounds/v/luffy_ultra.mp3",
 "luffy_transform": "assets/sounds/v/luffy_transform.mp3",
 "naruto_special": "assets/sounds/v/naruto_special.mp3",
 "naruto_ultra": "assets/sounds/v/naruto_ultra.mp3",
 "kenshin_special": "assets/sounds/v/kenshin_special.mp3",
 "kenshin_ultra": "assets/sounds/v/kenshin_ultra.mp3",
 "kakashi_special": "assets/sounds/v/kakashi_special.mp3",
 "kakashi_transform": "assets/sounds/v/kakashi_transform.mp3",
 "ichigo_special": "assets/sounds/v/ichigo_special.mp3",
 "ichigo_transform": "assets/sounds/v/ichigo_transform.mp3",
 "zenitsu_special": "assets/sounds/v/zenitsu_special.mp3",
 "tanjiro_special": "assets/sounds/v/tanjiro_special.mp3",
 "tanjiro_ultra": "assets/sounds/v/tanjiro_ultra.mp3",
 "izuku_ultra": "assets/sounds/v/izuku_ultra.mp3",
 "izuku_transform": "assets/sounds/v/izuku_transform.mp3",
 "jinwoo_ultra": "assets/sounds/v/jinwoo_ultra.mp3",
 "saitama_ultra": "assets/sounds/v/saitama_ultra.mp3",
 "saitama_transform": "assets/sounds/v/saitama_transform.mp3",
 "gojo_special": "assets/sounds/v/gojo_special.mp3",
 "gojo_ultra": "assets/sounds/v/gojo_ultra.mp3",
 "ippo_ultra": "assets/sounds/v/ippo_ultra.mp3",
 "killua_ultra": "assets/sounds/v/killua_ultra.mp3",
 "sasuke_special": "assets/sounds/v/sasuke_special.mp3",
 "sasuke_transform": "assets/sounds/v/sasuke_transform.mp3",
 "gohan_special": "assets/sounds/v/gohan_special.mp3",
 "gohan_transform": "assets/sounds/v/gohan_transform.mp3",
 "ippo_special": "assets/sounds/v/ippo_special.mp3",
 "cri_m": "assets/sounds/v/cri_m.mp3",
 "ace_special": "assets/sounds/v/ace_special.mp3",
 "ace_ultra": "assets/sounds/v/ace_ultra.mp3",
 "sanji_special": "assets/sounds/v/sanji_special.mp3"
};
const CV = {
 "goku": {
  "special": "goku_special",
  "transform": "aura"
 },
 "vegeta": {
  "special": "vegeta_special",
  "ultra": "vegeta_ultra",
  "transform": "aura"
 },
 "luffy": {
  "special": "luffy_special",
  "ultra": "luffy_ultra",
  "transform": "luffy_transform"
 },
 "naruto": {
  "special": "naruto_special",
  "ultra": "naruto_ultra"
 },
 "kenshin": {
  "special": "kenshin_special",
  "ultra": "kenshin_ultra"
 },
 "kakashi": {
  "special": "kakashi_special",
  "transform": "kakashi_transform"
 },
 "ichigo": {
  "special": "ichigo_special",
  "transform": "ichigo_transform"
 },
 "zenitsu": {
  "special": "zenitsu_special"
 },
 "tanjiro": {
  "special": "tanjiro_special",
  "ultra": "tanjiro_ultra"
 },
 "izuku": {
  "ultra": "izuku_ultra",
  "transform": "izuku_transform"
 },
 "jinwoo": {
  "ultra": "jinwoo_ultra"
 },
 "saitama": {
  "ultra": "saitama_ultra",
  "transform": "saitama_transform"
 },
 "gojo": {
  "special": "gojo_special",
  "ultra": "gojo_ultra"
 },
 "ippo": {
  "ultra": "ippo_ultra",
  "special": "ippo_special"
 },
 "killua": {
  "ultra": "killua_ultra"
 },
 "sasuke": {
  "special": "sasuke_special",
  "transform": "sasuke_transform",
  "ultra": "cri_m"
 },
 "gohan": {
  "special": "gohan_special",
  "transform": "gohan_transform",
  "ultra": "goku_special"
 },
 "ace": {
  "special": "ace_special",
  "ultra": "ace_ultra",
  "transform": "tanjiro_special"
 },
 "sanji": {
  "special": "sanji_special",
  "transform": "tanjiro_special",
  "ultra": "cri_m"
 },
 "hero": {
  "transform": "aura"
 },
 "inosuke": {
  "special": "brutal",
  "transform": "aura",
  "ultra": "tanjiro_ultra"
 },
 "trunks": {
  "special": "vegeta_special",
  "transform": "aura",
  "ultra": "cri_m"
 },
 "guts": {
  "special": "cri_m",
  "transform": "brutal",
  "ultra": "brutal"
 },
 "shoto": {
  "special": "aura",
  "transform": "aura",
  "ultra": "vegeta_special"
 },
 "saber": {
  "special": "teleport2",
  "transform": "aura",
  "ultra": "boom"
 },
 "mikasa": {
  "special": "teleport",
  "transform": "aura",
  "ultra": "brutal"
 },
 "revy": {
  "special": "boom",
  "transform": "aura",
  "ultra": "boom"
 },
 "gally": {
  "special": "brutal",
  "transform": "aura",
  "ultra": "brutal"
 },
 "levi": {
  "special": "teleport",
  "transform": "aura",
  "ultra": "cri_m"
 },
 "baki": {
  "special": "brutal",
  "transform": "brutal",
  "ultra": "cri_m"
 },
 "itachi": {
  "special": "aura",
  "transform": "aura",
  "ultra": "cri_m"
 },
 "eren": {
  "special": "brutal",
  "transform": "brutal",
  "ultra": "cri_m"
 },
 "boruto": {
  "special": "naruto_special",
  "transform": "aura",
  "ultra": "naruto_ultra"
 },
 "edward": {
  "special": "teleport2",
  "transform": "aura",
  "ultra": "cri_m"
 },
 "gintoki": {
  "special": "tanjiro_special",
  "transform": "aura",
  "ultra": "brutal"
 },
 "bakugo": {
  "special": "brutal",
  "transform": "brutal",
  "ultra": "cri_m"
 },
 "seiya": {
  "special": "aura",
  "transform": "aura",
  "ultra": "cri_m"
 }
};
