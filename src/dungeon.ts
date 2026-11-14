export const STAGE_NAMES = ['THE SUNKEN VAULT', 'THE REACTOR GALLERY', 'THE WARDEN’S CHAMBER'];
export const GATE_Z = [-23, -69];
export const SUPPLIES = [
  { id: 0, x: -2, z: -19, kind: 'health' as const },
  { id: 1, x: 2, z: -19, kind: 'ammo' as const },
  { id: 2, x: -2, z: -65, kind: 'health' as const },
  { id: 3, x: 2, z: -65, kind: 'ammo' as const },
];
export const ENEMY_SPAWNS = [
  { stage: 0, boss: false, x: -5, z: -3 }, { stage: 0, boss: false, x: 6, z: -5 },
  { stage: 0, boss: false, x: -8, z: -16 }, { stage: 0, boss: false, x: 0, z: -18 },
  { stage: 0, boss: false, x: 8, z: -20 }, { stage: 0, boss: false, x: -2, z: 9 },
  { stage: 1, boss: false, x: -8, z: -38 }, { stage: 1, boss: false, x: 7, z: -42 },
  { stage: 1, boss: false, x: -5, z: -55 }, { stage: 1, boss: false, x: 6, z: -58 },
  { stage: 1, boss: false, x: 0, z: -62 }, { stage: 1, boss: false, x: 8, z: -33 },
  { stage: 2, boss: true, x: 0, z: -103 },
];
export const COVER = [
  { x: 0, z: 4, w: 5, d: 1.1 }, { x: -6, z: -7, w: 3.5, d: 1.2 }, { x: 6, z: -15, w: 3.5, d: 1.2 },
  { x: 0, z: -42, w: 5, d: 1.1 }, { x: -6, z: -53, w: 3.5, d: 1.2 }, { x: 6, z: -61, w: 3.5, d: 1.2 },
  { x: -7, z: -88, w: 3.5, d: 1.2 }, { x: 7, z: -99, w: 3.5, d: 1.2 },
];
for (const center of [0, -46, -92]) for (const x of [-9, 9]) for (const z of [center - 14, center, center + 14]) COVER.push({ x, z, w: 1.4, d: 1.4 });
