// 瓶1つの個体を描く。状態の個体（sim の Creature）に合わせて、泳ぐ個体（成体・エフィラ）と
// 瓶底の個体（ポリプ・ストロビラ）を作ったり消したりし、毎フレーム動かす。
// ストロビラがエフィラを放したときは、皿が上から1枚ずつ離れて、そのままエフィラとして泳ぎ出す。
import { Group, Vector3, type Camera, type Object3D, type PerspectiveCamera } from 'three';
import { EPHYRA, SWIM } from '../config';
import { createRng } from '../sim/rng';
import { isSwimmer, type Creature, type JarState } from '../sim/state';
import { Jellyfish } from './jelly/jellyfish';
import { Polyp } from './jelly/polyp';
import { swimBounds, type Neighbor } from './jelly/swim';
import type { SharedUniforms } from './uniforms';

interface SwimmerView {
  kind: 'swimmer';
  jelly: Jellyfish;
  neighbor: Neighbor;
  /** 皿から離れるのを待っている（まだ描かない） */
  waiting: boolean;
}

interface PolypView {
  kind: 'polyp';
  polyp: Polyp;
}

type View = SwimmerView | PolypView;

/** 放されたエフィラが泳ぎ出すときの、上への勢い（瓶の高さ/秒） */
const LAUNCH_SPEED = 0.02;

export class Creatures {
  readonly group = new Group();
  /** 確認用：個体を隠す（?hide=jelly） */
  hidden = false;
  private readonly views = new Map<number, View>();
  private readonly neighbors: Neighbor[] = [];
  private realSize = false;
  private readonly tmp = new Vector3();

  constructor(
    private readonly shared: SharedUniforms,
    /** 光る種の発光パスに入れる（泳ぐ個体だけ） */
    private readonly glowLayer: number,
  ) {}

  /** 確認用：ポリプ・ストロビラ・エフィラを実物大で描く */
  setRealSize(on: boolean): void {
    this.realSize = on;
  }

  get isRealSize(): boolean {
    return this.realSize;
  }

  /** 瓶の個体に合わせる。新しい個体は作り、いなくなった個体は消す */
  sync(jar: JarState): void {
    const seen = new Set<number>();
    for (const c of jar.creatures) {
      seen.add(c.id);
      let v = this.views.get(c.id);
      const kind = isSwimmer(c.stage) ? 'swimmer' : 'polyp';
      if (v && v.kind !== kind) {
        this.remove(c.id);
        v = undefined;
      }
      if (!v) v = this.create(c);
      this.apply(v, c, jar);
    }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.remove(id);
  }

  private create(c: Creature): View {
    const rng = createRng(c.seed);
    let v: View;
    if (isSwimmer(c.stage)) {
      const jelly = new Jellyfish(this.shared, rng, this.growthOf(c), this.startRadius());
      jelly.group.traverse((o) => o.layers.enable(this.glowLayer));
      const view: SwimmerView = { kind: 'swimmer', jelly, neighbor: { pos: jelly.swimmer.pos, radius: jelly.radius }, waiting: false };
      // 皿を放しているストロビラの子なら、その皿が離れるまで待ってから泳ぎ出す
      const parent = c.parent !== null ? this.views.get(c.parent) : undefined;
      if (c.stage === 'ephyra' && parent?.kind === 'polyp' && parent.polyp.isReleasing) {
        view.waiting = true;
        jelly.group.visible = false;
        parent.polyp.queueLaunch((pos, up) => {
          jelly.place(pos, up, this.tmp.copy(up).multiplyScalar(LAUNCH_SPEED));
          view.waiting = false;
          jelly.group.visible = true;
        });
      } else {
        // ほかの個体から離れた所で泳ぎはじめる（重なって現れないように）
        this.placeApart(jelly, c.seed);
      }
      v = view;
      this.group.add(jelly.group);
    } else {
      const polyp = new Polyp(this.shared, rng, c.spot ?? [0, 0]);
      v = { kind: 'polyp', polyp };
      this.group.add(polyp.group);
    }
    this.views.set(c.id, v);
    return v;
  }

  /** 泳げる範囲からいくつか場所を選び、ほかの泳ぐ個体からいちばん離れた所に置く（画面の上での離れ方で比べる） */
  private placeApart(jelly: Jellyfish, seed: number): void {
    const others = this.swimmers.filter((j) => j !== jelly);
    if (!others.length) return;
    const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
    const b = swimBounds(jelly.radius);
    const best = new Vector3();
    let bestD = -1;
    const p = new Vector3();
    for (let i = 0; i < 12; i++) {
      const r = Math.sqrt(rng.next()) * b.radius * 0.9;
      const th = rng.range(0, Math.PI * 2);
      p.set(r * Math.cos(th), rng.range(b.bottom + 0.03, b.top - 0.03), r * Math.sin(th));
      let d = Infinity;
      for (const o of others) {
        const q = o.swimmer.pos;
        const dz = (p.z - q.z) * SWIM.othersDepth;
        d = Math.min(d, Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + dz * dz) / (jelly.radius + o.radius));
      }
      if (d > bestD) {
        bestD = d;
        best.copy(p);
      }
    }
    jelly.relocate(best);
  }

  private apply(v: View, c: Creature, jar: JarState): void {
    if (v.kind === 'swimmer') {
      v.jelly.setGrowth(this.growthOf(c), this.startRadius());
      v.neighbor.radius = v.jelly.radius;
    } else {
      v.polyp.sync(
        {
          stage: c.stage === 'strobila' ? 'strobila' : 'polyp',
          progress: c.progress,
          discs: c.discs,
          age: c.age,
          stageAge: c.stageAge,
          resting: jar.resting,
        },
        this.realSize ? EPHYRA.realScale : 1,
      );
    }
  }

  private remove(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    if (v.kind === 'swimmer') {
      this.group.remove(v.jelly.group);
      v.jelly.dispose();
    } else {
      this.group.remove(v.polyp.group);
      v.polyp.dispose();
    }
  }

  /** 育ち具合（エフィラは段階の進み、成体は 1） */
  private growthOf(c: Creature): number {
    return c.stage === 'ephyra' ? c.progress : 1;
  }

  private startRadius(): number {
    return EPHYRA.radius * (this.realSize ? EPHYRA.realScale : 1);
  }

  /** 泳ぐ個体（皿から離れるのを待っているものは除く） */
  get swimmers(): Jellyfish[] {
    const out: Jellyfish[] = [];
    for (const v of this.views.values()) if (v.kind === 'swimmer' && !v.waiting) out.push(v.jelly);
    return out;
  }

  /** 光る個体がいるか（ミズクラゲは光らない） */
  get glowing(): boolean {
    return this.swimmers.some((j) => j.glowing);
  }

  /** 動かし、奥のものから先に描くよう順番を決める */
  update(dt: number, camera: Camera): void {
    const cam = camera.getWorldPosition(this.tmp);
    this.neighbors.length = 0;
    const swim: SwimmerView[] = [];
    const polyps: PolypView[] = [];
    for (const v of this.views.values()) {
      if (v.kind === 'polyp') polyps.push(v);
      else if (!v.waiting) {
        swim.push(v);
        this.neighbors.push(v.neighbor);
      }
    }
    for (const v of swim) {
      v.jelly.neighbors = this.neighbors;
      v.jelly.update(dt);
    }
    for (const v of polyps) v.polyp.update(dt);
    const far = (o: Vector3): number => -o.distanceToSquared(cam);
    swim.sort((a, b) => far(a.jelly.swimmer.pos) - far(b.jelly.swimmer.pos));
    swim.forEach((v, i) => v.jelly.setRenderOrder(30 + i));
    polyps.sort((a, b) => far(a.polyp.base) - far(b.polyp.base));
    polyps.forEach((v, i) => v.polyp.setRenderOrder(12 + i * 0.5));
  }

  /** ガラスをつつかれた。近くの個体が反応したら true */
  poke(point: Vector3): boolean {
    let any = false;
    for (const v of this.views.values()) {
      if (v.kind === 'swimmer' ? !v.waiting && v.jelly.poke(point) : v.polyp.poke(point)) any = true;
    }
    return any;
  }

  /**
   * 画面上の点（ndc）にいる個体の番号。泳ぐ個体は傘の見かけの大きさより少し広め、瓶底の個体は
   * 指で押せる大きさ（minNdc、画面の高さに対する ndc の半径）まで広げる。swimmersOnly なら泳ぐ個体だけ
   */
  pick(ndcX: number, ndcY: number, cam: PerspectiveCamera, minNdc: number, swimmersOnly = false): number | null {
    const aspect = cam.aspect;
    let best: number | null = null;
    let bestScore = Infinity;
    const c = new Vector3();
    const e = new Vector3();
    for (const [id, v] of this.views) {
      let r: number;
      if (v.kind === 'swimmer') {
        if (v.waiting) continue;
        const p = v.jelly.swimmer.pos;
        c.copy(p).project(cam);
        e.set(p.x + v.jelly.radius, p.y, p.z).project(cam);
        r = Math.max(Math.abs(e.x - c.x) * aspect * 1.4, minNdc);
      } else {
        if (swimmersOnly) continue;
        v.polyp.top(c);
        const h = v.polyp.size;
        c.addScaledVector(v.polyp.base, 1).multiplyScalar(0.5).project(cam);
        e.copy(v.polyp.base).setY(v.polyp.base.y + h).project(cam);
        r = Math.max(Math.abs(e.y - c.y) * 1.5, minNdc);
      }
      const d = Math.hypot((ndcX - c.x) * aspect, ndcY - c.y);
      if (d < r && d / r < bestScore) {
        bestScore = d / r;
        best = id;
      }
    }
    return best;
  }

  /** 札を出す位置（ワールド）：泳ぐ個体は傘のすぐ上、瓶底の個体は触手の冠の上 */
  anchorOf(id: number, out: Vector3): Vector3 | null {
    const v = this.views.get(id);
    if (!v) return null;
    if (v.kind === 'polyp') return v.polyp.top(out);
    if (v.waiting) return null;
    return out.copy(v.jelly.swimmer.pos).setY(v.jelly.swimmer.pos.y + v.jelly.radius * 0.55);
  }

  /** 泳ぐ個体をつまむ・引く・放す（target が null で放す） */
  hold(id: number, target: Vector3 | null): boolean {
    const v = this.views.get(id);
    if (v?.kind !== 'swimmer' || v.waiting) return false;
    v.jelly.swimmer.hold(target);
    return true;
  }

  /** 泳ぐ個体をきゅっと縮ませる（つままれたとき）。strength はつついたときを 1 として */
  startle(id: number, strength: number): void {
    const v = this.views.get(id);
    if (v?.kind === 'swimmer' && !v.waiting) v.jelly.pulse.startle(strength);
  }

  /** 泳ぐ個体の今の位置（ワールド、瓶の中心が原点） */
  positionOf(id: number): Vector3 | null {
    const v = this.views.get(id);
    return v?.kind === 'swimmer' ? v.jelly.swimmer.pos : null;
  }

  /** 泳ぐ個体の描画を隣の瓶へ渡す（動きはそのまま引き継ぐ）。渡したら true */
  giveTo(id: number, other: Creatures): boolean {
    const v = this.views.get(id);
    if (v?.kind !== 'swimmer' || v.waiting) return false;
    v.jelly.swimmer.hold(null);
    this.views.delete(id);
    this.group.remove(v.jelly.group);
    other.views.set(id, v);
    other.group.add(v.jelly.group);
    return true;
  }

  /**
   * 移ってきた個体を、水面の近くの side 側（-1 で左、1 で右）から入れる。
   * 瓶から瓶へ移すときは上から注ぎ入れるので、水面の近くからゆっくり沈んでくる
   */
  pourIn(id: number, side: number): void {
    const v = this.views.get(id);
    if (v?.kind !== 'swimmer') return;
    const j = v.jelly;
    const b = j.swimmer.range;
    j.place(new Vector3(side * b.radius * 0.55, b.top - 0.02, 0.02), new Vector3(0, 1, 0), new Vector3(0, -0.02, 0));
  }

  /** 確認用：個体の位置（泳ぐ個体は傘の中心、瓶底の個体は足もと。ワールド） */
  positionForDebug(id: number): Vector3 | null {
    const v = this.views.get(id);
    if (!v) return null;
    return v.kind === 'swimmer' ? v.jelly.swimmer.pos.clone() : v.polyp.base.clone();
  }

  /** 確認用：泳ぐ個体を決めた位置・向きに置く */
  placeForDebug(id: number, pos: Vector3, up: Vector3): void {
    const v = this.views.get(id);
    if (v?.kind === 'swimmer') v.jelly.place(pos, up, new Vector3());
  }

  /** 確認用：部品ごとの表示の切り替えに使う */
  get object(): Object3D {
    return this.group;
  }
}
