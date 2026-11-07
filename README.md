# JAPANESE STATION — Tactical FPS

[English](README.md) · [简体中文](README.zh.md)

A browser-native Three.js first-person shooter: a night-time Japanese rail
station, 「桜見台駅」 (Sakuramidai Station) — cherry blossoms, a konbini, a
commuter train pulling into the platform, HDR/PBR lighting, bloom, particle
hit feedback, enemy AI, 3D spatial audio and a full 15-mission campaign.

**Runs with zero external assets.** Every model, texture, HDR and sound is
generated procedurally. Drop real GLB / HDR / audio files in place and they
are picked up automatically (see [Swapping assets](#swapping-assets)).

## Running it

No Node.js, no build step. Serve with any static server (GLTF/HDR loading
needs HTTP — `file://` hits CORS):

```bash
python -m http.server 8080
```

Then open <http://localhost:8080> — desktop Chrome / Edge with WebGL2
recommended.

## Controls

| Key | Action |
|---|---|
| Mouse | Look |
| WASD | Move (low kerbs/steps are auto-stepped) |
| SHIFT | Sprint |
| SPACE | Jump (hold mid-air in MISSION 14 = jetpack) |
| CTRL | Crouch |
| LMB | Fire |
| RMB | Aim down sights (ADS: FOV zoom, tighter spread, lower sensitivity; the DMR gets a full sniper scope) |
| R | Reload (the magazine physically drops out and goes back in) |
| G | Grenade (arcing, bouncing, 2 s fuse) |
| 1–6 / wheel / Q | Switch weapon (slots 4–6 unlocked via weapon crates or the ARMORY perk) |
| 1 / 2 / 3 | Pick a perk during the intermission window |
| F3 | Debug panel (FPS / draw calls / triangles / particles) |
| M | Mute |
| ESC | Release mouse / pause |

> In MISSION 14 (Zero-G Aquarium), hold SPACE mid-air to thrust upward. In
> MISSION 12 (Canopy of Yggdrasil), the giant leaves bounce you up onto the
> canopy boardwalks.

## The campaign

15 missions, from the metro station out to a cyber-punk alley, a moon base,
an Egyptian tomb, a skyport, a quantum lab and a sunken continent — then on
to a polar icebreaker under the aurora, an orbital elevator, the canopy of
the world tree, a rusted canyon with a crashed starship, a zero-G aquarium
and a clockwork city.

Enemies arrive in reinforcement waves, and kills drop **medkits / ammo** —
**HP never regenerates passively**; once damaged, the only heal in the game
is a picked-up medkit. Each mission ends with a KILLS / ACCURACY / TIME
report; clearing MISSION 15 shows CAMPAIGN COMPLETE.

| # | Mission | World | Signature mechanics |
|---|---|---|---|
| 01–03 | Concourse / Platform / Sakura Garden | Station | Ticket gates, konbini, arriving commuter train, GPU sakura petals |
| 04 | Neon Alley Sweep | 電脳九龍 cyber | Dense neon alleys + scaffolding stairs, shader holograms, reflective wet ground, breakable neon panels |
| 05 | Lunar Outpost | 月面基地 moon | Low gravity (higher jumps), shootable door switches, spinning centrifuge, Earth visible through cracked portholes |
| 06 | Golden Tomb | 黄金の墓 tomb | Hieroglyph reliefs, pillar maze, flickering torches, gold PBR hoards; shoot scarab slabs to trigger falling-rock traps and quicksand |
| 07 | Skyport Raid | 天空港 skyport | Brass airship port: breathing canvas dirigibles, steam jets that lift you, 900 m cloud sea below, invisible walls at the rim |
| 08 | Quantum Lab Incursion | 量子実験室 lab | Mirror-floor minimal hall, floating Fresnel quantum core, EMP pulse every ~18 s glitches the HUD |
| 09 | Sunken Continent | 沈没大陸 atlantis | Underwater feel: reduced gravity/speed, bubbles on fire & hits, Greek colonnade, animated caustics, glowing fish, current channels push you |
| 10 | Polar Icebreaker | 永夜极光破冰船 ice | 36 m nuclear icebreaker: lower-deck CQB, upper deck & radar mast for high ground; shootable falling icicles; aurora sky dome, blowing snow, sweeping searchlights |
| 11 | Orbital Nexus | 軌道電梯 orbit | True ring deck (r12→r30), slowly turning Earth far below the central shaft; a cargo skid sweeps the deck every ~16 s — get hit, take damage; invisible walls |
| 12 | Canopy of Yggdrasil | 世界樹 canopy | The real battleground is the canopy boardwalk net at y≈6.75 — enemies spawn up there too; bounce pads on the forest floor launch you up; GPU wind-deformed instanced leaves |
| 13 | The Rusting Canyon | 錆峡谷 canyon | 46 m three-stage starship wreck: crawl into the ribcage for CQB, climb cargo crates to the hull-top sniper nest; periodic sandstorms collapse fog distance |
| 14 | Zero-G Aquarium | 無重力水槽 aquarium | Zero gravity (gravityScale 0.3 + SPACE jetpack); Fresnel water orbs slow you 50 % inside; a 9 m megalodon patrols overhead and dives to bite (40 dmg) |
| 15 | Clockwork Purgatory | 鐘楼机关城 clockwork | Ground gears mesh at real ratios, rotate, and are standable; meshing points are 85-damage traps; two stadium gears carry orbiting gothic towns; elite mission (all enemies red-armband) |

Every mission has its own spawn, atmosphere (fog / moonlight / procedural
sky) and banner. The intermission window auto-advances after
`INTERMISSION.seconds` (4 s, with a visible countdown) — no forced
"Continue" click. Per-mission world mechanics live in `MISSIONS[].mods`
(ice / bounce / sandstorm / zeroG / gravityScale …).

## Gameplay systems (v2)

- **Randomized win conditions** (`js/objectives.js`, per-mission
  `MISSIONS[].objectives` pool — one is rolled each entry):
  **Eliminate** (clear all enemies) · **Survive** (hold out against
  continuous reinforcements for N s) · **Defend the Terminal** (enemy
  saboteurs walk up to your data terminal and drain it; zero integrity =
  retry) · **Capture the Uplink** (progress ticks while you stand in the
  ring and no enemy is inside) · **Recover Intel** (grab 3 data discs, then
  extract at the beacon) · **Assassinate the Commander** (kill the boss,
  the rest withdraw). Objective + progress shown top-HUD with waypoint
  markers.
- **Enemy AI** (`js/enemy.js`, FSM incl. COVER and SEARCH states):
  spotted you? they **call nearby teammates**. Lost sight? no wall-hacks —
  they **search your last known position**. Hurt or out of ammo? they find
  **real cover** (ray-checked), crouch, reload, peek out. Rushers
  **flank**; grenadiers/heavies/commanders **lob grenades** at campers.
  Burst fire with mag + reload windows; your speed reduces their hit
  chance; bullets whiz past your ears.
- **14 enemy classes**: rifle, rusher, heavy, marksman, stalker, breacher,
  bombardier, flamer, phantom (cloak ghost), juggernaut (3.4× HP drum gun)
  — plus **shield bearer** (front-immune: flank, leg-shot or headshot),
  **medic** (heals nearby wounded, kill first), **drone** (flying, fast,
  crashes when shot down) and the **commander boss** (health bar, calls
  reinforcements at 66 % / 33 % HP, throws grenades). Later waves mix in
  specials; elites get red armbands and buffed stats.
- **Spawn patterns**: reinforcement waves pick from five playbooks (frontal
  / backdoor / pincer / squad rally / charge), preferring anchors outside
  your view; the next wave arrives early when the field nearly empties.
- **Weapons** (6): AR-15, M9, M870 at start; **MP7 PDW**, **M14 EBR DMR**
  (pierces 1 body, full-screen scope) and **M32 grenade launcher**
  (arcing explosive rounds) via weapon crates or the ARMORY perk. First
  person hands: gloved two-hand grips and sleeves; the shotgun pump tracks
  the left hand.
- **CS-style spray**: continuous full-auto climbs your camera pitch
  per-shot (permanent — you must pull down like in Counter-Strike) while
  spread heat builds to `spreadMax`; release the trigger for 0.3 s and the
  pattern cools fast. Slow taps stay nearly full-accuracy. Tune in
  `js/config.js` → `RECOIL` + `WEAPONS[].sprayRamp / climbMin / climbMax`.
- **Drops**: ammo / medkit / **armor plates** (absorb 60 % of incoming
  damage) / grenades / **weapon crates** / **OVERDRIVE** (10 s +50 % dmg) /
  **HASTE** (10 s speed + fast reload). They land at corpse height (correct
  on elevated walkways) with coloured ground rings.
- **Progression**: kills grant XP (headshots/elites more, objective
  bonuses); level-ups grant perk points; the intermission offers a
  pick-one-of-three from **15 stacking perks** (Vitality, Armor Plating,
  Quick Hands, Hollow Point, Deadeye, Lightfoot, Deep Pockets, Field
  Medic, Scavenger, Steady Aim, Demolitionist, Vampiric, Juggernaut,
  Second Wind, Armory). Restarting the campaign resets them.
- **Dynamic stages** (`js/props.js` + `js/variants.js`): each entry
  randomly scatters **cover props** (crate stacks, ammo lockers, sandbag
  walls, concrete barriers — real colliders that block bullets and that
  enemies actually use as cover) and **red explosive barrels** (a few shots
  leak fire, then chain-explode). Random weather/lighting variants: **fog /
  thunderstorm (GPU rain + lightning + thunder) / blackout flicker / alert
  (red tint + siren) / dusk / blizzard**.
- **Audio**: layered synthesized gunshots (transient crack + report + bass
  thump + bolt cycle + ambient tail), 3–4 random variants per weapon; every
  sound passes through a **per-map generated reverb** (concourse, tomb,
  open sky, underwater…); explosions, grenade bounces, bullet whine,
  shield ricochet, low-HP heartbeat, thunder. **Adaptive procedural music**
  (`js/music.js`): each world has its own mode/tempo/chords — pads + arpeggios
  in calm, drums and bass fade in during combat.
- **Graphics**: enemies / weapons / pickups / props are high-detail
  procedural models **merged into few draw calls** (`js/meshKit.js`:
  per-vertex roughness/metal + baked AO); textured materials get bump
  detail automatically. A final **grade pass** (`js/postfx.js`): contrast /
  saturation / cool-shadows-warm-highlights, vignette, edge chromatic
  aberration, film grain, low-HP desaturation + red pulse, outline on
  pickups, scope mask (off on LOW quality).
- **Collision & bounds**: spatial-hash collider world (queries touch only
  nearby cells); players auto-step ≤ 0.48 m; enemies no longer overlap
  each other or you; per-region hitboxes (head ×2, torso ×1, limbs ×0.72)
  follow the animation; grenades and launcher rounds bounce off real
  colliders.

### Performance

- Enemies: ~12 draw calls each (was ~43), geometry cached per class;
  corpses sink and are removed after 7 s.
- Measured (13-enemy firefight): `_update` averages 0.52 ms (was 0.79),
  draw calls 508 (was 873).
- Bullets and enemy LoS rays only test **the current map's** meshes (not
  all 16 worlds); HUD writes DOM only on change; all models / materials /
  pickups / props / reverbs are prewarmed during loading, so no shader
  compiles or buffer uploads happen mid-level.

## Project layout

```
jstation/
├── index.html          # entry + import map (three@0.165 CDN) + HUD DOM
├── REQUIREMENTS.md     # merged original spec (prompt.txt / moremaps1 / moremaps2)
├── REBUILD.md          # MISSION 04–15 rebuild acceptance contract
├── css/style.css       # minimal military-style UI
├── js/
│   ├── main.js         # bootstrap
│   ├── game.js         # master assembly: renderer / post / missions / fire pipeline
│   ├── config.js       # every tunable number (weapons, player, enemies, quality)
│   ├── layout.js       # station coordinates
│   ├── assetManager.js # GLB/HDR/texture/audio loading + fallbacks
│   ├── environment.js  # HDR → PMREM → scene.environment (PBR IBL)
│   ├── textures.js     # procedural canvas textures (marble / concrete / signage)
│   ├── materials.js    # shared PBR materials (wet clearcoat floors, glass)
│   ├── station.js      # main hall (gates, ticket machines, LED boards, sakura garden)
│   ├── store.js        # station konbini (glass front, auto door, shelves, warm light)
│   ├── platform.js     # platform (yellow line, screen doors, tracks, skyline)
│   ├── train.js        # 4-car commuter train: arrive → brake → doors → depart
│   ├── sakura.js       # cherry trees + GPU petal particles
│   ├── player.js       # pointer-lock controller, collision, recoil/shake compositing
│   ├── weapon.js       # 6 procedural guns + hold animations (breathing/sway/sprint/reload)
│   ├── enemy.js        # enemy FSM: patrol/chase/attack/cover/search/death
│   ├── enemyModel.js   # high-detail enemy models baked per skeletal segment
│   ├── pickups.js      # kill loot: medkit / ammo / armor / grenade / crate / buffs
│   ├── meshKit.js      # PartList → one BufferGeometry (vertex color + rm channels)
│   ├── gameSystems.js  # gameplay layer mixed into Game: objectives/XP/perks/armor/
│   │                   #   grenades/buffs/props/weather/music
│   ├── objectives.js   # the six win conditions
│   ├── progression.js  # XP / levels / 15 perks
│   ├── explosives.js   # grenades, launcher rounds, explosions + fireballs
│   ├── props.js        # per-mission random cover props + explosive barrels
│   ├── variants.js     # weather / lighting variants + GPU rain
│   ├── music.js        # procedural adaptive soundtrack
│   ├── postfx.js       # final color-grade pass
│   ├── lightRig.js     # scene-rooted light rig (count-stable, intensity-gated)
│   ├── hud.js / hudExtras.js   # HUD + armor/XP/objective/waypoint/boss-bar widgets
│   ├── newAreas.js     # MISSION 04–09 themed worlds (cyber/moon/tomb/skyport/lab/atlantis)
│   ├── newAreas2.js    # MISSION 10–12 (ice/orbit/canopy) + aurora fbm shader + point fields
│   ├── newAreas3.js    # MISSION 13–15 (canyon/aquarium/clockwork) + fresnel orbs / sandstorm / megalodon / gears
│   ├── mapChunks.js    # 17 m ChunkGrid visibility culling + LOD + splat materials
│   ├── particleManager.js # pooled particles (sparks/smoke/dust/debris/glass/prints/tracers)
│   ├── audioManager.js # fully synthesized Web Audio SFX + PositionalAudio + JP announcements
│   ├── collision.js    # spatial-hash AABB world
│   └── build.js / utils.js
└── assets/
    ├── models/   # station.glb train.glb rifle.glb enemy.glb (optional overrides)
    ├── hdr/      # station_night.hdr
    ├── textures/
    └── audio/    # optional .wav/.ogg/.mp3 overriding same-named synth SFX
```

## Swapping assets

The manifest lives in `js/config.js` → `ASSETS`. Drop a file in and it is
used; a missing file falls back to procedural content (404s never crash).

- **GLB models**: place in `assets/models/` with the names in
  `ASSETS.models` (`enemy.glb` / `rifle.glb` / `train.glb` / `station.glb`).
  Meshes get shadows enabled and are auto-scaled to the expected bounding
  box; if the model has animations named `Idle/Walk/Run/Attack/Hit/Death/Reload`
  they play through an AnimationMixer, otherwise procedural animation stays.
- **HDR**: `assets/hdr/station_night.hdr` (equirectangular) goes through
  PMREM to drive `scene.environment` (PBR reflections + IBL).
- **Firearm**: `assets/models/rifle.glb` (point the barrel along +X or −Z;
  the code auto-orients by longest axis and aligns the muzzle).
- **SFX**: drop same-named files listed in `ASSETS.audio` into
  `assets/audio/` (e.g. `gunshot_rifle.wav`, `train_rumble.wav`,
  `station_chime.wav`) to override the synthesized version.
- **Announcements**: prefers the browser's Japanese `SpeechSynthesis`;
  falls back to a chime when no JP voice exists.

## Tuning

Everything gameplay-related is in `js/config.js`:

- **Quality**: GRAPHICS QUALITY dropdown (LOW / MEDIUM / HIGH / ULTRA) on
  the start/pause screens → `QUALITY_PRESETS` (shadow maps, bloom, pixel
  ratio, particle density, clearcoat/transmission).
- **Campaign**: `MISSIONS` — 15 entries with `enemyCount`, `waves`,
  `roster`, `objectives`, `spawn`, `atmo` (fog, `farClip`, `bloom`
  multiplier), `mods` (world mechanics).
- **Enemy classes / stats**: `ENEMY.classes` (base 130 HP × `hpMul`, per-class
  damage, view distance, burst patterns, flank/quiet/grenade flags);
  `ENEMY.eliteHpMultiplier / eliteSpeedScale`.
- **Weapons**: `WEAPONS` (damage, rpm, mag, reload, spray ramp/climb, ADS zoom).
- **Player**: `PLAYER` (speed, jump ≈ 1.18 m, gravity, FOV, `overrunHp` —
  there are no regen params anymore; healing only comes from `DROPS`).
- **Recoil**: `RECOIL` (resetAfter / coolRate) + per-weapon
  `sprayRamp / climbMin / climbMax`.
- **Slow-mo kills**: `SLOWMO`.

## Technical notes

- three@0.165 (CDN import map) · WebGL2 · ACES Filmic + sRGB · PCFSoft shadows
- EffectComposer: RenderPass → UnrealBloomPass → OutputPass (+ postfx grade
  pass); bloom auto-off on LOW
- HDR environment (real .hdr or procedural float HDR) → PMREM → PBR IBL
- Particles are pooled `THREE.Points + ShaderMaterial` (one draw call per
  type); bullet prints and tracers are pooled meshes
- **Themed-world performance** (MISSIONS 04–15, stable 60 FPS): everything
  is procedural low-poly primitives + a global `cachedBox` geometry cache
  (zero downloads, zero parsing, GPU buffer reuse); repeats go through
  `InstancedMesh`; animated effects are custom `ShaderMaterial` (holograms,
  caustics, quantum core pulse, aurora dome, wind leaves, Fresnel orbs —
  one draw call each, animated on GPU, CPU just bumps `uT`); per-world
  `THREE.Group` visibility gating + per-mission `camera.far` (`atmo.farClip`)
  keep draw calls at ~230–350 per mission (down from 1200–2000 when worlds
  bled through each other)
- **World isolation**: each themed world's meshes live in its own group
  (`newAreas*.setVisible(area)`), so oversized set-dressing (aurora dome,
  Earth, canopy shell) never leaks through a neighbouring world's walls;
  lights stay scene-rooted with a constant count (no mid-mission shader
  recompiles). World bounds (`newAreas*.bounds`) drive player fence clamping
  and an enemy anti-stuck guardian that teleports wedged enemies back to a
  free anchor
- **Stutter defenses**: all lights permanently scene-rooted and
  intensity-gated (hiding never changes light count → no mass shader
  recompile); a boot-time prewarm (`renderer.compile` + one full render
  with everything visible) moves shader compiles and buffer uploads into
  loading; enemy geometry cached; one-shot audio nodes pooled;
  `ColliderWorld.all()` cached — minimal per-frame garbage
- 3D spatial audio: train rumble, konbini ambience, platform PA, enemy
  gunfire (`THREE.PositionalAudio`)
- Train event loop every 40–60 s: headlights → arrival → braking → dwell →
  doors (linked platform doors) → departure — station maps only
- Kill feedback: bullet-hole decals + sparks/smoke/debris + hit sound +
  HIT marker + slight camera shake + headshot/finisher slow-mo (no gore)
