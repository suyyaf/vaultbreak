import {
  Color3, Color4, DirectionalLight, Engine, GlowLayer, HemisphericLight,
  Mesh, MeshBuilder, Ray, Scene, SceneInstrumentation, StandardMaterial, TransformNode, UniversalCamera, Vector2, Vector3
} from '@babylonjs/core';
import { getWeapon, Loadout, WeaponId, WeaponSpec, WEAPONS } from './weapons';
import { ServerMessage, WorldState } from './network';
import { ENEMY_SPAWNS, GATE_Z, STAGE_NAMES, SUPPLIES } from './dungeon';
import { GameMode, ZombieKind, ZOMBIE_SPAWNS, zombieDamage, zombieHealth, zombieKind, zombieSpeed, zombieWaveSize } from './modes';
import { PerkId, PERKS } from './perks';
import { buildWeaponModel } from './weaponModels';
import { CombatAudio } from './audio';
import { CharacterAsset, CharacterKind, characterClip, loadCharacter, preloadCharacters } from './assets';
import { AcidProjectile, GrenadeState, GRENADE_CAPACITY, GRENADE_FUSE_MS, grenadeDamage, SPIT_SPEED } from './equipment';

export type GameState = 'menu' | 'playing' | 'paused' | 'won' | 'lost';
export interface GameEvents {
  onAmmo: (ammo: number, reserve: number) => void;
  onWeapon: (weapon: WeaponSpec) => void;
  onHealth: (health: number) => void;
  onEnemies: (remaining: number) => void;
  onHit: (killed: boolean) => void;
  onDamage: () => void;
  onReload: (reloading: boolean) => void;
  onMessage: (message: string) => void;
  onEnd: (won: boolean, kills: number, shots: number, seconds: number) => void;
  onPause: () => void;
  onRoom: (room: string, players: number) => void;
  onSquad: (players: { id: string; health: number; downed: boolean; kills: number }[]) => void;
  onRevive: (message: string, progress: number) => void;
  onStage: (stage: number, name: string) => void;
  onBoss: (health: number, maxHealth: number) => void;
  onObjective: (message: string) => void;
  onWave: (wave: number) => void;
  onSpread: (spread: number) => void;
  onGrenades: (count: number) => void;
  onMedkits: (count: number) => void;
  onSlots: (primary: string, secondary: string) => void;
  onScope: (active: boolean) => void;
}

interface OperatorRig {
  root: TransformNode;
  torso: TransformNode;
  head: TransformNode;
  leftArm: TransformNode;
  rightArm: TransformNode;
  rifle: TransformNode;
  asset?: CharacterAsset;
}

interface Enemy {
  id: number;
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  limbs: Mesh[];
  health: number;
  alive: boolean;
  attackAt: number;
  phase: number;
  hitAt: number;
  windupUntil: number;
  asset?: CharacterAsset;
  assetKind?: CharacterKind;
  assetVersion: number;
  deadAt: number;
  proceduralMeshes?: import('@babylonjs/core').AbstractMesh[];
  weapon?: TransformNode;
  muzzleFlash?: Mesh;
  telegraph?: Mesh;
}

const UP = new Vector3(0, 1, 0);

export class Game {
  readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly keys = new Set<string>();
  private readonly enemies: Enemy[] = [];
  private readonly shotRegions = new Map<number, number>();
  private readonly obstacles: Mesh[] = [];
  private readonly gun: TransformNode;
  private muzzle!: Mesh;
  private magazineMesh?: Mesh;
  private sliding = false;
  private crouched = false;
  private slideStartedAt = 0;
  private slideDirection = Vector3.Zero();
  private firing = false;
  private aiming = false;
  private nextShot = 0;
  private reloadAt = 0;
  private ammo = 30;
  private reserve = 120;
  private weapon: WeaponSpec = getWeapon('rifle', { optic: false, grip: false, magazine: false });
  private loadout: Loadout = { optic: false, grip: false, magazine: false };
  private gunParts: Mesh[] = [];
  private triggerReady = true;
  private health = 100;
  private kills = 0;
  private shots = 0;
  private startedAt = 0;
  private state: GameState = 'menu';
  private recoil = 0;
  private walkTime = 0;
  private audio?: AudioContext;
  private combatAudio?: CombatAudio;
  private weaponKick = 0;
  private lastEmptySound = 0;
  private grenades = GRENADE_CAPACITY;
  private localGrenadeId = 0;
  private readonly localGrenades = new Map<number, GrenadeState>();
  private readonly grenadeMeshes = new Map<string, Mesh>();
  private nextGrenadeAt = 0;
  private pointerLocked = false;
  private socket?: WebSocket;
  private playerId = '';
  private networkSentAt = 0;
  private networkStartedAt = 0;
  private readonly teammates = new Map<string, TransformNode>();
  private lastWorld?: WorldState;
  private downed = false;
  private reviveTarget?: string;
  private stage = 0;
  private readonly gates: Mesh[] = [];
  private readonly supplyMeshes = new Map<number, TransformNode>();
  private collectedSupplies = new Set<number>();
  private lastStageEvent = -1;
  private verticalVelocity = 0;
  private reloadStartedAt = 0;
  private gateMarker!: Mesh;
  private weaponBaseZ = -0.75;
  private mode: GameMode = 'dungeon';
  private wave = 1;
  private nextWaveAt = 0;
  private waveBreak = false;
  private networkClockOffset = 0;
  private readonly enemyTargets = new Map<number, { position: Vector3; yaw: number }>();
  private perk: PerkId = 'runner';
  private pumpMesh?: TransformNode;
  private readonly teammateTargets = new Map<string, { position: Vector3; yaw: number }>();
  private readonly operatorModels = new Map<PerkId, OperatorRig>();
  private operatorSelectedAt = 0;
  private operatorInspection = false;
  private performanceUiAt = 0;
  private readonly sceneInstrumentation: SceneInstrumentation;
  private readonly touchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  private mobileMove = Vector2.Zero();
  private mobileSprint = false;
  private readonly operatorStage: TransformNode;
  private readonly operatorStageLight: HemisphericLight;
  private readonly acidProjectiles = new Map<number, AcidProjectile>();
  private readonly acidMeshes = new Map<number, Mesh>();
  private nextAcidId = 1;
  private primaryId: WeaponId = 'rifle';
  private secondaryId: WeaponId = 'smg';
  private activeSlot: 1 | 2 = 1;
  private weaponAmmo = new Map<WeaponId, { ammo: number; reserve: number }>();
  private medkits = 2;
  private nextMedkitAt = 0;
  private mouseSensitivity = 0.0018;
  private baseFov = 1.25;
  private reducedMotion = false;
  private masterVolume = 0.7;
  private masterGain?: GainNode;

  constructor(private readonly engine: Engine, private readonly events: GameEvents) {
    this.scene = new Scene(engine);
    this.gun = new TransformNode('rifle', this.scene);
    this.scene.clearColor = new Color4(0.025, 0.033, 0.029, 1);
    this.scene.ambientColor = new Color3(0.15, 0.17, 0.15);
    this.scene.gravity = new Vector3(0, -0.45, 0);
    this.scene.collisionsEnabled = true;

    this.camera = new UniversalCamera('player', new Vector3(0, 1.7, 17), this.scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 160;
    this.camera.fov = 1.25;
    this.camera.speed = 0;
    this.camera.inertia = 0;
    this.camera.checkCollisions = true;
    this.camera.applyGravity = true;
    this.camera.ellipsoid = new Vector3(0.38, 0.85, 0.38);
    if (location.hash === '#debug') (window as unknown as { game: Game }).game = this;
    this.camera.ellipsoidOffset = new Vector3(0, 0.85, 0);
    this.scene.activeCamera = this.camera;

    this.engine.setHardwareScalingLevel(this.touchDevice ? 1.25 : 1);
    this.scene.performancePriority = 2;
    this.sceneInstrumentation = new SceneInstrumentation(this.scene);
    this.scene.autoClearDepthAndStencil = true;
    this.buildDungeon();
    this.buildGun();
    this.spawnEnemies();
    this.spawnZombies();
    this.buildGateMarker();
    this.operatorStage = new TransformNode('operator inspection stage', this.scene);
    this.operatorStage.position.set(0, 0, 200);
    this.operatorStageLight = new HemisphericLight('operator inspection fill', new Vector3(0.2, 1, 0.6), this.scene);
    this.operatorStageLight.intensity = 1.05;
    this.operatorStageLight.setEnabled(false);
    const backdrop = MeshBuilder.CreateBox('operator stage backdrop', { width: 24, height: 12, depth: 0.3 }, this.scene);
    backdrop.parent = this.operatorStage; backdrop.position.set(0, 4, -3); backdrop.material = this.material(new Color3(0.025, 0.035, 0.028)); backdrop.isPickable = false;
    const floor = MeshBuilder.CreateCylinder('operator stage floor', { diameter: 10, height: 0.15, tessellation: 12 }, this.scene);
    floor.parent = this.operatorStage; floor.position.y = -0.05; floor.material = this.material(new Color3(0.07, 0.09, 0.07)); floor.isPickable = false;
    this.operatorStage.setEnabled(false);
    this.buildOperatorPreview();
    this.bindInput();
    void preloadCharacters(this.scene).then(() => this.upgradeCharacters());
    if (this.touchDevice) this.bindMobileInput();
    this.scene.onBeforeRenderObservable.add(() => this.update());
    this.scene.onAfterRenderObservable.add(() => this.updatePerformanceReadout());
  }

  get currentState() { return this.state; }

  setMode(mode: GameMode) { this.mode = mode; }

  setOperatorInspection(active: boolean) {
    this.operatorInspection = active;
    this.operatorStage.setEnabled(active);
    this.operatorStageLight.setEnabled(active);
    this.operatorSelectedAt = performance.now();
    for (const [id, rig] of this.operatorModels) {
      const selected = id === this.perk;
      rig.root.setEnabled(!active || selected);
      rig.root.position.set(active && selected ? 0 : 2.2 + ['runner', 'scavenger', 'juggernaut', 'medic'].indexOf(id) * 1.75, 0.15, active && selected ? 200 : 2.7);
      rig.root.scaling.setAll(active && selected ? 1.65 : 0.82);
    }
  }

  setPerk(perk: PerkId) {
    this.perk = PERKS[perk] ? perk : 'runner';
    this.operatorSelectedAt = performance.now();
    for (const [id, rig] of this.operatorModels) {
      const selected = id === this.perk;
      rig.root.setEnabled(!this.operatorInspection || selected);
      if (this.operatorInspection && selected) {
        rig.root.position.set(0, 0.15, 200);
        rig.root.scaling.setAll(1.65);
      }
      (rig.root.getChildMeshes().find((mesh) => mesh.name === 'operator platform')?.material as StandardMaterial).emissiveColor = selected ? new Color3(0.35, 0.5, 0.1) : new Color3(0.01, 0.015, 0.01);
    }
  }

  setSecondary(weapon: WeaponId) {
    this.secondaryId = this.perk === 'juggernaut' && (weapon === 'ak' || weapon === 'shotgun') ? weapon : weapon === 'pistol' ? 'pistol' : 'smg';
  }

  setSensitivity(value: number) { this.mouseSensitivity = Math.max(0.0005, Math.min(0.005, value)); }
  setFieldOfView(value: number) { this.baseFov = Math.max(0.9, Math.min(1.6, value)); }
  setReducedMotion(value: boolean) { this.reducedMotion = value; }
  setVolume(value: number) {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGain && this.audio) this.masterGain.gain.value = this.masterVolume;
  }

  mainMenu() {
    this.disconnect();
    this.state = 'menu';
    this.firing = false;
    this.aiming = false;
    this.keys.clear();
    this.events.onScope(false);
    this.gun.setEnabled(false);
    for (const rig of this.operatorModels.values()) rig.root.setEnabled(true);
  }

  setLoadout(weapon: WeaponId, loadout: Loadout) {
    this.primaryId = weapon;
    this.activeSlot = 1;
    this.loadout = { ...loadout };
    this.weapon = getWeapon(weapon, loadout);
    for (const mesh of this.gunParts) { mesh.material?.dispose(); mesh.dispose(); }
    this.gunParts = [];
    this.buildGun();
    this.events.onWeapon(this.weapon);
    this.events.onSlots(WEAPONS[this.primaryId].name, WEAPONS[this.secondaryId].name);
  }

  async connectCoop(room: string) {
    this.socket?.close();
    const host = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
    this.socket = new WebSocket(host);
    this.socket.addEventListener('open', () => {
      this.socket?.send(JSON.stringify({ type: 'join', room, mode: this.mode }));
      this.socket?.send(JSON.stringify({ type: 'loadout', weapon: this.weapon.id, loadout: this.loadout, perk: this.perk }));
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'state' && !this.lastWorld && this.state === 'playing') {
        const spawn = message.state.players.find((player) => player.id === this.playerId);
        if (spawn) this.camera.position.set(spawn.x, spawn.y, spawn.z);
      }
      if (message.type === 'joined') {
        this.playerId = message.id;
        this.events.onMessage(`ROOM ${message.room} CONNECTED`);
      } else if (message.type === 'state') this.applyWorld(message.state);
      else if (message.type === 'hit') {
        this.events.onHit(message.killed);
        this.combatAudio?.hit(message.killed);
      }
      else if (message.type === 'damaged') {
        const wasAlive = this.health > 0;
        const previousHealth = this.health;
        this.health = message.health;
        this.events.onHealth(this.health);
        if (wasAlive && message.health < previousHealth) this.combatAudio?.damage();
        if (message.health === 0 && this.lastWorld && this.lastWorld.players.length > 1) {
          this.downed = true;
          this.events.onMessage('DOWNED — WAITING FOR REVIVE');
        } else if (message.health > 0) {
          this.downed = false;
          this.camera.position.y = Math.max(this.camera.position.y, 1.05);
        }
        if (wasAlive && message.health < previousHealth) this.events.onDamage();
        if (message.health > previousHealth && this.lastWorld && this.lastWorld.elapsed < 0.2) this.camera.position.y = Math.max(this.camera.position.y, 1.7);
      } else if (message.type === 'equipment') {
        this.grenades = message.grenades;
        this.events.onGrenades(this.grenades);
        if (message.medkits !== undefined) { this.medkits = message.medkits; this.events.onMedkits(this.medkits); }
      } else if (message.type === 'explosion') this.explode(new Vector3(message.x, message.y, message.z));
      else if (message.type === 'notice') this.events.onMessage(message.message);
      else if (message.type === 'error') this.events.onMessage(message.message);
    });
    this.socket.addEventListener('close', () => {
      if (this.state === 'playing') this.events.onMessage('CONNECTION LOST');
    });
  }

  disconnect() {
    this.socket?.close();
    this.socket = undefined;
    this.playerId = '';
    this.lastWorld = undefined;
    this.downed = false;
    this.events.onRoom('', 0);
    this.events.onSquad([]);
    for (const model of this.teammates.values()) model.dispose();
    this.teammates.clear();
  }

  private sendNetwork(data: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }

  get isCoop() { return this.socket?.readyState === WebSocket.OPEN; }

  private applyWorld(world: WorldState) {
    this.lastWorld = world;
    this.mode = world.mode;
    this.wave = world.wave;
    this.events.onWave(this.wave);
    this.nextWaveAt = world.nextWaveAt;
    this.waveBreak = world.nextWaveAt > 0;
    const serverNow = Date.now();
    const networkNow = performance.now();
    const clockOffset = networkNow - world.elapsed * 1000 - serverNow;
    this.networkStartedAt = serverNow + clockOffset - world.elapsed * 1000;
    this.networkClockOffset = clockOffset;
    const me = world.players.find((player) => player.id === this.playerId);
    this.downed = me?.downed ?? false;
    const activeGrenades = new Set<string>();
    for (const grenade of world.grenades) {
      const key = `server-${grenade.id}`;
      activeGrenades.add(key);
      const mesh = this.grenadeMeshes.get(key) ?? this.createGrenadeMesh(key);
      mesh.position.set(grenade.x, grenade.y, grenade.z);
    }
    for (const [key, mesh] of this.grenadeMeshes) {
      if (key.startsWith('server-') && !activeGrenades.has(key)) { mesh.dispose(); this.grenadeMeshes.delete(key); }
    }
    const activeAcid = new Set<number>();
    for (const acid of world.acid) {
      activeAcid.add(acid.id);
      const isNew = !this.acidMeshes.has(acid.id);
      const mesh = this.acidMeshes.get(acid.id) ?? this.createAcidMesh(acid.id);
      if (isNew) this.combatAudio?.spit();
      mesh.position.set(acid.x, acid.y, acid.z);
    }
    for (const [id, mesh] of this.acidMeshes) if (!activeAcid.has(id)) { mesh.dispose(); this.acidMeshes.delete(id); }
    if (this.isCoop && this.mode === 'zombies') this.nextWaveAt += this.networkClockOffset;
    this.reviveTarget = world.players.find((player) => player.downed && player.id !== this.playerId && Math.hypot(player.x - this.camera.position.x, player.z - this.camera.position.z) < 2.8)?.id;
    for (const state of world.enemies) {
      const enemy = this.enemies[state.id];
      if (!enemy) continue;
      if (state.zombie && state.kind !== 'soldier') this.applyZombieKind(enemy, state.kind);
      this.enemyTargets.set(state.id, { position: new Vector3(state.x, 0, state.z), yaw: state.yaw });
      if (state.health < enemy.health) enemy.hitAt = 150;
      enemy.health = state.health;
      if (enemy.alive && !state.alive) {
        enemy.deadAt = performance.now();
        enemy.asset?.play('Death', false);
      } else if (state.alive) enemy.deadAt = 0;
      enemy.alive = state.alive;
      enemy.windupUntil = state.windupUntil ? this.networkClock(state.windupUntil) : 0;
      enemy.root.setEnabled(state.alive || (!!enemy.asset && enemy.deadAt > 0 && performance.now() - enemy.deadAt < 4000));
      if (state.boss) this.events.onBoss(state.health, 800);
    }
    this.kills = me?.kills ?? 0;
    this.events.onEnemies(world.enemies.filter((enemy) => enemy.stage === world.stage && enemy.alive).length);
    this.stage = world.stage;
    if (this.mode === 'dungeon') this.updateStage(world.stage, this.lastStageEvent !== world.stage);
    this.lastStageEvent = world.stage;
    this.collectedSupplies = new Set(world.supplies);
    for (const [id, mesh] of this.supplyMeshes) mesh.setEnabled(!this.collectedSupplies.has(id));
    this.events.onRoom(world.room, world.players.length);
    this.events.onSquad(world.players.map((player) => ({ id: player.id, health: player.health, downed: player.downed, kills: player.kills })));
    const connected = new Set<string>();
    for (const player of world.players) {
      if (player.id === this.playerId) continue;
      connected.add(player.id);
      let model = this.teammates.get(player.id);
      if (!model) { model = this.createTeammate(player.id); this.teammates.set(player.id, model); }
      this.teammateTargets.set(player.id, { position: new Vector3(player.x, player.y - 1.7, player.z), yaw: player.yaw });
      model.rotation.z = player.downed ? -1.35 : 0;
      model.scaling.y = player.downed ? 0.65 : 1;
    }
    for (const [id, model] of this.teammates) if (!connected.has(id)) { model.dispose(); this.teammates.delete(id); }
  }

  private createTeammate(id: string) {
    const root = new TransformNode(`teammate ${id}`, this.scene);
    const armor = this.material(new Color3(0.2, 0.33, 0.35));
    const accent = this.material(new Color3(0.4, 0.9, 0.95), 0.8);
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial) => {
      const mesh = MeshBuilder.CreateBox('operative', { width: w, height: h, depth: d }, this.scene);
      mesh.parent = root; mesh.position.set(x, y, z); mesh.material = mat; mesh.isPickable = false;
      return mesh;
    };
    part(0.7, 0.8, 0.4, 0, 1.3, 0, armor);
    part(0.4, 0.4, 0.4, 0, 1.95, 0, armor);
    part(0.3, 0.08, 0.02, 0, 1.98, 0.21, accent);
    part(0.25, 0.85, 0.27, -0.2, 0.45, 0, armor);
    part(0.25, 0.85, 0.27, 0.2, 0.45, 0, armor);
    part(0.16, 0.16, 0.85, 0.3, 1.35, 0.25, armor);
    part(0.55, 0.75, 0.2, 0, 1.35, -0.27, armor);
    part(0.42, 0.12, 0.46, 0, 2.17, 0, armor);
    part(0.22, 0.35, 0.18, -0.39, 1.43, 0, armor);
    part(0.22, 0.35, 0.18, 0.39, 1.43, 0, armor);
    part(0.28, 0.17, 0.34, -0.2, 0.53, 0.05, armor);
    part(0.28, 0.17, 0.34, 0.2, 0.53, 0.05, armor);
    part(0.11, 0.11, 0.95, 0.28, 1.35, 0.1, armor);
    const barrel = part(0.055, 0.055, 0.35, 0.28, 1.35, 0, armor);
    barrel.position.z = 0.6;
    root.metadata = { limbs: root.getChildMeshes().filter((mesh) => mesh.name === 'operative').slice(2, 4) };
    return root;
  }

  start() {
    this.reset();
    this.state = 'playing';
    this.operatorInspection = false;
    this.operatorStage.setEnabled(false);
    this.operatorStageLight.setEnabled(false);
    for (const rig of this.operatorModels.values()) rig.root.setEnabled(false);
    this.pointerLocked = false;
    this.startedAt = performance.now();
    const me = this.lastWorld?.players.find((player) => player.id === this.playerId);
    this.camera.position.set(me?.x ?? 0, 1.7, me?.z ?? 17);
    this.camera.cameraDirection.setAll(0);
    this.verticalVelocity = 0;
    this.camera.rotation.set(0, 0, 0);
    this.lockPointer();
    if (!this.audio) {
      this.audio = new AudioContext();
      this.masterGain = this.audio.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.audio.destination);
    }
    this.combatAudio ??= new CombatAudio(this.audio, this.masterGain);
    void this.audio.resume();
  }

  resume() {
    this.state = 'playing';
    this.lockPointer();
  }

  reset() {
    this.enemyTargets.clear();
    this.teammateTargets.clear();
    this.wave = 1;
    this.events.onWave(1);
    this.nextWaveAt = 0;
    this.waveBreak = false;
    if (this.mode === 'zombies') {
      this.gates.forEach((gate) => gate.setEnabled(false));
      this.gateMarker.setEnabled(false);
      this.events.onBoss(0, 800);
    }
    this.health = PERKS[this.perk].maxHealth;
    this.medkits = 2;
    this.events.onMedkits(this.medkits);
    this.weaponAmmo.clear();
    this.activeSlot = 1;
    if (this.weapon.id !== this.primaryId) {
      this.weapon = getWeapon(this.primaryId, this.loadout);
      for (const mesh of this.gunParts) { mesh.material?.dispose(); mesh.dispose(); }
      this.gunParts = [];
      this.buildGun();
    }
    this.ammo = this.weapon.magazine;
    this.reserve = Math.round(this.weapon.reserve * PERKS[this.perk].ammo);
    this.grenades = GRENADE_CAPACITY;
    this.events.onGrenades(this.grenades);
    this.nextGrenadeAt = 0;
    this.localGrenades.clear();
    this.acidProjectiles.clear();
    for (const mesh of this.acidMeshes.values()) mesh.dispose();
    this.acidMeshes.clear();
    for (const mesh of this.grenadeMeshes.values()) mesh.dispose();
    this.grenadeMeshes.clear();
    this.kills = 0;
    this.shots = 0;
    this.firing = false;
    this.aiming = false;
    this.events.onScope(false);
    this.reloadAt = 0;
    this.sliding = false;
    this.crouched = false;
    this.stage = 0;
    this.lastStageEvent = -1;
    this.collectedSupplies.clear();
    this.triggerReady = true;
    this.keys.clear();
    this.events.onWeapon(this.weapon);
    this.events.onHealth(this.health);
    this.events.onAmmo(this.ammo, this.reserve);
    this.events.onEnemies(this.enemies.filter((enemy) => (enemy.root.metadata as { stage: number; zombie?: boolean }).stage === 0 && (this.mode === 'zombies') === !!(enemy.root.metadata as { zombie?: boolean }).zombie && (this.mode !== 'zombies' || enemy.phase < zombieWaveSize(1))).length);
    this.events.onReload(false);
    this.events.onStage(0, this.mode === 'zombies' ? 'OUTBREAK CONTAINMENT' : STAGE_NAMES[0]);
    this.events.onObjective(this.mode === 'zombies' ? 'SURVIVE WAVE 1' : 'CLEAR THE CHAMBER');
    this.gateMarker?.setEnabled(false);
    this.events.onBoss(0, 800);
    this.gates.forEach((gate) => { gate.setEnabled(this.mode === 'dungeon'); gate.checkCollisions = this.mode === 'dungeon'; });
    this.events.onRevive('', 0);
    this.downed = false;
    for (const model of this.teammates.values()) { model.rotation.z = 0; model.scaling.y = 1; }
    for (const mesh of this.supplyMeshes.values()) mesh.setEnabled(false);
    for (const gate of this.gates) gate.checkCollisions = true;
    this.sendNetwork({ type: 'restart' });
    this.sendNetwork({ type: 'loadout', weapon: this.weapon.id, loadout: this.loadout, perk: this.perk });
    for (const enemy of this.enemies) {
      const meta = enemy.root.metadata as { boss: boolean; stage: number; zombie?: boolean; kind?: ZombieKind };
      enemy.alive = this.mode === 'zombies' ? !!meta.zombie && enemy.phase < zombieWaveSize(1) : !meta.zombie;
      enemy.windupUntil = 0;
      enemy.telegraph?.setEnabled(false);
      enemy.health = meta.boss ? 800 : meta.zombie ? zombieHealth(1, meta.kind) : 100;
      enemy.root.rotation.set(0, 0, 0);
      enemy.hitAt = 0;
      enemy.deadAt = 0;
      enemy.root.setEnabled(enemy.alive);
      enemy.asset?.animations.forEach((animation) => animation.stop());
      if (enemy.alive) enemy.asset?.play('Idle');
      enemy.attackAt = performance.now() + 1500;
      enemy.root.position.copyFrom((enemy.root.metadata as { spawn: Vector3 }).spawn);
    }
  }

  private lockPointer() {
    if (this.touchDevice) return;
    try {
      const request = this.engine.getRenderingCanvas()?.requestPointerLock();
      if (request instanceof Promise) void request.catch(() => this.pause());
    } catch {
      this.pause();
    }
  }

  private pause() {
    this.state = 'paused';
    this.aiming = false;
    this.events.onScope(false);
    this.firing = false;
    this.keys.clear();
    this.mobileMove = Vector2.Zero();
    this.mobileSprint = false;
    this.events.onPause();
  }

  private bindInput() {
    const canvas = this.engine.getRenderingCanvas()!;
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'KeyR' && this.state === 'playing') this.reload();
      if ((event.code === 'KeyG' || event.code === 'Digit4') && this.state === 'playing' && !this.downed) this.throwGrenade();
      if (event.code === 'Digit3' && this.state === 'playing' && !this.downed) this.useMedkit();
      if (event.code === 'Digit1' && this.state === 'playing' && !this.downed) this.switchWeapon(1);
      if (event.code === 'Digit2' && this.state === 'playing' && !this.downed) this.switchWeapon(2);
      if (event.code === 'Space' && this.state === 'playing') {
        event.preventDefault();
        this.jump();
      }
      if ((event.code === 'KeyC' || event.code === 'ControlLeft') && this.state === 'playing') this.slide();
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.firing = false; });
    canvas.addEventListener('mousedown', (event) => {
      if (this.state !== 'playing') return;
      if (event.button === 0) this.firing = true;
      if (event.button === 2) { this.aiming = true; this.events.onScope(this.loadout.optic); }
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) { this.firing = false; this.triggerReady = true; }
      if (event.button === 2) { this.aiming = false; this.events.onScope(false); }
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('mousemove', (event) => {
      if (this.state !== 'playing' || document.pointerLockElement !== canvas) return;
      this.camera.rotation.y += event.movementX * this.mouseSensitivity;
      this.camera.rotation.x += event.movementY * this.mouseSensitivity;
      this.camera.rotation.x = Math.max(-1.35, Math.min(1.35, this.camera.rotation.x));
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) this.pointerLocked = true;
      else if (this.pointerLocked && this.state === 'playing') this.pause();
    });
    document.addEventListener('pointerlockerror', () => this.pause());
  }

  private bindMobileInput() {
    const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
    const stick = element('move-stick');
    const knob = element('move-knob');
    let movePointer = -1;
    const move = (event: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      const radius = rect.width * 0.32;
      const length = Math.hypot(x, y);
      const scale = length > radius ? radius / length : 1;
      const dx = x * scale, dy = y * scale;
      this.mobileMove.set(dx / radius, dy / radius);
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    stick.addEventListener('pointerdown', (event) => {
      event.preventDefault(); movePointer = event.pointerId; stick.setPointerCapture(event.pointerId); move(event);
    });
    stick.addEventListener('pointermove', (event) => { if (event.pointerId === movePointer) move(event); });
    const releaseMove = (event: PointerEvent) => {
      if (event.pointerId !== movePointer) return;
      movePointer = -1; this.mobileMove = Vector2.Zero(); knob.style.transform = '';
    };
    stick.addEventListener('pointerup', releaseMove); stick.addEventListener('pointercancel', releaseMove);
    let aimPointer = -1, aimX = 0, aimY = 0;
    const aimZone = element('aim-zone');
    aimZone.addEventListener('pointerdown', (event) => {
      event.preventDefault(); aimPointer = event.pointerId; aimX = event.clientX; aimY = event.clientY; aimZone.setPointerCapture(event.pointerId);
    });
    aimZone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== aimPointer || this.state !== 'playing') return;
      this.camera.rotation.y += (event.clientX - aimX) * this.mouseSensitivity * 1.45;
      this.camera.rotation.x += (event.clientY - aimY) * this.mouseSensitivity * 1.45;
      this.camera.rotation.x = Math.max(-1.35, Math.min(1.35, this.camera.rotation.x));
      aimX = event.clientX; aimY = event.clientY;
    });
    const releaseAim = (event: PointerEvent) => { if (event.pointerId === aimPointer) aimPointer = -1; };
    aimZone.addEventListener('pointerup', releaseAim); aimZone.addEventListener('pointercancel', releaseAim);
    const hold = (id: string, begin: () => void, end: () => void) => {
      const button = element(id);
      button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); button.classList.add('active'); begin(); });
      const release = () => { button.classList.remove('active'); end(); };
      button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release);
    };
    hold('mobile-fire', () => { this.firing = true; this.triggerReady = true; }, () => { this.firing = false; this.triggerReady = true; });
    hold('mobile-sprint', () => { this.mobileSprint = true; }, () => { this.mobileSprint = false; });
    const tap = (id: string, action: () => void) => element(id).addEventListener('pointerdown', (event) => { event.preventDefault(); if (this.state === 'playing' && !this.downed) action(); });
    tap('mobile-scope', () => { this.aiming = !this.aiming; this.events.onScope(this.aiming && this.loadout.optic); });
    tap('mobile-reload', () => this.reload());
    tap('mobile-jump', () => this.jump());
    tap('mobile-crouch', () => this.slide());
    element('mobile-pause').addEventListener('pointerdown', (event) => { event.preventDefault(); if (this.state === 'playing') this.pause(); });
    document.querySelectorAll<HTMLButtonElement>('[data-mobile-slot]').forEach((button) => button.addEventListener('pointerdown', (event) => { event.preventDefault(); this.switchWeapon(Number(button.dataset.mobileSlot) as 1 | 2); }));
    element<HTMLButtonElement>('mobile-controls').querySelector('[data-mobile-heal]')!.addEventListener('pointerdown', (event) => { event.preventDefault(); this.useMedkit(); });
    element<HTMLButtonElement>('mobile-controls').querySelector('[data-mobile-grenade]')!.addEventListener('pointerdown', (event) => { event.preventDefault(); this.throwGrenade(); });
  }

  private jump() {
    if (this.camera.position.y > 1.78 || this.sliding) return;
    this.crouched = false;
    this.verticalVelocity = 5.8;
  }

  private slide() {
    if (this.camera.position.y > 1.78) return;
    if (this.sliding) return;
    if (!this.keys.has('ShiftLeft')) {
      this.crouched = !this.crouched;
      return;
    }
    this.crouched = false;
    const forward = this.camera.getDirection(new Vector3(0, 0, 1));
    forward.y = 0;
    this.slideDirection = forward.normalize();
    this.sliding = true;
    this.slideStartedAt = performance.now();
    this.firing = false;
  }

  private material(color: Color3, emissive = 0) {
    const mat = new StandardMaterial('material', this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    mat.emissiveColor = color.scale(emissive);
    return mat;
  }

  private box(name: string, size: { w: number; h: number; d: number }, position: Vector3, mat: StandardMaterial, collision = true) {
    const mesh = MeshBuilder.CreateBox(name, { width: size.w, height: size.h, depth: size.d }, this.scene);
    mesh.position.copyFrom(position);
    mesh.material = mat;
    mesh.checkCollisions = collision;
    this.obstacles.push(mesh);
    return mesh;
  }

  private buildDungeon() {
    new HemisphericLight('ambient', new Vector3(0.2, 1, 0), this.scene).intensity = 0.45;
    const sun = new DirectionalLight('light', new Vector3(-0.25, -1, 0.3), this.scene);
    sun.position = new Vector3(3, 12, -4);
    sun.intensity = 1.15;
    if (!this.touchDevice) new GlowLayer('glow', this.scene).intensity = 0.25;

    const floor = this.material(new Color3(0.16, 0.18, 0.16));
    const wall = this.material(new Color3(0.22, 0.25, 0.22));
    const dark = this.material(new Color3(0.075, 0.09, 0.08));
    const trim = this.material(new Color3(0.32, 0.35, 0.28));
    const glow = this.material(new Color3(0.66, 0.83, 0.28), 1.1);

    this.box('floor', { w: 28, h: 0.4, d: 46 }, new Vector3(0, -0.2, 0), floor);
    this.box('ceiling', { w: 28, h: 0.5, d: 46 }, new Vector3(0, 6.2, 0), dark, false);
    this.box('left wall', { w: 0.7, h: 6, d: 46 }, new Vector3(-14, 3, 0), wall);
    this.box('right wall', { w: 0.7, h: 6, d: 46 }, new Vector3(14, 3, 0), wall);
    this.box('far wall', { w: 28, h: 6, d: 0.7 }, new Vector3(0, 3, -23), wall);
    this.box('entry wall', { w: 28, h: 6, d: 0.7 }, new Vector3(0, 3, 23), wall);

    for (const x of [-9, 9]) {
      for (const z of [-14, 0, 14]) {
        this.box('pillar', { w: 1.4, h: 5.5, d: 1.4 }, new Vector3(x, 2.75, z), dark);
        this.box('pillar base', { w: 1.9, h: 0.35, d: 1.9 }, new Vector3(x, 0.18, z), trim);
        this.box('pillar cap', { w: 1.9, h: 0.35, d: 1.9 }, new Vector3(x, 5.45, z), trim);
      }
    }
    this.box('central cover', { w: 5, h: 1.35, d: 1.1 }, new Vector3(0, 0.675, 4), wall);
    this.box('left cover', { w: 3.5, h: 1.1, d: 1.2 }, new Vector3(-6, 0.55, -7), wall);
    this.box('right cover', { w: 3.5, h: 1.1, d: 1.2 }, new Vector3(6, 0.55, -15), wall);

    for (let z = -20; z <= 20; z += 4) {
      this.box('floor seam', { w: 27, h: 0.012, d: 0.025 }, new Vector3(0, 0.012, z), dark, false);
    }
    for (const x of [-11.8, 11.8]) {
      this.box('guide light', { w: 0.06, h: 0.025, d: 42 }, new Vector3(x, 0.03, 0), glow, false);
      for (const z of [-16, -4, 8]) {
        this.box('wall light', { w: 0.08, h: 0.14, d: 3.2 }, new Vector3(x > 0 ? 13.61 : -13.61, 3.9, z), glow, false);
      }
    }
    for (let x = -12; x <= 12; x += 3) {
      this.box('ceiling rib', { w: 0.18, h: 0.22, d: 46 }, new Vector3(x, 5.88, 0), trim, false);
    }
    const vault = this.box('vault door', { w: 7, h: 4.8, d: 0.35 }, new Vector3(0, 2.4, -22.55), dark);
    vault.isPickable = true;
    this.gates.push(vault);
    this.box('vault stripe', { w: 5.7, h: 0.12, d: 0.05 }, new Vector3(0, 4.25, -22.34), glow, false);

    for (let stage = 1; stage <= 2; stage++) {
      const center = -46 * stage;
      this.box('chamber floor', { w: 28, h: 0.4, d: 46 }, new Vector3(0, -0.2, center), floor);
      this.box('chamber ceiling', { w: 28, h: 0.5, d: 46 }, new Vector3(0, 6.2, center), dark, false);
      this.box('chamber left', { w: 0.7, h: 6, d: 46 }, new Vector3(-14, 3, center), wall);
      this.box('chamber right', { w: 0.7, h: 6, d: 46 }, new Vector3(14, 3, center), wall);
      for (const x of [-9, 9]) for (const z of [center - 14, center, center + 14]) {
        this.box('pillar', { w: 1.4, h: 5.5, d: 1.4 }, new Vector3(x, 2.75, z), dark);
        this.box('pillar cap', { w: 1.9, h: 0.35, d: 1.9 }, new Vector3(x, 5.45, z), trim);
      }
      this.box('arena cover', { w: 5, h: 1.35, d: 1.1 }, new Vector3(0, 0.675, center + 4), wall);
      this.box('arena cover left', { w: 3.5, h: 1.1, d: 1.2 }, new Vector3(-6, 0.55, center - 7), wall);
      this.box('arena cover right', { w: 3.5, h: 1.1, d: 1.2 }, new Vector3(6, 0.55, center - 15), wall);
      for (const x of [-11.8, 11.8]) this.box('guide light', { w: 0.06, h: 0.025, d: 42 }, new Vector3(x, 0.03, center), glow, false);
      this.box('back wall left', { w: 10.5, h: 6, d: 0.7 }, new Vector3(-8.75, 3, center - 23), wall);
      this.box('back wall right', { w: 10.5, h: 6, d: 0.7 }, new Vector3(8.75, 3, center - 23), wall);
      if (stage === 1) {
        const gate = this.box('vault door', { w: 7, h: 4.8, d: 0.35 }, new Vector3(0, 2.4, center - 22.55), dark);
        this.gates.push(gate);
        this.box('vault stripe', { w: 5.7, h: 0.12, d: 0.05 }, new Vector3(0, 4.25, center - 22.34), glow, false);
      } else this.box('final wall', { w: 7, h: 6, d: 0.7 }, new Vector3(0, 3, center - 23), wall);
    }
    for (const supply of SUPPLIES) {
      const root = new TransformNode('supply crate', this.scene);
      root.position.set(supply.x, 0.35, supply.z);
      const mat = this.material(supply.kind === 'health' ? new Color3(0.45, 0.8, 0.35) : new Color3(0.85, 0.7, 0.2), 0.45);
      const crate = MeshBuilder.CreateBox('supply', { width: 0.8, height: 0.6, depth: 0.65 }, this.scene);
      crate.parent = root; crate.material = mat; crate.isPickable = false;
      const stripe = MeshBuilder.CreateBox('supply marking', { width: supply.kind === 'health' ? 0.42 : 0.52, height: 0.09, depth: 0.015 }, this.scene);
      stripe.parent = root; stripe.position.set(0, 0, 0.335); stripe.material = this.material(new Color3(0.9, 0.95, 0.75), 0.5); stripe.isPickable = false;
      if (supply.kind === 'health') {
        const cross = MeshBuilder.CreateBox('health marking', { width: 0.09, height: 0.42, depth: 0.015 }, this.scene);
        cross.parent = root; cross.position.set(0, 0, 0.335); cross.material = stripe.material; cross.isPickable = false;
      } else for (const x of [-0.16, 0, 0.16]) {
        const round = MeshBuilder.CreateCylinder('ammo marking', { diameter: 0.08, height: 0.3, tessellation: 8 }, this.scene);
        round.parent = root; round.position.set(x, 0.05, 0.36); round.material = stripe.material; round.isPickable = false;
      }
      this.supplyMeshes.set(supply.id, root);
    }
  }

  private buildOperatorPreview() {
    const ids: PerkId[] = ['runner', 'scavenger', 'juggernaut', 'medic'];
    const colors = [new Color3(0.35, 0.45, 0.26), new Color3(0.43, 0.3, 0.16), new Color3(0.2, 0.25, 0.28), new Color3(0.24, 0.42, 0.43)];
    ids.forEach((id, index) => {
      const root = new TransformNode(`operator preview ${id}`, this.scene);
      root.position.set(3.2 + index * 2.1, 0.15, 3);
      root.metadata = { previewLight: new HemisphericLight('operator fill', new Vector3(0, 1, 0.4), this.scene) };
      root.metadata.previewLight.intensity = 0.85;
      const armor = this.material(colors[index], 0.28);
      const dark = this.material(new Color3(0.08, 0.1, 0.09));
      const accent = this.material(new Color3(0.75, 0.9, 0.4), 0.8);
      const part = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = armor, parent: TransformNode = root) => {
        const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.parent = parent; mesh.position.set(x, y, z); mesh.material = material; mesh.isPickable = false;
        return mesh;
      };
      const joint = (name: string, x: number, y: number, z: number) => {
        const node = new TransformNode(name, this.scene);
        node.parent = root; node.position.set(x, y, z);
        return node;
      };
      const torso = joint('operator torso joint', 0, 0.95, 0);
      const head = joint('operator head joint', 0, 1.76, 0);
      const leftArm = joint('operator left arm joint', -0.48, 1.66, 0);
      const rightArm = joint('operator right arm joint', 0.48, 1.66, 0);
      const rifle = joint('operator rifle joint', 0.25, 1.35, 0.38);
      const bulk = id === 'juggernaut' ? 1.25 : id === 'runner' ? 0.88 : 1;
      part('operator torso', 0.72 * bulk, 0.82, 0.4, 0, 0.4, 0, armor, torso);
      part('operator head', 0.4, 0.4, 0.4, 0, 0.24, 0, dark, head);
      part('operator visor', 0.3, 0.07, 0.025, 0, 0.26, 0.21, accent, head);
      for (const x of [-0.2 * bulk, 0.2 * bulk]) part('operator leg', 0.25, 0.85, 0.28, x, 0.47, 0, dark);
      part('operator arm', 0.21 * bulk, 0.78, 0.25, 0, -0.31, 0, armor, leftArm);
      part('operator arm', 0.21 * bulk, 0.78, 0.25, 0, -0.31, 0, armor, rightArm);
      part('operator chest', 0.55 * bulk, 0.28, 0.08, 0, 0.55, 0.24, dark, torso);
      if (id === 'juggernaut') for (const [x, arm] of [[-0.1, leftArm], [0.1, rightArm]] as const) part('tank shoulder', 0.38, 0.35, 0.48, x, -0.04, 0, dark, arm);
      if (id === 'scavenger') part('scavenger pack', 0.65, 0.85, 0.34, 0, 0.3, -0.32, dark, torso);
      if (id === 'medic') {
        part('medic cross', 0.32, 0.1, 0.03, 0, 0.53, 0.3, accent, torso);
        part('medic cross', 0.1, 0.32, 0.03, 0, 0.53, 0.3, accent, torso);
      }
      if (id === 'runner') part('runner hood', 0.48, 0.18, 0.46, 0, 0.43, -0.02, armor, head);
      part('operator rifle', 0.12, 0.13, 1, 0, 0, 0, dark, rifle);
      part('operator rifle stock', 0.16, 0.23, 0.34, 0, 0, -0.5, dark, rifle);
      rifle.rotation.x = -0.35;
      const platform = MeshBuilder.CreateCylinder('operator platform', { diameter: 1.65, height: 0.12, tessellation: 6 }, this.scene);
      platform.parent = root; platform.position.y = -0.1; platform.material = this.material(new Color3(0.12, 0.15, 0.12)); platform.isPickable = false;
      this.operatorModels.set(id, { root, torso, head, leftArm, rightArm, rifle });
    });
  }

  private async upgradeCharacters() {
    const operatorJobs = [...this.operatorModels].map(async ([id, rig]) => {
      const asset = await loadCharacter(this.scene, id, rig.root);
      asset.root.position.z = -0.3;
      rig.asset = asset;
      for (const mesh of rig.root.getChildMeshes()) {
        if (!mesh.name.startsWith(`${id}:`)) mesh.setEnabled(false);
      }
      for (const node of [rig.torso, rig.head, rig.leftArm, rig.rightArm, rig.rifle]) node.setEnabled(false);
    });
    const enemyJobs = this.enemies.map((enemy) => this.upgradeEnemy(enemy));
    const results = await Promise.allSettled([...operatorJobs, ...enemyJobs]);
    if (results.some((result) => result.status === 'rejected')) console.warn('Some enhanced character assets could not be loaded; procedural fallbacks remain active.');
  }

  private enemyKind(enemy: Enemy): CharacterKind {
    const meta = enemy.root.metadata as { zombie?: boolean; kind?: ZombieKind };
    return meta.zombie ? meta.kind === 'runner' ? 'infectedRunner' : meta.kind ?? 'walker' : 'hostile';
  }

  private async upgradeEnemy(enemy: Enemy) {
    const kind = this.enemyKind(enemy);
    const version = ++enemy.assetVersion;
    const asset = await loadCharacter(this.scene, kind, enemy.root);
    if (version !== enemy.assetVersion) { asset.dispose(); return; }
    enemy.asset?.dispose();
    enemy.asset = asset;
    enemy.assetKind = kind;
    enemy.proceduralMeshes = enemy.root.getChildMeshes().filter((mesh) => !mesh.name.startsWith(`${kind}:`) && mesh.metadata?.enemyIndex !== enemy.id && mesh !== enemy.telegraph && mesh !== enemy.muzzleFlash);
    for (const mesh of enemy.proceduralMeshes) {
      // Invisible meshes still participate in picking; disabled meshes do not.
      mesh.isVisible = false;
    }
    enemy.weapon?.setEnabled(false);
    enemy.asset.root.setEnabled(enemy.alive || enemy.deadAt > 0);
    if (enemy.alive) asset.play('Idle');
    else if (enemy.deadAt > 0) asset.play('Death', false);
  }

  private updateOperatorPreview(dt: number) {
    const now = performance.now();
    const ids: PerkId[] = ['runner', 'scavenger', 'juggernaut', 'medic'];
    const ease = Math.min(1, dt * 7);
    const selectedAge = Math.min(1, (now - this.operatorSelectedAt) / 1100);
    const selectPulse = Math.sin(selectedAge * Math.PI);
    ids.forEach((id, index) => {
      const rig = this.operatorModels.get(id)!;
      const selected = id === this.perk;
      const time = now * 0.001 + index * 1.7;
      const targetX = this.operatorInspection && selected ? 0 : selected ? 8.25 : 2.2 + index * 1.75;
      const targetZ = this.operatorInspection && selected ? 200 : selected ? 7.7 : 2.7;
      rig.root.setEnabled(!this.operatorInspection || selected);
      rig.root.position.x += (targetX - rig.root.position.x) * ease;
      rig.root.position.z += (targetZ - rig.root.position.z) * ease;
      rig.root.position.y = 0.15 + Math.sin(time * 1.7) * 0.012;
      rig.root.scaling.setAll(rig.root.scaling.x + ((selected ? this.operatorInspection ? 1.65 : 1.42 : 0.82) - rig.root.scaling.x) * ease);
      rig.root.rotation.y += ((selected ? -0.22 : 0.12) - rig.root.rotation.y) * ease;
      if (rig.asset) {
        rig.asset.play(selected ? id === 'juggernaut' ? 'Shoot_OneHanded' : id === 'scavenger' ? 'PickUp' : id === 'medic' ? 'Victory' : 'Idle' : 'Idle');
        return;
      }
      rig.torso.rotation.y = Math.sin(time * 1.3) * 0.035;
      rig.torso.rotation.x = Math.sin(time * 1.7) * 0.012;
      rig.head.rotation.y = Math.sin(time * 0.8) * 0.13;
      rig.head.rotation.x = Math.sin(time * 1.1) * 0.025;
      rig.leftArm.rotation.set(0, 0, 0);
      rig.rightArm.rotation.set(0, 0, 0);
      rig.rifle.rotation.set(-0.35, 0, 0);
      rig.rifle.position.set(0.25, 1.35, 0.38);
      if (!selected) return;
      if (id === 'runner') {
        rig.leftArm.rotation.x = -0.55 - selectPulse * 0.4;
        rig.rightArm.rotation.x = -0.65 - selectPulse * 0.35;
        rig.rifle.rotation.x = -0.15 - selectPulse * 0.2;
        rig.rifle.position.y += selectPulse * 0.22;
        rig.root.rotation.y -= 0.1 + selectPulse * 0.16;
      } else if (id === 'scavenger') {
        rig.rightArm.rotation.x = -1.65 * selectPulse;
        rig.rightArm.rotation.z = 0.45 * selectPulse;
        rig.head.rotation.y += 0.22 * selectPulse;
      } else if (id === 'juggernaut') {
        rig.leftArm.rotation.x = -0.5 * selectPulse;
        rig.rightArm.rotation.x = -0.5 * selectPulse;
        rig.rifle.rotation.z = -0.42 * selectPulse;
        rig.rifle.position.y += 0.12 * selectPulse;
        rig.torso.rotation.x -= 0.06 * selectPulse;
      } else {
        rig.leftArm.rotation.x = -1.45 * selectPulse;
        rig.leftArm.rotation.z = -0.32 * selectPulse;
        rig.head.rotation.y -= 0.18 * selectPulse;
      }
    });
  }

  private buildGateMarker() {
    const mat = this.material(new Color3(0.66, 0.83, 0.28), 1.5);
    this.gateMarker = MeshBuilder.CreateCylinder('next chamber marker', { height: 0.1, diameter: 1.6, tessellation: 3 }, this.scene);
    this.gateMarker.rotation.x = Math.PI / 2;
    this.gateMarker.material = mat;
    this.gateMarker.isPickable = false;
    this.gateMarker.checkCollisions = false;
    this.gateMarker.setEnabled(false);
  }

  private buildGun() {
    this.pumpMesh = undefined;
    const model = buildWeaponModel(this.scene, this.gun, this.weapon, this.loadout);
    this.gunParts = model.parts;
    this.magazineMesh = model.magazine;
    this.muzzle = model.muzzle;
    this.pumpMesh = model.pump;
    this.gun.parent = this.camera;
    this.gun.setEnabled(this.state !== 'menu');
    this.gun.scaling.setAll(1);
    this.weaponBaseZ = this.weapon.id === 'pistol' ? -0.75 : -0.65;
    this.gun.position.set(0.34, -0.3, this.weaponBaseZ);
    this.gun.rotation.set(0, 0, 0);
  }

  private spawnEnemies() {
    const positions = ENEMY_SPAWNS;
    const bodyMat = this.material(new Color3(0.25, 0.29, 0.23));
    const armorMat = this.material(new Color3(0.09, 0.11, 0.09));
    const eyeMat = this.material(new Color3(0.9, 0.22, 0.08), 1.4);
    positions.forEach((spawn, index) => {
      const root = new TransformNode(`hostile ${index + 1}`, this.scene);
      root.position = new Vector3(spawn.x, 0, spawn.z);
      root.metadata = { spawn: root.position.clone(), stage: spawn.stage, boss: spawn.boss };
      if (spawn.boss) root.scaling.setAll(2.1);
      const make = (name: string, w: number, h: number, d: number, y: number, mat: StandardMaterial, x = 0) => {
        const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.parent = root;
        mesh.position.set(x, y, 0);
        mesh.material = mat;
        mesh.isPickable = false;
        return mesh;
      };
      const body = make('torso', 0.72, 0.82, 0.4, 1.35, bodyMat);
      const head = make('head', 0.4, 0.4, 0.4, 1.98, armorMat);
      make('visor', 0.31, 0.09, 0.025, 2.01, eyeMat).position.z = 0.21;
      make('armor', 0.8, 0.36, 0.44, 1.51, armorMat);
      make('shoulder armor', 0.28, 0.25, 0.5, 1.55, armorMat, -0.5);
      make('shoulder armor', 0.28, 0.25, 0.5, 1.55, armorMat, 0.5);
      make('backpack', 0.58, 0.65, 0.22, 1.32, armorMat).position.z = -0.3;
      if (spawn.boss) {
        make('warden chest core', 0.36, 0.36, 0.05, 1.48, eyeMat).position.z = 0.25;
        make('warden helmet crown', 0.52, 0.16, 0.48, 2.23, armorMat);
        make('warden shoulder blade', 0.35, 0.6, 0.28, 1.95, armorMat, -0.64).rotation.z = -0.3;
        make('warden shoulder blade', 0.35, 0.6, 0.28, 1.95, armorMat, 0.64).rotation.z = 0.3;
      }
      const leftArm = make('left arm', 0.2, 0.75, 0.23, 1.35, bodyMat, -0.5);
      const rightArm = make('right arm', 0.2, 0.75, 0.23, 1.35, bodyMat, 0.5);
      const limbs = [
        make('left leg', 0.25, 0.85, 0.27, 0.48, armorMat, -0.2),
        make('right leg', 0.25, 0.85, 0.27, 0.48, armorMat, 0.2),
        leftArm,
        rightArm,
      ];
      const weapon = new TransformNode('hostile rifle', this.scene);
      weapon.parent = root;
      weapon.position.set(0.27, 1.4, 0.34);
      const gunPart = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat = armorMat) => {
        const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.parent = weapon; mesh.position.set(x, y, z); mesh.material = mat; mesh.isPickable = false;
        return mesh;
      };
      gunPart('hostile receiver', 0.15, 0.17, 0.65, 0, 0, 0);
      gunPart('hostile barrel', 0.055, 0.055, 0.6, 0, 0.025, 0.58, bodyMat);
      gunPart('hostile stock', 0.17, 0.22, 0.32, 0, -0.02, -0.45);
      gunPart('hostile magazine', 0.12, 0.3, 0.18, 0, -0.21, 0.02).rotation.x = -0.2;
      gunPart('hostile optic', 0.11, 0.11, 0.22, 0, 0.14, 0.03);
      const muzzleFlash = MeshBuilder.CreateCylinder('hostile muzzle flash', { diameterTop: 0, diameterBottom: 0.3, height: 0.5, tessellation: 5 }, this.scene);
      muzzleFlash.parent = weapon; muzzleFlash.rotation.x = Math.PI / 2; muzzleFlash.position.set(0, 0.025, 1.02);
      muzzleFlash.material = this.material(new Color3(1, 0.55, 0.12), 2.5); muzzleFlash.isPickable = false; muzzleFlash.setEnabled(false);
      make('hostile handguard grip', 0.23, 0.23, 0.25, 1.34, bodyMat, -0.33).position.z = 0.49;
      make('hostile trigger hand', 0.23, 0.23, 0.25, 1.34, bodyMat, 0.4).position.z = 0.31;
      if (spawn.boss) {
        weapon.scaling.setAll(1.25);
        gunPart('warden heavy barrel shroud', 0.25, 0.25, 0.65, 0, 0.02, 0.5, bodyMat);
      }
      body.metadata = { enemyIndex: index, multiplier: 1 };
      head.metadata = { enemyIndex: index, multiplier: 2 };
      body.isPickable = true;
      head.isPickable = true;
      for (const limb of limbs) { limb.isPickable = true; limb.metadata = { enemyIndex: index, multiplier: 0.65 }; }
      let telegraph: Mesh | undefined;
      if (spawn.boss) {
        telegraph = MeshBuilder.CreateDisc('warden attack warning', { radius: 1.6, tessellation: 32 }, this.scene);
        telegraph.parent = root;
        telegraph.position.y = 0.025;
        telegraph.material = this.material(new Color3(1, 0.22, 0.05), 1.5);
        telegraph.isPickable = false;
        telegraph.setEnabled(false);
      }
      this.enemies.push({ id: index, root, body, head, limbs, health: 100, alive: true, attackAt: 0, phase: index, hitAt: 0, windupUntil: 0, assetVersion: 0, deadAt: 0, weapon, muzzleFlash, telegraph });
    });
  }

  private spawnZombies() {
    const skin = this.material(new Color3(0.34, 0.43, 0.25));
    const cloth = this.material(new Color3(0.19, 0.22, 0.17));
    const eye = this.material(new Color3(0.85, 0.65, 0.15), 1.2);
    const runnerSkin = this.material(new Color3(0.48, 0.3, 0.2));
    const bruteSkin = this.material(new Color3(0.24, 0.34, 0.27));
    const spitterSkin = this.material(new Color3(0.22, 0.48, 0.18));
    const acidMat = this.material(new Color3(0.65, 1, 0.12), 1.6);
    const wound = this.material(new Color3(0.32, 0.045, 0.035));
    const bone = this.material(new Color3(0.62, 0.57, 0.4));
    for (const spawn of ZOMBIE_SPAWNS) {
      const index = this.enemies.length;
      const root = new TransformNode(`infected ${spawn.id + 1}`, this.scene);
      root.position.set(spawn.x, 0, spawn.z);
      const kind = zombieKind(spawn.id, 1);
      root.metadata = { spawn: root.position.clone(), stage: 0, boss: false, zombie: true, kind };
      const skinMat = kind === 'runner' ? runnerSkin : kind === 'brute' ? bruteSkin : kind === 'spitter' ? spitterSkin : skin;
      const scale = kind === 'brute' ? 1.35 : kind === 'runner' ? 0.88 : 1;
      root.scaling.set(scale, kind === 'brute' ? 1.2 : 1, scale);
      const make = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial) => {
        const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.parent = root;
        mesh.position.set(x, y, z);
        mesh.material = mat;
        mesh.isPickable = false;
        return mesh;
      };
      const body = make('infected torso', 0.68, 0.8, 0.38, 0, 1.3, 0, cloth);
      body.rotation.x = 0.2;
      body.rotation.z = spawn.id % 2 ? 0.1 : -0.1;
      const head = make('infected head', 0.42, 0.43, 0.4, 0.08, 1.91, 0.12, skinMat);
      head.rotation.z = spawn.id % 2 ? 0.2 : -0.22;
      make('infected eyes', 0.29, 0.05, 0.025, 0.08, 1.96, 0.33, kind === 'spitter' ? acidMat : eye);
      make('infected mouth', 0.24, 0.11, 0.035, 0.06, 1.78, 0.34, wound);
      make('infected lower jaw', 0.27, 0.08, 0.16, 0.06, 1.72, 0.27, skinMat).rotation.x = 0.18;
      make('torn shirt chest', 0.36, 0.38, 0.025, -0.1, 1.4, 0.22, skinMat).rotation.z = -0.12;
      make('infected chest wound', 0.22, 0.17, 0.035, -0.12, 1.38, 0.245, wound).rotation.z = 0.35;
      make('exposed ribs', 0.3, 0.035, 0.045, -0.1, 1.44, 0.27, bone).rotation.z = -0.12;
      make('exposed ribs', 0.26, 0.035, 0.045, -0.12, 1.35, 0.27, bone).rotation.z = -0.12;
      make('torn sleeve', 0.27, 0.3, 0.28, -0.43, 1.55, 0, cloth).rotation.z = -0.12;
      make('infected shoulder wound', 0.17, 0.12, 0.03, 0.39, 1.56, 0.15, wound);
      make('infected belt', 0.72, 0.12, 0.41, 0, 0.95, 0, wound);
      if (kind === 'spitter') {
        make('spitter acid sac', 0.46, 0.36, 0.12, 0, 1.42, 0.24, acidMat);
        make('spitter jaw', 0.28, 0.16, 0.2, 0, 1.75, 0.25, spitterSkin);
      }
      const leftLeg = make('infected left leg', 0.23, 0.8, 0.25, -0.2, 0.44, 0, cloth);
      const rightLeg = make('infected right leg', 0.23, 0.8, 0.25, 0.2, 0.44, -0.09, cloth);
      rightLeg.rotation.z = 0.09;
      const leftArm = make('infected left arm', 0.2, 0.2, 0.72, -0.43, 1.42, 0.35, skinMat);
      const rightArm = make('infected right arm', 0.2, 0.2, 0.72, 0.43, 1.5, 0.28, skinMat);
      rightArm.rotation.z = -0.22;
      leftArm.rotation.x = 0.12;
      make('infected left hand', 0.24, 0.26, 0.22, -0.43, 1.39, 0.77, skinMat).rotation.x = 0.35;
      make('infected right hand', 0.24, 0.26, 0.22, 0.53, 1.46, 0.67, skinMat).rotation.z = -0.2;
      make('infected arm wound', 0.21, 0.08, 0.22, -0.43, 1.43, 0.48, wound);
      const limbs = [leftLeg, rightLeg, leftArm, rightArm];
      if (kind === 'runner') {
        head.rotation.x = -0.15;
        make('runner torn vest', 0.73, 0.22, 0.43, 0, 1.1, 0, wound);
      }
      if (kind === 'brute') {
        make('brute swollen shoulder', 0.42, 0.42, 0.44, -0.48, 1.56, 0, skinMat);
        make('brute exposed chest', 0.46, 0.35, 0.06, 0.08, 1.42, 0.24, wound);
      }
      for (const [part, multiplier] of [[body, 1], [head, 2], ...limbs.map((limb) => [limb, 0.65] as const)] as const) {
        part.metadata = { enemyIndex: index, multiplier };
        part.isPickable = true;
      }
      const telegraph = MeshBuilder.CreateDisc('attack warning', { radius: kind === 'brute' ? 1.1 : 0.75, tessellation: 24 }, this.scene);
      telegraph.parent = root;
      telegraph.position.y = 0.035;
      telegraph.material = this.material(new Color3(1, 0.24, 0.07), 1.5);
      telegraph.isPickable = false;
      telegraph.checkCollisions = false;
      telegraph.setEnabled(false);
      this.enemies.push({ id: index, root, body, head, limbs, health: zombieHealth(1, kind), alive: false, attackAt: 0, phase: spawn.id, hitAt: 0, windupUntil: 0, assetVersion: 0, deadAt: 0, telegraph });
      root.setEnabled(false);
    }
  }

  private networkClock(serverTime: number) { return serverTime + this.networkClockOffset; }

  private applyZombieKind(enemy: Enemy, kind: ZombieKind) {
    const meta = enemy.root.metadata as { kind?: ZombieKind };
    if (meta.kind === kind) return;
    meta.kind = kind;
    const assetKind = this.enemyKind(enemy);
    if (enemy.assetKind && enemy.assetKind !== assetKind) void this.upgradeEnemy(enemy).catch(() => console.warn('Infected variant asset could not be loaded.'));
    const scale = kind === 'brute' ? 1.35 : kind === 'runner' ? 0.88 : 1;
    enemy.root.scaling.set(scale, kind === 'brute' ? 1.2 : 1, scale);
    enemy.body.material = this.material(new Color3(kind === 'brute' ? 0.24 : kind === 'runner' ? 0.32 : 0.19, kind === 'runner' ? 0.16 : 0.22, 0.17));
    enemy.head.material = this.material(new Color3(kind === 'runner' ? 0.48 : kind === 'brute' ? 0.24 : 0.34, kind === 'runner' ? 0.3 : kind === 'brute' ? 0.34 : 0.43, kind === 'runner' ? 0.2 : kind === 'brute' ? 0.27 : 0.25));
    for (const limb of enemy.limbs.slice(2)) limb.material = enemy.head.material;
    for (const mesh of enemy.root.getChildMeshes()) {
      if (mesh.name === 'spitter acid sac' || mesh.name === 'spitter jaw') mesh.setEnabled(kind === 'spitter');
      if (mesh.name === 'infected eyes' && kind === 'spitter') mesh.material = this.material(new Color3(0.65, 1, 0.12), 1.6);
    }
  }

  private updatePerformanceReadout() {
    if (location.hash !== '#debug' || performance.now() <= this.performanceUiAt) return;
    this.performanceUiAt = performance.now() + 500;
    let readout = document.getElementById('performance-readout');
    if (!readout) {
      readout = document.createElement('div'); readout.id = 'performance-readout'; readout.className = 'performance-readout'; document.body.append(readout);
    }
    const rigs = [...this.operatorModels.values()].filter((rig) => rig.asset).length + this.enemies.filter((enemy) => enemy.asset).length;
    readout.textContent = `${this.engine.getFps().toFixed(0)} FPS · ${this.scene.getActiveMeshes().length} meshes · ${this.sceneInstrumentation.drawCallsCounter.current} calls · ${this.scene.getActiveIndices() / 3} tris · ${rigs} rigs`;
  }

  private update() {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    if (this.state === 'menu') {
      if (this.operatorInspection) {
        const selected = this.operatorModels.get(this.perk)!;
        this.camera.position.set(-0.35, 2.05, selected.root.position.z + 4.6);
        this.camera.setTarget(new Vector3(0.7, selected.root.position.y + 1.35, selected.root.position.z));
      } else {
        this.camera.position.set(6.2, 2.35, 12);
        this.camera.setTarget(new Vector3(6.2, 1.4, 3.5));
      }
      this.updateOperatorPreview(dt);
      this.gun.setEnabled(false);
      return;
    }
    if (this.state !== 'playing') return;
    this.gun.setEnabled(!(this.aiming && this.loadout.optic));
    this.updatePlayer(dt);
    this.updateSupplies();
    this.interpolateNetwork(dt);
    this.animateEnemies(dt);
    this.updateGrenades(dt);
    this.updateAcid(dt);
    if (this.mode === 'zombies') {
      if (this.waveBreak) {
        const seconds = Math.max(0, Math.ceil((this.nextWaveAt - Date.now()) / 1000));
        this.events.onObjective(`RESUPPLY — WAVE ${this.wave + 1} IN ${seconds}s`);
      } else this.events.onObjective(`SURVIVE WAVE ${this.wave}`);
      if (!this.isCoop && this.waveBreak && performance.now() >= this.nextWaveAt) this.spawnNextWave();
    }
    if (this.gateMarker.isEnabled()) {
      this.gateMarker.rotation.z = performance.now() * 0.001;
      this.gateMarker.position.y = 2.7 + Math.sin(performance.now() * 0.003) * 0.15;
    }
    if (this.mode === 'dungeon' && this.stage === 1 && this.camera.position.z < -28) this.events.onObjective('CLEAR THE CHAMBER');
    if (this.mode === 'dungeon' && this.stage === 2 && this.camera.position.z < -74) this.events.onObjective('DEFEAT THE WARDEN');
    if (this.downed) {
      this.camera.position.y = Math.max(0.65, this.camera.position.y - dt * 2);
      this.gun.setEnabled(false);
      this.firing = false;
    } else this.updateWeapon(dt);
    if (this.isCoop) {
      if (performance.now() - this.networkSentAt > 50) {
        this.networkSentAt = performance.now();
        this.sendNetwork({ type: 'state', x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, yaw: this.camera.rotation.y, pitch: this.camera.rotation.x });
      }
      if (this.reviveTarget && this.keys.has('KeyE') && !this.downed) this.sendNetwork({ type: 'revive', playerId: this.reviveTarget });
      const target = this.lastWorld?.players.find((player) => player.id === this.reviveTarget);
      this.events.onRevive(this.downed ? 'DOWNED — A TEAMMATE CAN REVIVE YOU' : this.reviveTarget ? `${this.keys.has('KeyE') ? 'REVIVING' : 'HOLD [E] REVIVE'} ${this.reviveTarget}` : '', target?.reviveProgress ?? 0);
      if (this.lastWorld?.ended) this.finish(this.lastWorld.ended === 'won');
    } else this.updateEnemies(dt);
  }

  private interpolateNetwork(dt: number) {
    if (!this.isCoop) return;
    const blend = Math.min(1, dt * 15);
    for (const [id, target] of this.enemyTargets) {
      const enemy = this.enemies[id];
      if (!enemy) continue;
      enemy.root.position = Vector3.Lerp(enemy.root.position, target.position, blend);
      enemy.root.rotation.y += Math.atan2(Math.sin(target.yaw - enemy.root.rotation.y), Math.cos(target.yaw - enemy.root.rotation.y)) * blend;
    }
    for (const [id, target] of this.teammateTargets) {
      const model = this.teammates.get(id);
      if (!model) continue;
      model.position = Vector3.Lerp(model.position, target.position, blend);
      model.rotation.y += Math.atan2(Math.sin(target.yaw - model.rotation.y), Math.cos(target.yaw - model.rotation.y)) * blend;
      const limbs = model.metadata?.limbs as Mesh[] | undefined;
      if (limbs && Vector3.Distance(model.position, target.position) > 0.04) limbs.forEach((limb, index) => { limb.rotation.x = Math.sin(performance.now() * 0.009 + index * Math.PI) * 0.4; });
    }
  }

  private animateEnemies(dt: number) {
    const now = performance.now();
    for (const enemy of this.enemies) {
      if (enemy.assetKind !== this.enemyKind(enemy)) void this.upgradeEnemy(enemy).catch(() => console.warn('Infected variant asset could not be loaded.'));
      if (!enemy.alive) {
        if (enemy.deadAt && now - enemy.deadAt >= 4000) { enemy.root.setEnabled(false); enemy.deadAt = 0; }
        continue;
      }
      enemy.deadAt = 0;
      const target = this.isCoop ? this.enemyTargets.get(enemy.id) : undefined;
      const moving = this.isCoop ? (target ? Vector3.Distance(target.position, enemy.root.position) > 0.04 : false) : true;
      const meta = enemy.root.metadata as { zombie?: boolean; kind?: string; boss?: boolean };
      if (meta.zombie && this.isCoop && this.lastWorld?.enemies[enemy.id]) this.applyZombieKind(enemy, this.lastWorld.enemies[enemy.id].kind as ZombieKind);
      if (moving) enemy.limbs.forEach((limb, index) => { limb.rotation.x = Math.sin(now * (meta.kind === 'runner' ? 0.015 : 0.007) + index * Math.PI) * (meta.zombie ? 0.3 : 0.4); });
      enemy.hitAt = Math.max(0, enemy.hitAt - dt * 1000);
      enemy.root.rotation.z += ((enemy.hitAt > 0 ? 0.1 : 0) - enemy.root.rotation.z) * Math.min(1, dt * 18);
      const windup = enemy.windupUntil > now;
      if (enemy.asset) enemy.asset.play(characterClip((meta.zombie ? meta.kind === 'runner' ? 'infectedRunner' : meta.kind ?? 'walker' : 'hostile') as 'hostile' | 'walker' | 'infectedRunner' | 'brute' | 'spitter', moving, windup, enemy.hitAt > 0));
      enemy.telegraph?.setEnabled(windup && (meta.kind === 'brute' || meta.kind === 'spitter' || meta.boss === true));
      if (enemy.telegraph?.isEnabled()) enemy.telegraph.scaling.setAll(0.85 + Math.sin(now * 0.02) * 0.15);
      const stagger = meta.zombie ? (enemy.phase % 2 ? 0.1 : -0.1) : 0;
      enemy.body.rotation.z = stagger + (windup ? Math.sin(now * 0.025) * 0.09 : enemy.hitAt > 0 ? Math.sin(enemy.hitAt * 0.04) * 0.13 : 0);
      enemy.muzzleFlash?.setEnabled(!meta.zombie && windup && (enemy.windupUntil - now) < 100);
      if (enemy.weapon) {
        enemy.weapon.rotation.x = windup ? -0.04 + Math.sin(now * 0.04) * 0.025 : Math.sin(now * 0.003 + enemy.phase) * 0.025;
        enemy.limbs[2].rotation.x = -0.95;
        enemy.limbs[3].rotation.x = -1.05;
      }
      if (meta.zombie) {
        enemy.head.rotation.z = (enemy.phase % 2 ? 0.2 : -0.22) + Math.sin(now * 0.003 + enemy.phase) * 0.06;
        enemy.limbs[2].rotation.x = 0.12 + Math.sin(now * 0.006 + enemy.phase) * 0.12;
        enemy.limbs[3].rotation.x = Math.sin(now * 0.007 + enemy.phase) * 0.16;
      }
      if (windup && meta.zombie) enemy.limbs.slice(2).forEach((limb) => { limb.rotation.x = -0.55; });
    }
  }

  private updatePlayer(dt: number) {
    const forward = this.camera.getDirection(new Vector3(0, 0, 1));
    forward.y = 0;
    forward.normalize();
    const right = Vector3.Cross(UP, forward).normalize();
    const move = Vector3.Zero();
    if (this.keys.has('KeyW')) move.addInPlace(forward);
    if (this.keys.has('KeyS')) move.subtractInPlace(forward);
    if (this.keys.has('KeyD')) move.addInPlace(right);
    if (this.keys.has('KeyA')) move.subtractInPlace(right);
    if (this.mobileMove.lengthSquared() > 0.01) {
      move.addInPlace(forward.scale(-this.mobileMove.y));
      move.addInPlace(right.scale(this.mobileMove.x));
    }
    const moving = move.lengthSquared() > 0;
    if (moving) {
      move.normalize();
      const sprint = (this.keys.has('ShiftLeft') || this.mobileSprint || this.mobileMove.length() > 0.92) && !this.aiming && !this.crouched;
      const speed = (this.crouched ? 2.2 : sprint ? 6.2 : this.aiming ? 2.7 : 4.2) * PERKS[this.perk].speed;
      if (!this.sliding) this.camera.cameraDirection.addInPlace(move.scale(speed * dt));
      this.walkTime += dt * (sprint ? 12 : 8);
    }
    if (this.sliding) {
      const progress = (performance.now() - this.slideStartedAt) / 650;
      this.camera.cameraDirection.addInPlace(this.slideDirection.scale(dt * 9 * (1 - progress * 0.65)));
      if (progress >= 1) this.sliding = false;
    }
    const stanceHeight = this.sliding || this.crouched ? 1.08 : 1.7;
    if (this.verticalVelocity === 0) this.camera.position.y += (stanceHeight - this.camera.position.y) * Math.min(1, dt * 12);
    this.verticalVelocity -= 15 * dt;
    this.camera.cameraDirection.y = this.verticalVelocity * dt;
    if (this.camera.position.y <= stanceHeight + 0.02 && this.verticalVelocity <= 0) {
      this.camera.position.y = stanceHeight;
      this.camera.cameraDirection.y = 0;
      this.verticalVelocity = 0;
      this.camera.cameraDirection.y = 0;
    }
    const targetFov = this.aiming ? (this.loadout.optic ? this.baseFov * 0.44 : this.baseFov * 0.68) : this.baseFov;
    this.events.onScope(this.aiming && this.loadout.optic);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    const bob = moving && !this.reducedMotion ? Math.sin(this.walkTime) * 0.008 : 0;
    const reloading = this.reloadAt > 0;
    const targetX = reloading ? 0.12 : this.aiming ? 0 : 0.34;
    const targetY = (reloading ? -0.48 : this.aiming ? (this.loadout.optic ? -0.215 : -0.09) : -0.3) + bob;
    const targetZ = (reloading ? -0.72 : this.aiming ? -0.48 : this.weaponBaseZ);
    this.gun.position.x += (targetX - this.gun.position.x) * dt * 14;
    this.gun.position.y += (targetY - this.gun.position.y) * dt * 14;
    this.gun.position.z += (targetZ + this.recoil - this.gun.position.z) * Math.min(1, dt * 18);
    const movementSpread = moving ? 3 : 0;
    this.events.onSpread((this.aiming ? 0 : this.weapon.spread * 75) + movementSpread + this.recoil * 90);
  }

  private updateWeapon(dt: number) {
    this.recoil *= Math.max(0, 1 - dt * 15);
    if (this.pumpMesh) {
      const cycle = Math.max(0, Math.min(1, 1 - (this.nextShot - performance.now()) / this.weapon.fireDelay));
      this.pumpMesh.position.z = this.weapon.id === 'shotgun' && this.nextShot > performance.now() ? -Math.sin(cycle * Math.PI) * 0.18 : 0;
    }
    this.weaponKick *= Math.max(0, 1 - dt * 18);
    this.gun.rotation.z = Math.sin(this.walkTime * 0.5) * (this.aiming ? 0.002 : 0.008);
    this.gun.rotation.x = this.weaponKick;
    if (this.magazineMesh) this.magazineMesh.position.y = this.weapon.id === 'pistol' ? -0.25 : -0.285;
    if (this.sliding) {
      this.gun.rotation.z = -0.12;
      this.gun.rotation.x = 0.08;
    }
    if (this.reloadAt) {
      const progress = Math.min(1, (performance.now() - this.reloadStartedAt) / this.weapon.reloadMs);
      const tilt = Math.sin(progress * Math.PI);
      this.gun.rotation.z = tilt * 0.65;
      this.gun.rotation.x = tilt * 0.55;
      if (this.magazineMesh) {
        if (progress < 0.4) this.magazineMesh.position.y = (this.weapon.id === 'pistol' ? -0.25 : -0.285) - Math.sin(progress / 0.4 * Math.PI / 2) * 0.7;
        else if (progress < 0.7) this.magazineMesh.position.y = -0.92;
        else this.magazineMesh.position.y = -0.92 + ((progress - 0.7) / 0.3) * 0.7;
      }
    }
    if (this.reloadAt && performance.now() >= this.reloadAt) {
      const needed = this.weapon.magazine - this.ammo;
      const loaded = Math.min(needed, this.reserve);
      this.ammo += loaded;
      this.reserve -= loaded;
      this.reloadAt = 0;
      this.events.onAmmo(this.ammo, this.reserve);
      this.events.onReload(false);
    }
    if (this.firing && this.triggerReady && !this.reloadAt && performance.now() >= this.nextShot) {
      if (this.ammo <= 0) {
        if (performance.now() > this.lastEmptySound) {
          this.lastEmptySound = performance.now() + 350;
          this.combatAudio?.empty();
        }
        this.reload();
      }
      else {
        this.shoot();
        if (!this.weapon.automatic) this.triggerReady = false;
      }
    }
  }

  private reload() {
    if (this.reloadAt || this.ammo === this.weapon.magazine || this.reserve === 0) return;
    this.reloadStartedAt = performance.now();
    this.reloadAt = this.reloadStartedAt + this.weapon.reloadMs;
    this.events.onReload(true);
    this.combatAudio?.reload(this.weapon.id);
  }

  private shoot() {
    const now = performance.now();
    this.nextShot = now + this.weapon.fireDelay;
    this.ammo--;
    this.shots++;
    this.recoil = Math.min(0.09, this.recoil + (this.weapon.id === 'shotgun' ? 0.065 : 0.035));
    this.weaponKick = this.weapon.id === 'shotgun' ? 0.14 : this.weapon.id === 'ak' ? 0.08 : this.weapon.id === 'pistol' ? 0.09 : this.weapon.id === 'smg' ? 0.04 : 0.055;
    this.camera.rotation.x -= this.weapon.recoil * (this.aiming ? 0.5 : 1);
    this.camera.rotation.y += (Math.random() - 0.5) * this.weapon.recoil;
    this.events.onAmmo(this.ammo, this.reserve);
    this.combatAudio?.weapon(this.weapon.id);
    this.muzzle.setEnabled(true);
    setTimeout(() => this.muzzle.setEnabled(false), 35);

    const origin = this.camera.position.clone();
    const forward = this.camera.getDirection(Vector3.Forward());
    const right = Vector3.Cross(UP, forward).normalize();
    const up = Vector3.Cross(forward, right).normalize();
    const spread = this.weapon.spread * (this.aiming ? 0.4 : 1);
    this.shotRegions.clear();
    const hits = new Map<number, { enemy: Enemy; pellets: number; headshot: boolean }>();
    for (let pellet = 0; pellet < this.weapon.pellets; pellet++) {
      const direction = forward.add(right.scale((Math.random() - 0.5) * spread)).add(up.scale((Math.random() - 0.5) * spread)).normalize();
      const ray = new Ray(origin, direction, this.weapon.range);
      const hit = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable && mesh.isEnabled());
      if (!hit?.hit || !hit.pickedPoint) continue;
      const metadata = hit.pickedMesh?.metadata as { enemyIndex?: number; multiplier?: number } | undefined;
      if (metadata?.enemyIndex !== undefined) {
        const enemy = this.enemies[metadata.enemyIndex];
        if (enemy.alive && enemy.root.isEnabled()) {
          const previous = hits.get(metadata.enemyIndex);
          hits.set(metadata.enemyIndex, { enemy, pellets: (previous?.pellets ?? 0) + 1, headshot: previous?.headshot || metadata.multiplier === 2 });
          this.shotRegions.set(metadata.enemyIndex, this.hitRegion(enemy, hit.pickedPoint));
        }
      }
      if (pellet < 3 || this.weapon.pellets === 1) this.impact(hit.pickedPoint);
    }
    for (const hit of hits.values()) {
      const falloff = this.weapon.id === 'shotgun' ? Math.max(0.45, 1 - this.camera.position.subtract(hit.enemy.root.position).length() / this.weapon.range * 0.65) : 1;
      const multiplier = this.shotRegions.get(hit.enemy.id) ?? 1;
      if (this.isCoop) this.sendNetwork({ type: 'shoot', enemyId: hit.enemy.id, hitRegion: multiplier, pellets: hit.pellets });
      else this.damageEnemy(hit.enemy, this.weapon.damage * hit.pellets * multiplier * falloff);
    }
  }

  private createGrenadeMesh(key: string) {
    const mesh = MeshBuilder.CreateSphere(key, { diameter: 0.16, segments: 5 }, this.scene);
    mesh.material = this.material(new Color3(0.32, 0.38, 0.18));
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    this.grenadeMeshes.set(key, mesh);
    return mesh;
  }

  private useMedkit() {
    const maxHealth = PERKS[this.perk].maxHealth;
    if (this.medkits <= 0 || this.health >= maxHealth || performance.now() < this.nextMedkitAt) return;
    this.medkits--;
    this.nextMedkitAt = performance.now() + 1200;
    this.health = Math.min(maxHealth, this.health + 50);
    this.events.onHealth(this.health);
    this.events.onMedkits(this.medkits);
    this.combatAudio?.pickup();
    this.events.onMessage('+50 HEALTH');
    if (this.isCoop) this.sendNetwork({ type: 'heal' });
  }

  private switchWeapon(slot: 1 | 2) {
    if (this.activeSlot === slot) return;
    this.weaponAmmo.set(this.weapon.id, { ammo: this.ammo, reserve: this.reserve });
    this.activeSlot = slot;
    this.reloadAt = 0;
    this.firing = false;
    this.aiming = false;
    this.events.onReload(false);
    this.events.onScope(false);
    this.weapon = getWeapon(slot === 1 ? this.primaryId : this.secondaryId, this.loadout);
    const saved = this.weaponAmmo.get(this.weapon.id);
    this.ammo = saved?.ammo ?? this.weapon.magazine;
    this.reserve = saved?.reserve ?? Math.round(this.weapon.reserve * PERKS[this.perk].ammo);
    for (const mesh of this.gunParts) { mesh.material?.dispose(); mesh.dispose(); }
    this.gunParts = [];
    this.buildGun();
    this.events.onWeapon(this.weapon);
    this.events.onAmmo(this.ammo, this.reserve);
    this.sendNetwork({ type: 'loadout', weapon: this.weapon.id, loadout: this.loadout, perk: this.perk });
  }

  private throwGrenade() {
    const now = performance.now();
    if (this.grenades <= 0 || now < this.nextGrenadeAt) {
      if (this.grenades <= 0) this.combatAudio?.empty();
      return;
    }
    this.nextGrenadeAt = now + 650;
    this.grenades--;
    this.events.onGrenades(this.grenades);
    this.combatAudio?.throwGrenade();
    const direction = this.camera.getDirection(Vector3.Forward());
    const position = this.camera.position.add(direction.scale(0.65));
    if (this.isCoop) {
      this.sendNetwork({ type: 'grenade', x: position.x, y: position.y, z: position.z, vx: direction.x * 10, vy: direction.y * 10 + 4.5, vz: direction.z * 10 });
      return;
    }
    const id = ++this.localGrenadeId;
    this.localGrenades.set(id, { id, x: position.x, y: position.y, z: position.z, vx: direction.x * 10, vy: direction.y * 10 + 4.5, vz: direction.z * 10, explodeAt: now + GRENADE_FUSE_MS, owner: 'local' });
    this.createGrenadeMesh(`local-${id}`);
  }

  private updateGrenades(dt: number) {
    if (this.isCoop) return;
    const now = performance.now();
    for (const [id, grenade] of this.localGrenades) {
      grenade.vy -= 12 * dt;
      const next = new Vector3(grenade.x + grenade.vx * dt, grenade.y + grenade.vy * dt, grenade.z + grenade.vz * dt);
      if (this.blocked(next)) { grenade.vx *= -0.45; grenade.vz *= -0.45; }
      else { grenade.x = next.x; grenade.z = next.z; }
      grenade.y = next.y;
      if (grenade.y < 0.1) { grenade.y = 0.1; grenade.vy = Math.abs(grenade.vy) * 0.42; grenade.vx *= 0.72; grenade.vz *= 0.72; }
      const mesh = this.grenadeMeshes.get(`local-${id}`);
      if (mesh) { mesh.position.set(grenade.x, grenade.y, grenade.z); mesh.rotation.x += dt * 8; }
      if (now < grenade.explodeAt) continue;
      this.localGrenades.delete(id);
      mesh?.dispose();
      this.grenadeMeshes.delete(`local-${id}`);
      const position = new Vector3(grenade.x, grenade.y, grenade.z);
      this.explode(position);
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const meta = enemy.root.metadata as { zombie?: boolean; stage: number };
        if (!!meta.zombie !== (this.mode === 'zombies') || meta.stage !== this.stage) continue;
        const distance = Vector3.Distance(enemy.root.position, position);
        if (distance < 5) this.damageEnemy(enemy, grenadeDamage(distance));
      }
    }
  }

  private explode(position: Vector3) {
    this.combatAudio?.explosion();
    const blast = MeshBuilder.CreateSphere('grenade blast', { diameter: 1, segments: 8 }, this.scene);
    blast.position.copyFrom(position);
    const material = this.material(new Color3(1, 0.42, 0.08), 2);
    material.alpha = 0.8;
    blast.material = material;
    blast.isPickable = false;
    const start = performance.now();
    const animate = () => {
      const progress = Math.min(1, (performance.now() - start) / 350);
      blast.scaling.setAll(1 + progress * 8);
      material.alpha = 0.8 * (1 - progress);
      if (progress < 1) requestAnimationFrame(animate);
      else { blast.dispose(); material.dispose(); }
    };
    animate();
  }

  private damageEnemy(enemy: Enemy, damage: number) {
    if (!enemy.alive) return;
    enemy.health -= damage;
    enemy.hitAt = 150;
    const killed = enemy.health <= 0;
    this.events.onHit(killed);
    this.combatAudio?.hit(killed);
    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.deadAt = performance.now();
      if (enemy.asset) {
        enemy.asset.root.setEnabled(true);
        enemy.asset.play('Death', false);
        enemy.telegraph?.setEnabled(false);
        enemy.muzzleFlash?.setEnabled(false);
      } else enemy.root.setEnabled(false);
      this.kills++;
      this.events.onEnemies(this.enemies.length - this.kills);
      this.events.onBoss(this.enemies.find((entry) => (entry.root.metadata as { boss: boolean }).boss)?.health ?? 0, 800);
      const remaining = this.enemies.filter((entry) => (entry.root.metadata as { stage: number }).stage === this.stage && entry.alive && (this.mode === 'zombies') === !!(entry.root.metadata as { zombie?: boolean }).zombie).length;
      this.events.onEnemies(remaining);
      if (remaining === 0) {
        if (this.mode === 'zombies') this.completeWave();
        else if (this.stage === 2) this.finish(true);
        else this.updateStage(this.stage + 1, true);
      }
    }
  }

  private completeWave() {
    if (this.waveBreak) return;
    this.waveBreak = true;
    this.nextWaveAt = performance.now() + 7000;
    this.collectedSupplies.clear();
    this.grenades = GRENADE_CAPACITY;
    this.events.onGrenades(this.grenades);
    this.events.onMessage(`WAVE ${this.wave} CLEARED — RESUPPLY`);
  }

  private spawnNextWave() {
    this.wave++;
    this.events.onWave(this.wave);
    this.waveBreak = false;
    this.nextWaveAt = 0;
    this.collectedSupplies.clear();
    for (const enemy of this.enemies) {
      const meta = enemy.root.metadata as { zombie?: boolean; kind?: ZombieKind };
      if (!meta.zombie) continue;
      this.applyZombieKind(enemy, zombieKind(enemy.phase, this.wave));
      enemy.alive = enemy.phase < zombieWaveSize(this.wave);
      enemy.deadAt = 0;
      enemy.health = zombieHealth(this.wave, zombieKind(enemy.phase, this.wave));
      enemy.attackAt = 0;
      enemy.root.position.copyFrom((meta as { spawn: Vector3 }).spawn);
      enemy.root.setEnabled(enemy.alive);
      if (enemy.alive) enemy.asset?.play('Idle');
    }
    this.events.onEnemies(zombieWaveSize(this.wave));
    this.events.onMessage(`WAVE ${this.wave} INCOMING`);
  }

  private updateStage(stage: number, announce: boolean) {
    this.stage = stage;
    this.events.onStage(stage, STAGE_NAMES[stage]);
    this.events.onObjective(stage === 0 ? 'CLEAR THE CHAMBER' : stage === 1 ? 'PROCEED TO NEXT CHAMBER ↓' : stage === 2 ? 'PROCEED TO THE WARDEN ↓' : 'DEFEAT THE WARDEN');
    this.gateMarker.setEnabled(stage === 1 || stage === 2);
    if (stage === 1 || stage === 2) this.gateMarker.position.set(0, 2.7, GATE_Z[stage - 1] + 0.5);
    for (let i = 0; i < this.gates.length; i++) {
      this.gates[i].checkCollisions = i >= stage;
      this.gates[i].setEnabled(i >= stage);
    }
    if (announce && stage > 0) this.events.onMessage(`GATE OPEN — ${STAGE_NAMES[stage]}`);
  }

  private updateSupplies() {
    for (const supply of SUPPLIES) {
      if (this.collectedSupplies.has(supply.id)) continue;
      const mesh = this.supplyMeshes.get(supply.id);
      const available = this.mode === 'zombies' ? supply.id < 2 : supply.id < 2 ? this.stage >= 1 : this.stage >= 2;
      mesh?.setEnabled(available);
      if (!available || Math.hypot(this.camera.position.x - supply.x, this.camera.position.z - supply.z) > 1.5) continue;
      this.collectedSupplies.add(supply.id);
      mesh?.setEnabled(false);
      if (this.isCoop) this.sendNetwork({ type: 'supply', supplyId: supply.id });
      else {
        this.grenades = GRENADE_CAPACITY;
        this.medkits = Math.min(3, this.medkits + 1);
        this.events.onGrenades(this.grenades);
        this.events.onMedkits(this.medkits);
      }
      if (supply.kind === 'health') {
        this.health = Math.min(PERKS[this.perk].maxHealth, this.health + 50);
        this.events.onHealth(this.health);
        this.events.onMessage('+50 HEALTH');
      } else {
        this.reserve += 60;
        this.events.onAmmo(this.ammo, this.reserve);
        this.events.onMessage('+60 AMMO');
      }
      this.combatAudio?.pickup();
    }
  }

  private impact(point: Vector3) {
    const spark = MeshBuilder.CreateSphere('impact', { diameter: 0.06, segments: 4 }, this.scene);
    spark.position.copyFrom(point);
    spark.material = this.material(new Color3(0.85, 0.93, 0.5), 1);
    spark.isPickable = false;
    setTimeout(() => spark.dispose(), 70);
  }

  private createAcidMesh(id: number) {
    const mesh = MeshBuilder.CreateSphere('acid projectile', { diameter: 0.24, segments: 5 }, this.scene);
    mesh.material = this.material(new Color3(0.55, 1, 0.08), 2);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    this.acidMeshes.set(id, mesh);
    return mesh;
  }

  private launchAcid(enemy: Enemy, target: Vector3) {
    const start = enemy.root.position.add(new Vector3(0, 1.65, 0));
    const velocity = target.subtract(start).normalize().scale(SPIT_SPEED);
    const projectile: AcidProjectile = { id: this.nextAcidId++, x: start.x, y: start.y, z: start.z, vx: velocity.x, vy: velocity.y, vz: velocity.z, expiresAt: performance.now() + 2600 };
    this.acidProjectiles.set(projectile.id, projectile);
    this.createAcidMesh(projectile.id).position.set(start.x, start.y, start.z);
    this.combatAudio?.spit();
  }

  private updateAcid(dt: number) {
    if (this.isCoop) return;
    for (const [id, acid] of this.acidProjectiles) {
      const next = new Vector3(acid.x + acid.vx * dt, acid.y + acid.vy * dt, acid.z + acid.vz * dt);
      const hitPlayer = Vector3.DistanceSquared(next, this.camera.position) < 0.45;
      const blocked = this.blocked(next);
      if (hitPlayer && !blocked) this.takeDamage(zombieDamage('spitter'));
      this.acidMeshes.get(id)?.position.copyFrom(next);
      Object.assign(acid, { x: next.x, y: next.y, z: next.z });
      if (hitPlayer || blocked || performance.now() >= acid.expiresAt) {
        this.acidProjectiles.delete(id);
        this.acidMeshes.get(id)?.dispose();
        this.acidMeshes.delete(id);
      }
    }
  }

  private updateEnemies(dt: number) {
    const now = performance.now();
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const toPlayer = this.camera.position.subtract(enemy.root.position);
      toPlayer.y = 0;
      const distance = toPlayer.length();
      const meta = enemy.root.metadata as { stage: number; boss: boolean; zombie?: boolean; kind?: ZombieKind };
      if ((this.mode === 'zombies') !== !!meta.zombie) continue;
      const active = meta.stage === this.stage && now > this.startedAt + (meta.zombie ? 1200 : 3000) + enemy.phase * (meta.zombie ? 70 : 300);
      if (active && distance < 36) {
        toPlayer.normalize();
        enemy.root.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        const spitter = meta.kind === 'spitter';
        const attackDistance = spitter ? 7 : meta.zombie ? 1.65 : 5;
        if (distance > attackDistance) {
          const step = toPlayer.scale(dt * (meta.zombie ? zombieSpeed(this.wave, meta.kind ?? 'walker') : 1.25));
          let separationX = 0;
          let separationZ = 0;
          for (const other of this.enemies) {
            if (other === enemy || !other.alive) continue;
            const otherMeta = other.root.metadata as { zombie?: boolean; stage: number };
            if (!!otherMeta.zombie !== !!meta.zombie || otherMeta.stage !== meta.stage) continue;
            const dx = enemy.root.position.x - other.root.position.x;
            const dz = enemy.root.position.z - other.root.position.z;
            const gap = Math.hypot(dx, dz);
            if (gap > 0.001 && gap < 0.9) {
              separationX += dx / gap * (0.9 - gap);
              separationZ += dz / gap * (0.9 - gap);
            }
          }
          const next = enemy.root.position.add(step).add(new Vector3(separationX * dt * 4, 0, separationZ * dt * 4));
          if (Math.abs(next.x) < 12.8 && (this.mode === 'zombies' ? next.z > -21.5 && next.z < 21.5 : next.z > -114 && next.z < 21.5) && !this.blocked(next)) {
            enemy.root.position.copyFrom(next);
          } else {
            const side = new Vector3(toPlayer.z, 0, -toPlayer.x).scale(dt * (enemy.phase % 2 ? 1.1 : -1.1));
            const alternate = enemy.root.position.add(side);
            if (!this.blocked(alternate)) enemy.root.position.copyFrom(alternate);
          }
          enemy.limbs.forEach((limb, i) => { limb.rotation.x = Math.sin(now * 0.005 + i * Math.PI) * 0.35; });
        }
        const heavy = meta.boss || meta.kind === 'brute';
        if (enemy.windupUntil && now >= enemy.windupUntil) {
          enemy.windupUntil = 0;
          if (spitter) this.launchAcid(enemy, this.camera.position.clone());
          else if (distance < (meta.zombie ? 2.4 : 14) && this.hasLineOfSight(enemy)) this.takeDamage(meta.boss ? 24 : meta.zombie ? zombieDamage(meta.kind ?? 'walker') : distance < 6 ? 12 : 7);
        } else if (!enemy.windupUntil && distance < (spitter ? 18 : meta.zombie ? 1.9 : 13) && now >= enemy.attackAt && this.hasLineOfSight(enemy)) {
          enemy.attackAt = now + (spitter ? 2300 : meta.zombie ? 900 : 1100 + Math.random() * 700);
          enemy.windupUntil = now + (spitter ? 700 : heavy ? 850 : 350);
        }
      }
    }
  }

  private blocked(position: Vector3) {
    return this.obstacles.some((mesh) => {
      if (!mesh.checkCollisions || !mesh.isEnabled() || mesh.name === 'floor' || mesh.name.includes('wall') && mesh.name !== 'vault door') return false;
      const bounds = mesh.getBoundingInfo().boundingBox;
      return position.x > bounds.minimumWorld.x - 0.35 && position.x < bounds.maximumWorld.x + 0.35 &&
        position.z > bounds.minimumWorld.z - 0.35 && position.z < bounds.maximumWorld.z + 0.35 && bounds.maximumWorld.y > 0.5;
    });
  }

  private hasLineOfSight(enemy: Enemy) {
    const start = enemy.root.position.add(new Vector3(0, 1.5, 0));
    const direction = this.camera.position.subtract(start);
    const distance = direction.length();
    direction.normalize();
    const ray = new Ray(start, direction);
    const hit = this.scene.pickWithRay(ray, (mesh) => this.obstacles.some((obstacle) => obstacle === mesh) && mesh.isEnabled());
    return !hit?.hit || hit.distance >= distance;
  }

  private hitRegion(enemy: Enemy, point: Vector3) {
    const local = Vector3.TransformCoordinates(point, enemy.root.getWorldMatrix().invert());
    return local.y > 1.7 ? 2 : local.y < 0.95 || Math.abs(local.x) > 0.38 ? 0.65 : 1;
  }

  private takeDamage(amount: number) {
    this.health = Math.max(0, this.health - amount);
    this.events.onHealth(this.health);
    this.events.onDamage();
    this.combatAudio?.damage();
    if (this.health <= 0) this.finish(false);
  }

  private finish(won: boolean) {
    this.state = won ? 'won' : 'lost';
    this.firing = false;
    if (document.pointerLockElement) void document.exitPointerLock();
    const start = this.isCoop ? this.networkStartedAt : this.startedAt;
    this.events.onEnd(won, this.kills, this.shots, Math.floor((performance.now() - start) / 1000));
  }

}
