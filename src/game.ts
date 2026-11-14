import {
  Color3, Color4, DirectionalLight, Engine, GlowLayer, HemisphericLight,
  Mesh, MeshBuilder, Ray, Scene, StandardMaterial, TransformNode, UniversalCamera, Vector3,
} from '@babylonjs/core';
import { getWeapon, Loadout, WeaponId, WeaponSpec } from './weapons';
import { ServerMessage, WorldState } from './network';
import { ENEMY_SPAWNS, GATE_Z, STAGE_NAMES, SUPPLIES } from './dungeon';

export type GameState = 'menu' | 'playing' | 'paused' | 'won' | 'lost';
export interface GameEvents {
  onAmmo: (ammo: number, reserve: number) => void;
  onWeapon: (weapon: WeaponSpec) => void;
  onHealth: (health: number) => void;
  onEnemies: (remaining: number) => void;
  onHit: () => void;
  onDamage: () => void;
  onReload: (reloading: boolean) => void;
  onMessage: (message: string) => void;
  onEnd: (won: boolean, kills: number, shots: number, seconds: number) => void;
  onPause: () => void;
  onRoom: (room: string, players: number) => void;
  onRevive: (message: string, progress: number) => void;
  onStage: (stage: number, name: string) => void;
  onBoss: (health: number, maxHealth: number) => void;
  onObjective: (message: string) => void;
}

interface Enemy {
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  limbs: Mesh[];
  health: number;
  alive: boolean;
  attackAt: number;
  phase: number;
}

const UP = new Vector3(0, 1, 0);

export class Game {
  readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly keys = new Set<string>();
  private readonly enemies: Enemy[] = [];
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
    this.camera.ellipsoidOffset = new Vector3(0, 0.85, 0);
    this.scene.activeCamera = this.camera;

    this.buildDungeon();
    this.buildGun();
    this.spawnEnemies();
    this.buildGateMarker();
    this.bindInput();
    this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  get currentState() { return this.state; }

  setLoadout(weapon: WeaponId, loadout: Loadout) {
    this.loadout = { ...loadout };
    this.weapon = getWeapon(weapon, loadout);
    for (const mesh of this.gunParts) mesh.dispose();
    this.gunParts = [];
    this.buildGun();
    this.events.onWeapon(this.weapon);
  }

  async connectCoop(room: string) {
    this.socket?.close();
    const host = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
    this.socket = new WebSocket(host);
    this.socket.addEventListener('open', () => {
      this.socket?.send(JSON.stringify({ type: 'join', room }));
      this.socket?.send(JSON.stringify({ type: 'loadout', weapon: this.weapon.id, loadout: this.loadout }));
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'joined') {
        this.playerId = message.id;
        this.events.onMessage(`ROOM ${message.room} CONNECTED`);
      } else if (message.type === 'state') this.applyWorld(message.state);
      else if (message.type === 'hit') this.events.onHit();
      else if (message.type === 'damaged') {
        const wasAlive = this.health > 0;
        const previousHealth = this.health;
        this.health = message.health;
        this.events.onHealth(this.health);
        if (message.health === 0 && this.lastWorld && this.lastWorld.players.length > 1) {
          this.downed = true;
          this.events.onMessage('DOWNED — WAITING FOR REVIVE');
        } else if (message.health > 0) {
          this.downed = false;
          this.camera.position.y = Math.max(this.camera.position.y, 1.05);
        }
        if (wasAlive && message.health < previousHealth) this.events.onDamage();
      } else if (message.type === 'notice') this.events.onMessage(message.message);
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
    for (const model of this.teammates.values()) model.dispose();
    this.teammates.clear();
  }

  private sendNetwork(data: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }

  get isCoop() { return this.socket?.readyState === WebSocket.OPEN; }

  private applyWorld(world: WorldState) {
    this.lastWorld = world;
    this.networkStartedAt = performance.now() - world.elapsed * 1000;
    const me = world.players.find((player) => player.id === this.playerId);
    this.downed = me?.downed ?? false;
    this.reviveTarget = world.players.find((player) => player.downed && player.id !== this.playerId && Math.hypot(player.x - this.camera.position.x, player.z - this.camera.position.z) < 2.8)?.id;
    for (const state of world.enemies) {
      const enemy = this.enemies[state.id];
      if (!enemy) continue;
      enemy.root.position.set(state.x, 0, state.z);
      enemy.root.rotation.y = state.yaw;
      enemy.health = state.health;
      enemy.alive = state.alive;
      enemy.root.setEnabled(state.alive);
      if (state.boss) this.events.onBoss(state.health, 800);
    }
    this.kills = world.enemies.filter((enemy) => !enemy.alive).length;
    this.events.onEnemies(world.enemies.filter((enemy) => enemy.stage === world.stage && enemy.alive).length);
    this.stage = world.stage;
    this.updateStage(world.stage, this.lastStageEvent !== world.stage);
    this.lastStageEvent = world.stage;
    this.collectedSupplies = new Set(world.supplies);
    for (const [id, mesh] of this.supplyMeshes) mesh.setEnabled(!this.collectedSupplies.has(id));
    this.events.onRoom(world.room, world.players.length);
    const connected = new Set<string>();
    for (const player of world.players) {
      if (player.id === this.playerId) continue;
      connected.add(player.id);
      let model = this.teammates.get(player.id);
      if (!model) { model = this.createTeammate(player.id); this.teammates.set(player.id, model); }
      model.position.set(player.x, player.y - 1.7, player.z);
      model.rotation.y = player.yaw;
      model.rotation.z = player.downed ? -1.35 : 0;
      model.scaling.y = player.downed ? 0.65 : 1;
    }
    for (const [id, model] of this.teammates) if (!connected.has(id)) { model.dispose(); this.teammates.delete(id); }
  }

  private createTeammate(id: string) {
    const root = new TransformNode(`teammate ${id}`, this.scene);
    const armor = this.material(new Color3(0.2, 0.33, 0.35));
    const accent = this.material(new Color3(0.4, 0.9, 0.95), 0.8);
    const part = (w: number, h: number, d: number, x: number, y: number, mat: StandardMaterial) => {
      const mesh = MeshBuilder.CreateBox('operative', { width: w, height: h, depth: d }, this.scene);
      mesh.parent = root; mesh.position.set(x, y, 0); mesh.material = mat; mesh.isPickable = false;
    };
    part(0.7, 0.8, 0.4, 0, 1.3, armor);
    part(0.4, 0.4, 0.4, 0, 1.95, armor);
    part(0.3, 0.08, 0.02, 0, 1.98, accent);
    part(0.25, 0.85, 0.27, -0.2, 0.45, armor);
    part(0.25, 0.85, 0.27, 0.2, 0.45, armor);
    part(0.16, 0.16, 0.85, 0.3, 1.35, armor);
    return root;
  }

  start() {
    this.reset();
    this.state = 'playing';
    this.pointerLocked = false;
    this.startedAt = performance.now();
    const me = this.lastWorld?.players.find((player) => player.id === this.playerId);
    this.camera.position.set(me?.x ?? 0, 1.7, me?.z ?? 17);
    this.camera.cameraDirection.setAll(0);
    this.verticalVelocity = 0;
    this.camera.rotation.set(0, 0, 0);
    this.lockPointer();
    this.audio ??= new AudioContext();
    void this.audio.resume();
  }

  resume() {
    this.state = 'playing';
    this.lockPointer();
  }

  reset() {
    this.health = 100;
    this.ammo = this.weapon.magazine;
    this.reserve = this.weapon.reserve;
    this.kills = 0;
    this.shots = 0;
    this.firing = false;
    this.aiming = false;
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
    this.events.onEnemies(this.enemies.filter((enemy) => (enemy.root.metadata as { stage: number }).stage === 0).length);
    this.events.onReload(false);
    this.events.onStage(0, STAGE_NAMES[0]);
    this.events.onObjective('CLEAR THE CHAMBER');
    this.gateMarker?.setEnabled(false);
    this.events.onBoss(0, 800);
    this.gates.forEach((gate) => { gate.setEnabled(true); gate.checkCollisions = true; });
    this.events.onRevive('', 0);
    for (const mesh of this.supplyMeshes.values()) mesh.setEnabled(false);
    for (const gate of this.gates) gate.checkCollisions = true;
    this.sendNetwork({ type: 'restart' });
    this.sendNetwork({ type: 'loadout', weapon: this.weapon.id, loadout: this.loadout });
    for (const enemy of this.enemies) {
      enemy.alive = true;
      const meta = enemy.root.metadata as { boss: boolean; stage: number };
      enemy.health = meta.boss ? 800 : 100;
      enemy.root.setEnabled(true);
      enemy.attackAt = performance.now() + 1500;
      enemy.root.position.copyFrom((enemy.root.metadata as { spawn: Vector3 }).spawn);
    }
  }

  private lockPointer() {
    try {
      const request = this.engine.getRenderingCanvas()?.requestPointerLock();
      if (request instanceof Promise) void request.catch(() => this.pause());
    } catch {
      this.pause();
    }
  }

  private pause() {
    this.state = 'paused';
    this.firing = false;
    this.keys.clear();
    this.events.onPause();
  }

  private bindInput() {
    const canvas = this.engine.getRenderingCanvas()!;
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'KeyR' && this.state === 'playing') this.reload();
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
      if (event.button === 2) this.aiming = true;
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) { this.firing = false; this.triggerReady = true; }
      if (event.button === 2) this.aiming = false;
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('mousemove', (event) => {
      if (this.state !== 'playing' || document.pointerLockElement !== canvas) return;
      this.camera.rotation.y += event.movementX * 0.0018;
      this.camera.rotation.x += event.movementY * 0.0018;
      this.camera.rotation.x = Math.max(-1.35, Math.min(1.35, this.camera.rotation.x));
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) this.pointerLocked = true;
      else if (this.pointerLocked && this.state === 'playing') this.pause();
    });
    document.addEventListener('pointerlockerror', () => this.pause());
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
    new GlowLayer('glow', this.scene).intensity = 0.35;

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
      this.supplyMeshes.set(supply.id, root);
    }
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
    const gunMat = this.material(new Color3(0.12, 0.14, 0.12));
    const metal = this.material(new Color3(0.28, 0.3, 0.27));
    const accent = this.material(new Color3(0.62, 0.76, 0.24), 0.35);
    const part = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat = gunMat) => {
      const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      mesh.parent = this.gun;
      mesh.position.set(x, y, z);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      this.gunParts.push(mesh);
      return mesh;
    };
    part('receiver', 0.16, 0.19, 0.62, 0, 0, 0);
    part('handguard', 0.13, 0.14, 0.55, 0, 0.025, -0.56, metal);
    part('stock', 0.12, 0.18, 0.35, 0, -0.025, 0.46);
    this.magazineMesh = part('magazine', 0.11, 0.32, 0.17, 0, -0.22, 0.02);
    this.magazineMesh.rotation.x = -0.14;
    part('grip', 0.1, 0.25, 0.12, 0, -0.19, 0.23).rotation.x = -0.3;
    if (this.loadout.optic) {
      part('optic base', 0.1, 0.05, 0.18, 0, 0.14, -0.04, metal);
      part('optic', 0.1, 0.12, 0.16, 0, 0.22, -0.04);
      part('optic glass', 0.065, 0.075, 0.008, 0, 0.22, -0.125, accent);
    }
    if (this.loadout.grip) part('vertical grip', 0.09, 0.25, 0.1, 0, -0.17, -0.53);
    if (this.loadout.magazine) this.magazineMesh.scaling.y = 1.5;
    part('barrel', 0.045, 0.045, 0.4, 0, 0.01, -0.99, metal);
    this.muzzle = part('muzzle flash', 0.13, 0.13, 0.18, 0, 0.01, -1.25, accent);
    this.muzzle.setEnabled(false);
    this.gun.parent = this.camera;
    this.gun.setEnabled(this.state !== 'menu');
    if (this.weapon.id === 'pistol') this.gun.scaling.set(0.8, 1.1, 0.65);
    else this.gun.scaling.setAll(1);
    this.weaponBaseZ = this.weapon.id === 'pistol' ? -0.85 : -0.75;
    this.gun.position.set(0.34, -0.3, this.weaponBaseZ);
    this.gun.rotation.y = 0;
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
      const limbs = [
        make('left leg', 0.25, 0.85, 0.27, 0.48, armorMat, -0.2),
        make('right leg', 0.25, 0.85, 0.27, 0.48, armorMat, 0.2),
        make('left arm', 0.2, 0.75, 0.23, 1.35, bodyMat, -0.5),
        make('right arm', 0.2, 0.75, 0.23, 1.35, bodyMat, 0.5),
      ];
      body.metadata = { enemyIndex: index, multiplier: 1 };
      head.metadata = { enemyIndex: index, multiplier: 2 };
      body.isPickable = true;
      head.isPickable = true;
      this.enemies.push({ root, body, head, limbs, health: 100, alive: true, attackAt: 0, phase: index });
    });
  }

  private update() {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    if (this.state === 'menu') {
      this.camera.position.set(Math.sin(performance.now() * 0.00008) * 2, 2.5, 18);
      this.camera.setTarget(new Vector3(0, 1.4, -9));
      this.gun.setEnabled(false);
      return;
    }
    if (this.state !== 'playing') return;
    this.gun.setEnabled(true);
    this.updatePlayer(dt);
    this.updateSupplies();
    if (this.gateMarker.isEnabled()) {
      this.gateMarker.rotation.z = performance.now() * 0.001;
      this.gateMarker.position.y = 2.7 + Math.sin(performance.now() * 0.003) * 0.15;
    }
    if (this.stage === 1 && this.camera.position.z < -28) this.events.onObjective('CLEAR THE CHAMBER');
    if (this.stage === 2 && this.camera.position.z < -74) this.events.onObjective('DEFEAT THE WARDEN');
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
    const moving = move.lengthSquared() > 0;
    if (moving) {
      move.normalize();
      const sprint = this.keys.has('ShiftLeft') && !this.aiming && !this.crouched;
      const speed = this.crouched ? 2.2 : sprint ? 6.2 : this.aiming ? 2.7 : 4.2;
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
    const targetFov = this.aiming ? 0.85 : 1.25;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    const bob = moving ? Math.sin(this.walkTime) * 0.008 : 0;
    const reloading = this.reloadAt > 0;
    const targetX = reloading ? 0.12 : this.aiming ? 0 : 0.34;
    const targetY = (reloading ? -0.48 : this.aiming ? (this.loadout.optic ? -0.215 : -0.09) : -0.3) + bob;
    const targetZ = (reloading ? -0.72 : this.aiming ? -0.48 : this.weaponBaseZ);
    this.gun.position.x += (targetX - this.gun.position.x) * dt * 14;
    this.gun.position.y += (targetY - this.gun.position.y) * dt * 14;
    this.gun.position.z += (targetZ + this.recoil - this.gun.position.z) * dt * 18;
  }

  private updateWeapon(dt: number) {
    this.recoil *= Math.max(0, 1 - dt * 15);
    this.gun.rotation.z = 0;
    this.gun.rotation.x = 0;
    if (this.magazineMesh) this.magazineMesh.position.y = -0.22;
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
        if (progress < 0.4) this.magazineMesh.position.y = -0.22 - Math.sin(progress / 0.4 * Math.PI / 2) * 0.7;
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
      if (this.ammo <= 0) this.reload();
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
    this.sound(160, 0.06, 0.04);
  }

  private shoot() {
    const now = performance.now();
    this.nextShot = now + this.weapon.fireDelay;
    this.ammo--;
    this.shots++;
    this.recoil = Math.min(0.09, this.recoil + 0.035);
    this.camera.rotation.x -= this.weapon.recoil * (this.aiming ? 0.5 : 1);
    this.camera.rotation.y += (Math.random() - 0.5) * this.weapon.recoil;
    this.events.onAmmo(this.ammo, this.reserve);
    this.sound(75, 0.045, 0.1);
    this.muzzle.setEnabled(true);
    setTimeout(() => this.muzzle.setEnabled(false), 35);

    const origin = this.camera.position.clone();
    const direction = this.camera.getDirection(Vector3.Forward());
    const spread = this.weapon.spread * (this.aiming ? 0.25 : 1);
    direction.x += (Math.random() - 0.5) * spread;
    direction.y += (Math.random() - 0.5) * spread;
    direction.normalize();
    const ray = new Ray(origin, direction);
    const hit = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable && mesh.isEnabled());
    if (hit?.hit && hit.pickedPoint) {
      const metadata = hit.pickedMesh?.metadata as { enemyIndex?: number; multiplier?: number } | undefined;
      if (metadata?.enemyIndex !== undefined) {
        const enemy = this.enemies[metadata.enemyIndex];
        if (enemy.alive) {
          if (this.isCoop) this.sendNetwork({ type: 'shoot', enemyId: metadata.enemyIndex, headshot: metadata.multiplier === 2 });
          else this.damageEnemy(enemy, this.weapon.damage * (metadata.multiplier ?? 1));
        }
      }
      this.impact(hit.pickedPoint);
    }
  }

  private damageEnemy(enemy: Enemy, damage: number) {
    enemy.health -= damage;
    this.events.onHit();
    this.sound(420, 0.025, 0.025);
    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.root.setEnabled(false);
      this.kills++;
      this.events.onEnemies(this.enemies.length - this.kills);
      this.events.onBoss(this.enemies.find((entry) => (entry.root.metadata as { boss: boolean }).boss)?.health ?? 0, 800);
      const remaining = this.enemies.filter((entry) => (entry.root.metadata as { stage: number }).stage === this.stage && entry.alive).length;
      this.events.onEnemies(remaining);
      if (remaining === 0) {
        if (this.stage === 2) this.finish(true);
        else this.updateStage(this.stage + 1, true);
      }
    }
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
      const available = supply.id < 2 ? this.stage >= 1 : this.stage >= 2;
      mesh?.setEnabled(available);
      if (!available || Math.hypot(this.camera.position.x - supply.x, this.camera.position.z - supply.z) > 1.5) continue;
      this.collectedSupplies.add(supply.id);
      mesh?.setEnabled(false);
      if (this.isCoop) this.sendNetwork({ type: 'supply', supplyId: supply.id });
      if (supply.kind === 'health') {
        this.health = Math.min(100, this.health + 50);
        this.events.onHealth(this.health);
        this.events.onMessage('+50 HEALTH');
      } else {
        this.reserve += 60;
        this.events.onAmmo(this.ammo, this.reserve);
        this.events.onMessage('+60 AMMO');
      }
      this.sound(660, 0.12, 0.05);
    }
  }

  private impact(point: Vector3) {
    const spark = MeshBuilder.CreateSphere('impact', { diameter: 0.06, segments: 4 }, this.scene);
    spark.position.copyFrom(point);
    spark.material = this.material(new Color3(0.85, 0.93, 0.5), 1);
    spark.isPickable = false;
    setTimeout(() => spark.dispose(), 70);
  }

  private updateEnemies(dt: number) {
    const now = performance.now();
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const toPlayer = this.camera.position.subtract(enemy.root.position);
      toPlayer.y = 0;
      const distance = toPlayer.length();
      const meta = enemy.root.metadata as { stage: number; boss: boolean };
      const active = meta.stage === this.stage && now > this.startedAt + 3000 + enemy.phase * 300;
      if (active && distance < 28) {
        toPlayer.normalize();
        enemy.root.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        if (distance > 5) {
          const step = toPlayer.scale(dt * 1.25);
          const next = enemy.root.position.add(step);
          if (Math.abs(next.x) < 12.8 && next.z > -21.5 && next.z < 21.5 && !this.blocked(next)) {
            enemy.root.position.copyFrom(next);
          } else {
            const side = new Vector3(toPlayer.z, 0, -toPlayer.x).scale(dt * (enemy.phase % 2 ? 1.1 : -1.1));
            const alternate = enemy.root.position.add(side);
            if (!this.blocked(alternate)) enemy.root.position.copyFrom(alternate);
          }
          enemy.limbs.forEach((limb, i) => { limb.rotation.x = Math.sin(now * 0.005 + i * Math.PI) * 0.35; });
        }
        if (distance < 13 && now >= enemy.attackAt && this.hasLineOfSight(enemy)) {
          enemy.attackAt = now + 1100 + Math.random() * 700;
          this.takeDamage(distance < 6 ? 12 : 7);
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

  private takeDamage(amount: number) {
    this.health = Math.max(0, this.health - amount);
    this.events.onHealth(this.health);
    this.events.onDamage();
    this.sound(48, 0.12, 0.07);
    if (this.health <= 0) this.finish(false);
  }

  private finish(won: boolean) {
    this.state = won ? 'won' : 'lost';
    this.firing = false;
    if (document.pointerLockElement) void document.exitPointerLock();
    const start = this.isCoop ? this.networkStartedAt : this.startedAt;
    this.events.onEnd(won, this.kills, this.shots, Math.floor((performance.now() - start) / 1000));
  }

  private sound(frequency: number, duration: number, volume: number) {
    if (!this.audio) return;
    const oscillator = this.audio.createOscillator();
    const gain = this.audio.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(frequency, this.audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(30, this.audio.currentTime + duration);
    gain.gain.setValueAtTime(volume, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + duration);
    oscillator.connect(gain).connect(this.audio.destination);
    oscillator.start();
    oscillator.stop(this.audio.currentTime + duration);
  }
}
