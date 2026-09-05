/** Shared world measurements used by both rendering and navigation. */
export const CELL_SIZE = 2.45;
export const FLOOR_HEIGHT = 1.42;

// Quays are centred at .51 cells and are .24 m wide. Keep the walking line
// safely on the stone instead of outside its water-facing edge.
export const QUAY_PATH_OFFSET = CELL_SIZE * .53;
export const GROUND_WALK_Y = .18;

export const ROOF_DECK_OFFSET = .16;
export const roofWalkY = (height: number) => .38 + height * FLOOR_HEIGHT + ROOF_DECK_OFFSET;

export const TERRACE_STEP_COUNT = 8;
// The flight starts at the high roof edge and finishes inside the lower roof.
// Starting near the cell centre made the first half descend through the upper
// building volume, which looked like stairs pasted down its façade.
export const TERRACE_START = 1.05;
export const TERRACE_RUN = .16;
export const TERRACE_RISE = FLOOR_HEIGHT / (TERRACE_STEP_COUNT - 1);
export const TERRACE_STEP_HEIGHT = .12;
export const terraceStepOutward = (index: number) => TERRACE_START + index * TERRACE_RUN;
export const terraceStepWalkY = (topY: number, index: number) =>
  topY + ROOF_DECK_OFFSET - index * TERRACE_RISE;

export const HIGH_CROSSING_SPAN_Y = FLOOR_HEIGHT * 2.28;
export const HIGH_CROSSING_WALK_Y = HIGH_CROSSING_SPAN_Y + .4;
