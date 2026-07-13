export interface SpringValue {
  value: number;
  velocity: number;
}

export interface PovAttitude {
  heading: SpringValue;
  heel: SpringValue;
  trim: SpringValue;
}

export interface PovAttitudeTarget {
  headingDeg: number;
  heelDeg: number;
  trimDeg: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** The target angle nearest the current unwrapped angle. */
export function nearestEquivalentAngle(targetDeg: number, currentDeg: number): number {
  // Floored modulo keeps the delta in [-180, 180) even when `currentDeg` is an
  // unwrapped heading many turns away (repeated spins); a plain `%` would return
  // a negative remainder and snap the camera a full turn backward at the wrap.
  const delta = (((targetDeg - currentDeg + 180) % 360) + 360) % 360 - 180;
  return currentDeg + delta;
}

/**
 * Exact integration of a critically damped spring over one time step.
 * `timeConstantSec` is the 63% step-response time, matching a first-order
 * EWMA's intuitive time constant while preserving spring motion. Integration
 * is independent of the replay's frame rate.
 */
export function advanceSpring(
  spring: SpringValue,
  target: number,
  dtSec: number,
  timeConstantSec = 0.5,
): SpringValue {
  const dt = Math.max(0, dtSec);
  const omega = 2.146 / Math.max(0.001, timeConstantSec);
  const offset = spring.value - target;
  const coefficient = spring.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);

  return {
    value: target + (offset + coefficient * dt) * decay,
    velocity: (spring.velocity - omega * coefficient * dt) * decay,
  };
}

export function resetPovAttitude(target: PovAttitudeTarget): PovAttitude {
  return {
    heading: { value: finiteOr(target.headingDeg, 0), velocity: 0 },
    heel: { value: finiteOr(target.heelDeg, 0), velocity: 0 },
    trim: { value: finiteOr(target.trimDeg, 0), velocity: 0 },
  };
}

export function advancePovAttitude(
  attitude: PovAttitude,
  target: PovAttitudeTarget,
  dtSec: number,
  timeConstantSec = 0.5,
): PovAttitude {
  const headingTarget = Number.isFinite(target.headingDeg)
    ? nearestEquivalentAngle(target.headingDeg, attitude.heading.value)
    : attitude.heading.value;

  return {
    heading: advanceSpring(attitude.heading, headingTarget, dtSec, timeConstantSec),
    heel: advanceSpring(attitude.heel, finiteOr(target.heelDeg, 0), dtSec, timeConstantSec),
    trim: advanceSpring(attitude.trim, finiteOr(target.trimDeg, 0), dtSec, timeConstantSec),
  };
}
