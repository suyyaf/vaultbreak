import { GameMode } from './modes';

export interface EnemyState {
  id: number;
  x: number;
  z: number;
  yaw: number;
  health: number;
  alive: boolean;
  stage: number;
  boss: boolean;
  zombie: boolean;
}

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  downed: boolean;
  reviveProgress: number;
}

export interface WorldState {
  room: string;
  players: PlayerState[];
  enemies: EnemyState[];
  elapsed: number;
  ended: 'won' | 'lost' | null;
  stage: number;
  supplies: number[];
  mode: GameMode;
  wave: number;
  nextWaveAt: number;
}

export type ServerMessage =
  | { type: 'joined'; id: string; room: string }
  | { type: 'state'; state: WorldState }
  | { type: 'hit' }
  | { type: 'damaged'; health: number }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };
