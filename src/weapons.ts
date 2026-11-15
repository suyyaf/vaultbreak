export type WeaponId = 'rifle' | 'ak' | 'smg' | 'pistol' | 'shotgun';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  mode: string;
  damage: number;
  magazine: number;
  reserve: number;
  fireDelay: number;
  reloadMs: number;
  automatic: boolean;
  spread: number;
  recoil: number;
  pellets: number;
  range: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rifle: { id: 'rifle', name: 'M4A1', mode: 'AUTO', damage: 34, magazine: 30, reserve: 120, fireDelay: 110, reloadMs: 1600, automatic: true, spread: 0.006, recoil: 0.006, pellets: 1, range: 60 },
  ak: { id: 'ak', name: 'AK-47', mode: 'AUTO', damage: 42, magazine: 30, reserve: 120, fireDelay: 140, reloadMs: 1950, automatic: true, spread: 0.009, recoil: 0.009, pellets: 1, range: 65 },
  smg: { id: 'smg', name: 'MP5', mode: 'AUTO', damage: 26, magazine: 30, reserve: 150, fireDelay: 85, reloadMs: 1450, automatic: true, spread: 0.008, recoil: 0.0045, pellets: 1, range: 45 },
  pistol: { id: 'pistol', name: 'M9', mode: 'SEMI', damage: 50, magazine: 15, reserve: 60, fireDelay: 240, reloadMs: 1200, automatic: false, spread: 0.004, recoil: 0.009, pellets: 1, range: 50 },
  shotgun: { id: 'shotgun', name: 'M870', mode: 'PUMP', damage: 18, magazine: 6, reserve: 36, fireDelay: 850, reloadMs: 2100, automatic: false, spread: 0.085, recoil: 0.025, pellets: 8, range: 24 },
};

export interface Loadout {
  optic: boolean;
  grip: boolean;
  magazine: boolean;
}

export function getWeapon(id: WeaponId, loadout: Loadout): WeaponSpec {
  const base = WEAPONS[id] ?? WEAPONS.rifle;
  return {
    ...base,
    magazine: base.magazine + (loadout.magazine ? Math.ceil(base.magazine * 0.5) : 0),
    spread: base.spread * (loadout.optic ? 0.75 : 1),
    recoil: base.recoil * (loadout.grip ? 0.65 : 1),
  };
}
