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
  stop: () => void;
  dispose: () => void;
}

const MODELS: Record<CharacterKind, { file: string; height: number; tint?: Color3; skin?: Color3 }> = {
  runner: { file: 'soldier-female', height: 1.85, tint: new Color3(0.62, 0.82, 0.44) },
  scavenger: { file: 'soldier-male', height: 1.95, tint: new Color3(0.82, 0.62, 0.3) },
  juggernaut: { file: 'soldier-male', height: 2.1, tint: new Color3(0.4, 0.52, 0.62) },
  medic: { file: 'soldier-female', height: 1.9, tint: new Color3(0.32, 0.7, 0.72) },
  hostile: { file: 'soldier-male', height: 1.95, tint: new Color3(0.34, 0.39, 0.31) },
  walker: { file: 'zombie-male', height: 1.9, skin: new Color3(0.42, 0.48, 0.3) },
  infectedRunner: { file: 'zombie-female', height: 1.8, skin: new Color3(0.52, 0.31, 0.2) },
  brute: { file: 'zombie-male', height: 2.1, skin: new Color3(0.3, 0.4, 0.27) },
  spitter: { file: 'zombie-female', height: 1.9, skin: new Color3(0.3, 0.55, 0.2) },
};

const containers = new Map<string, Promise<AssetContainer>>();
const variants = new Map<CharacterKind, Map<number, PBRMaterial>>();

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
  let variantMaterials = variants.get(kind);
  if (!variantMaterials) {
    variantMaterials = new Map();
    variants.set(kind, variantMaterials);
  }
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.isVisible = true;
    mesh.visibility = 1;
    if (mesh.material instanceof PBRMaterial) {
      let material = variantMaterials.get(mesh.material.uniqueId);
      if (!material) {
        material = mesh.material.clone(`${kind}:${mesh.material.name}`) as PBRMaterial;
        material.metallic = 0;
        material.roughness = 0.85;
        material.environmentIntensity = 0.5;
        material.directIntensity = 0.9;
        if (spec.tint && material.name.endsWith(':Main')) material.albedoColor = spec.tint;
        if (spec.skin && material.name.endsWith(':Skin')) material.albedoColor = spec.skin;
        variantMaterials.set(mesh.material.uniqueId, material);
      }
      mesh.material = material;
    }
  }
  const authoredHeight = Math.max(...meshes.map((mesh) => mesh.getBoundingInfo().boundingBox.maximum.y), 1);
  root.scaling.setAll(spec.height / authoredHeight);
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
    stop() {
      asset.current?.stop();
    },
    dispose() {
      for (const group of instances.animationGroups) group.dispose();
      for (const node of instances.rootNodes) node.dispose(false, true);
      root.dispose();
    },
  };
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
