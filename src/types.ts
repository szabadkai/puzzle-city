export type Cell = {
  x: number;
  z: number;
  height: number;
  color: number;
  placedAt: number;
};

export type SavedTown = {
  version: 1 | 2 | 3;
  seed: number;
  cells: Cell[];
  timeOfDay?: number;
  day?: number;
  citizens?: CitizenSave[];
  businesses?: BusinessSave[];
};

export type BusinessType = 'bakery' | 'cafe' | 'workshop' | 'fishmonger' | 'inn';

export type BusinessSave = {
  id: string;
  type: BusinessType;
  cellKey: string;
  ownerId: string;
  name: string;
  openedAt: number;
};

export type CitizenSave = {
  id: string;
  name: string;
  homeKey: string;
  position: [number, number];
  occupation: string;
  traits: string[];
  relationships: string[];
  color: number;
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
