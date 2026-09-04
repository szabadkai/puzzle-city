export function hash(seed: number, x: number, z: number, salt = 0): number {
  let value = seed ^ Math.imul(x + 101, 374761393) ^ Math.imul(z - 47, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function pick<T>(items: readonly T[], value: number): T {
  return items[Math.floor(value * items.length) % items.length];
}
