import * as THREE from "three";
import { TAU, clamp } from "./utils.js";

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(1.0, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = smoothstep(0.5, 0.04, d) * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class ParticleSystem {
  constructor(scene, maxParticles = 700) {
    this.max = maxParticles;
    this.cursor = 0;
    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 3);
    this.sizes = new Float32Array(maxParticles);
    this.alphas = new Float32Array(maxParticles);
    this.life = new Float32Array(maxParticles);
    this.maxLife = new Float32Array(maxParticles);
    this.gravity = new Float32Array(maxParticles);
    this.drag = new Float32Array(maxParticles);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setDrawRange(0, maxParticles);

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geometry = geometry;
    this._color = new THREE.Color();
  }

  emit(position, color, count = 12, options = {}) {
    const {
      speed = 7,
      spread = 1,
      lift = 0.55,
      life = 0.7,
      size = 0.22,
      gravity = 7,
      drag = 1.2,
      direction = null,
      bias = 0,
    } = options;
    this._color.set(color);
    const pos = position?.isVector3 ? position : { x: position?.x || 0, y: position?.y || 0, z: position?.z || 0 };

    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      const angle = Math.random() * TAU;
      const radial = Math.random() * speed * spread;
      let vx = Math.cos(angle) * radial;
      let vz = Math.sin(angle) * radial;
      let vy = (Math.random() * 0.8 + lift * 0.4) * speed;
      if (direction) {
        vx += direction.x * speed * bias;
        vy += direction.y * speed * bias;
        vz += direction.z * speed * bias;
      }
      const jitter = 0.4;
      this.positions[i3] = pos.x + (Math.random() - 0.5) * jitter;
      this.positions[i3 + 1] = pos.y + (Math.random() - 0.5) * jitter;
      this.positions[i3 + 2] = pos.z + (Math.random() - 0.5) * jitter;
      this.velocities[i3] = vx;
      this.velocities[i3 + 1] = vy;
      this.velocities[i3 + 2] = vz;
      const variation = 0.75 + Math.random() * 0.5;
      this.colors[i3] = this._color.r * variation;
      this.colors[i3 + 1] = this._color.g * variation;
      this.colors[i3 + 2] = this._color.b * variation;
      this.sizes[i] = size * (0.65 + Math.random() * 0.8);
      const particleLife = life * (0.7 + Math.random() * 0.6);
      this.life[i] = particleLife;
      this.maxLife[i] = particleLife;
      this.alphas[i] = 1;
      this.gravity[i] = gravity;
      this.drag[i] = drag;
    }
  }

  burst(position, color, count = 24, options = {}) {
    this.emit(position, color, count, options);
  }

  trail(position, color, direction, count = 2) {
    this.emit(position, color, count, {
      speed: 2.8,
      spread: 0.55,
      lift: 0.18,
      life: 0.42,
      size: 0.18,
      gravity: -0.5,
      drag: 2.2,
      direction,
      bias: 0.55,
    });
  }

  smoke(position, color = 0xbfc7df, count = 3) {
    this.emit(position, color, count, {
      speed: 2.2,
      spread: 0.65,
      lift: 0.8,
      life: 0.9,
      size: 0.38,
      gravity: -1.4,
      drag: 2.6,
    });
  }

  update(dt) {
    const step = Math.min(dt, 0.05);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.life[i] -= step;
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      const decay = Math.max(0, 1 - this.drag[i] * step);
      this.velocities[i3] *= decay;
      this.velocities[i3 + 2] *= decay;
      this.velocities[i3 + 1] -= this.gravity[i] * step;
      this.positions[i3] += this.velocities[i3] * step;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * step;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * step;
      const t = clamp(this.life[i] / this.maxLife[i], 0, 1);
      this.alphas[i] = t * t;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  reset() {
    this.life.fill(0);
    this.alphas.fill(0);
    this.sizes.fill(0);
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }
}
