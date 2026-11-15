export type PerkId = 'runner' | 'scavenger' | 'juggernaut' | 'medic';
export interface Perk {
  id: PerkId;
  name: string;
  description: string;
  speed: number;
  maxHealth: number;
  ammo: number;
  reviveMs: number;
  reviveHealth: number;
}
export const PERKS: Record<PerkId, Perk> = {
  runner: { id: 'runner', name: 'RUNNER', description: '+15% movement speed', speed: 1.15, maxHealth: 100, ammo: 1, reviveMs: 3000, reviveHealth: 50 },
  scavenger: { id: 'scavenger', name: 'SCAVENGER', description: '+50% reserve ammunition', speed: 1, maxHealth: 100, ammo: 1.5, reviveMs: 3000, reviveHealth: 50 },
  juggernaut: { id: 'juggernaut', name: 'JUGGERNAUT', description: '125 maximum health', speed: 0.95, maxHealth: 125, ammo: 1, reviveMs: 3000, reviveHealth: 50 },
  medic: { id: 'medic', name: 'COMBAT MEDIC', description: 'Revive in 1.5s with 75 HP', speed: 1, maxHealth: 100, ammo: 1, reviveMs: 1500, reviveHealth: 75 },
};
