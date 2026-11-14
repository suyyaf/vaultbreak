export type GameMode = 'dungeon' | 'zombies';
export const ZOMBIE_POOL_SIZE = 48;
export const ZOMBIE_SPAWNS = Array.from({ length: ZOMBIE_POOL_SIZE }, (_, id) => ({
  id,
  x: [-11, -6, 0, 6, 11][id % 5],
  z: [-18, -11, 8, 18][Math.floor(id / 5) % 4],
}));
export const zombieWaveSize = (wave: number) => Math.min(ZOMBIE_POOL_SIZE, 6 + wave * 3);
export type ZombieKind = 'walker' | 'runner' | 'brute';
export const zombieKind = (id: number, wave: number): ZombieKind => wave >= 2 && id % 9 === 0 ? 'brute' : wave >= 2 && id % 3 === 0 ? 'runner' : 'walker';
export const zombieHealth = (wave: number, kind: ZombieKind = 'walker') => Math.min(260, (60 + wave * 10) * (kind === 'brute' ? 2.4 : kind === 'runner' ? 0.7 : 1));
export const zombieSpeed = (wave: number, kind: ZombieKind) => Math.min(kind === 'runner' ? 4.2 : kind === 'brute' ? 1.4 : 3, (kind === 'runner' ? 2.8 : kind === 'brute' ? 1 : 1.6) + wave * 0.06);
export const zombieDamage = (kind: ZombieKind) => kind === 'brute' ? 22 : kind === 'runner' ? 8 : 12;
