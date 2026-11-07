// ============================================================
// config.js — global configuration: asset paths, player tuning,
// weapon stats, enemy settings, quality presets.
// ============================================================

export const ASSET_PATH = './assets/';

// GLB / HDR drop-in assets. If a file exists it is loaded and used;
// otherwise the procedural fallback model/texture is kept. See README.md.
export const ASSETS = {
  models: {
    station: ASSET_PATH + 'models/station.glb',
    train:   ASSET_PATH + 'models/train.glb',
    rifle:   ASSET_PATH + 'models/rifle.glb',
    enemy:   ASSET_PATH + 'models/enemy.glb',
  },
  hdr: ASSET_PATH + 'hdr/station_night.hdr',
  // Optional replacement audio files (wav/ogg/mp3). Missing → procedural synth.
  audio: {
    shotRifle:     'gunshot_rifle.wav',
    shotPistol:    'gunshot_pistol.wav',
    shotShotgun:   'gunshot_shotgun.wav',
    enemyShot:     'gunshot_enemy.wav',
    impactMetal:   'impact_metal.wav',
    impactConcrete:'impact_concrete.wav',
    impactWood:    'impact_wood.wav',
    impactGlass:   'glass_break.wav',
    footstep:      'footstep.wav',
    trainRumble:   'train_rumble.wav',
    chime:         'station_chime.wav',
  },
};

// Campaign — fifteen missions. The first three sweep the station;
// MISSIONS 04–09 are themed worlds (spec: moremaps.md) built in newAreas.js:
//   cyber     電脳九龍 · neon cyberpunk alley (breakable neon, holo ads)
//   moon      月面基地 · abandoned lunar outpost (LOW GRAVITY, airlock switch)
//   tomb      黄金の墓 · pharaoh's golden tomb (torchlit pillar maze)
//   skyport   天空港 · steampunk airship harbor (air-walled gantry deck;
//             steam vents launch you higher)
//   lab       量子実験室 · minimalist quantum lab (EMP pulses glitch the HUD)
//   atlantis  沈没大陸 · sunken Atlantis ruins (underwater feel: slow heavy
//             gravity, bubbles, caustic light)
// MISSIONS 10–15 are the six moremaps2.md worlds (js/newAreas2.js / newAreas3.js):
//   ice       極夜破冰船 · polar night icebreaker (GPU aurora dome, blizzard,
//             slippery ice, shootable cliff icicles, radar-station high ground)
//   orbit     軌道ターミナル · stratospheric elevator ring (instanced struts,
//             layered Earth backdrop, a cargo train that shoves you)
//   canopy    世界樹の冠 · eco-dome treetops (wind-shader leaf canopy,
//             elevated walkways, springy leaf jump pads, glowing bugs)
//   canyon    錆の峡谷 · rusting starship-wreck canyon (periodic sandstorms)
//   aquarium  無重力水槽 · zero-G neon aquarium (jetpack, floating water
//             orbs that drag you, a mechanical megalodon overhead)
//   clockwork 歯車の煉獄 · eternal-dusk brass gear world (transmission-ratio
//             spinning floor gears, gothic silhouettes, brass dust)
// Each mission has its own player spawn, atmosphere (fog/moon/background),
// enemy spawn pool and reinforcement wave plan. Waves batch hostiles at
// randomized anchors with gaps of WAVES.gap seconds between them.
// `roster` lists the enemy classes (ENEMY.classes); optional `mods`
// tweak player physics + special mechanics per world.
export const WAVES = {
  batchSize: [2, 3],   // used when a mission has no explicit `waves`
  gap: [11, 20],       // seconds between reinforcement batches
};

// Objective pools: a mission draws ONE objective type from its
// `objectives` list each time it is armed (see js/objectives.js), so a
// replay of the same map can be a hold-out, a data heist or a manhunt.
// `specials` mixes shield / medic / drone units into later waves, and
// `boss` names the class that leads the last wave (or the manhunt).
export const OBJECTIVES = {
  survive:     { duration: 70, perMission: 2, gap: [5, 9], maxAlive: 6, batch: [1, 3] },
  defend:      { duration: 65, perMission: 2, gap: [6, 10], maxAlive: 6, batch: [1, 3], hackRate: 4.5 },
  capture:     { time: 32, radius: 4.5, gap: [7, 12], maxAlive: 5, batch: [1, 2] },
  intel:       {},
  assassinate: {},
  eliminate:   {},
};

// Run-to-run variety: every mission start rolls an atmosphere variant
// (weather / lighting) that fits the setting — see js/variants.js.
export const VARIANTS = {
  chance: 0.7,          // odds a mission gets a non-default variant
};

// Player growth (js/progression.js): XP per kill by class, level curve.
export const PROGRESSION = {
  baseXp: 120, growth: 1.22,
  xp: { rifle: 20, rusher: 18, heavy: 40, marksman: 28, stalker: 24, breacher: 30,
        bombardier: 38, flamer: 34, phantom: 30, juggernaut: 70, shield: 34,
        medic: 30, drone: 22, commander: 250 },
  headshotBonus: 0.5,     // +50 % XP for headshot kills
  objectiveXp: 150,
};

export const MISSIONS = [
  {
    name1: 'MISSION 01',
    name2: 'SECURE THE CONCOURSE',
    desc:  'Eliminate all hostile targets in the main hall.',
    jp:    '改札制圧',
    enemyCount: 5,
    waves: [2, 3],
    roster: ['rifle'],
    area: 'hall',
    objectives: ['eliminate', 'defend', 'capture'],
    specials: ['shield'],
    spawn: { x: -6, z: -8, yaw: 0 },
    atmo: {},
  },
  {
    name1: 'MISSION 02',
    name2: 'PLATFORM LOCKDOWN',
    desc:  'Hostiles hold the boarding platform. Clear the tracks.',
    jp:    'ホーム制圧',
    enemyCount: 6,
    waves: [3, 3],
    roster: ['rifle', 'rifle', 'rusher'],
    area: 'platform',
    objectives: ['survive', 'capture', 'eliminate'],
    specials: ['shield', 'medic'],
    spawn: { x: -20, z: 10, yaw: Math.PI },
    atmo: { fogNear: 40, fogFar: 175, moon: 0.55 },
    trainSoon: true,
  },
  {
    name1: 'MISSION 03',
    name2: 'SAKURA GARDEN SIEGE',
    desc:  'Sweep east of the hall — elite hostiles among the trees.',
    jp:    '桜の庭園 掃討',
    enemyCount: 7,
    waves: [3, 4],
    roster: ['rifle', 'rusher'],
    area: 'garden',
    objectives: ['eliminate', 'intel', 'assassinate'],
    specials: ['medic', 'drone'],
    boss: 'commander',
    spawn: { x: 7, z: 4, yaw: -Math.PI / 2 },
    atmo: { fogNear: 34, fogFar: 160, moon: 0.85 },
    elite: true,
  },
  {
    name1: 'MISSION 04',
    name2: 'NEON ALLEY SWEEP',
    desc:  'Rain-slicked neon corridors of the cyber block. Shoot the signs down.',
    jp:    '電脳九龍 掃討',
    enemyCount: 8,
    waves: [3, 3, 2],
    roster: ['rifle', 'rusher', 'marksman', 'stalker'],
    area: 'cyber',
    objectives: ['intel', 'eliminate', 'survive'],
    specials: ['drone', 'shield'],
    spawn: { x: -127, z: -14, yaw: -Math.PI / 2 },
    atmo: { fogNear: 24, fogFar: 140, moon: 0.5, bg: 'neon', bloom: 0.55 },
  },
  {
    name1: 'MISSION 05',
    name2: 'LUNAR OUTPOST',
    desc:  'Dead moon dome, low gravity. Jump high — the airlock switch is shootable.',
    jp:    '月面基地 潜入',
    enemyCount: 7,
    waves: [2, 3, 2],
    roster: ['rifle', 'stalker', 'breacher'],
    area: 'moon',
    objectives: ['defend', 'eliminate', 'intel'],
    specials: ['drone', 'medic'],
    spawn: { x: -12, z: 38.5, yaw: Math.PI },
    atmo: { fogNear: 45, fogFar: 210, moon: 1.15, bg: 'space' },
    mods: { gravityScale: 0.38, jumpScale: 1.4 },
  },
  {
    name1: 'MISSION 06',
    name2: "GOLDEN TOMB",
    desc:  'Pillar maze of the pharaoh. Breachers guard the gold.',
    jp:    '黄金の墓 探索',
    enemyCount: 8,
    waves: [3, 3, 2],
    roster: ['rifle', 'breacher', 'heavy'],
    area: 'tomb',
    objectives: ['intel', 'capture', 'eliminate'],
    specials: ['shield', 'medic'],
    spawn: { x: -20, z: -70, yaw: -2.0 },
    atmo: { fogNear: 16, fogFar: 95, moon: 0.3, bg: 'dark' },
    mods: { traps: true },
  },
  {
    name1: 'MISSION 07',
    name2: 'SKYPORT RAID',
    desc:  'Gantry deck above the clouds — the rails hold, so use the steam vents.',
    jp:    '天空港 急襲',
    enemyCount: 8,
    waves: [2, 3, 3],
    roster: ['rifle', 'marksman', 'stalker'],
    area: 'skyport',
    objectives: ['capture', 'survive', 'intel'],
    specials: ['drone', 'medic'],
    spawn: { x: 47, z: -4, yaw: -Math.PI / 2 },
    atmo: { fogNear: 20, fogFar: 150, moon: 1.45, bg: 'cloud' },
  },
  {
    name1: 'MISSION 08',
    name2: 'QUANTUM LAB INCURSION',
    desc:  'White hall, one core. Its EMP pulses will blind your optics.',
    jp:    '量子実験室 制圧',
    enemyCount: 9,
    waves: [3, 3, 3],
    roster: ['rifle', 'heavy', 'bombardier'],
    area: 'lab',
    objectives: ['defend', 'capture', 'assassinate'],
    specials: ['drone', 'shield'],
    boss: 'commander',
    spawn: { x: 87, z: 38.5, yaw: Math.PI },
    atmo: { fogNear: 50, fogFar: 230, moon: 0.78, bg: 'dark' },
    mods: { emp: true },
    elite: true,
  },
  {
    name1: 'MISSION 09',
    name2: 'SUNKEN CONTINENT',
    desc:  'Atlantis endgame — heavy water, glowing ruins, everything they have.',
    jp:    '沈没大陸 最終決戦',
    enemyCount: 11,
    waves: [3, 3, 2, 3],
    roster: ['rifle', 'rusher', 'heavy', 'bombardier', 'marksman'],
    area: 'atlantis',
    objectives: ['assassinate', 'eliminate', 'intel'],
    specials: ['shield', 'medic', 'drone'],
    boss: 'commander',
    spawn: { x: -127, z: 40, yaw: -Math.PI / 2 },
    atmo: { fogNear: 12, fogFar: 85, moon: 0.45, bg: 'deep' },
    mods: { gravityScale: 0.5, jumpScale: 0.9, speedScale: 0.88, underwater: true, gapScale: 1.35, currents: true },
    elite: true,
  },
  // ---- MISSIONS 10–15: the six moremaps2.md worlds (js/newAreas2.js) ----
  {
    name1: 'MISSION 10',
    name2: 'POLAR ICEBREAKER',
    desc:  'Aurora over the frozen sea. The deck is slick — and the icicles fall.',
    jp:    '極夜破冰船 突入',
    enemyCount: 9,
    waves: [3, 3, 3],
    roster: ['rifle', 'marksman', 'flamer'],
    area: 'ice',
    objectives: ['survive', 'intel', 'eliminate'],
    specials: ['medic', 'shield'],
    // spawn on the frozen-sea side, three-quarter view of the icebreaker
    // with both glacier ridges clipped into frame edges (audit: pulled in
    // from 122,-22 so the hull reads larger without touching the flank)
    spawn: { x: 144, z: -21, yaw: -0.8 },
    atmo: { fogNear: 24, fogFar: 150, moon: 1.3, bg: 'aurora' },
    mods: { ice: true, gapScale: 1.15 },
  },
  {
    name1: 'MISSION 11',
    name2: 'ORBITAL NEXUS',
    desc:  'Ring platform in the stratosphere. Watch the deck — a cargo train runs it.',
    jp:    '軌道ターミナル 制圧',
    enemyCount: 9,
    waves: [3, 3, 3],
    roster: ['rifle', 'rusher', 'marksman', 'phantom'],
    area: 'orbit',
    objectives: ['capture', 'defend', 'eliminate'],
    specials: ['drone', 'shield'],
    spawn: { x: 125, z: 46, yaw: -Math.PI / 2 },
    atmo: { fogNear: 60, fogFar: 260, moon: 1.2, bg: 'orbit', farClip: 780 },
  },
  {
    name1: 'MISSION 12',
    name2: 'CANOPY OF YGGDRASIL',
    desc:  'Fight on the treetops. The big leaves are springboards — use them.',
    jp:    '世界樹の冠 掃討',
    enemyCount: 10,
    waves: [3, 3, 4],
    roster: ['rifle', 'stalker', 'phantom', 'flamer'],
    area: 'canopy',
    objectives: ['intel', 'survive', 'eliminate'],
    specials: ['drone', 'medic'],
    spawn: { x: -235, z: -14, yaw: -Math.PI / 2 },
    atmo: { fogNear: 30, fogFar: 180, moon: 1.1, bg: 'canopy', farClip: 168 },
    mods: { bounce: true },
  },
  {
    name1: 'MISSION 13',
    name2: 'THE RUSTING CANYON',
    desc:  'Wreck of a starship in red rock. Sandstorms roll in without warning.',
    jp:    '錆の峡谷 探索',
    enemyCount: 10,
    waves: [3, 3, 4],
    roster: ['rifle', 'marksman', 'breacher', 'juggernaut'],
    area: 'canyon',
    objectives: ['assassinate', 'capture', 'intel'],
    specials: ['shield', 'medic', 'drone'],
    boss: 'commander',
    // flank shot: wreck line + mid breach glow + sun off the nozzles all
    // read the moment the mission starts
    spawn: { x: -220, z: 46, yaw: -2.64 },
    atmo: { fogNear: 26, fogFar: 175, moon: 0.9, bg: 'rust', farClip: 235, bloom: 0.5 },
    mods: { sandstorm: true },
  },
  {
    name1: 'MISSION 14',
    name2: 'ZERO-G AQUARIUM',
    desc:  'Gravity failed here. Jet over the floating water orbs — they slow you.',
    jp:    '無重力水槽 突入',
    enemyCount: 11,
    waves: [3, 4, 4],
    roster: ['rifle', 'phantom', 'flamer', 'stalker'],
    area: 'aquarium',
    objectives: ['survive', 'defend', 'intel'],
    specials: ['drone', 'medic'],
    spawn: { x: 185, z: 46, yaw: -1.31 },
    atmo: { fogNear: 28, fogFar: 150, moon: 0.7, bg: 'aqua', bloom: 0.5 },
    mods: { zeroG: true, gravityScale: 0.3, gapScale: 1.25 },
  },
  {
    name1: 'MISSION 15',
    name2: 'CLOCKWORK PURGATORY',
    desc:  'Endgame in the turning brass world. Everything they have, on every gear.',
    jp:    '歯車の煉獄 最終決戦',
    enemyCount: 12,
    waves: [3, 3, 3, 3],
    roster: ['rifle', 'heavy', 'marksman', 'bombardier', 'juggernaut', 'phantom'],
    area: 'clockwork',
    objectives: ['assassinate', 'eliminate'],
    specials: ['shield', 'medic', 'drone'],
    boss: 'commander',
    spawn: { x: 185, z: -34, yaw: -Math.PI / 2 },
    atmo: { fogNear: 18, fogFar: 120, fogColor: 0x241606, moon: 0.8, bg: 'brass', bloom: 0.45 },
    mods: { gears: true, hazards: true },
    elite: true,
  },
];

export const PLAYER = {
  eyeStand: 1.66,
  eyeCrouch: 1.14,
  walkSpeed: 3.3,
  sprintSpeed: 5.7,
  crouchSpeed: 1.85,
  accel: 14,
  airControl: 0.4,
  gravity: 22,
  jumpSpeed: 7.2,
  radius: 0.38,
  height: 1.75,
  stepUp: 0.48,      // auto-climb ledges up to this height (stairs, kerbs)
  fov: 72,
  fovSprint: 79,
  maxHp: 100,
  overrunHp: 60,     // hp restored on death-respawn (no passive regen — medkits only)
  hearingRadius: 24, // enemies hear player shots within this radius
};

// Mission-clear window between missions dismisses itself after this many
// seconds (countdown shown in the hint) — the player never has to click.
// Clicking the window just skips the remaining countdown. The final
// CAMPAIGN COMPLETE screen stays manual (stats to read, restart intent).
export const INTERMISSION = { seconds: 4 };

// CS-style spray recoil: holding the trigger makes every shot climb the
// view more and adds cone spread; the pattern is HELD while the trigger is
// down (no cooling mid-burst) and washes out after `resetAfter` seconds of
// not firing. The view climb is permanent — pull down to fight it, just
// like Counter-Strike. Tap slowly and every shot stays near-perfect.
// Per weapon (WEAPONS[].sprayRamp / climbMin / climbMax):
//   sprayRamp  shots until the climb reaches climbMax
//   climbMin/Max  camera pitch climb per shot (rad) at 1 shot vs. full spray
//   climbKnee  optional: shots 1..knee stay near climbMin, then the climb
//     ACCELERATES to climbMax by sprayRamp (AR spray stays flat for the
//     first burst, then kicks hard). Weapons with no auto fire use 0/0.
export const RECOIL = {
  resetAfter: 0.30,   // seconds of silence before the pattern cools
  coolRate: 6.5,      // how fast the spray count washes out once cooling
};

export const WEAPONS = {
  rifle: {
    key: 'rifle', label: 'AR-15 ASSAULT', sound: 'shotRifle',
    auto: true, rpm: 640, damage: 26, pellets: 1,
    mag: 30, reserve: 120, reserveMax: 180,
    spreadBase: 0.0035, spreadKick: 0.0042, spreadMax: 0.04,
    sprayRamp: 16, climbMin: 0.0015, climbMax: 0.013, climbKnee: 5,
    kick: 1.0, reloadTime: 2.1, range: 140, adsZoom: 1.45,
  },
  pistol: {
    key: 'pistol', label: 'M9 SIDEARM', sound: 'shotPistol',
    auto: false, rpm: 460, damage: 30, pellets: 1,
    mag: 12, reserve: 72, reserveMax: 120,
    spreadBase: 0.0028, spreadKick: 0.003, spreadMax: 0.024,
    sprayRamp: 6, climbMin: 0, climbMax: 0,
    kick: 0.8, reloadTime: 1.5, range: 90, adsZoom: 1.2,
  },
  shotgun: {
    key: 'shotgun', label: 'M870 BREACHER', sound: 'shotShotgun',
    auto: false, rpm: 78, damage: 11, pellets: 8,
    mag: 6, reserve: 36, reserveMax: 60,
    spreadBase: 0.02, spreadKick: 0.01, spreadMax: 0.06,
    sprayRamp: 4, climbMin: 0.005, climbMax: 0.023,
    kick: 2.6, reloadTime: 2.7, range: 45, adsZoom: 1.15,
  },

  smg: {
    key: 'smg', label: 'MP7 PDW', sound: 'shotSmg',
    auto: true, rpm: 900, damage: 17, pellets: 1,
    mag: 40, reserve: 160, reserveMax: 240,
    spreadBase: 0.005, spreadKick: 0.0032, spreadMax: 0.035,
    sprayRamp: 20, climbMin: 0.001, climbMax: 0.008, climbKnee: 8,
    kick: 0.6, reloadTime: 1.9, range: 80, adsZoom: 1.25,
  },
  dmr: {
    key: 'dmr', label: 'M14 EBR · DMR', sound: 'shotDmr',
    auto: false, rpm: 220, damage: 64, pellets: 1,
    mag: 10, reserve: 40, reserveMax: 70,
    spreadBase: 0.0015, spreadKick: 0.006, spreadMax: 0.03,
    sprayRamp: 4, climbMin: 0.012, climbMax: 0.02,
    kick: 1.8, reloadTime: 2.5, range: 240, adsZoom: 3.2, scope: true, pierce: 1,
  },
  launcher: {
    key: 'launcher', label: 'M32 MGL LAUNCHER', sound: 'shotLauncher',
    auto: false, rpm: 90, damage: 150, pellets: 0,
    mag: 6, reserve: 12, reserveMax: 18,
    spreadBase: 0.004, spreadKick: 0.004, spreadMax: 0.02,
    sprayRamp: 3, climbMin: 0.02, climbMax: 0.03,
    kick: 2.4, reloadTime: 3.4, range: 0, projectile: { speed: 26, radius: 5.2 },
  },
};

// Owned from the start vs. found later (weapon crates / ARMORY perk).
export const WEAPON_ORDER = ['rifle', 'pistol', 'shotgun', 'smg', 'dmr', 'launcher'];
export const STARTING_WEAPONS = ['rifle', 'pistol', 'shotgun'];

// Aim down sights (right mouse): FOV zoom per weapon (adsZoom), spread
// and move-speed scaling, mouse sensitivity scaling while zoomed.
export const ADS = { spreadMul: 0.45, speedMul: 0.65, sensMul: 0.6, fovDefaultZoom: 1.3, inTime: 9 };

// Throwables
export const GRENADE = { start: 2, dmg: 140, radius: 6.5, fuse: 2.0, throwSpeed: 15, cooldown: 0.8 };

export const ENEMY = {
  hp: 130,               // base hit points for the standard 'rifle' hostile
  patrolSpeed: 1.6,
  chaseSpeed: 3.05,
  viewDistance: 30,
  viewAngleDeg: 125,
  attackRange: 17,
  loseRange: 34,
  losCheckInterval: 0.2,
  headshotMultiplier: 2.0,
  limbMultiplier: 0.72,  // thigh / shin / upper-arm hitboxes
  damageMin: 9,
  damageMax: 15,
  fireGap: [1.2, 2.0],   // seconds between bursts while in ATTACK state
  burst: [1, 3],         // rounds per trigger pull (0.11 s apart)
  mag: 24,               // rounds before a reload (the player's window)
  reloadTime: [1.7, 2.5],
  hitChance: 0.63,       // base accuracy (falls off with distance)
  reaction: [0.35, 0.7], // first-sight delay before the first shot
  alertRadius: 20,       // a spotter calls the player's position to squadmates
  searchTime: [5, 8],    // seconds spent sweeping the last known position
  coverHp: 0.5,          // below this hp fraction a hostile breaks for cover
  grenadeGap: [9, 15],   // per-thrower cooldown
  corpseTime: 7,         // seconds a body stays before it sinks away
  // Elite flag (MISSIONS[].elite): red band + strobe, buffed stats.
  eliteHpMultiplier: 1.5,
  eliteSpeedScale: 1.15,
  // Enemy classes — per-class overrides of the base values above.
  // `hpMul` scales base hp, `chaseMul`/`patrolMul` scale speed,
  // `fireGap` is the burst interval range, `hitBias` adds to accuracy,
  // `keepDist` makes the hostile back away when you get too close,
  // `shots` > 1 fires a multi-pellet pattern (breacher),
  // `quiet` suppresses its detection callout (stalker),
  // `flank` circles to your side instead of walking straight at you,
  // `grenades` lets it lob frags at a camping / hidden player,
  // `shield` carries a ballistic shield that stops frontal fire,
  // `medic` heals wounded squadmates, `flying` hovers (drone),
  // `boss` gets a HUD health bar and calls reinforcements.
  classes: {
    rifle:      { burst: [2, 3], grenades: false },
    rusher:     { hpMul: 0.65, chaseMul: 1.5, patrolMul: 1.3, viewDistance: 26,
                  attackRange: 11, fireGap: [0.7, 1.2], hitBias: 0.1,
                  damageMin: 7, damageMax: 11, flank: true, burst: [3, 5], mag: 30 },
    heavy:      { hpMul: 2.1, chaseMul: 0.7, patrolMul: 0.8, viewDistance: 26,
                  attackRange: 15, fireGap: [1.4, 2.2], burst: [4, 7], mag: 60,
                  damageMin: 11, damageMax: 16, grenades: true, noCover: true },
    marksman:   { hpMul: 0.85, chaseMul: 0.9, viewDistance: 52,
                  attackRange: 26, loseRange: 48, fireGap: [2.2, 3.2], burst: [1, 1],
                  hitBias: 0.2, damageMin: 15, damageMax: 23, keepDist: 11,
                  aimSpeed: 5, mag: 10, sound: 'enemySniper' },
    stalker:    { hpMul: 0.8, chaseMul: 1.7, patrolMul: 1.4, viewDistance: 22,
                  attackRange: 9, fireGap: [0.5, 1.0], hitBias: 0.16, burst: [2, 4],
                  damageMin: 6, damageMax: 10, quiet: true, scale: 0.96, flank: true, mag: 30 },
    breacher:   { hpMul: 1.35, chaseMul: 1.15, viewDistance: 24,
                  attackRange: 11, fireGap: [1.5, 2.2], shots: 4, hitBias: -0.08, burst: [1, 1],
                  damageMin: 6, damageMax: 9, grenades: true, mag: 6, sound: 'enemyShotgun' },
    bombardier: { hpMul: 1.8, chaseMul: 0.8, viewDistance: 34,
                  attackRange: 22, loseRange: 44, fireGap: [2.8, 3.8], burst: [1, 1],
                  hitBias: -0.05, damageMin: 22, damageMax: 30, keepDist: 13,
                  bigShot: true, scale: 1.12, aimSpeed: 5, grenades: true, mag: 4,
                  sound: 'enemyLauncher' },
    // --- MISSIONS 10–15 roster (moremaps2.md worlds) ---
    flamer:     { hpMul: 1.25, chaseMul: 1.05, viewDistance: 24,
                  attackRange: 13, fireGap: [1.8, 2.6], shots: 5, hitBias: -0.12, burst: [1, 1],
                  damageMin: 4, damageMax: 7, bigShot: true, noCover: true, mag: 8, sound: 'enemyFlame' },
    phantom:    { hpMul: 0.75, chaseMul: 1.85, patrolMul: 1.5, viewDistance: 30,
                  attackRange: 13, fireGap: [0.45, 0.9], hitBias: 0.14, burst: [2, 4],
                  damageMin: 6, damageMax: 11, quiet: true, scale: 0.98,
                  ghost: true, aimSpeed: 10, flank: true, mag: 30 },
    juggernaut: { hpMul: 3.4, chaseMul: 0.62, patrolMul: 0.7, viewDistance: 30,
                  attackRange: 19, fireGap: [0.9, 1.5], shots: 3, hitBias: -0.04, burst: [3, 6],
                  damageMin: 8, damageMax: 13, bigShot: true, scale: 1.35,
                  keepDist: 6, aimSpeed: 4, noCover: true, mag: 90 },
    // --- new hostiles ---
    shield:     { hpMul: 1.3, chaseMul: 0.85, patrolMul: 0.9, viewDistance: 26,
                  attackRange: 12, fireGap: [0.8, 1.3], burst: [2, 3], hitBias: -0.05,
                  damageMin: 6, damageMax: 10, shield: true, noCover: true, mag: 15,
                  sound: 'enemyPistol' },
    medic:      { hpMul: 0.9, chaseMul: 1.05, viewDistance: 28,
                  attackRange: 14, fireGap: [0.9, 1.5], burst: [2, 4], hitBias: -0.04,
                  damageMin: 5, damageMax: 9, medic: true, keepDist: 8, mag: 30 },
    drone:      { hpMul: 0.42, chaseMul: 1.55, patrolMul: 1.6, viewDistance: 34,
                  attackRange: 16, fireGap: [0.9, 1.6], burst: [3, 5], hitBias: -0.02,
                  damageMin: 4, damageMax: 7, flying: true, hover: 2.7, quiet: true,
                  flank: true, noCover: true, mag: 40, sound: 'enemyZap' },
    commander:  { hpMul: 8.5, chaseMul: 0.82, patrolMul: 0.8, viewDistance: 40,
                  attackRange: 22, loseRange: 60, fireGap: [0.8, 1.3], burst: [3, 5],
                  hitBias: 0.06, damageMin: 9, damageMax: 14, keepDist: 7, scale: 1.3,
                  aimSpeed: 6, grenades: true, boss: true, noCover: true, mag: 45,
                  sound: 'enemyHeavy' },
  },
};

// Battlefield drops (kills leave salvage on the ground).
// Each kill rolls every entry independently; bigger classes drop more
// often (`bonus`), elites +10 %, the SCAVENGER perk adds on top.
// Pickups bob over the corpse with a coloured ground ring + light
// shaft, expire after `lifetime` seconds, collected by walking over.
//   ammo      +rounds to every owned weapon
//   medkit    +HP (the ONLY heal besides perks / ADRENALINE)
//   armor     +armor plates (absorbs ARMOR.absorb of incoming damage)
//   grenade   +1 frag
//   weapon    unlocks a weapon you don't own yet (or refills one)
//   overdrive 10 s of +50 % damage
//   haste     10 s of +30 % move speed and 40 % faster reloads
export const DROPS = {
  ammoChance: 0.5,    ammoRounds: 24,
  medkitChance: 0.3,  medkitHp: 26,
  armorChance: 0.14,  armorPts: 30,
  grenadeChance: 0.12,
  weaponChance: 0.035,
  overdriveChance: 0.04, hasteChance: 0.045, buffTime: 10,
  bonus: { heavy: 0.15, bombardier: 0.2, juggernaut: 0.35, flamer: 0.15, shield: 0.12,
           medic: 0.25, commander: 1 },
  lifetime: 18,
};

export const ARMOR = { absorb: 0.6 };

export const QUALITY_PRESETS = {
  LOW: {
    label: 'LOW',
    shadows: false, shadowSize: 512, pixelRatio: 1.0, lightBudget: 6,
    bloom: false, bloomStrength: 0.0,
    particleScale: 0.4, floorClearcoat: false, glassTransmission: false,
    envResolution: 128, cityDetail: 0.5,
  },
  MEDIUM: {
    label: 'MEDIUM',
    shadows: true, shadowSize: 1024, pixelRatio: 1.0, lightBudget: 12,
    bloom: true, bloomStrength: 0.55,
    particleScale: 0.7, floorClearcoat: false, glassTransmission: false,
    envResolution: 256, cityDetail: 0.7,
  },
  HIGH: {
    label: 'HIGH',
    shadows: true, shadowSize: 2048, pixelRatio: 1.25, lightBudget: 16,
    bloom: true, bloomStrength: 0.68,
    particleScale: 1.0, floorClearcoat: true, glassTransmission: true,
    envResolution: 256, cityDetail: 1.0,
  },
  ULTRA: {
    label: 'ULTRA',
    shadows: true, shadowSize: 4096, pixelRatio: 1.5, lightBudget: 20,
    bloom: true, bloomStrength: 0.78,
    particleScale: 1.3, floorClearcoat: true, glassTransmission: true,
    envResolution: 512, cityDetail: 1.0,
  },
};

// Slow-motion feedback (seconds are REAL time while slowed)
export const SLOWMO = {
  headshot: { scale: 0.16, duration: 0.07 },
  finalKill: { scale: 0.12, duration: 0.16 },
};
