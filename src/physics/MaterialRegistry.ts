/** SI units. Shared by rendering, content replays and production physics. */
export const COIN_RADIUS = 0.035;
export const COIN_THICKNESS = 0.008;
export const PHYSICS_CONFIG = Object.freeze({
  version: 'wood-standard-v2',
  fixedDt: 1 / 120,
  maxFrameSeconds: 0.1,
  maxStepsPerFrame: 12,
  gravity: -9.81,
  solverIterations: 8,
  integrationSubsteps: 2,
  tableThickness: 0.06,
  obstacleHeight: 0.08,
  initialYGap: 0.001,
  initialSettleSteps: 90,
  maxInitialDrift: 0.002,
  minDirectionLength: 1e-8,
  resupportSteps: 12,
  uprightQuaternionTolerance: 0.02,
  minSupportNormalY: 0.5,
  tableContactTolerance: 0.006,
  minSupportedCenterY: -0.002,
  initialClearance: 0.003,
  maxCoins: 32,
  coinMass: 0.012,
  maxImpulse: 0.048,
  powerExponent: 1.35,
  minPower: 0.06,
  linearDamping: 0.45,
  angularDamping: 2.5,
  settledLinearSpeed: 0.012,
  settledAngularSpeed: 0.15,
  settledSteps: 36,
  maxShotSteps: 120 * 15,
  fallY: -0.09,
  supportTolerance: 0.012,
});
export const MATERIALS = Object.freeze({
  standard: Object.freeze({ friction: 0.18, restitution: 0.7, mass: PHYSICS_CONFIG.coinMass }),
  wood: Object.freeze({ friction: 0.18, restitution: 0, obstacleRestitution: 0.7 }),
});
export function impulseForPower(power: number): number {
  return PHYSICS_CONFIG.maxImpulse * power ** PHYSICS_CONFIG.powerExponent;
}
