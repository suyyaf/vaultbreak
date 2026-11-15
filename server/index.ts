import { WebSocket, WebSocketServer } from 'ws';
import { getWeapon, Loadout, WeaponId } from '../src/weapons';
import { EnemyState, PlayerState, WorldState } from '../src/network';
import { COVER, ENEMY_SPAWNS, GATE_Z, SUPPLIES } from '../src/dungeon';
import { GameMode, ZOMBIE_SPAWNS, zombieDamage, zombieHealth, zombieKind, zombieSpeed, zombieWaveSize } from '../src/modes';
import { PerkId, PERKS } from '../src/perks';
import { AcidProjectile, GrenadeState, GRENADE_CAPACITY, grenadeDamage, SPIT_SPEED } from '../src/equipment';

interface Client {
  ws: WebSocket;
  room: string;
  player: PlayerState;
  health: number;
  loadout: Loadout;
  weapon: WeaponId;
  perk: PerkId;
  nextShotAt: number;
  downedAt: number;
  reviveStartedAt: number;
  reviverId: string;
  grenades: number;
  nextGrenadeAt: number;
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
  grenades: GrenadeState[] = [];
  acid: AcidProjectile[] = [];
  nextGrenadeId = 1;
  nextAcidId = 1;
  timer?: NodeJS.Timeout;

  constructor(readonly code: string, mode: GameMode = 'dungeon') { this.mode = mode; this.reset(); }

  reset() {
    this.wave = 1;
    this.nextWaveAt = 0;
    this.grenades = [];
    this.acid = [];
    this.enemies = this.mode === 'zombies'
      ? ZOMBIE_SPAWNS.map((spawn, id) => ({ id, x: spawn.x, z: spawn.z, yaw: 0, health: zombieHealth(1, zombieKind(id, 1)), alive: id < zombieWaveSize(1), stage: 0, boss: false, zombie: true, kind: zombieKind(id, 1), windupUntil: 0 }))
      : ENEMY_SPAWNS.map((spawn, id) => ({ id, x: spawn.x, z: spawn.z, yaw: 0, health: spawn.boss ? 800 : 100, alive: true, stage: spawn.stage, boss: spawn.boss, zombie: false, kind: 'soldier' as const, windupUntil: 0 }));
    this.stage = 0;
    this.supplies.clear();
    this.startedAt = Date.now();
    this.ended = null;
    for (const client of this.clients) {
      client.health = PERKS[client.perk].maxHealth;
      client.player.health = client.health;
      client.nextShotAt = 0;
      client.grenades = GRENADE_CAPACITY;
      client.nextGrenadeAt = 0;
      this.send(client, { type: 'equipment', grenades: client.grenades });
      client.player.kills = 0;
      client.player.downed = false;
      client.player.reviveProgress = 0;
      client.player.yaw = 0;
      client.player.pitch = 0;
      client.downedAt = 0;
      client.reviveStartedAt = 0;
      client.reviverId = '';
      client.player.x = this.clients.size > 1 ? Array.from(this.clients).indexOf(client) * 1.5 - 1.5 : 0;
      client.player.y = 1.7;
      client.player.z = 17;
      this.send(client, { type: 'damaged', health: client.health });
    }
  }

  join(client: Client, mode: GameMode) {
    if (!this.clients.size) this.mode = mode;
    this.clients.add(client);
    client.room = this.code;
    client.player = { id: client.player.id, x: (this.clients.size - 1) * 1.5, y: 1.7, z: 17, yaw: 0, pitch: 0, downed: false, reviveProgress: 0, kills: 0, health: 100 };
    this.send(client, { type: 'joined', id: client.player.id, room: this.code });
    this.send(client, { type: 'equipment', grenades: client.grenades });
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
      if (distance > weapon.range || !this.lineOfSight(enemy, client.player)) return;
      const pellets = Math.max(1, Math.min(weapon.pellets, Number(data.pellets) || 1));
      const falloff = weapon.id === 'shotgun' ? Math.max(0.45, 1 - distance / weapon.range * 0.65) : 1;
      const damage = weapon.damage * (data.headshot ? 2 : 1) * pellets * falloff;
      enemy.health -= damage;
      if (enemy.health <= 0) { enemy.health = 0; enemy.alive = false; client.player.kills++; }
      this.send(client, { type: 'hit', killed: !enemy.alive });
      this.checkStageClear(client);
    }
    if (data.type === 'grenade' && !this.ended && !client.player.downed && client.grenades > 0 && Date.now() >= client.nextGrenadeAt) {
      const values = ['x', 'y', 'z', 'vx', 'vy', 'vz'].map((key) => Number(data[key]));
      if (!values.every(Number.isFinite) || Math.hypot(values[0] - client.player.x, values[2] - client.player.z) > 2) return;
      const [x, y, z, vx, vy, vz] = values;
      const speed = Math.hypot(vx, vy, vz);
      if (speed > 18) return;
      client.grenades--;
      client.nextGrenadeAt = Date.now() + 650;
      this.send(client, { type: 'equipment', grenades: client.grenades });
      this.grenades.push({ id: this.nextGrenadeId++, x, y: Math.max(0.3, Math.min(4.5, y)), z, vx, vy, vz, explodeAt: Date.now() + 1800, owner: client.player.id });
    }
    if (data.type === 'supply') {
      const supply = SUPPLIES.find((entry) => entry.id === Number(data.supplyId));
      if (!supply || this.supplies.has(supply.id)) return;
      if (Math.hypot(supply.x - client.player.x, supply.z - client.player.z) > 2) return;
      this.supplies.add(supply.id);
      client.grenades = GRENADE_CAPACITY;
      this.send(client, { type: 'equipment', grenades: client.grenades });
      if (supply.kind === 'health') {
        client.health = Math.min(PERKS[client.perk].maxHealth, client.health + 50);
        this.send(client, { type: 'damaged', health: client.health });
      }
    }
    if (data.type === 'loadout' && data.weapon && data.loadout) {
      client.weapon = data.weapon === 'pistol' || data.weapon === 'shotgun' || data.weapon === 'smg' || data.weapon === 'ak' ? data.weapon : 'rifle';
      const perk = String(data.perk ?? '') as PerkId;
      if (PERKS[perk]) client.perk = perk;
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
          enemy.kind = zombieKind(id, this.wave);
          enemy.health = zombieHealth(this.wave, enemy.kind);
          enemy.windupUntil = 0;
          enemy.alive = id < zombieWaveSize(this.wave);
        });
        for (const player of this.clients) this.send(player, { type: 'notice', message: `WAVE ${this.wave} INCOMING` });
      }
      this.updateGrenades();
      this.updateAcid();
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
          client.player.reviveProgress = Math.min(1, (Date.now() - client.reviveStartedAt) / PERKS[reviver.perk].reviveMs);
          if (client.player.reviveProgress >= 1) {
            client.player.downed = false;
            client.player.reviveProgress = 0;
            client.health = PERKS[reviver.perk].reviveHealth;
            client.downedAt = 0;
            this.send(client, { type: 'damaged', health: client.health });
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
        const spitter = enemy.kind === 'spitter';
        const attackDistance = spitter ? 7 : enemy.zombie ? 1.65 : 5;
        if (distance > attackDistance) {
          const speed = (enemy.zombie ? zombieSpeed(this.wave, enemy.kind as 'walker' | 'runner' | 'brute') : 1.25) * 0.05;
          let nx = enemy.x + dx / distance * speed;
          let nz = enemy.z + dz / distance * speed;
          if (this.blocked(nx, nz)) { nx = enemy.x + dz / distance * speed; nz = enemy.z - dx / distance * speed; }
          if (!this.blocked(nx, nz)) { enemy.x = nx; enemy.z = nz; }
          for (const other of this.enemies) {
            if (other === enemy || !other.alive || other.stage !== enemy.stage || other.zombie !== enemy.zombie) continue;
            const sx = enemy.x - other.x;
            const sz = enemy.z - other.z;
            const gap = Math.hypot(sx, sz);
            if (gap > 0.001 && gap < 0.9) {
              const push = (0.9 - gap) * 0.22;
              const px = enemy.x + sx / gap * push;
              const pz = enemy.z + sz / gap * push;
              if (!this.blocked(px, pz) && Math.abs(px) < 12.8 && pz > -114 && pz < 21.5) { enemy.x = px; enemy.z = pz; }
            }
          }
        }
        if (distance < (spitter ? 18 : enemy.zombie ? 1.9 : 18)) {
          const lastAttack = (enemy as EnemyState & { attackAt?: number }).attackAt ?? 0;
          const heavy = enemy.boss || enemy.kind === 'brute';
          if (enemy.windupUntil && Date.now() >= enemy.windupUntil) {
            enemy.windupUntil = 0;
            const currentDistance = this.distance(enemy, target.player);
            if (spitter) {
              const dx = target.player.x - enemy.x;
              const dy = target.player.y - 1.65;
              const dz = target.player.z - enemy.z;
              const length = Math.hypot(dx, dy, dz) || 1;
              this.acid.push({ id: this.nextAcidId++, x: enemy.x, y: 1.65, z: enemy.z, vx: dx / length * SPIT_SPEED, vy: dy / length * SPIT_SPEED, vz: dz / length * SPIT_SPEED, expiresAt: Date.now() + 2600 });
            } else if (currentDistance < (enemy.zombie ? 2.4 : 20) && this.lineOfSight(enemy, target.player)) {
              target.health = Math.max(0, target.health - (enemy.boss ? 24 : enemy.zombie ? zombieDamage(enemy.kind as 'walker' | 'runner' | 'brute') : currentDistance < 6 ? 10 : 5));
              if (target.health === 0 && !target.player.downed && this.clients.size > 1) {
                target.player.downed = true;
                target.downedAt = Date.now();
                target.reviverId = '';
                target.reviveStartedAt = 0;
              }
              this.send(target, { type: 'damaged', health: target.health });
            }
          } else if (!enemy.windupUntil && Date.now() >= lastAttack && this.lineOfSight(enemy, target.player)) {
            (enemy as EnemyState & { attackAt?: number }).attackAt = Date.now() + (spitter ? 2300 : enemy.zombie ? 900 : 1100 + Math.random() * 700);
            enemy.windupUntil = Date.now() + (spitter ? 700 : heavy ? 850 : 350);
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
      grenades: this.grenades,
      acid: this.acid,
    };
    for (const client of this.clients) {
      client.player.health = client.health;
      this.send(client, { type: 'state', state });
    }
  }

  damageClient(client: Client, amount: number) {
    if (client.health <= 0 || client.player.downed || this.ended) return;
    client.health = Math.max(0, client.health - amount);
    if (client.health === 0 && this.clients.size > 1) {
      client.player.downed = true;
      client.downedAt = Date.now();
      client.reviverId = '';
      client.reviveStartedAt = 0;
    }
    this.send(client, { type: 'damaged', health: client.health });
  }

  updateAcid() {
    for (let i = this.acid.length - 1; i >= 0; i--) {
      const acid = this.acid[i];
      acid.x += acid.vx * 0.05;
      acid.y += acid.vy * 0.05;
      acid.z += acid.vz * 0.05;
      const blocked = this.blocked(acid.x, acid.z);
      const target = blocked ? undefined : Array.from(this.clients).find((client) => !client.player.downed && client.health > 0 && Math.hypot(client.player.x - acid.x, client.player.y - acid.y, client.player.z - acid.z) < 0.7);
      if (target) this.damageClient(target, zombieDamage('spitter'));
      if (blocked || target || Date.now() >= acid.expiresAt) this.acid.splice(i, 1);
    }
  }

  updateGrenades() {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const grenade = this.grenades[i];
      grenade.vy -= 0.6;
      const nx = grenade.x + grenade.vx * 0.05;
      const nz = grenade.z + grenade.vz * 0.05;
      if (this.blocked(nx, nz)) { grenade.vx *= -0.45; grenade.vz *= -0.45; }
      else { grenade.x = nx; grenade.z = nz; }
      grenade.y += grenade.vy * 0.05;
      if (grenade.y < 0.1) { grenade.y = 0.1; grenade.vy = Math.abs(grenade.vy) * 0.42; grenade.vx *= 0.72; grenade.vz *= 0.72; }
      if (Date.now() < grenade.explodeAt) continue;
      this.grenades.splice(i, 1);
      for (const client of this.clients) this.send(client, { type: 'explosion', x: grenade.x, y: grenade.y, z: grenade.z });
      const owner = Array.from(this.clients).find((client) => client.player.id === grenade.owner);
      if (!owner) continue;
      let hit = false;
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.stage !== this.stage) continue;
        const distance = Math.hypot(enemy.x - grenade.x, enemy.z - grenade.z);
        if (distance >= 5) continue;
        enemy.health -= grenadeDamage(distance);
        hit = true;
        if (enemy.health <= 0) { enemy.health = 0; enemy.alive = false; owner.player.kills++; }
      }
      if (hit) this.send(owner, { type: 'hit', killed: this.enemies.some((enemy) => !enemy.alive && Math.hypot(enemy.x - grenade.x, enemy.z - grenade.z) < 5) });
      this.checkStageClear(owner);
    }
  }

  checkStageClear(_owner: Client) {
    if (this.ended || this.enemies.some((entry) => entry.stage === this.stage && entry.alive)) return;
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
  const client: Client = { ws, room: '', health: 100, weapon: 'rifle', perk: 'runner', loadout: { optic: false, grip: false, magazine: false }, nextShotAt: 0, downedAt: 0, reviveStartedAt: 0, reviverId: '', grenades: GRENADE_CAPACITY, nextGrenadeAt: 0, player: { id: `P${nextId++}`, x: 0, y: 1.7, z: 17, yaw: 0, pitch: 0, downed: false, reviveProgress: 0, kills: 0, health: 100 } };
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
