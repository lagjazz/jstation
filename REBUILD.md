# MISSION 04–15 WORLD REBUILD CONTRACT

Purpose: the current worlds (js/newAreas.js, newAreas2.js, newAreas3.js) are thinly-dressed
sealed box rooms and do NOT implement the designs in moremaps1.md / moremaps2.md.
Each world builder `_xxx()` must be REWRITTEN to match its design file. This document is
the acceptance checklist; the design files are the source of truth.

## Hard engine rules (do not break)

1. Per world keep: `this.bounds.<area>` interior rect, `SPAWN_POOLS.<area>` (6–7 anchors,
   inside walkable space, re-anchored to the NEW layout), `this.groups[area]` gating via
   `_g(area)` / `setVisible`, lights created with `scene.add(...)` (lightRig collects them
   as fixtures at boot — never add/remove point lights after boot, flicker = intensity).
2. Every solid prop: `addBox(..., { collide: world, raycast: rc })` (or manual
   `world.addBox` + `rc.push`). Nothing walkable/shootable through. Player stays inside
   bounds — outer perimeter walls (or invisible air walls) required on all sides.
3. Chunking is MANDATORY (moremaps2.md brief): in each builder call
   `this._grid(area, {x0,z0,x1,z1}, 17)` once, then put props into
   `this._cell(area, x, z)` instead of `G`; backdrops / world-spanning InstancedMesh /
   animated dome+sky go into `this._core(area)`. Colliders & rc arrays stay global.
4. InstancedMesh (MANDATORY for repeats): railings, containers, gears' teeth, columns,
   cables, pipes, coral, rocks, struts, lanterns — one draw call per repeated family.
5. LOD (moremaps2.md brief): distant decor clusters (background silhouettes, cliff
   ranges, far gear fields) use `lodNode(hiGroup, loGroup, 55)` from mapChunks.js
   (bboxProxy() makes a cheap far stand-in).
6. Arena sizes: play areas may grow to 60–84 m (update bounds + spawn + config atmo
   consistently); background/LOD layers carry the "kilometers" feel. Camera far / fog
   come from MISSIONS[].atmo in config.js — adjust them if a map grows.
7. Player mechanics hooks already wired in game.js (do not re-implement in worlds):
   - `mods.gravityScale / jumpScale / speedScale / underwater / zeroG / ice / bounce /
     sandstorm / emp / gapScale` (existing)
   - NEW: `mods.traps` → push zones into `this.quicksand = {x,z,r}` (slow 0.45)
   - NEW: `mods.currents` → push into `this.currents = {x,z,dx,dz,r,power}`
   - NEW: `mods.gears` → push into `this.gearSpin = {x,z,top,r,omega}` (player carried)
   - NEW: `mods.hazards` → push into `this.gearSpin`'s sibling `this.hazards = {x,z,y,r,dmg}`
   - Boulder trap: mesh `userData.fallTrap = <index>` + register
     `this.fallTraps.push({mesh, rock, falling:false, t:0})`; animate the rock fall in an
     updater (gravity ~18 m/s², land at y=0, dust puff via this.p.dust, then stay).
   - Icicles (ice): existing `this.icicles` / `userData.icicle` pattern — keep.
   - Steam vents: `this.vents.push({x,z,r,power})`. Bounce pads: newAreas2 `.bouncePads`.
   - Water orbs: newAreas3 `.orbs = {x,y,z,r}`. Cargo rect: newAreas2 `.cargo`.
   - Shark: implement INSIDE the aquarium updater using `ctx` (update(dt, ctx)):
     ctx = { feet, damage(n), respawnPlayer(), shake, flash, particles, audio }.
8. Perf budget: pooled PointShaderMaterials (pointField), cachedBox, ≤ ~450 draw calls
   per mission at the arena center. Textures: canvas `tex()` kit in newAreas.js.
9. After rewrite: `node --check` each file, then headless smoke (capture script) with
   zero pageerror and non-black screenshots from spawn + center views.
10. Keep code comments in the file's existing voice; no TODOs; no dead code.

## MISSION 04 · 電脳九龍 cyber (moremaps1.md §1)

Vertical neon Kowloon alley, NOT a wide plaza: main alley 10–14 m wide, flanked by 6–9
building blocks 20–30 m tall (raise wall to ~30 m); ground = wet asphalt: dark floor mat,
roughness ~0.15 + clearcoat (env reflections mirror the neon); 8–12 holo ad planes
(holoMat, big, stacked on facades) + dense neon trims/kanji signs; breakable neon boxes
(`userData.shatter`, glass tag) wired with spark particle at break (already routed);
MULTI-LEVEL FIGHTING: continuous scaffold walkways at y≈4.5 and 8 m along facades with
0.45 m step-box stair/ladders reachable from ground + ramps on second level; instanced
cables/pipes/lanterns/AC units overhead; 5–8 flying-vehicle streak light trails crossing
sky lanes; puddle mirrors optional via glossy strips.

## MISSION 05 · 月面基地 moon (moremaps1.md §2)

White-gray modular base under a dome: replace flat ceiling with a real dome
(hemisphere, panel texture); ONE BROKEN VIEWPORT WALL (frame + cracked glass shards,
shatter) looking out onto a slowly ROTATING Earth sphere (r≈40) in starfield (core group,
outside bounds — keep within farClip/fogFar=210); 4–6 white habitat pods connected by
short corridors (interior corner rooms for CQB); ONE GIANT CENTRIFUGE (r 6–8, torus +
spokes + 3 pods, slow spin, walkable ring base); zero-g: 8–12 slow tumbling debris chunks
(slow rotate/drift updaters) + fine dust field; blinking red emergency lights (intensity
flicker fixtures) + power-out flicker on one habitat lamp; airlock + shootable switch +
annex: keep existing door mechanic, move into new layout; gravityScale 0.38 stays.

## MISSION 06 · 黄金の墓 tomb (moremaps1.md §3)

Maze + treasure, not one hall: entrance corridor → pillared hall → burial chamber
(rectangular inner walls forming 3–4 corridor bends; sight lines ≤ 25 m); 12–16 ROUND
sandstone columns (cylinders r≈1.2, h 9, capital boxes) with hiero texture on walls AND
columns; central golden sarcophagus (outer chest + gold inner coffin + lapis band +
mask-shaped head plane) on raised dais; treasure: 4–6 heaps = instanced coins + gold
bowls/vases (torus/cylinder) + treasure chests, big pile volume near walls + chamber;
TORCHES: 10–14 wall sconces (post + flame cone additive) each with a flicker-modulated
PointLight fixture (nearest-16 pool keeps cost); 2 MECHANISMS: scarab relief plates on
columns with `userData.fallTrap` → boulder falls from ceiling corridor onto the corridor
(floor-animated rock, r≈1.6); 2 QUICKSAND pits `quicksand` zones (sunken sand disc,
particles) in side corridors; set config mods: { traps: true }.

## MISSION 07 · 天空港 skyport (moremaps1.md §4)

Open brass harbor above a cloud sea: NO visible walls — perimeter is brass railing +
INVISIBLE air walls (glass-tag or thin invisible box, keep colliders + bounds); CLOUD SEA
= giant animated plane (fbm-ish shader, slow drift, in core group) at y≈−12 under the
deck + FogExp2-style murk via linear fog (fogNear 20 fogFar 150, bg 'cloud'); deck =
bronze/brass platforms (3 levels connected by plank ramps + stairs) with rivets texture;
3–4 GIANT AIRSHIPS: yellow canvas envelopes (capsule/scaled spheres, breathing vertex
shader), rigging lines + gondolas anchored to mooring masts; GEAR MACHINERY: 4–6 exposed
brass gear clusters (instanced teeth, counter-rotating, transmission ratios via parent
nodes) on deck walls/cranes; STEAM: 6–10 pipe nozzles with white smoke puffs on timer +
3 launch vents `this.vents` (keep); fake god-ray cones (additive, sun tint) 2–3; keep
THEME_BG 'cloud' + moon sun disc bright.

## MISSION 08 · 量子実験室 lab (moremaps1.md §5)

White minimal: thin-line wall panels (panel texture with recessed light strips), polished
near-mirror floor (dark grey, roughness 0.1 + env), ONE FULL mirror wall (MeshPhysical:
metalness 0.9 roughness 0.05 = one-way mirror look) + 2 glass partitions (transmission
mat); core room open with zero cover at center (wide duel sightlines) — cover only along
walls (consoles, low cabinets); QUANTUM CORE: floating (no pedestal!) transparent body —
inner glowing icosahedron + outer fresnel shell + ripple rings spreading via shader
(expanding torus alpha wave); EMP pulse (existing mods.emp) + core flash sync; ceiling
light coves; keep elite roster.

## MISSION 09 · 沈没大陸 atlantis (moremaps1.md §6)

Underwater temple field: GREEK RUINS — 10–14 marble columns (fluted: cylinder + capital)
in 2 colonnades + broken pediment wall + fallen column drums (cylinders on side) as
cover; OBELISKS: 3–4 dark stone obelisks with glowing blue seam strips (emissive);
CORAL+KELP: instanced coral fans (cones) on columns/rubble + instanced kelp strips
(vertex sway shader); FISH: 12–20 glowing fish (instanced, slow orbit groups); CAUSTICS:
existing caustic overlay planes on floor AND large vertical overlays near temple faces
(2 sets, different scale); bubbles ambient field; WATER CURRENT CHANNELS: 3 lanes
`this.currents` (visible streak bubble strips along the seabed, power 6–8) connecting
spawn → temple → obelisk plaza; keep underwater mods + add currents:true in config.

## MISSION 10 · 極夜破冰船 ice (moremaps2.md §1) — grow arena to ~76 m wide

THREE ZONES: (1) THE ICEBREAKER (center, along X, ~30 m long): hull box with bow wedge,
3 decks — lower interior = corridor rooms (bulkhead walls, door gaps, CQB), upper bridge
+ RADAR MAST high point (walkable top platform y≈9, catwalks to it via side stairs),
warm interior lights; (2) GLACIER CLIFFS both sides: two faceted blue wall ridges
(instanced angular chunks, LOD far stand-ins) up to 20 m, with 6–8 shootable icicles
(keep icicles pattern) above enemy anchors; (3) FROZEN SEA floor: splat material
(splatShader: snow/ice/rock) + pressure-ridge instanced ice blades; aurora dome shader
(keep, make it cover full sky), blizzard point field (keep), 2 searchlight beams: Spot-
like fake light columns (additive cones from mast, slow sweep) whose patch moves on the
ice; ice mod (slippery) stays; radar platform = enemy marksman anchor.

## MISSION 11 · 軌道ターミナル orbit (moremaps2.md §2)

True RING platform: walkable annulus (inner r≈12, outer r≈30, centered on arena) built
as ring deck plates + INNER/OUTER hollow railings (instanced balusters — see-through);
center = OPEN VOID down to a rotating Earth (big sphere r≈120 below, slow rotate + cloud
shell, core group, farClip ≥ 600 stays); CENTER ELEVATOR: cable pillar r≈3 climbing out
of the ring center + docking arms; TRAFFIC: cargo train on a rail chord ACROSS the deck
(keep cargo rect mechanic, add visible rail + cars), 6–10 hover carts circling rails,
4–6 drones; CONTAINER YARD: 30–50 instanced containers stacked in rows + struts under
the deck (instanced, 100+); ring corners outside annulus: gantry arms / docking pads
(walkable) so the square bounds stay justified; NO exterior walls (air walls at bounds,
invisible) + bounds clamp stays.

## MISSION 12 · 世界樹の冠 canopy (moremaps2.md §3)

Fight HIGH: main walkable layer = boardwalk grid at y≈6.5 (wood plank paths + 3 alloy
observation platforms y≈8.5/10), connected over branch cylinders (3.5 m wide, walkable,
arc between trunks); below: dark forest floor visible with mushroom/fern props (drop off
= land on floor, bounce nets optional) + lower route y0 for variety; GIANT TRUNKS: 4–6
(super cylinder r 2.5–4, LOD bark), 2 HOLLOW (open tube interiors = straight sniper
corridors through the trunk); LEAVES: instanced big glowing discs with wind vertex shader
(keep) + LOD far billboard clusters; DOME: triangular glass panel sky (icosphere wire +
translucent skin, core) + 3–4 volumetric sunbeam cones through it; mecha-bugs: keep point
field + add 4–6 instanced glowing insect shells with orbit updaters; bounce pads: keep
(leaf springs from ground floor up to the boardwalk); enemy anchors mostly on the
walkways/branches.

## MISSION 13 · 錆の峡谷 canyon (moremaps2.md §4) — grow arena to ~72 m

CLIFF WALLS: instanced angular red-sandstone chunks stacked along X0/X1 sides up to 18 m
(LOD far range silhouettes in core); THE WRECK: kilometer feel — main hull cylinder
(r≈6, length ~46 across the arena, broken: 3 hull segments with gaps + buckled plates),
2 giant engine NOZZLE bells at the stern casting long shadows (moon direction along the
canyon), tail fin; INTERIOR: inside the hull = narrow dark corridor (ribs, low light
strips, CQB) with two breach holes to the outside; ROOF: hull top = open sniper roost
(walkable via cargo-box stairs); props: half-buried hull plates, instanced crates,
dunes; rust: hull material = splatShader(base paint, rust noise) or vertex-noise mix;
sandstorm cycle: keep sandstorm value + particle wall (denser, streaked), fog values in
config stay; sunset: bg 'rust' + long shadow direction.

## MISSION 14 · 無重力水槽 aquarium (moremaps2.md §5)

Rectangular neon hall (keep shell) +: WATER ORBS: 5–7 fresnel spheres (keep .orbs)
varied r 3–7, some with glow-jelly INSIDE; JELLYFISH: 10–15 instanced glowing bells +
tentacle strips, slow bob/drift updaters (several near orbs); MEGALODON: a real
mechanical SHARK mesh (box-built: body/cone snout/dorsal fin/tail, red eye lights,
r≈4 long) on an overhead patrol circuit + periodic dive-lunge toward ONE hunted orb:
when player is within ~4 m of the hunted orb during the lunge window → ctx.damage(40) +
ctx.flash + ctx.respawnPlayer() + 'swallowed' alert (audio 'land' rate low), then
the shark relocates its hunt target; CAUSTIC WALL GLOW: causticMat overlay panels
covering the 4 inner walls (slow animated mottled cyan), dimmed (bloom 0.5 stays);
PLATFORMS: 4–6 observation decks (grating platforms + railings) at y 2/4.5/7 with jet
routes between them; jetpack (zeroG) stays.

## MISSION 15 · 歯車の煉獄 clockwork (moremaps2.md §6)

No sky — ALL directions gear-walls: 2 rotating wall-gear backdrops per side (huge discs
in the walls, core group, LOD); FLOOR = 3–5 big floor gears (r 8–13) that actually carry
the player: register `gearSpin` {x,z,top,r,omega} with proper transmission ratios
(omega_i*r_i equal magnitude, alternating sign — parent-driven); at each pair's MESH
POINT: `hazards` entry {x,z,y:0.35,r:1.2,dmg:85} + visual: teeth interpenetration +
spark point; GOTHEC CITIES: 2 stadium-sized gears (r≈13) carry small gothic buildings
(spire boxes, buttresses) riding on them (children of the gear group → they orbit);
stepping gears: 8–12 manhole-size gears (r 1.5–3) at y 1.2–4 as jump plates (spinning);
pendulum/escapement arm crossing the hall (throttled swing); brass dust (keep), warm
dusk lighting (keep), config mods: { gears: true, hazards: true }.
