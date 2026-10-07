import * as THREE from 'three';

export const FLIGHT_TUNING = {
  cruiseSpeed: 18,
  boostSpeed: 38,
  climbSpeed: 12,
  boostedClimbSpeed: 20,
  soarSpeed: 10,
  groundClearance: 3,
  landingSpeed: 5,
  takeoffHeight: 3,
  maxHeightAboveTerrain: 240,
} as const;

/** Velocity intent only. CampusGame still sweeps the real collider before moving. */
export class FlightMotion {
  mode: 'foot' | 'flying' | 'landing' = 'foot';
  velocity = new THREE.Vector3();
  takeoffY: number | null = null;
  blocked = false;
  get active() { return this.mode !== 'foot'; }
  start(y: number) {
    this.mode = 'flying'; this.velocity.set(0, 0, 0);
    this.takeoffY = y + FLIGHT_TUNING.takeoffHeight;
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
  update(dt: number, input: { forward: number; strafe: number; climb: number; boost: boolean; yaw: number; y: number; enabled: boolean }) {
    if (!this.active || !input.enabled) { this.pause(); return this.velocity; }
    if (input.climb > 0 && this.mode === 'landing') this.mode = 'flying';
    const horizontal = new THREE.Vector3(input.strafe, 0, -input.forward);
    if (horizontal.lengthSq() > 1) horizontal.normalize();
    horizontal.applyAxisAngle(new THREE.Vector3(0, 1, 0), input.yaw);
    const speed = this.mode === 'landing' ? 5 : input.boost ? FLIGHT_TUNING.boostSpeed : FLIGHT_TUNING.cruiseSpeed;
    let climb = input.climb * (input.boost ? FLIGHT_TUNING.boostedClimbSpeed : FLIGHT_TUNING.climbSpeed);
    if (input.climb < 0) this.takeoffY = null;
    if (this.takeoffY !== null) {
      if (input.y >= this.takeoffY - .08) this.takeoffY = null;
      else if (input.climb === 0) climb = Math.min(7, (this.takeoffY - input.y) * 4);
    }
    // Boost + a direction soars upward. Explicit up/down input takes priority.
    if (this.mode === 'flying' && input.boost && input.climb === 0 && horizontal.lengthSq() > 0)
      climb = Math.max(climb, FLIGHT_TUNING.soarSpeed);
    if (this.mode === 'landing') climb = -FLIGHT_TUNING.landingSpeed;
    const target = horizontal.multiplyScalar(speed); target.y = climb;
    if (target.length() > (input.boost ? FLIGHT_TUNING.boostSpeed : FLIGHT_TUNING.cruiseSpeed))
      target.setLength(input.boost ? FLIGHT_TUNING.boostSpeed : FLIGHT_TUNING.cruiseSpeed);
    this.velocity.lerp(target, 1 - Math.exp(-dt * (target.lengthSq() ? 5 : 9)));
    if (target.lengthSq() === 0 && this.velocity.lengthSq() < .0001) this.pause();
    return this.velocity;
  }
}
