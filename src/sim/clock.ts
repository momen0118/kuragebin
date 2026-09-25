// 時計。ふだんは端末の時刻そのもの。確認用に、早送り（倍率）と先へ進める（ずらし）ができる。
// 早送りはゲームの時間と光の時刻だけにかかり、海月の動きの速さは変えない。

export class Clock {
  private rate = 1;
  private anchorWall: number;
  private anchorTime: number;

  constructor(private readonly wall: () => number = () => Date.now()) {
    this.anchorWall = wall();
    this.anchorTime = this.anchorWall;
  }

  /** 今の時刻（ミリ秒） */
  now(): number {
    return this.anchorTime + (this.wall() - this.anchorWall) * this.rate;
  }

  /** 早送りの倍率（1 で実時間） */
  get speed(): number {
    return this.rate;
  }

  setSpeed(rate: number): void {
    this.anchorTime = this.now();
    this.anchorWall = this.wall();
    this.rate = rate;
  }

  /** ms ミリ秒先へ進める */
  jump(ms: number): void {
    this.anchorTime += ms;
  }

  /** 端末の時刻に戻す */
  reset(): void {
    this.rate = 1;
    this.anchorWall = this.wall();
    this.anchorTime = this.anchorWall;
  }

  /** 端末の時刻そのもの（早送りやずらしを含まない） */
  wallNow(): number {
    return this.wall();
  }

  /** 端末の時刻からどれだけずれているか（ミリ秒） */
  get drift(): number {
    return this.now() - this.wall();
  }
}
