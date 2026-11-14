export type WeaponId = 'rifle' | 'pistol';

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
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rifle: { id: 'rifle', name: 'M4A1', mode: 'AUTO', damage: 34, magazine: 30, reserve: 120, fireDelay: 110, reloadMs: 1600, automatic: true, spread: 0.006, recoil: 0.006 },
  pistol: { id: 'pistol', name: 'M9', mode: 'SEMI', damage: 50, magazine: 15, reserve: 60, fireDelay: 240, reloadMs: 1200, automatic: false, spread: 0.004, recoil: 0.009 },
};

export interface Loadout {
  optic: boolean;
  grip: boolean;
  magazine: boolean;
}

export function getWeapon(id: WeaponId, loadout: Loadout): WeaponSpec {
  const base = WEAPONS[id];
  return {
    ...base,
    magazine: base.magazine + (loadout.magazine ? Math.ceil(base.magazine * 0.5) : 0),
    spread: base.spread * (loadout.optic ? 0.75 : 1),
    recoil: base.recoil * (loadout.grip ? 0.65 : 1),
  };
}
