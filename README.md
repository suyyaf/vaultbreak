# VAULTBREAK

A desktop and landscape-mobile browser FPS built with Babylon.js, TypeScript, and Vite. Rigged CC0 soldiers and infected are combined with procedural weapons, environments, regional hitboxes, and automatic geometry fallbacks.

## Run

```sh
npm install
npm run dev
# In a second terminal:
npm run server
```

Open the local URL printed by Vite. Click **Deploy** to lock the pointer and play.

## Controls

- **WASD:** move
- **Mouse:** aim
- **Left click:** fire
- **Right click:** aim down sights; red-dot-equipped weapons use a circular optical scope
- **Shift:** sprint
- **R:** reload with animated magazine swap
- **1 / 2:** switch primary and secondary weapons; each retains its own ammunition
- **3:** use a health pack (+50 HP, two carried)
- **4 / G:** throw a frag grenade (two carried; area damage, falloff, and cover bounces)
- **Space:** jump
- **C / Left Ctrl:** toggle crouch; while holding Shift, slide
- **Hold E near a downed teammate:** revive (3 seconds)
- **Esc:** pause / release pointer

## Modes

- **Dungeon Operation:** clear three connected chambers and defeat the Warden.
- **Zombie Survival:** fight endless escalating waves of infected. Walkers, runners, and heavy brutes are joined from wave two by Spitters, which telegraph and launch dodgeable acid projectiles blocked by cover. Each cleared wave starts a seven-second resupply break; health and ammo crates return near the first gate. Survive as long as possible solo or with your squad.

## Development roadmap

1. **Current — playable systems and visual pass:** dungeon, co-op, zombie survival, five distinct weapon models, tactical perks, infected variants, character movement, hit reactions, and boss attack telegraphs.
2. **Current — combat polish:** weapon-specific synthesized audio, smoother handling, responsive crosshair and hit feedback, and separated enemy hordes. Co-op tracks individual eliminations and resets downed players correctly.
3. **Next — balance and content:** weapon feel, enemy pacing, wave difficulty, UI, and performance based on complete solo/co-op playtests, followed by unlocks and new objectives.
4. **Later — expansion:** more weapons, maps, and objectives.

## Character assets and performance

Local GLB soldiers and infected use their original skeletal rigs and 17 animation clips, including movement, attacks, hit reactions, and persistent four-second death poses. Assets are cached once and instantiated per character. Zombie rigs change with their wave variant; invisible procedural head/torso/limb hitboxes retain regional damage. Failed asset loads retain the procedural fallback. See `public/assets/ATTRIBUTION.md` for CC0 provenance.

Touch devices render at 1.25 hardware scaling and skip bloom. Hidden rigs do not animate, and characters use normal frustum culling. Open `http://localhost:5173/#debug` for FPS, active meshes, draw calls, triangles, and loaded rigs. Real-device mobile profiling is still required; desktop browser automation is not a mobile GPU benchmark.

## Mobile

Landscape phones and tablets have dedicated multi-touch FPS controls: analog movement, drag aiming, hold-to-fire, ADS, sprint, reload, jump, crouch/slide, weapon switching, health packs, grenades, and pause. Menus use a compact landscape layout with safe-area spacing; portrait orientation displays a rotate prompt.

## Deployment and settings

The welcome screen leads to a separate deployment preparation screen. Choose the operation, one of four visible 3D operators, primary/secondary weapons, attachments, and an optional co-op room, then select **Start Deployment**. Back or Escape returns to the welcome screen without starting the game. Selecting an operator opens an isolated close-up inspection stage with an animated class-specific pose and specialty profile. **Tank** has 125 HP and can carry an AK-47 or M870 as a heavy secondary. Settings are available from both the welcome and Esc pause screens: master volume, field of view, mouse sensitivity, reduced camera motion, and fullscreen. Settings persist locally.

## Arsenal and perks

- **M4A1:** automatic rifle, 30 rounds, controllable recoil.
- **AK-47:** harder-hitting automatic rifle, 30 rounds, heavier recoil, slower fire and reload, distinct wood furniture and curved magazine.
- **MP5:** fast-firing SMG, 30 rounds, low recoil, 150-round reserve.
- **M9:** semi-automatic pistol, 15 rounds, high single-shot damage.
- **M870:** pump-action shotgun, six shells, eight simulated pellets, range falloff, animated pump.
- **Runner:** +15% movement speed.
- **Scavenger:** +50% reserve ammunition.
- **Juggernaut:** 125 maximum health with a slight speed penalty.
- **Combat Medic:** revive teammates in 1.5 seconds instead of 3, restoring 75 HP instead of 50.

Dungeon hostiles carry visible rifles with aiming poses and attack muzzle flashes. Infected have torn clothing, exposed wounds and ribs, crooked posture, reaching arms, and distinct Runner, Brute, and Spitter details.

Shots scale by hit region: **2× head, 1× torso, and 0.65× arms/legs**, using the actual impact point and enemy scale. Co-op validates and applies the same multipliers. Health packs and their resupply are server-authoritative in co-op.

Co-op includes a squad HUD with each player's health, downed state, and individual eliminations. Grenades are server-authoritative in co-op, including damage and elimination credit; collecting ammunition resupplies both carried grenades.

Zombie waves introduce fast, fragile runners, slow durable brutes, and ranged Spitters from wave two. Heavy infected and the Warden display an attack wind-up; Spitters use a glowing ground warning before launching acid. Co-op acid movement, collisions, cover blocking, and damage are server-authoritative.

Models remain intentionally low-poly; fine-tuning means better shape, readability, animation, and feedback rather than unnecessary detail.

## Prototype scope

A three-stage dungeon run with two combat chambers, a large Warden boss, gates, health/ammo supplies, six simple AI enemies per combat chamber, rifle and pistol combat, health, reloading, and complete/failure states. Choose a weapon and attachments (red dot, grip, extended magazine) before deploying; each changes the weapon's statistics and appearance. Online co-op supports 2–4 players. Create or enter a room code before deploying; other players enter the same code. The Node WebSocket server owns enemy AI, health, damage, and match results. Leave the room code blank for offline play.
