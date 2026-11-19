import * as THREE from "three";
import { clamp, damp } from "./utils.js";

export class Vehicle {
  constructor(car, world) {
    this.car = car;
    this.world = world;
    this.pos = new THREE.Vector3(0, 0, -4);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.yaw = 0;
    this.speed = 0;
    this.slip = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.time = 0;
    this.distance = 0;

    this.maxHealth = 3;
    this.health = 3;
    this.boost = 38;
    this.boosting = false;
    this.boostVisual = 0;
    this.boostImpulse = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.collisionCooldown = 0;
    this.shake = 0;
    this.bounce = 0;
    this.visualRoll = 0;
    this.visualPitch = 0;

    this.maxSpeed = 42;
    this.boostSpeed = 58;
    this.updateVectors();
  }

  reset({ x = 0, z = -4, yaw = 0, health = 3, boost = 38 } = {}) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.speed = 0;
    this.slip = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.time = 0;
    this.distance = 0;
    this.health = health;
    this.boost = boost;
    this.boosting = false;
    this.boostVisual = 0;
    this.boostImpulse = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.collisionCooldown = 0;
    this.shake = 0;
    this.bounce = 0;
    this.visualRoll = 0;
    this.visualPitch = 0;
    this.updateVectors();
    this.car.group.position.copy(this.pos);
    this.car.group.rotation.y = this.yaw;
    this.car.visual.rotation.set(0, 0, 0);
    this.car.visual.position.y = 0;
    this.car.setBoost(0, 0);
    for (const wheel of this.car.wheels) wheel.mesh.rotation.set(0, 0, 0);
  }

  updateVectors() {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  addBoost(amount) {
    this.boost = clamp(this.boost + amount, 0, 100);
  }

  triggerBoostPad() {
    this.addBoost(52);
    this.boostImpulse = 1.15;
    this.shake = Math.max(this.shake, 0.42);
  }

  takeHit(impact = 20, pushX = 0, pushZ = 0) {
    if (this.collisionCooldown > 0) return false;
    this.collisionCooldown = 1.05;
    this.health = Math.max(0, this.health - 1);
    this.speed *= 0.4;
    this.slip += (Math.random() - 0.5) * 5;
    this.pos.x += pushX * 1.35;
    this.pos.z += pushZ * 1.35;
    this.shake = Math.max(this.shake, 0.75 + impact * 0.018);
    this.bounce = 0.22;
    return true;
  }

  update(dt, controls) {
    const events = {
      collision: null,
      drift: 0,
      boostStarted: false,
      boostEnded: false,
      offroad: 0,
      boundary: false,
    };
    this.time += dt;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    this.boostImpulse = Math.max(0, this.boostImpulse - dt);
    this.steer = damp(this.steer, controls.steer, 12, dt);

    const previousBoosting = this.boosting;
    const wantsBoost = (controls.boost || this.boostImpulse > 0) && this.boost > 0.4 && this.speed > 2;
    this.boosting = wantsBoost;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - 25 * dt);
    } else {
      this.boost = Math.min(100, this.boost + 1.8 * dt);
    }
    if (this.boosting && !previousBoosting) events.boostStarted = true;
    if (!this.boosting && previousBoosting) events.boostEnded = true;

    const offroad = !this.world.isOnRoad(this.pos.x, this.pos.z);
    if (offroad) events.offroad = dt;
    const maxSpeed = offroad ? 20 : (this.boosting ? this.boostSpeed : this.maxSpeed);
    const accel = (this.boosting ? 38 : 24) * (offroad ? 0.58 : 1);
    const brake = controls.brake > 0.04;
    const throttle = brake ? controls.throttle * 0.18 : controls.throttle;

    if (brake) {
      if (this.speed > 0.4) this.speed -= 34 * controls.brake * dt;
      else this.speed = Math.max(-9, this.speed - 12 * controls.brake * dt);
    } else if (throttle > 0) {
      this.speed += accel * throttle * dt;
    } else {
      const coast = Math.min(Math.abs(this.speed), 3.2 * dt);
      this.speed -= Math.sign(this.speed) * coast;
    }
    const drag = offroad ? 1.55 : 0.22;
    this.speed -= this.speed * drag * dt;
    this.speed = clamp(this.speed, -9, maxSpeed);
    if (Math.abs(this.speed) < 0.04) this.speed = 0;

    const wantsDrift = controls.drift && Math.abs(this.speed) > 9 && Math.abs(this.steer) > 0.11;
    this.drifting = wantsDrift;
    if (wantsDrift) {
      events.drift = dt;
      this.driftTime += dt;
      this.addBoost(15 * dt);
      this.slip = damp(this.slip, -this.steer * Math.abs(this.speed) * 0.22, 5.5, dt);
    } else {
      this.driftTime = 0;
      this.slip = damp(this.slip, 0, 4.6, dt);
    }
    this.slip = clamp(this.slip, -7.5, 7.5);

    const speedFactor = clamp(0.34 + Math.abs(this.speed) / 38, 0.34, 1.5);
    const reverseSign = this.speed < -0.5 ? -1 : 1;
    let turnRate = this.steer * 1.55 * speedFactor * (wantsDrift ? 1.34 : 1) * reverseSign;
    turnRate = clamp(turnRate, -2.75, 2.75);
    this.yaw += turnRate * dt;
    this.updateVectors();

    this.pos.addScaledVector(this.forward, this.speed * dt);
    this.pos.addScaledVector(this.right, this.slip * dt);
    this.distance += Math.abs(this.speed) * dt;

    this.resolveCollisions(events);
    this.resolveBounds(events);
    this.updateVisuals(dt, controls, offroad);
    return events;
  }

  resolveCollisions(events) {
    const radius = 1.35;
    const colliders = this.world.getNearbyColliders(this.pos.x, this.pos.z, radius + 1.2);
    for (const collider of colliders) {
      const closestX = clamp(this.pos.x, collider.minX, collider.maxX);
      const closestZ = clamp(this.pos.z, collider.minZ, collider.maxZ);
      const dx = this.pos.x - closestX;
      const dz = this.pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius) continue;

      let nx;
      let nz;
      let penetration;
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        nx = dx / dist;
        nz = dz / dist;
        penetration = radius - dist;
      } else {
        const toLeft = this.pos.x - collider.minX;
        const toRight = collider.maxX - this.pos.x;
        const toBack = this.pos.z - collider.minZ;
        const toFront = collider.maxZ - this.pos.z;
        const min = Math.min(toLeft, toRight, toBack, toFront);
        if (min === toLeft) { nx = -1; nz = 0; }
        else if (min === toRight) { nx = 1; nz = 0; }
        else if (min === toBack) { nx = 0; nz = -1; }
        else { nx = 0; nz = 1; }
        penetration = radius + min;
      }
      this.pos.x += nx * penetration;
      this.pos.z += nz * penetration;
      const impact = Math.abs(this.speed);
      this.speed *= 0.28;
      this.slip *= -0.35;
      this.bounce = Math.max(this.bounce, 0.16);
      this.shake = Math.max(this.shake, 0.45 + impact * 0.012);
      if (this.collisionCooldown <= 0 && impact > 6) {
        this.collisionCooldown = 1.0;
        this.health = Math.max(0, this.health - 1);
        events.collision = { impact, position: this.pos.clone(), type: "building" };
      }
      break;
    }
  }

  resolveBounds(events) {
    const limit = this.world.citySize - 3;
    let hit = false;
    if (this.pos.x > limit) { this.pos.x = limit; hit = true; }
    if (this.pos.x < -limit) { this.pos.x = -limit; hit = true; }
    if (this.pos.z > limit) { this.pos.z = limit; hit = true; }
    if (this.pos.z < -limit) { this.pos.z = -limit; hit = true; }
    if (hit) {
      this.speed *= 0.45;
      this.slip *= 0.4;
      this.shake = Math.max(this.shake, 0.35);
      events.boundary = true;
    }
  }

  updateVisuals(dt, controls, offroad) {
    this.car.group.position.copy(this.pos);
    this.car.group.rotation.y = this.yaw;

    this.wheelSpin += (this.speed / 0.43) * dt;
    const steerVisual = this.steer * 0.38;
    for (const wheel of this.car.wheels) {
      wheel.mesh.rotation.x = this.wheelSpin;
      if (wheel.front) wheel.mesh.rotation.y = steerVisual;
    }

    const targetRoll = clamp(-this.steer * 0.11 - this.slip * 0.018, -0.2, 0.2);
    const targetPitch = clamp(
      (this.boosting ? -0.035 : 0) + (controls.brake ? 0.045 : 0) - (controls.throttle ? 0.018 : 0),
      -0.1,
      0.1,
    );
    this.visualRoll = damp(this.visualRoll, targetRoll, 8, dt);
    this.visualPitch = damp(this.visualPitch, targetPitch, 7, dt);
    this.bounce = damp(this.bounce, 0, 8, dt);
    this.shake = damp(this.shake, 0, 5.2, dt);
    const speedRatio = clamp(Math.abs(this.speed) / this.boostSpeed, 0, 1);
    const vibration = offroad ? 0.035 : 0.012;
    this.car.visual.rotation.z = this.visualRoll;
    this.car.visual.rotation.x = this.visualPitch;
    this.car.visual.position.y = Math.sin(this.time * 19) * vibration * speedRatio + this.bounce;

    this.boostVisual = damp(this.boostVisual, this.boosting ? 1 : 0, 10, dt);
    this.car.setBoost(this.boostVisual, speedRatio);
  }

  getState() {
    return {
      x: this.pos.x,
      y: 0,
      z: this.pos.z,
      yaw: this.yaw,
      speed: this.speed,
      drift: this.drifting,
      boost: this.boosting,
      alive: this.health > 0,
    };
  }
}
