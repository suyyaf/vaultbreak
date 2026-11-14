import { WebSocket, WebSocketServer } from 'ws';
import { getWeapon, Loadout, WeaponId } from '../src/weapons';
import { EnemyState, PlayerState, WorldState } from '../src/network';
import { COVER, ENEMY_SPAWNS, GATE_Z, SUPPLIES } from '../src/dungeon';
import { GameMode, ZOMBIE_SPAWNS, zombieHealth, zombieWaveSize } from '../src/modes';

interface Client {
  ws: WebSocket;
  room: string;
  player: PlayerState;
  health: number;
  loadout: Loadout;
  weapon: WeaponId;
  nextShotAt: number;
  downedAt: number;
  reviveStartedAt: number;
  reviverId: string;
}


class Room {
  readonly clients = new Set<Client>();
  enemies: EnemyState[] = [];
  startedAt = Date.now();
  ended: WorldState['ended'] = null;
  stage = 0;
  supplies = new Set<number>();
  mode: GameMode = 'dungeon';
  wave = 1;
  nextWaveAt = 0;
  timer?: NodeJS.Timeout;

  constructor(readonly code: string, mode: GameMode = 'dungeon') { this.mode = mode; this.reset(); }

  reset() {
    this.wave = 1;
    this.nextWaveAt = 0;
    this.enemies = this.mode === 'zombies'
      ? ZOMBIE_SPAWNS.map((spawn, id) => ({ id, x: spawn.x, z: spawn.z, yaw: 0, health: zombieHealth(1), alive: id < zombieWaveSize(1), stage: 0, boss: false, zombie: true }))
      : ENEMY_SPAWNS.map((spawn, id) => ({ id, x: spawn.x, z: spawn.z, yaw: 0, health: spawn.boss ? 800 : 100, alive: true, stage: spawn.stage, boss: spawn.boss, zombie: false }));
    this.stage = 0;
    this.supplies.clear();
    this.startedAt = Date.now();
    this.ended = null;
    for (const client of this.clients) {
      client.health = 100;
      client.nextShotAt = 0;
      client.downedAt = 0;
      client.reviveStartedAt = 0;
      client.reviverId = '';
      client.player.x = this.clients.size > 1 ? Array.from(this.clients).indexOf(client) * 1.5 - 1.5 : 0;
      client.player.y = 1.7;
      client.player.z = 17;
      this.send(client, { type: 'damaged', health: 100 });
    }
  }

  join(client: Client, mode: GameMode) {
    if (!this.clients.size) this.mode = mode;
    this.clients.add(client);
    client.room = this.code;
    client.player = { id: client.player.id, x: (this.clients.size - 1) * 1.5, y: 1.7, z: 17, yaw: 0, pitch: 0, downed: false, reviveProgress: 0 };
    this.send(client, { type: 'joined', id: client.player.id, room: this.code });
    if (!this.timer) this.timer = setInterval(() => this.tick(), 50);
  }

  leave(client: Client) {
    this.clients.delete(client);
    if (!this.clients.size) {
      if (this.timer) clearInterval(this.timer);
      rooms.delete(this.code);
    }
  }

  message(client: Client, data: { type: string; [key: string]: unknown }) {
    if (data.type === 'restart') { this.reset(); return; }
    if (this.mode === 'zombies' && data.type === 'supply') {
      const supplyId = Number(data.supplyId);
      const supply = SUPPLIES.find((entry) => entry.id === supplyId);
      if (!supply || this.supplies.has(supplyId) || Math.hypot(supply.x - client.player.x, supply.z - client.player.z) > 2) return;
      this.supplies.add(supplyId);
      if (supply.kind === 'health') {
        client.health = Math.min(100, client.health + 50);
        this.send(client, { type: 'damaged', health: client.health });
      }
      return;
    }
    if (data.type === 'state') {
      const values = data as unknown as PlayerState;
      if (![values.x, values.y, values.z, values.yaw, values.pitch].every(Number.isFinite)) return;
      client.player.x = Math.max(-13.2, Math.min(13.2, values.x));
      client.player.y = Math.max(0.5, Math.min(4.5, values.y));
      const gateLimit = GATE_Z[this.stage];
      client.player.z = gateLimit === undefined ? Math.max(-114, Math.min(22, values.z)) : Math.max(gateLimit + 0.65, Math.min(22, values.z));
      client.player.yaw = values.yaw;
      client.player.pitch = values.pitch;
    }
    if (data.type === 'revive') {
      const target = Array.from(this.clients).find((entry) => entry.player.id === data.playerId);
      if (!target?.player.downed || client.player.downed) return;
      if (Math.hypot(target.player.x - client.player.x, target.player.z - client.player.z) > 2.8) return;
      if (target.reviverId !== client.player.id) {
        target.reviverId = client.player.id;
        target.reviveStartedAt = Date.now();
      }
    }
    if (data.type === 'shoot' && !this.ended && !client.player.downed) {
      const id = Number(data.enemyId);
      const enemy = this.enemies[id];
      if (!enemy?.alive || enemy.stage !== this.stage || Date.now() < client.nextShotAt) return;
      const weapon = getWeapon(client.weapon, client.loadout);
      client.nextShotAt = Date.now() + weapon.fireDelay * 0.9;
      const distance = Math.hypot(enemy.x - client.player.x, enemy.z - client.player.z);
      if (distance > 60 || !this.lineOfSight(enemy, client.player)) return;
      const damage = weapon.damage * (data.headshot ? 2 : 1);
      enemy.health -= damage;
      this.send(client, { type: 'hit' });
      if (enemy.health <= 0) { enemy.health = 0; enemy.alive = false; }
      if (this.enemies.every((entry) => entry.stage !== this.stage || !entry.alive)) {
        if (this.mode === 'zombies') {
          if (!this.nextWaveAt) {
            this.nextWaveAt = Date.now() + 7000;
            this.supplies.clear();
            for (const player of this.clients) this.send(player, { type: 'notice', message: `WAVE ${this.wave} CLEARED — RESUPPLY` });
          }
        } else if (this.stage === 2) this.ended = 'won';
        else {
          this.stage++;
          for (const player of this.clients) this.send(player, { type: 'notice', message: `GATE OPEN — CHAMBER ${this.stage + 1}` });
        }
      }
    }
    if (data.type === 'supply') {
      const supply = SUPPLIES.find((entry) => entry.id === Number(data.supplyId));
      if (!supply || this.supplies.has(supply.id)) return;
      if (Math.hypot(supply.x - client.player.x, supply.z - client.player.z) > 2) return;
      this.supplies.add(supply.id);
      if (supply.kind === 'health') {
        client.health = Math.min(100, client.health + 50);
        this.send(client, { type: 'damaged', health: client.health });
      }
    }
    if (data.type === 'loadout' && data.weapon && data.loadout) {
      client.weapon = data.weapon === 'pistol' ? 'pistol' : 'rifle';
      const value = data.loadout as Loadout;
      client.loadout = { optic: !!value.optic, grip: !!value.grip, magazine: !!value.magazine };
    }
  }

  tick() {
    const elapsed = (Date.now() - this.startedAt) / 1000;
    if (!this.ended) {
      if (this.mode === 'zombies' && this.nextWaveAt && Date.now() >= this.nextWaveAt) {
        this.wave++;
        this.nextWaveAt = 0;
        this.supplies.clear();
        this.enemies.forEach((enemy, id) => {
          const spawn = ZOMBIE_SPAWNS[id];
          enemy.x = spawn.x;
          enemy.z = spawn.z;
          enemy.health = zombieHealth(this.wave);
          enemy.alive = id < zombieWaveSize(this.wave);
        });
        for (const player of this.clients) this.send(player, { type: 'notice', message: `WAVE ${this.wave} INCOMING` });
      }
      const players = Array.from(this.clients);
      for (const client of players) {
        if (!client.player.downed) continue;
        const reviver = players.find((entry) => entry.player.id === client.reviverId && !entry.player.downed);
        const close = reviver && Math.hypot(reviver.player.x - client.player.x, reviver.player.z - client.player.z) <= 2.8;
        if (!reviver || !close) {
          client.reviverId = '';
          client.reviveStartedAt = 0;
          client.player.reviveProgress = 0;
        } else {
          client.player.reviveProgress = Math.min(1, (Date.now() - client.reviveStartedAt) / 3000);
          if (client.player.reviveProgress >= 1) {
            client.player.downed = false;
            client.player.reviveProgress = 0;
            client.health = 50;
            client.downedAt = 0;
            this.send(client, { type: 'damaged', health: 50 });
            this.send(reviver, { type: 'notice', message: `${client.player.id} REVIVED` });
          }
        }
      }
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.stage !== this.stage || elapsed < 3 + enemy.id * 0.3) continue;
        const targets = Array.from(this.clients).filter((client) => client.health > 0 && !client.player.downed);
        if (!targets.length) continue;
        const target = targets.reduce((a, b) => this.distance(enemy, a.player) < this.distance(enemy, b.player) ? a : b);
        const dx = target.player.x - enemy.x;
        const dz = target.player.z - enemy.z;
        const distance = Math.hypot(dx, dz);
        enemy.yaw = Math.atan2(dx, dz);
        const attackDistance = enemy.zombie ? 1.65 : 5;
        if (distance > attackDistance) {
          const speed = (enemy.zombie ? Math.min(3.1, 1.65 + this.wave * 0.07) : 1.25) * 0.05;
          let nx = enemy.x + dx / distance * speed;
          let nz = enemy.z + dz / distance * speed;
          if (this.blocked(nx, nz)) { nx = enemy.x + dz / distance * speed; nz = enemy.z - dx / distance * speed; }
          if (!this.blocked(nx, nz)) { enemy.x = nx; enemy.z = nz; }
        }
        if (distance < (enemy.zombie ? 1.9 : 18)) {
          const lastAttack = (enemy as EnemyState & { attackAt?: number }).attackAt ?? 0;
          if (Date.now() >= lastAttack && this.lineOfSight(enemy, target.player)) {
            (enemy as EnemyState & { attackAt?: number }).attackAt = Date.now() + (enemy.zombie ? 850 : 1100 + Math.random() * 700);
            target.health = Math.max(0, target.health - (enemy.boss ? 18 : enemy.zombie ? 12 : distance < 6 ? 10 : 5));
            if (target.health === 0 && !target.player.downed) {
              if (this.clients.size > 1) {
                target.player.downed = true;
                target.downedAt = Date.now();
                target.reviverId = '';
                target.reviveStartedAt = 0;
              }
            }
            this.send(target, { type: 'damaged', health: target.health });
          }
        }
      }
      if (this.clients.size === 1 && Array.from(this.clients)[0]?.health <= 0) this.ended = 'lost';
      else if (Array.from(this.clients).every((client) => client.health <= 0 && (!client.player.downed || Date.now() - client.downedAt > 30000))) this.ended = 'lost';
    }
    const state: WorldState = {
      room: this.code,
      players: Array.from(this.clients).map((client) => client.player),
      enemies: this.enemies,
      elapsed,
      ended: this.ended,
      stage: this.stage,
      supplies: Array.from(this.supplies),
      mode: this.mode,
      wave: this.wave,
      nextWaveAt: this.nextWaveAt,
    };
    for (const client of this.clients) this.send(client, { type: 'state', state });
  }

  distance(enemy: EnemyState, player: PlayerState) { return Math.hypot(player.x - enemy.x, player.z - enemy.z); }
  blocked(x: number, z: number) {
    return COVER.some((box) => Math.abs(x - box.x) < box.w / 2 + 0.35 && Math.abs(z - box.z) < box.d / 2 + 0.35);
  }
  lineOfSight(enemy: EnemyState, player: PlayerState) {
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      if (this.blocked(enemy.x + (player.x - enemy.x) * t, enemy.z + (player.z - enemy.z) * t)) return false;
    }
    return true;
  }
  send(client: Client, data: unknown) { if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(data)); }
}

const port = Number(process.env.PORT ?? 2567);
const wss = new WebSocketServer({ port });
const rooms = new Map<string, Room>();
let nextId = 1;
wss.on('connection', (ws) => {
  const client: Client = { ws, room: '', health: 100, weapon: 'rifle', loadout: { optic: false, grip: false, magazine: false }, nextShotAt: 0, downedAt: 0, reviveStartedAt: 0, reviverId: '', player: { id: `P${nextId++}`, x: 0, y: 1.7, z: 17, yaw: 0, pitch: 0, downed: false, reviveProgress: 0 } };
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString()) as { type: string; room?: string; mode?: string };
      if (data.type === 'join') {
        const code = String(data.room ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (!code) return;
        const mode: GameMode = data.mode === 'zombies' ? 'zombies' : 'dungeon';
        const room = rooms.get(code) ?? new Room(code, mode);
        if (room.clients.size >= 4) { ws.send(JSON.stringify({ type: 'error', message: 'Room is full.' })); return; }
        rooms.set(code, room);
        room.join(client, mode);
      } else if (client.room) rooms.get(client.room)?.message(client, data);
    } catch { /* Ignore malformed client messages. */ }
  });
  ws.on('close', () => { if (client.room) rooms.get(client.room)?.leave(client); });
});
console.log(`VAULTBREAK co-op server running on ws://localhost:${port}`);
