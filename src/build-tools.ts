import * as THREE from 'three';
import type { Cell } from './types';
import { CELL_SIZE, FLOOR_HEIGHT } from './spatial';

/** Construction targets deliberately ignore tiny facade details and animated props. */
export class BuildingPicker {
  private readonly bounds = new THREE.Box3();
  private readonly hit = new THREE.Vector3();

  pick(ray: THREE.Ray, cells: Iterable<Cell>): Cell | null {
    let nearest: Cell | null = null;
    let distance = Infinity;
    for (const cell of cells) {
      const x = cell.x * CELL_SIZE;
      const z = cell.z * CELL_SIZE;
      const half = CELL_SIZE * .48;
      this.bounds.min.set(x - half, 0, z - half);
      this.bounds.max.set(x + half, .6 + cell.height * FLOOR_HEIGHT, z + half);
      if (!ray.intersectBox(this.bounds, this.hit)) continue;
      const candidate = ray.origin.distanceToSquared(this.hit);
      if (candidate < distance) { nearest = cell; distance = candidate; }
    }
    return nearest;
  }
}

export type ConstructionEdit = { x: number; z: number; before: Cell | null; after: Cell | null };

/** Session-local construction history; discovery awards and simulation time stay earned. */
export class ConstructionHistory {
  private undoStack: ConstructionEdit[] = [];
  private redoStack: ConstructionEdit[] = [];
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  record(x: number, z: number, before: Cell | null, after: Cell | null) {
    if (before?.height === after?.height) return;
    this.undoStack.push({ x, z, before: before ? { ...before } : null, after: after ? { ...after } : null });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  take(direction: 'undo' | 'redo') {
    const from = direction === 'undo' ? this.undoStack : this.redoStack;
    const to = direction === 'undo' ? this.redoStack : this.undoStack;
    const edit = from.pop();
    if (edit) to.push(edit);
    return edit;
  }
}
