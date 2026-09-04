export type Cell = {
  x: number;
  z: number;
  height: number;
  color: number;
  placedAt: number;
};

export type SavedTown = {
  version: 1;
  seed: number;
  cells: Cell[];
};

export const keyOf = (x: number, z: number) => `${x},${z}`;

export const CARDINALS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export const DIAGONALS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
