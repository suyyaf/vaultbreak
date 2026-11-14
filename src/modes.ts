export type GameMode = 'dungeon' | 'zombies';
export const ZOMBIE_POOL_SIZE = 48;
export const ZOMBIE_SPAWNS = Array.from({ length: ZOMBIE_POOL_SIZE }, (_, id) => ({
  id,
  x: [-11, -6, 0, 6, 11][id % 5],
  z: [-18, -11, 8, 18][Math.floor(id / 5) % 4],
}));
export const zombieWaveSize = (wave: number) => Math.min(ZOMBIE_POOL_SIZE, 6 + wave * 3);
export const zombieHealth = (wave: number) => Math.min(220, 70 + wave * 10);
