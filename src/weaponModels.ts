import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import { Loadout, WeaponSpec } from './weapons';

export interface WeaponModel {
  parts: Mesh[];
  magazine?: Mesh;
  muzzle: Mesh;
  pump?: TransformNode;
}

function mat(scene: Scene, color: Color3, emissive = 0) {
  const material = new StandardMaterial('weapon material', scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.16, 0.17, 0.15);
  material.emissiveColor = color.scale(emissive);
  return material;
}

export function buildWeaponModel(scene: Scene, gun: TransformNode, weapon: WeaponSpec, loadout: Loadout): WeaponModel {
  const parts: Mesh[] = [];
  const dark = mat(scene, new Color3(0.075, 0.085, 0.075));
  const metal = mat(scene, new Color3(0.24, 0.27, 0.25));
  const polymer = mat(scene, new Color3(0.13, 0.15, 0.12));
  const gripMat = mat(scene, new Color3(0.1, 0.095, 0.075));
  const glow = mat(scene, new Color3(0.8, 0.9, 0.36), 1.6);
  const flash = mat(scene, new Color3(1, 0.72, 0.18), 2.5);
  const add = (mesh: Mesh, parent: TransformNode = gun) => {
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    parts.push(mesh);
    return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = polymer, parent = gun) => {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    return add(mesh, parent);
  };
  const cylinder = (name: string, diameter: number, length: number, x: number, y: number, z: number, material = metal, parent = gun) => {
    const mesh = MeshBuilder.CreateCylinder(name, { diameter, height: length, tessellation: 10 }, scene);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.material = material;
    return add(mesh, parent);
  };

  let magazine: Mesh | undefined;
  let pump: TransformNode | undefined;
  let muzzleZ = -1.15;
  if (weapon.id === 'rifle') {
    box('M4 upper receiver', 0.16, 0.16, 0.55, 0, 0.015, -0.02, metal);
    box('M4 lower receiver', 0.135, 0.13, 0.37, 0, -0.105, 0.04, dark);
    box('M4 handguard', 0.145, 0.145, 0.54, 0, 0.025, -0.54, dark);
    for (let z = -0.77; z < -0.28; z += 0.075) box('handguard vent', 0.151, 0.027, 0.028, 0, 0.025, z, metal);
    box('M4 top rail', 0.075, 0.028, 1.03, 0, 0.116, -0.27, dark);
    for (let z = -0.73; z < 0.19; z += 0.075) box('rail tooth', 0.09, 0.018, 0.035, 0, 0.138, z, metal);
    cylinder('M4 barrel', 0.043, 0.36, 0, 0.025, -0.96);
    cylinder('M4 flash hider', 0.062, 0.1, 0, 0.025, -1.15, dark);
    muzzleZ = -1.24;
    box('M4 buffer tube', 0.085, 0.085, 0.4, 0, 0.015, 0.44, metal);
    box('M4 stock', 0.135, 0.21, 0.32, 0, -0.01, 0.65, polymer);
    box('M4 stock cutout', 0.142, 0.08, 0.17, 0, 0.015, 0.65, dark);
    box('M4 pistol grip', 0.105, 0.26, 0.125, 0, -0.235, 0.19, gripMat).rotation.x = -0.28;
    magazine = box('M4 magazine', 0.115, 0.3, 0.18, 0, -0.285, -0.09, dark);
    magazine.rotation.x = -0.17;
    box('M4 magazine floorplate', 0.135, 0.035, 0.2, 0, -0.145, 0, metal, magazine as unknown as TransformNode);
    box('M4 charging handle', 0.21, 0.035, 0.05, 0, 0.075, 0.27, dark);
    box('M4 front sight', 0.07, 0.105, 0.04, 0, 0.17, -0.77, dark);
  } else if (weapon.id === 'ak') {
    const wood = mat(scene, new Color3(0.32, 0.16, 0.065));
    box('AK receiver', 0.17, 0.18, 0.57, 0, 0, -0.02, metal);
    box('AK stamped cover', 0.15, 0.065, 0.55, 0, 0.115, -0.03, dark);
    box('AK wooden handguard', 0.17, 0.18, 0.43, 0, 0.015, -0.53, wood);
    for (const z of [-0.68, -0.38]) box('AK handguard band', 0.178, 0.19, 0.035, 0, 0.015, z, metal);
    cylinder('AK barrel', 0.05, 0.49, 0, 0.025, -0.94);
    cylinder('AK slant brake', 0.07, 0.12, 0, 0.025, -1.22, dark);
    cylinder('AK gas tube', 0.052, 0.48, 0, 0.115, -0.54, dark);
    box('AK front sight', 0.07, 0.15, 0.045, 0, 0.15, -1.04, dark);
    box('AK rear sight', 0.09, 0.055, 0.08, 0, 0.17, -0.27, dark);
    box('AK wooden stock', 0.15, 0.23, 0.58, 0, -0.055, 0.55, wood).rotation.x = 0.08;
    box('AK butt plate', 0.16, 0.245, 0.04, 0, -0.08, 0.855, dark);
    box('AK pistol grip', 0.11, 0.27, 0.135, 0, -0.23, 0.19, wood).rotation.x = -0.25;
    magazine = box('AK curved magazine', 0.125, 0.38, 0.18, 0, -0.285, -0.085, dark);
    magazine.rotation.x = -0.42;
    box('AK magazine lower curve', 0.13, 0.15, 0.18, 0, -0.13, 0.07, dark, magazine as unknown as TransformNode).rotation.x = 0.4;
    for (const y of [-0.12, 0, 0.12]) box('AK magazine rib', 0.132, 0.018, 0.185, 0, y, 0, metal, magazine as unknown as TransformNode);
    muzzleZ = -1.3;
  } else if (weapon.id === 'smg') {
    box('MP5 receiver', 0.17, 0.18, 0.58, 0, 0, -0.02, metal);
    box('MP5 stamped top', 0.15, 0.04, 0.62, 0, 0.105, -0.03, dark);
    cylinder('MP5 barrel shroud', 0.12, 0.34, 0, 0.015, -0.47, dark);
    cylinder('MP5 barrel', 0.042, 0.28, 0, 0.015, -0.73);
    cylinder('MP5 muzzle', 0.065, 0.08, 0, 0.015, -0.9, dark);
    box('MP5 hand stop', 0.08, 0.15, 0.11, 0, -0.105, -0.46, gripMat).rotation.x = -0.2;
    box('MP5 pistol grip', 0.115, 0.26, 0.14, 0, -0.225, 0.17, gripMat).rotation.x = -0.3;
    magazine = box('MP5 curved magazine', 0.105, 0.33, 0.15, 0, -0.25, -0.09, dark);
    magazine.rotation.x = -0.24;
    box('MP5 magazine ribs', 0.112, 0.21, 0.03, 0, -0.035, 0.08, metal, magazine as unknown as TransformNode);
    box('MP5 stock rail', 0.07, 0.07, 0.43, 0, 0.025, 0.48, metal);
    box('MP5 compact stock', 0.14, 0.19, 0.27, 0, -0.02, 0.7, polymer);
    box('MP5 rear sight drum', 0.15, 0.12, 0.09, 0, 0.17, 0.19, dark);
    box('MP5 front sight', 0.13, 0.15, 0.04, 0, 0.13, -0.68, dark);
    box('MP5 charging handle', 0.19, 0.045, 0.05, -0.05, 0.075, -0.36, dark).rotation.z = 0.25;
    muzzleZ = -0.98;
  } else if (weapon.id === 'pistol') {
    box('M9 slide', 0.145, 0.145, 0.64, 0, 0.045, -0.16, metal);
    box('M9 frame', 0.13, 0.115, 0.55, 0, -0.06, -0.1, dark);
    box('M9 open barrel', 0.065, 0.035, 0.36, 0, 0.12, -0.23, dark);
    cylinder('M9 muzzle', 0.055, 0.055, 0, 0.045, -0.505, dark);
    box('M9 grip', 0.125, 0.33, 0.19, 0, -0.245, 0.11, gripMat).rotation.x = -0.16;
    magazine = box('M9 magazine', 0.075, 0.25, 0.13, 0, -0.25, 0.105, metal);
    magazine.rotation.x = -0.16;
    box('M9 trigger guard', 0.06, 0.12, 0.17, 0, -0.145, -0.11, dark);
    box('M9 trigger opening', 0.065, 0.075, 0.11, 0, -0.145, -0.11, polymer);
    box('M9 rear sight', 0.13, 0.035, 0.035, 0, 0.138, 0.12, dark);
    box('M9 front sight', 0.035, 0.035, 0.04, 0, 0.138, -0.43, dark);
    muzzleZ = -0.57;
  } else {
    box('M870 receiver', 0.16, 0.2, 0.48, 0, 0, 0.08, metal);
    box('M870 ejection port', 0.165, 0.07, 0.21, 0, 0.035, -0.01, dark);
    cylinder('M870 barrel', 0.055, 0.95, 0, 0.065, -0.57, metal);
    cylinder('M870 tube magazine', 0.065, 0.72, 0, -0.04, -0.47, dark);
    pump = new TransformNode('M870 pump', scene);
    pump.parent = gun;
    box('M870 ribbed forend', 0.17, 0.16, 0.38, 0, -0.04, -0.51, gripMat, pump);
    for (let z = -0.67; z < -0.34; z += 0.045) box('pump rib', 0.178, 0.165, 0.016, 0, -0.04, z, dark, pump);
    box('M870 stock', 0.145, 0.23, 0.55, 0, -0.07, 0.57, gripMat).rotation.x = 0.1;
    box('M870 recoil pad', 0.16, 0.25, 0.055, 0, -0.105, 0.855, dark);
    box('M870 bead sight', 0.035, 0.035, 0.04, 0, 0.125, -0.99, glow);
    muzzleZ = -1.09;
  }

  if (loadout.optic && weapon.id !== 'pistol') {
    const z = weapon.id === 'shotgun' ? 0.06 : -0.06;
    const y = weapon.id === 'shotgun' ? 0.22 : 0.23;
    box('optic riser', 0.09, 0.08, 0.16, 0, y - 0.08, z, dark);
    box('red dot housing', 0.14, 0.145, 0.17, 0, y, z, dark);
    box('red dot lens', 0.095, 0.095, 0.008, 0, y, z - 0.09, glow);
  }
  if (loadout.grip && weapon.id === 'rifle') box('vertical foregrip', 0.095, 0.25, 0.105, 0, -0.16, -0.5, gripMat).rotation.x = -0.12;
  if (loadout.grip && weapon.id === 'smg') box('MP5 foregrip', 0.1, 0.19, 0.1, 0, -0.14, -0.45, gripMat).rotation.x = -0.12;
  if (loadout.grip && weapon.id === 'ak') box('AK foregrip', 0.1, 0.22, 0.105, 0, -0.16, -0.52, gripMat).rotation.x = -0.12;
  if (loadout.magazine && magazine) magazine.scaling.y = 1.3;
  const muzzle = MeshBuilder.CreateCylinder('muzzle flash', { diameterTop: 0, diameterBottom: 0.19, height: 0.28, tessellation: 6 }, scene);
  muzzle.rotation.x = -Math.PI / 2;
  muzzle.position.set(0, weapon.id === 'shotgun' ? 0.065 : weapon.id === 'pistol' ? 0.045 : 0.025, muzzleZ);
  muzzle.material = flash;
  add(muzzle);
  muzzle.setEnabled(false);
  return { parts, magazine, muzzle, pump };
}
