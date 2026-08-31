// 简单的可复现随机（seedable），让 mock fixture 稳定。

export class Rng {
  private state: number;
  constructor(seed: number = 1) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    // (state >>> 0) / 2^32，强制走正路径
    return this.state / 0x1_0000_0000;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!;
  }
  id(prefix: string): string {
    return `${prefix}_${this.int(100000, 999999)}`;
  }
  isoDate(): string {
    return new Date(Date.now() - this.int(0, 30) * 86400000).toISOString();
  }
}
