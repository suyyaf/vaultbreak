import '@babylonjs/loaders/glTF/2.0';
import {
  AnimationGroup, AssetContainer, Color3, PBRMaterial, Scene,
  SceneLoader, TransformNode,
} from '@babylonjs/core';
import { PerkId } from './perks';

export type CharacterKind = PerkId | 'hostile' | 'walker' | 'infectedRunner' | 'brute' | 'spitter';

export interface CharacterAsset {
  root: TransformNode;
  animations: Map<string, AnimationGroup>;
  current?: AnimationGroup;
  play: (name: string, loop?: boolean, speed?: number) => void;
  dispose: () => void;
}

const MODELS: Record<CharacterKind, { file: string; height: number; tint?: Color3 }> = {
  runner: { file: 'soldier-female', height: 1.85, tint: new Color3(0.7, 0.9, 0.5) },
  scavenger: { file: 'soldier-male', height: 1.95, tint: new Color3(0.95, 0.78, 0.5) },
  juggernaut: { file: 'soldier-male', height: 2.1, tint: new Color3(0.7, 0.82, 0.9) },
  medic: { file: 'soldier-female', height: 1.9, tint: new Color3(0.55, 0.95, 0.95) },
  hostile: { file: 'soldier-male', height: 1.95, tint: new Color3(0.48, 0.54, 0.44) },
  walker: { file: 'zombie-male', height: 1.9 },
  infectedRunner: { file: 'zombie-female', height: 1.8 },
  brute: { file: 'zombie-male', height: 2.1, tint: new Color3(0.8, 0.95, 0.75) },
  spitter: { file: 'zombie-female', height: 1.9, tint: new Color3(0.75, 1, 0.55) },
};

const containers = new Map<string, Promise<AssetContainer>>();

function loadContainer(scene: Scene, file: string) {
  let request = containers.get(file);
  if (!request) {
    request = SceneLoader.LoadAssetContainerAsync('/assets/characters/', `${file}.glb`, scene);
    containers.set(file, request);
    request.catch(() => containers.delete(file));
  }
  return request;
}

export async function loadCharacter(scene: Scene, kind: CharacterKind, parent: TransformNode): Promise<CharacterAsset> {
  const spec = MODELS[kind];
  const container = await loadContainer(scene, spec.file);
  const instances = container.instantiateModelsToScene((name) => `${kind}:${name}`, false, { doNotInstantiate: false });
  const root = new TransformNode(`${kind} character`, scene);
  root.parent = parent;
  for (const node of instances.rootNodes) node.parent = root;
  const meshes = root.getChildMeshes(false);
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    for (const material of mesh.material instanceof PBRMaterial ? [mesh.material] : []) {
    }
    mesh.isVisible = true;
    mesh.visibility = 1;
    mesh.computeWorldMatrix(true);
    if (mesh.material instanceof PBRMaterial) {
      if (spec.tint && mesh.material.name === 'Main') mesh.material.albedoColor = spec.tint;
      mesh.material.metallic = 0;
      mesh.material.roughness = 0.85;
      mesh.material.environmentIntensity = 0.5;
      mesh.material.directIntensity = 0.9;
    }
  }
  root.scaling.setAll(spec.height / 1.8);
  root.rotation.y = 0;
  const animations = new Map(instances.animationGroups.map((group) => [group.name.split(':').pop()!, group]));
  const asset: CharacterAsset = {
    root,
    animations,
    play(name, loop = true, speed = 1) {
      const next = animations.get(name) ?? animations.get('Idle');
      if (!next) return;
      if (asset.current === next) { if (!next.isPlaying) next.start(loop, speed); return; }
      asset.current?.stop();
      next.start(loop, speed);
      asset.current = next;
    },
    dispose() {
      for (const group of instances.animationGroups) group.dispose();
      for (const node of instances.rootNodes) node.dispose(false, true);
      root.dispose();
    },
  };
  asset.play('Idle');
  return asset;
}

export async function preloadCharacters(scene: Scene) {
  await Promise.allSettled([...new Set(Object.values(MODELS).map((spec) => spec.file))].map((file) => loadContainer(scene, file)));
}

export function characterClip(kind: CharacterKind, moving: boolean, attacking: boolean, hit: boolean) {
  if (hit) return 'RecieveHit';
  if (attacking) return kind === 'hostile' ? 'Shoot_OneHanded' : 'Punch';
  if (moving) return kind === 'runner' || kind === 'infectedRunner' || kind === 'brute' ? 'Run' : 'Walk_Carry';
  return 'Idle';
}
