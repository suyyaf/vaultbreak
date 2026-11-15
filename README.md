# VAULTBREAK

A small desktop-browser FPS prototype built with Babylon.js, TypeScript, and Vite. Everything in the dungeon, including enemies and weapons, is generated from low-poly geometry—no external game assets required.

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
- **Right click:** aim down sights
- **Shift:** sprint
- **R:** reload with animated magazine swap
- **Space:** jump
- **C / Left Ctrl:** toggle crouch; while holding Shift, slide
- **Hold E near a downed teammate:** revive (3 seconds)
- **Esc:** pause / release pointer

## Modes

- **Dungeon Operation:** clear three connected chambers and defeat the Warden.
- **Zombie Survival:** fight endless escalating waves of melee infected. Each cleared wave starts a seven-second resupply break; health and ammo crates return near the first gate. Survive as long as possible solo or with your squad.

## Development roadmap

1. **Current — playable systems and visual pass:** dungeon, co-op, zombie survival, three distinct weapon models, tactical perks, infected variants, character movement, hit reactions, and boss attack telegraphs.
2. **Current — combat polish:** weapon-specific synthesized audio, smoother handling, responsive crosshair and hit feedback, and separated enemy hordes. Co-op tracks individual eliminations and resets downed players correctly.
3. **Next — balance and content:** weapon feel, enemy pacing, wave difficulty, UI, and performance based on complete solo/co-op playtests, followed by unlocks and new objectives.
4. **Later — expansion:** more weapons, maps, and objectives.

## Arsenal and perks

- **M4A1:** automatic rifle, 30 rounds, controllable recoil.
- **MP5:** fast-firing SMG, 30 rounds, low recoil, 150-round reserve.
- **M9:** semi-automatic pistol, 15 rounds, high single-shot damage.
- **M870:** pump-action shotgun, six shells, eight simulated pellets, range falloff, animated pump.
- **Runner:** +15% movement speed.
- **Scavenger:** +50% reserve ammunition.
- **Juggernaut:** 125 maximum health with a slight speed penalty.
- **Combat Medic:** revive teammates in 1.5 seconds instead of 3, restoring 75 HP instead of 50.

Co-op includes a squad HUD with each player's health, downed state, and individual eliminations.

Zombie waves introduce fast, fragile runners and slow, durable brutes from wave two. Heavy infected and the Warden display an attack wind-up before dealing damage.

Models remain intentionally low-poly; fine-tuning means better shape, readability, animation, and feedback rather than unnecessary detail.

## Prototype scope

A three-stage dungeon run with two combat chambers, a large Warden boss, gates, health/ammo supplies, six simple AI enemies per combat chamber, rifle and pistol combat, health, reloading, and complete/failure states. Choose a weapon and attachments (red dot, grip, extended magazine) before deploying; each changes the weapon's statistics and appearance. Online co-op supports 2–4 players. Create or enter a room code before deploying; other players enter the same code. The Node WebSocket server owns enemy AI, health, damage, and match results. Leave the room code blank for offline play.
