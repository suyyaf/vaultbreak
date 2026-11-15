import { Engine } from '@babylonjs/core';
import { Game } from './game';
import { WeaponId } from './weapons';
import { PerkId, PERKS } from './perks';
import './style.css';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('game');
const engine = new Engine(canvas, true, { stencil: true, antialias: true }, true);
let messageTimer: ReturnType<typeof setTimeout>;
let hitTimer: ReturnType<typeof setTimeout>;
let damageTimer: ReturnType<typeof setTimeout>;

const game = new Game(engine, {
  onAmmo: (ammo, reserve) => {
    byId('ammo').textContent = String(ammo).padStart(2, '0');
    const reserveLabel = document.querySelector('.ammo b');
    if (reserveLabel) reserveLabel.textContent = `/ ${reserve}`;
  },
  onWeapon: (weapon) => {
    byId('weapon-name').textContent = weapon.name;
    byId('weapon-mode').textContent = weapon.mode;
  },
  onHealth: (health) => {
    byId('health').textContent = String(health);
    byId('health-bar').style.width = `${Math.min(100, health / PERKS[byId<HTMLSelectElement>('perk-select').value as PerkId].maxHealth * 100)}%`;
    byId('health-bar').style.background = health <= 30 ? '#ef634e' : '';
  },
  onEnemies: (remaining) => { byId('enemy-count').textContent = String(remaining).padStart(2, '0'); },
  onHit: (killed) => {
    byId('hitmarker').classList.toggle('kill', killed);
    byId('hitmarker').classList.add('show');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => byId('hitmarker').classList.remove('show'), 90);
  },
  onDamage: () => {
    byId('damage').classList.add('flash');
    clearTimeout(damageTimer);
    damageTimer = setTimeout(() => byId('damage').classList.remove('flash'), 180);
  },
  onReload: (reloading) => { byId('reload-label').textContent = reloading ? 'RELOADING…' : ''; },
  onMessage: (message) => {
    byId('message').textContent = message;
    byId('message').classList.add('visible');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => byId('message').classList.remove('visible'), 1800);
  },
  onRoom: (room, players) => {
    byId('room-status').textContent = `ROOM ${room} · ${players}/4 OPERATIVES`;
  },
  onSquad: (players) => {
    byId('squad-status').replaceChildren(...players.map((player) => {
      const row = document.createElement('div');
      row.className = player.downed ? 'downed' : '';
      row.textContent = `${player.id}  ${player.downed ? 'DOWN' : `${player.health} HP`}  ·  ${player.kills} ELIMS`;
      return row;
    }));
  },
  onRevive: (message, progress) => {
    byId('revive-prompt').textContent = message;
    byId('revive-progress').style.width = `${progress * 100}%`;
  },
  onStage: (stage, name) => {
    document.querySelector('.mission small')!.textContent = name === 'OUTBREAK CONTAINMENT' ? 'ZOMBIE SURVIVAL · ENDLESS' : `CHAMBER ${stage + 1}/3 · ${name}`;
    document.querySelector('.mission strong')!.textContent = stage === 2 ? 'DEFEAT THE WARDEN' : 'CLEAR THE CHAMBER';
    if (stage < 2) byId('boss').classList.add('hidden');
  },
  onObjective: (message) => {
    const objective = document.querySelector('.mission strong')!;
    if (objective.textContent !== message) objective.textContent = message;
  },
  onWave: (wave) => { byId('hud').dataset.wave = String(wave); },
  onBoss: (health, maxHealth) => {
    byId('boss').classList.toggle('hidden', health <= 0);
    byId('boss-health').style.width = `${Math.max(0, health / maxHealth * 100)}%`;
  },
  onSpread: (spread) => { byId('crosshair').style.setProperty('--spread', `${spread}px`); },
  onPause: () => {
    if (game.currentState !== 'paused') return;
    byId('pause').classList.remove('hidden');
  },
  onEnd: (won, kills, shots, seconds) => {
    byId('pause').classList.add('hidden');
    byId('result').classList.remove('hidden');
    const zombies = byId<HTMLSelectElement>('mode-select').value === 'zombies';
    byId('result-label').textContent = zombies ? `SURVIVED TO WAVE ${byId('hud').dataset.wave ?? '1'}` : won ? 'OPERATION COMPLETE' : 'OPERATIVE DOWN';
    byId('result-title').textContent = zombies ? 'THE OUTBREAK CONTINUES.' : won ? 'VAULT SECURED.' : 'YOU DIDN’T MAKE IT.';
    byId('result-copy').textContent = won ? 'The chamber is clear. Nice work, operative.' : 'Regroup, reload, and give it another shot.';
    byId('stat-kills').textContent = String(kills);
    byId('stat-shots').textContent = String(shots);
    byId('stat-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  },
});

function deploy() {
  game.setMode(byId<HTMLSelectElement>('mode-select').value as 'dungeon' | 'zombies');
  game.setPerk(byId<HTMLSelectElement>('perk-select').value as PerkId);
  game.setLoadout(byId<HTMLSelectElement>('weapon-select').value as WeaponId, {
    optic: byId<HTMLInputElement>('optic').checked,
    grip: byId<HTMLInputElement>('grip').checked,
    magazine: byId<HTMLInputElement>('magazine').checked,
  });
  byId('menu').classList.add('hidden');
  byId('pause').classList.add('hidden');
  byId('result').classList.add('hidden');
  byId('hud').classList.remove('hidden');
  const room = byId<HTMLInputElement>('room-code').value.trim().toUpperCase();
  game.disconnect();
  if (room) void game.connectCoop(room);
  game.start();
}

byId('mode-select').addEventListener('change', () => {
  const zombies = byId<HTMLSelectElement>('mode-select').value === 'zombies';
  document.querySelector('.eyebrow span')!.textContent = zombies ? 'SURVIVAL PROTOCOL' : 'OPERATION 001';
  document.querySelector('h1')!.innerHTML = zombies ? 'ZOMBIE<br /><span>SURVIVAL</span>' : 'THE SUNKEN<br /><span>VAULT</span>';
  document.querySelector('.brief')!.textContent = zombies ? 'Hold the vault. Resupply. Survive the outbreak.' : 'Descend. Clear the chamber. Survive.';
  document.querySelector('.weapon-preview strong')!.textContent = zombies ? 'ENDLESS WAVES' : 'M4A1';
});
byId('weapon-select').addEventListener('change', () => {
  const weapon = byId<HTMLSelectElement>('weapon-select');
  const label = weapon.selectedOptions[0].textContent?.split(' / ') ?? [];
  document.querySelector('.weapon-preview strong')!.textContent = label[0] ?? 'M4A1';
});
byId('create-room').addEventListener('click', () => {
  byId<HTMLInputElement>('room-code').value = Math.random().toString(36).slice(2, 8).toUpperCase();
});
byId('deploy').addEventListener('click', deploy);
byId('restart').addEventListener('click', deploy);
byId('restart-pause').addEventListener('click', deploy);
byId('resume').addEventListener('click', () => {
  byId('pause').classList.add('hidden');
  game.resume();
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Enter' && game.currentState === 'menu') deploy();
});
window.addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => game.scene.render());
