export interface GrenadeState {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  explodeAt: number;
  owner: string;
}

export const GRENADE_CAPACITY = 2;
export const GRENADE_DAMAGE = 150;
export const GRENADE_RADIUS = 5;
export const GRENADE_FUSE_MS = 1800;

export interface AcidProjectile {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  expiresAt: number;
}

export const SPIT_SPEED = 11;

export function grenadeDamage(distance: number) {
  return Math.round(GRENADE_DAMAGE * Math.max(0.2, 1 - distance / GRENADE_RADIUS));
}
