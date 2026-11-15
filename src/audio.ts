import { WeaponId } from './weapons';

export class CombatAudio {
  private noise?: AudioBuffer;

  constructor(private readonly context: AudioContext) {}

  weapon(id: WeaponId) {
    const now = this.context.currentTime;
    const shotgun = id === 'shotgun';
    const pistol = id === 'pistol';
    const smg = id === 'smg';
    this.noiseBurst(now, shotgun ? 0.22 : pistol ? 0.09 : 0.075, shotgun ? 0.34 : smg ? 0.16 : 0.2, shotgun ? 900 : pistol ? 1800 : smg ? 2200 : 1400);
    this.tone(now, shotgun ? 105 : pistol ? 180 : smg ? 190 : 145, shotgun ? 38 : 55, shotgun ? 0.2 : 0.085, shotgun ? 0.24 : smg ? 0.09 : 0.12, 'square');
    if (shotgun) this.noiseBurst(now + 0.045, 0.18, 0.1, 450);
  }

  reload(id: WeaponId) {
    const now = this.context.currentTime;
    this.noiseBurst(now, 0.035, 0.055, 2600);
    this.tone(now, 240, 150, 0.045, 0.025, 'square');
    this.noiseBurst(now + (id === 'shotgun' ? 0.3 : 0.55), 0.045, 0.06, 1800);
  }

  hit(killed: boolean) {
    this.tone(this.context.currentTime, killed ? 720 : 480, killed ? 360 : 400, killed ? 0.09 : 0.035, killed ? 0.045 : 0.018, 'sine');
  }

  damage() { this.tone(this.context.currentTime, 65, 32, 0.16, 0.1, 'sawtooth'); }
  pickup() { this.tone(this.context.currentTime, 540, 880, 0.13, 0.045, 'sine'); }
  empty() { this.tone(this.context.currentTime, 190, 120, 0.035, 0.035, 'square'); }

  private tone(start: number, from: number, to: number, duration: number, volume: number, type: OscillatorType) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private noiseBurst(start: number, duration: number, volume: number, frequency: number) {
    if (!this.noise) {
      this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const channel = this.noise.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noise;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(gain).connect(this.context.destination);
    source.start(start);
    source.stop(start + duration);
  }
}
