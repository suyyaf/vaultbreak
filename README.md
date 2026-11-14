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

1. **Current — playable systems:** dungeon, co-op, and zombie survival; fix mechanics as they are added.
2. **Next — model and animation pass:** more readable low-poly weapon silhouettes, distinct infected variants, character movement, hit reactions, and boss attack telegraphs.
3. **Then — balance and polish:** weapon feel, enemy pacing, wave difficulty, audio, UI, and performance based on complete solo/co-op playtests.
4. **Later — expansion:** more weapons, maps, objectives, and progression after the core modes are stable.

Models remain intentionally low-poly; fine-tuning means better shape, readability, animation, and feedback rather than unnecessary detail.

## Prototype scope

A three-stage dungeon run with two combat chambers, a large Warden boss, gates, health/ammo supplies, six simple AI enemies per combat chamber, rifle and pistol combat, health, reloading, and complete/failure states. Choose a weapon and attachments (red dot, grip, extended magazine) before deploying; each changes the weapon's statistics and appearance. Online co-op supports 2–4 players. Create or enter a room code before deploying; other players enter the same code. The Node WebSocket server owns enemy AI, health, damage, and match results. Leave the room code blank for offline play.
