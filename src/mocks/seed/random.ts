/** Small seeded PRNG so every page load produces the same demo data. */
export class Random {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)]
    if (item === undefined) throw new Error('pick() from empty list')
    return item
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    let roll = this.next() * total
    for (const [value, weight] of entries) {
      roll -= weight
      if (roll <= 0) return value
    }
    const last = entries[entries.length - 1]
    if (!last) throw new Error('weighted() from empty list')
    return last[0]
  }

  digits(count: number): string {
    let out = ''
    for (let i = 0; i < count; i++) out += String(this.int(0, 9))
    return out
  }

  uuid(): string {
    const hex = () => this.int(0, 15).toString(16)
    const block = (n: number) => Array.from({ length: n }, hex).join('')
    return `${block(8)}-${block(4)}-4${block(3)}-${'89ab'[this.int(0, 3)]}${block(3)}-${block(12)}`
  }
}
