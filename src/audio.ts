export class Audio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private masterGain: GainNode | null = null;

  private ensure(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = "square",
    volume: number = 0.3,
    slideTo?: number
  ): void {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, slideTo),
        this.ctx.currentTime + duration
      );
    }
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  hit(): void { this.tone(800, 0.08, "square", 0.2); }
  shoot(): void { this.tone(600, 0.06, "square", 0.15); }
  block(): void { this.tone(400, 0.1, "sawtooth", 0.2); }
  score(): void { this.tone(880, 0.1, "sine", 0.25, 1200); }
  damage(): void { this.tone(200, 0.3, "sawtooth", 0.3, 80); }
  waveStart(): void {
    this.tone(440, 0.15, "square", 0.2);
    setTimeout(() => this.tone(660, 0.15, "square", 0.2), 120);
  }
  gameOver(): void {
    this.tone(440, 0.2, "sawtooth", 0.3, 220);
    setTimeout(() => this.tone(220, 0.4, "sawtooth", 0.3, 110), 200);
  }
  click(): void { this.tone(700, 0.05, "sine", 0.15); }
  alert(): void { this.tone(1200, 0.06, "square", 0.12); }
}
