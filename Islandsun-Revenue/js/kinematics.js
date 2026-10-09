export const KINEMATICS = Object.freeze({ acceleration: 0.0006, brakingExponent: 1.15, brakingFactor: 0.002, maximumSpeed: 0.12, snapDistance: 0.01 });

/** Preserve the established per-frame acceleration and braking curve. */
export function advanceProgress(state) {
  const difference = state.target - state.visual;
  if (difference > 0) {
    state.speed += KINEMATICS.acceleration;
    if (state.target < 100) {
      const maximumSpeed = Math.pow(difference, KINEMATICS.brakingExponent) * KINEMATICS.brakingFactor;
      if (state.speed > maximumSpeed) state.speed = maximumSpeed;
    }
    state.speed = Math.min(state.speed, KINEMATICS.maximumSpeed);
    state.visual += state.speed;
  } else state.speed = 0;
  if (state.visual >= state.target - KINEMATICS.snapDistance) state.visual = state.target;
  return state;
}
