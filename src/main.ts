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

const saved = JSON.parse(localStorage.getItem('vaultbreak-settings') ?? '{}') as { volume?: number; fov?: number; sensitivity?: number; reducedMotion?: boolean };
const settings = { volume: saved.volume ?? 70, fov: saved.fov ?? 90, sensitivity: saved.sensitivity ?? 100, reducedMotion: saved.reducedMotion ?? false };
byId<HTMLInputElement>('volume').value = String(settings.volume);
byId<HTMLInputElement>('fov').value = String(settings.fov);
byId<HTMLInputElement>('sensitivity').value = String(settings.sensitivity);
byId<HTMLInputElement>('reduced-motion').checked = settings.reducedMotion;
function saveSettings() { localStorage.setItem('vaultbreak-settings', JSON.stringify(settings)); }
let applySettings = () => {};
applySettings = () => {
  game.setVolume(settings.volume / 100);
  game.setFieldOfView(2 * Math.atan(Math.tan(settings.fov * Math.PI / 360) / (16 / 9)));
  game.setSensitivity(0.0018 * settings.sensitivity / 100);
  game.setReducedMotion(settings.reducedMotion);
  byId('volume-value').textContent = `${settings.volume}%`;
  byId('fov-value').textContent = String(settings.fov);
  byId('sensitivity-value').textContent = (settings.sensitivity / 100).toFixed(1);
  saveSettings();
};
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
  onGrenades: (count) => { byId('grenade-count').textContent = String(count).padStart(2, '0'); },
  onMedkits: (count) => { byId('medkit-count').textContent = String(count).padStart(2, '0'); },
  onSlots: (primary, secondary) => { byId('primary-slot').textContent = primary; byId('secondary-slot').textContent = secondary; },
  onScope: (active) => {
    byId('scope-overlay').classList.toggle('hidden', !active);
    byId('crosshair').classList.toggle('hidden', active);
  },
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

function showWelcome() {
  game.setOperatorInspection(false);
  byId('preparation').classList.add('hidden');
  byId('settings').classList.add('hidden');
  byId('menu').classList.remove('hidden');
}

function showPreparation() {
  game.setOperatorInspection(true);
  byId('menu').classList.add('hidden');
  byId('settings').classList.add('hidden');
  byId('preparation').classList.remove('hidden');
}

function deploy() {
  game.setMode(byId<HTMLSelectElement>('mode-select').value as 'dungeon' | 'zombies');
  game.setPerk(byId<HTMLSelectElement>('perk-select').value as PerkId);
  game.setSecondary(byId<HTMLSelectElement>('secondary-select').value as WeaponId);
  game.setLoadout(byId<HTMLSelectElement>('weapon-select').value as WeaponId, {
    optic: byId<HTMLInputElement>('optic').checked,
    grip: byId<HTMLInputElement>('grip').checked,
    magazine: byId<HTMLInputElement>('magazine').checked,
  });
  byId('menu').classList.add('hidden');
  byId('preparation').classList.add('hidden');
  byId('settings').classList.add('hidden');
  byId('pause').classList.add('hidden');
  byId('result').classList.add('hidden');
  byId('hud').classList.remove('hidden');
  const room = byId<HTMLInputElement>('room-code').value.trim().toUpperCase();
  game.disconnect();
  if (room) void game.connectCoop(room);
  game.start();
}

byId('operator-select').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-perk]');
  if (!button) return;
  const perk = button.dataset.perk as PerkId;
  byId<HTMLSelectElement>('perk-select').value = perk;
  document.querySelectorAll('#operator-select button').forEach((entry) => entry.classList.toggle('selected', entry === button));
  game.setPerk(perk);
  const profiles: Record<PerkId, { number: string; name: string; role: string; buff: string; animation: string }> = {
    runner: { number: '01', name: 'RUNNER', role: 'RECONNAISSANCE / MOBILITY', buff: '+15% MOVEMENT SPEED', animation: 'WEAPON READY' },
    scavenger: { number: '02', name: 'SCAVENGER', role: 'LOGISTICS / SUSTAINMENT', buff: '+50% RESERVE AMMUNITION', animation: 'EQUIPMENT CHECK' },
    juggernaut: { number: '03', name: 'TANK', role: 'ASSAULT / HEAVY WEAPONS', buff: '125 HP · DUAL HEAVY WEAPONS', animation: 'HEAVY WEAPON SALUTE' },
    medic: { number: '04', name: 'COMBAT MEDIC', role: 'SUPPORT / SQUAD RECOVERY', buff: '1.5s REVIVE · 75 HP RESTORED', animation: 'FIELD MEDIC SIGNAL' },
  };
  const profile = profiles[perk];
  byId('operator-number').textContent = profile.number;
  byId('operator-name').textContent = profile.name;
  byId('operator-role').textContent = profile.role;
  byId('operator-buff').textContent = profile.buff;
  byId('operator-animation').textContent = profile.animation;
  byId('operator-name').animate([{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 250 });
  const secondary = byId<HTMLSelectElement>('secondary-select');
  const selectedWeapon = secondary.value;
  secondary.replaceChildren(new Option('MP5 / SMG', 'smg'), new Option('M9 / PISTOL', 'pistol'));
  if (perk === 'juggernaut') {
    secondary.add(new Option('AK-47 / HEAVY RIFLE', 'ak'));
    secondary.add(new Option('M870 / HEAVY', 'shotgun'));
  }
  if ([...secondary.options].some((option) => option.value === selectedWeapon)) secondary.value = selectedWeapon;
});
for (const id of ['volume', 'fov', 'sensitivity'] as const) byId<HTMLInputElement>(id).addEventListener('input', () => {
  settings[id] = Number(byId<HTMLInputElement>(id).value);
  applySettings();
});
byId<HTMLInputElement>('reduced-motion').addEventListener('change', () => { settings.reducedMotion = byId<HTMLInputElement>('reduced-motion').checked; applySettings(); });
byId('fullscreen').addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); });
for (const id of ['welcome-settings', 'pause-settings']) byId(id).addEventListener('click', () => byId('settings').classList.remove('hidden'));
byId('close-settings').addEventListener('click', () => byId('settings').classList.add('hidden'));
byId('mode-select').addEventListener('change', () => {
  const zombies = byId<HTMLSelectElement>('mode-select').value === 'zombies';
  document.querySelector('#preparation .eyebrow span')!.textContent = zombies ? 'SURVIVAL PROTOCOL' : 'OPERATION 001';
  document.querySelector('.setup-section small')!.textContent = zombies ? '01 · ZOMBIE SURVIVAL' : '01 · DUNGEON OPERATION';
  document.querySelector('#preparation .brief')!.textContent = zombies ? 'Hold the vault. Resupply. Survive the outbreak.' : 'Descend. Clear the chamber. Survive.';
  byId('operator-role').textContent = zombies ? 'OUTBREAK RESPONSE / CONTAINMENT' : byId('operator-role').textContent;
});

byId('create-room').addEventListener('click', () => {
  byId<HTMLInputElement>('room-code').value = Math.random().toString(36).slice(2, 8).toUpperCase();
});
byId('deploy').addEventListener('click', showPreparation);
byId('back-to-welcome').addEventListener('click', showWelcome);
byId('start-deployment').addEventListener('click', deploy);
byId('restart').addEventListener('click', deploy);
byId('restart-pause').addEventListener('click', deploy);
function mainMenu() {
  game.mainMenu();
  byId('pause').classList.add('hidden');
  byId('result').classList.add('hidden');
  byId('hud').classList.add('hidden');
  showWelcome();
}
byId('main-menu').addEventListener('click', mainMenu);
byId('result-menu').addEventListener('click', mainMenu);
byId('resume').addEventListener('click', () => {
  byId('pause').classList.add('hidden');
  game.resume();
});
window.addEventListener('keydown', (event) => {
  const settingsOpen = !byId('settings').classList.contains('hidden');
  if (event.code === 'Escape' && settingsOpen) {
    byId('settings').classList.add('hidden');
    return;
  }
  if (game.currentState === 'menu' && !settingsOpen) {
    if (event.code === 'Enter') {
      if (!byId('menu').classList.contains('hidden')) showPreparation();
      else deploy();
    }
    if (event.code === 'Escape' && !byId('preparation').classList.contains('hidden')) showWelcome();
  }
  if (event.code === 'Escape' && game.currentState === 'paused') {
    byId('pause').classList.add('hidden');
    game.resume();
  }
});
window.addEventListener('resize', () => engine.resize());
applySettings();
engine.runRenderLoop(() => game.scene.render());
