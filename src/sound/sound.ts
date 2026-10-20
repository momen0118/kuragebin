// 音（4-5）。素材ファイルは使わず Web Audio で合成する。BGM はない。音がなくても成り立つゲームのまま、気づいた人だけ得をする程度に小さく。
// 鳴らすのは：ガラスをつつく音、水の音（カップから放す・シーグラスを沈める）、メモ帳をめくる・開く・閉じる音、拾いものが瓶底に着く音、
// 部屋の空気の音（ほとんど聞こえない低いノイズ。夜はさらに静か）。
// 初期はオフ。iOS は最初のタップまで鳴らせないので、タップのたびに有効にしなおす（unlock）。画面が隠れている間とオフの間は止める（電池のため）。
// 同じ音が続いても毎回まったく同じにならないよう、高さと長さを少しずつ揺らす。数値は config の SOUND。
import { SOUND } from '../config';
import type { FindKind } from '../sim/state';

export type SoundName = 'poke' | 'water' | 'page' | 'open' | 'close' | 'land';

export interface SoundOptions {
  /** つついた高さ（瓶の高さ 0〜1）と、水面より下か（つつく音） */
  height?: number;
  underwater?: boolean;
  /** 強さ（0〜1、水の音） */
  strength?: number;
  /** 瓶底に着いた物の種類（着く音） */
  kind?: FindKind;
}

type AudioContextCtor = typeof AudioContext;

function contextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** x を割合 j だけ上下にばらす */
function vary(x: number, j: number): number {
  return x * (1 + (Math.random() * 2 - 1) * j);
}

function between(a: number, b: number): number {
  return a + (b - a) * Math.random();
}

/** 消え入る小ささ（指数で下げるので 0 にはしない） */
const SILENT = 0.0001;

export class Sound {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private air: GainNode | null = null;
  private enabled = false;
  private hidden = false;
  private night = 0;
  /** 確認用：空気の音を大きくして聞く倍率 */
  private airBoost = 1;

  /** この端末で鳴らせるか */
  get supported(): boolean {
    return contextCtor() !== null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 鳴らすか（設定）。オンにしたときは、そのタップの中で呼べば鳴りはじめる */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.unlock();
    else void this.live?.suspend();
    this.updateAir();
  }

  /** タップのたびに呼ぶ（iOS は利用者の操作の中でしか鳴らしはじめられない）。オンなら、鳴らせる状態にする */
  unlock(): void {
    if (!this.enabled || this.hidden) return;
    this.ensure();
  }

  /** 画面が隠れている間は止める */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const live = this.live;
    if (!live) return;
    if (hidden) void live.suspend();
    else if (this.enabled) void live.resume();
  }

  /** 夜の度合い（0〜1）。夜は部屋の空気の音がさらに静か */
  setNight(night: number): void {
    if (Math.abs(night - this.night) < 0.01) return;
    this.night = night;
    this.updateAir();
  }

  /** 鳴らす（オンで、鳴らせる状態のときだけ） */
  play(name: SoundName, opts: SoundOptions = {}): void {
    if (!this.enabled || this.hidden || !this.ctx || this.ctx.state !== 'running') return;
    this.voice(name, opts);
  }

  /** 確認用（デバッグパネル）：設定によらず鳴らす。タップの中で呼ぶ */
  preview(name: SoundName, opts: SoundOptions = {}): void {
    if (!this.ensure()) return;
    this.voice(name, opts);
  }

  /** 確認用：部屋の空気の音を大きくして聞く（1 でふだん）。設定によらず鳴らす */
  previewAir(boost: number): void {
    this.airBoost = boost;
    if (boost > 1) this.ensure();
    this.updateAir();
  }

  /** 鳴らせる状態にする（なければ作る）。作れなければ false */
  private ensure(): boolean {
    if (!this.ctx) {
      const Ctor = contextCtor();
      if (!Ctor) return false;
      try {
        this.build(new Ctor({ latencyHint: 'interactive' }));
      } catch {
        return false;
      }
    }
    const live = this.live;
    if (live && live.state !== 'running') void live.resume();
    return true;
  }

  /** 鳴らしている AudioContext（確認用に書き出しているときは null） */
  private get live(): AudioContext | null {
    return this.ctx && 'suspend' in this.ctx ? (this.ctx as AudioContext) : null;
  }

  /**
   * 確認用：音を1つ、スピーカーを使わずに書き出す（seconds 秒、モノラル）。部屋の空気の音は入れない。
   * 大きさ・長さ・高さを数字で確かめるため
   */
  static async renderOffline(name: SoundName, opts: SoundOptions = {}, seconds = 1.2, sampleRate = 44100): Promise<Float32Array> {
    const ctx = new OfflineAudioContext(1, Math.round(seconds * sampleRate), sampleRate);
    const s = new Sound();
    s.build(ctx);
    s.air?.disconnect();
    s.voice(name, opts);
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }

  private build(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = SOUND.master;
    this.master.connect(ctx.destination);
    // 2秒の白いノイズ（紙・水・空気の音のもと。毎回ちがう所から読む）
    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // 部屋の空気：ノイズをくり返し流して、2段の lowpass で低いところだけ
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp1 = ctx.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = SOUND.air.lowpass;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = SOUND.air.lowpass;
    this.air = ctx.createGain();
    this.air.gain.value = 0;
    src.connect(lp1).connect(lp2).connect(this.air).connect(this.master);
    src.start();
    this.updateAir();
  }

  private updateAir(): void {
    const ctx = this.ctx;
    if (!ctx || !this.air) return;
    const on = this.enabled || this.airBoost > 1;
    const target = on ? SOUND.air.gain * (1 - this.night * (1 - SOUND.air.night)) * this.airBoost : 0;
    this.air.gain.setTargetAtTime(target, ctx.currentTime, SOUND.air.change / 3);
  }

  private voice(name: SoundName, opts: SoundOptions): void {
    switch (name) {
      case 'poke':
        this.poke(opts.height ?? 0.5, opts.underwater ?? true);
        break;
      case 'water':
        this.water(opts.strength ?? 1);
        break;
      case 'page':
      case 'open':
      case 'close':
        this.paper(SOUND[name]);
        break;
      case 'land':
        this.land(opts.kind ?? 'pebble');
        break;
    }
  }

  /** 音の大きさの形：attack 秒で peak へ上がり、decay 秒で消え入る */
  private envelope(g: GainNode, t0: number, attack: number, peak: number, decay: number): number {
    g.gain.setValueAtTime(SILENT, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(SILENT, t0 + attack + decay);
    return t0 + attack + decay;
  }

  /** ノイズを start から鳴らす（毎回ちがう所から読む） */
  private noiseSource(t0: number, seconds: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + seconds + 0.05);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** ガラスをつつく音：澄んだ音を数本重ねて短く減衰。瓶の下ほど低く、水面より下は少し早く消える。はじめに小さなコツ */
  private poke(height: number, underwater: boolean): void {
    const ctx = this.ctx!;
    const P = SOUND.poke;
    const t0 = ctx.currentTime + 0.005;
    const f0 = vary(P.base * (1 + (height - 0.5) * P.heightRange), P.jitter);
    const length = vary(1, P.lengthJitter) * (underwater ? P.underwaterDecay : 1);
    const out = ctx.createGain();
    out.gain.value = P.gain;
    const lp = this.filter('lowpass', P.lowpass * (underwater ? P.underwaterLowpass : 1));
    lp.connect(out).connect(this.master!);
    for (const p of P.partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0 * vary(p.ratio, 0.01);
      const g = ctx.createGain();
      const end = this.envelope(g, t0, 0.002, p.gain, p.decay * length);
      osc.connect(g).connect(lp);
      osc.start(t0);
      osc.stop(end + 0.05);
    }
    const c = P.click;
    const src = this.noiseSource(t0, c.seconds);
    const g = ctx.createGain();
    this.envelope(g, t0, 0.001, c.gain, c.seconds);
    src.connect(this.filter('bandpass', vary(c.freq, 0.1), 1.2)).connect(g).connect(lp);
  }

  /** 水の音：小さな泡のはじける音を1〜3つと、水の擦れる音 */
  private water(strength: number): void {
    const ctx = this.ctx!;
    const W = SOUND.water;
    const t0 = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    out.gain.value = W.gain * Math.min(Math.max(strength, 0), 1);
    out.connect(this.master!);
    const count = Math.round(between(W.bloops[0], W.bloops[1]));
    for (let i = 0; i < count; i++) {
      const t = t0 + Math.random() * 0.14;
      const seconds = vary(W.bloopSeconds, W.lengthJitter);
      const f = vary(between(W.bloopFreq[0], W.bloopFreq[1]), W.jitter);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * W.bloopRise, t + seconds);
      const g = ctx.createGain();
      const end = this.envelope(g, t, 0.004, between(0.5, 1), seconds);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(end + 0.05);
    }
    const seconds = vary(W.swishSeconds, W.lengthJitter);
    const src = this.noiseSource(t0, seconds + 0.03);
    const g = ctx.createGain();
    this.envelope(g, t0, 0.03, W.swishGain, seconds);
    src.connect(this.filter('lowpass', vary(W.swishLowpass, W.jitter))).connect(g).connect(out);
  }

  /** 紙の擦れる音：帯域を絞ったノイズを、ざらつき（細かい強弱）を付けて山なりに */
  private paper(cfg: { gain: number; center: number; q: number; highpass: number; seconds: number; flutter: number; jitter: number; lengthJitter: number }): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.005;
    const seconds = vary(cfg.seconds, cfg.lengthJitter);
    const src = this.noiseSource(t0, seconds);
    const g = ctx.createGain();
    // 山なりの形に、少しずつ揺れる強弱を重ねる
    const n = 48;
    const curve = new Float32Array(n);
    const bumps = Array.from({ length: Math.max(1, cfg.flutter) }, () => ({ at: Math.random(), w: between(0.05, 0.15), a: between(0.3, 0.8) }));
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const shape = Math.pow(Math.sin(Math.PI * Math.pow(x, 0.7)), 1.2);
      let grain = 0.55;
      for (const b of bumps) grain += b.a * Math.exp(-(((x - b.at) / b.w) ** 2));
      curve[i] = Math.max(SILENT, cfg.gain * shape * Math.min(grain, 1.2));
    }
    curve[n - 1] = SILENT;
    // 曲線の始まりにほかの変化を重ねると投げる端末があるので、はじめの値は node の値で
    g.gain.value = SILENT;
    g.gain.setValueCurveAtTime(curve, t0, seconds);
    src
      .connect(this.filter('highpass', cfg.highpass))
      .connect(this.filter('bandpass', vary(cfg.center, cfg.jitter), cfg.q))
      .connect(g)
      .connect(this.master!);
  }

  /** 瓶底に着いた音：ごく小さく、水の中なのでこもる。小石は鈍いコト（少し下がる）、シーグラスと貝殻は小さなカチ */
  private land(kind: FindKind): void {
    const ctx = this.ctx!;
    const L = SOUND.land;
    const k = L[kind];
    const t0 = ctx.currentTime + 0.005;
    const seconds = vary(k.seconds, L.lengthJitter);
    const f = vary(k.freq, L.jitter);
    const out = ctx.createGain();
    out.gain.value = L.gain;
    const lp = this.filter('lowpass', k.lowpass);
    lp.connect(out).connect(this.master!);
    const osc = ctx.createOscillator();
    osc.type = kind === 'pebble' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(f, t0);
    if (kind === 'pebble') osc.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + seconds);
    const g = ctx.createGain();
    const end = this.envelope(g, t0, 0.002, 1, seconds);
    osc.connect(g).connect(lp);
    osc.start(t0);
    osc.stop(end + 0.05);
    const src = this.noiseSource(t0, 0.02);
    const gn = ctx.createGain();
    this.envelope(gn, t0, 0.001, 0.4, 0.015);
    src.connect(this.filter('bandpass', f * 2, 1)).connect(gn).connect(lp);
  }
}
