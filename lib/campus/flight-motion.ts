import * as THREE from 'three';

export const FLIGHT_TUNING = {
  cruiseSpeed: 28,
  boostSpeed: 48,
  climbSpeed: 32,
  boostedClimbSpeed: 40,
  soarSpeed: 10,
  groundClearance: 3,
  landingSpeed: 24,
  landingApproachSpeed: 4,
  takeoffHeight: 50,
  maxHeightAboveTerrain: 240,
} as const;

/** Velocity intent only. CampusGame still sweeps the real collider before moving. */
export class FlightMotion {
  mode: 'foot' | 'flying' | 'landing' = 'foot';
  velocity = new THREE.Vector3();
  takeoffY: number | null = null;
  blocked = false;
  get active() { return this.mode !== 'foot'; }
  start(y: number, targetY = y + FLIGHT_TUNING.takeoffHeight) {
    this.mode = 'flying'; this.velocity.set(0, 0, 0);
    this.takeoffY = targetY;
    this.blocked = false;
  }
  stop() {
    this.mode = 'foot'; this.velocity.set(0, 0, 0);
    this.takeoffY = null; this.blocked = false;
  }
  pause() { this.velocity.set(0, 0, 0); }
  toggleLanding() {
    this.mode = this.mode === 'landing' ? 'flying' : 'landing';
    this.takeoffY = null; this.pause();
  }
  update(dt: number, input: { forward: number; strafe: number; climb: number; boost: boolean; yaw: number; y: number; enabled: boolean; landingTarget?: { x: number; y: number; z: number } | null; x?: number; z?: number }) {
    if (!this.active || !input.enabled) { this.pause(); return this.velocity; }
    if (input.climb > 0 && this.mode === 'landing') this.mode = 'flying';
    const horizontal = new THREE.Vector3(input.strafe, 0, -input.forward);
    if (horizontal.lengthSq() > 1) horizontal.normalize();
    horizontal.applyAxisAngle(new THREE.Vector3(0, 1, 0), input.yaw);
    const speed = this.mode === 'landing' ? 5 : input.boost ? FLIGHT_TUNING.boostSpeed : FLIGHT_TUNING.cruiseSpeed;
    let climb = input.climb * (input.boost ? FLIGHT_TUNING.boostedClimbSpeed : FLIGHT_TUNING.climbSpeed);
    if (input.climb !== 0) this.takeoffY = null;
    if (this.takeoffY !== null) {
      if (input.y >= this.takeoffY - .08) { this.takeoffY = null; this.velocity.y = 0; }
      else if (input.climb === 0) climb = Math.min(FLIGHT_TUNING.climbSpeed, (this.takeoffY - input.y) * 3);
    }
    // Boost + a direction soars upward. Explicit up/down input takes priority.
    if (this.mode === 'flying' && input.boost && input.climb === 0 && horizontal.lengthSq() > 0)
      climb = Math.max(climb, FLIGHT_TUNING.soarSpeed);
    const target = horizontal.multiplyScalar(speed);
    if (this.mode === 'landing') {
      const spot = input.landingTarget;
      const offset = spot && input.x !== undefined && input.z !== undefined
        ? new THREE.Vector3(spot.x - input.x, 0, spot.z - input.z) : null;
      // Missing/obstructed support means hover. A nearby clear spot is reached
      // by swept movement, never by teleporting the capsule through an obstacle.
      climb = 0;
      if (!spot) this.velocity.y = Math.max(0, this.velocity.y);
      if (offset && spot) {
        if (horizontal.lengthSq() === 0) target.copy(offset).multiplyScalar(3).clampLength(0, FLIGHT_TUNING.landingApproachSpeed);
        const gap = Math.max(0, input.y - spot.y);
        if (offset.length() < .4) climb = -Math.min(FLIGHT_TUNING.landingSpeed, Math.max(.45, gap * 3));
      }
    }
    target.y = climb;
    // Vertical ascent/descent has its own limit; horizontal cruise no longer
    // silently caps the faster automatic ascent to the old cruise velocity.
    this.velocity.lerp(target, 1 - Math.exp(-dt * (this.mode === 'landing' || this.takeoffY !== null ? 12 : target.lengthSq() ? 6 : 9)));
    if (target.lengthSq() === 0 && this.velocity.lengthSq() < .0001) this.pause();
    return this.velocity;
  }
}
