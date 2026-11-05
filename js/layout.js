// ============================================================
// layout.js — shared world coordinates (meters, y=0 is platform
// level). The hall runs along X; the platform + tracks are north
// (+Z); the sakura garden is east (+X).
// ============================================================

export const LAYOUT = {
  hall:     { x0: -40, x1: 12, z0: -16, z1: 14, h: 9 },
  store:    { x0: 2, x1: 11, z0: -13, z1: -4, h: 3.4 },
  garden:   { x0: 12, x1: 26, z0: -10, z1: 14 },
  platform: { x0: -40, x1: 12, z1: 25, edgeZ: 25, trackZ: 27.4, trackFloorY: -1.0, canopyH: 5.6 },

  // Platform screen-door bays (shared with train door offsets so they align).
  // exactly where the train's door bays land at stopFrontX (cars place doors
  // at local x 3/9/15 with carLen 17 → 6 m within a car, 5 m across the gap)
  doorXs: [6.5, 0.5, -5.5, -10.5, -16.5, -22.5, -27.5, -33.5],
  doorSpacing: 6,

  // Train (4 cars × 17 m). Front stops here → doors align with doorXs.
  train: {
    carLen: 17, carCount: 4, stopFrontX: 9.5,
    farX: -260, departX: 340,
  },

  spawn: { x: -6, z: -8 },   // player start
};
