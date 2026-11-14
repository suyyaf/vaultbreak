export type PerkId = 'runner' | 'scavenger' | 'juggernaut';
export interface Perk {
  id: PerkId;
  name: string;
  description: string;
  speed: number;
  maxHealth: number;
  ammo: number;
}
export const PERKS: Record<PerkId, Perk> = {
  runner: { id: 'runner', name: 'RUNNER', description: '+15% movement speed', speed: 1.15, maxHealth: 100, ammo: 1 },
  scavenger: { id: 'scavenger', name: 'SCAVENGER', description: '+50% reserve ammunition', speed: 1, maxHealth: 100, ammo: 1.5 },
  juggernaut: { id: 'juggernaut', name: 'JUGGERNAUT', description: '125 maximum health', speed: 0.95, maxHealth: 125, ammo: 1 },
};
