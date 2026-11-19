import * as THREE from "three";
import { cloneAsset, makeCharacter, makeCrowdMesh, makeMergedCar } from "./assets.js";
import { TAU, clamp, lerp, mulberry32, randomColor } from "./utils.js";

const ROAD_COORDS = [-102, -68, -34, 0, 34, 68, 102];
const CITY_SIZE = 122;
const ROAD_WIDTH = 13;
const BLOCK_SIZE = 21;
const COLLIDER_CELL = 34;
const TRAFFIC_COLORS = ["#e84a5f", "#2ec4b6", "#f7d154", "#6c7ac9", "#f28c28", "#8bd3dd", "#b56dff"];
const BUILDING_COLORS = ["#c96a4b", "#e0a45e", "#5d6ca8", "#3f8d84", "#d47b8c", "#d9c79a", "#7a5c92", "#4d6b8f", "#b95f48"];

function makeAsphaltTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111a2d";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const v = 20 + Math.random() * 45;
    ctx.fillStyle = `rgba(${v},${v + 12},${v + 28},${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1);
  }
  for (let i = 0; i < 22; i++) {
    ctx.strokeStyle = `rgba(90,150,180,${0.02 + Math.random() * 0.04})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8 + Math.random() * 60, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(22, 22);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeSignTexture(text, accent) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 512, 192);
  gradient.addColorStop(0, "#101636");
  gradient.addColorStop(0.55, "#1a1534");
  gradient.addColorStop(1, "#08152a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 172);
  ctx.fillStyle = accent;
  for (let i = 0; i < 16; i++) {
    ctx.globalAlpha = 0.15 + Math.random() * 0.25;
    ctx.beginPath();
    ctx.arc(25 + i * 31, 24 + (i % 2) * 144, 5 + (i % 3) * 2, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff3d6";
  ctx.font = "900 58px Impact, Arial Black, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.fillText(text, 256, 100, 460);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function makeBoostTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = "rgba(16, 240, 205, 0.18)";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = "rgba(80, 255, 225, 0.9)";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = "rgba(220, 255, 250, 0.9)";
  for (let i = 0; i < 3; i++) {
    const x = 48 + i * 68;
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x + 38, 64);
    ctx.lineTo(x, 98);
    ctx.lineTo(x + 14, 98);
    ctx.lineTo(x + 52, 64);
    ctx.lineTo(x + 14, 30);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class World {
  constructor(scene, assets, seed = 20261119) {
    this.scene = scene;
    this.assets = assets;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.roadCoords = ROAD_COORDS;
    this.citySize = CITY_SIZE;
    this.roadWidth = ROAD_WIDTH;
    this.time = 0;
    this.sparkTimer = 0;

    this.root = new THREE.Group();
    this.root.name = "Monsoon City";
    scene.add(this.root);
    this.dynamic = new THREE.Group();
    this.trafficGroup = new THREE.Group();
    this.root.add(this.dynamic, this.trafficGroup);

    this.colliders = [];
    this.colliderGrid = new Map();
    this._nearby = [];
    this._nearbySet = new Set();
    this.plazas = [
      { x: 17, z: 17, radius: 10 },
      { x: -51, z: 17, radius: 9 },
    ];

    this.traffic = [];
    this.pickups = [];
    this.pads = [];
    this.gate = null;
    this.gateIndex = 0;
    this.runSeed = seed;
    this.runRng = mulberry32(seed);
    this.nearCharacters = [];
    this.crowd = [];
    this.crowdTime = 0;
    this.rain = null;
    this.rainDrops = [];
    this.rainRng = mulberry32(seed + 9999);
    this.characterDummy = new THREE.Object3D();
    this.characterColor = new THREE.Color();

    this.createSharedResources();
    this.build();
  }

  createSharedResources() {
    const basic = (color, options = {}) => new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      ...options,
    });

    this.materials = {
      building: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.04 }),
      roof: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.02 }),
      sidewalk: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.02 }),
      road: new THREE.MeshPhysicalMaterial({
        color: 0x10182c, roughness: 0.18, metalness: 0.26,
        clearcoat: 0.65, clearcoatRoughness: 0.22,
      }),
      puddle: new THREE.MeshPhysicalMaterial({
        color: 0x6bb7d6, roughness: 0.06, metalness: 0.48,
        transparent: true, opacity: 0.22, depthWrite: false,
        clearcoat: 1, clearcoatRoughness: 0.05,
      }),
      lane: basic(0xffe8ad, { transparent: true, opacity: 0.62 }),
      window: basic(0xffffff),
      lamp: basic(0xffd89b),
      pole: new THREE.MeshStandardMaterial({ color: 0x3b4964, roughness: 0.55, metalness: 0.45 }),
      tank: new THREE.MeshStandardMaterial({ color: 0x46b7d6, roughness: 0.42, metalness: 0.18 }),
      palmTrunk: new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 }),
      palmFrond: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, side: THREE.DoubleSide }),
      garlandWire: new THREE.LineBasicMaterial({ color: 0x5b486f, transparent: true, opacity: 0.7 }),
      garlandBulb: basic(0xffffff),
      gateRing: basic(0xffd166, { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      gateInner: basic(0x20e3b2, { transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
      gatePillar: new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0x7a3500, emissiveIntensity: 0.6, roughness: 0.35 }),
      gateBeam: basic(0xffd166, { transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      cup: new THREE.MeshStandardMaterial({ color: 0xfff0c7, emissive: 0xffa62b, emissiveIntensity: 0.55, roughness: 0.35 }),
      cupGlow: basic(0xffd166, { transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
      pad: basic(0xffffff, {
        map: makeBoostTexture(), transparent: true, opacity: 0.82,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    };

    this.geometries = {
      unitBox: new THREE.BoxGeometry(1, 1, 1),
      gateRing: new THREE.TorusGeometry(4.2, 0.17, 10, 48),
      gateInner: new THREE.TorusGeometry(3.72, 0.055, 8, 48),
      gatePillar: new THREE.CylinderGeometry(0.16, 0.24, 4.2, 8),
      gateBeam: new THREE.CylinderGeometry(0.45, 0.45, 24, 10, 1, true),
      cup: new THREE.CylinderGeometry(0.34, 0.25, 0.44, 12),
      cupHandle: new THREE.TorusGeometry(0.17, 0.05, 6, 14),
      cupGlow: new THREE.SphereGeometry(0.62, 12, 8),
      pad: new THREE.BoxGeometry(5.2, 0.055, 3.2),
      puddle: new THREE.CircleGeometry(1, 20),
      streetPole: new THREE.CylinderGeometry(0.07, 0.12, 5.2, 6),
      streetLamp: new THREE.SphereGeometry(0.22, 8, 6),
      tank: new THREE.CylinderGeometry(0.7, 0.7, 1.0, 10),
      palmTrunk: new THREE.CylinderGeometry(0.22, 0.34, 5.0, 7),
      palmFrond: new THREE.ConeGeometry(0.22, 2.8, 4),
      garlandBulb: new THREE.SphereGeometry(0.16, 6, 5),
    };
  }

  build() {
    this.buildSkyAndLights();
    this.buildGround();
    this.buildRoads();
    this.buildPuddles();
    this.buildRain();
    this.buildBlocksAndBuildings();
    this.buildStreetlights();
    this.buildGarlands();
    this.buildPalms();
    this.buildLandmarks();
    this.buildCharacters();
    this.buildTraffic();
    this.resetRun(this.seed);
  }

  buildSkyAndLights() {
    this.scene.background = new THREE.Color(0x0a1024);
    this.scene.fog = new THREE.FogExp2(0x141b38, 0.0061);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 32, 18),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x10143a) },
          horizonColor: { value: new THREE.Color(0x6b3b75) },
          bottomColor: { value: new THREE.Color(0x172b4a) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform vec3 bottomColor;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition).y;
            vec3 color = mix(bottomColor, horizonColor, smoothstep(-0.32, 0.12, h));
            color = mix(color, topColor, smoothstep(0.10, 0.78, h));
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    sky.name = "Monsoon sky";
    this.root.add(sky);

    const hemisphere = new THREE.HemisphereLight(0x9cc9ff, 0x5b2438, 1.55);
    this.root.add(hemisphere);
    const ambient = new THREE.AmbientLight(0x4d477a, 0.62);
    this.root.add(ambient);

    const sun = new THREE.DirectionalLight(0xffd6a3, 2.1);
    sun.position.set(-65, 92, -42);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 210;
    sun.shadow.bias = -0.0004;
    this.root.add(sun);
    this.sun = sun;
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshPhysicalMaterial({
        map: makeAsphaltTexture(),
        color: 0xffffff,
        roughness: 0.34,
        metalness: 0.16,
        clearcoat: 0.38,
        clearcoatRoughness: 0.28,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  buildRoads() {
    const roadLength = CITY_SIZE * 2 + ROAD_WIDTH;
    for (const r of ROAD_COORDS) {
      const zRoad = new THREE.Mesh(this.geometries.unitBox, this.materials.road);
      zRoad.scale.set(ROAD_WIDTH, 0.06, roadLength);
      zRoad.position.set(r, 0.02, 0);
      zRoad.receiveShadow = true;
      this.root.add(zRoad);

      const xRoad = new THREE.Mesh(this.geometries.unitBox, this.materials.road);
      xRoad.scale.set(roadLength, 0.06, ROAD_WIDTH);
      xRoad.position.set(0, 0.021, r);
      xRoad.receiveShadow = true;
      this.root.add(xRoad);
    }

    const dummy = new THREE.Object3D();
    const matrices = [];
    for (const r of ROAD_COORDS) {
      for (let z = -CITY_SIZE + 4; z < CITY_SIZE; z += 7) {
        for (const side of [-1, 1]) {
          dummy.position.set(r + side * 3.15, 0.075, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.12, 0.025, 2.6);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
        }
      }
      for (let x = -CITY_SIZE + 4; x < CITY_SIZE; x += 7) {
        for (const side of [-1, 1]) {
          dummy.position.set(x, 0.077, r + side * 3.15);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(2.6, 0.025, 0.12);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
        }
      }
    }
    const dashes = new THREE.InstancedMesh(this.geometries.unitBox, this.materials.lane, matrices.length);
    matrices.forEach((matrix, index) => dashes.setMatrixAt(index, matrix));
    dashes.instanceMatrix.needsUpdate = true;
    dashes.frustumCulled = false;
    this.root.add(dashes);

    const crosswalkMatrices = [];
    for (const x of ROAD_COORDS) {
      for (const z of ROAD_COORDS) {
        for (let i = -2; i <= 2; i++) {
          for (const side of [-1, 1]) {
            dummy.position.set(x + i * 1.45, 0.079, z + side * (ROAD_WIDTH / 2 + 1.0));
            dummy.scale.set(0.72, 0.025, 2.1);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            crosswalkMatrices.push(dummy.matrix.clone());
            dummy.position.set(x + side * (ROAD_WIDTH / 2 + 1.0), 0.08, z + i * 1.45);
            dummy.scale.set(2.1, 0.025, 0.72);
            dummy.updateMatrix();
            crosswalkMatrices.push(dummy.matrix.clone());
          }
        }
      }
    }
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xfff0ce, transparent: true, opacity: 0.24, toneMapped: false });
    const crosswalks = new THREE.InstancedMesh(this.geometries.unitBox, crossMat, crosswalkMatrices.length);
    crosswalkMatrices.forEach((matrix, index) => crosswalks.setMatrixAt(index, matrix));
    crosswalks.instanceMatrix.needsUpdate = true;
    crosswalks.frustumCulled = false;
    this.root.add(crosswalks);
  }

  buildPuddles() {
    const rng = mulberry32(this.seed + 3131);
    const count = window.innerWidth < 760 ? 46 : 96;
    const dummy = new THREE.Object3D();
    const puddles = new THREE.InstancedMesh(this.geometries.puddle, this.materials.puddle, count);
    for (let i = 0; i < count; i++) {
      const axis = rng() < 0.5 ? "x" : "z";
      const road = ROAD_COORDS[Math.floor(rng() * ROAD_COORDS.length)];
      const along = (rng() * 2 - 1) * CITY_SIZE;
      const side = (rng() * 2 - 1) * (ROAD_WIDTH / 2 - 1.15);
      if (axis === "z") dummy.position.set(road + side, 0.086, along);
      else dummy.position.set(along, 0.087, road + side);
      dummy.rotation.set(-Math.PI / 2, 0, rng() * TAU);
      dummy.scale.set(0.8 + rng() * 2.6, 0.35 + rng() * 1.25, 1);
      dummy.updateMatrix();
      puddles.setMatrixAt(i, dummy.matrix);
    }
    puddles.instanceMatrix.needsUpdate = true;
    puddles.frustumCulled = false;
    puddles.renderOrder = 1;
    this.root.add(puddles);
  }

  buildRain() {
    const count = window.innerWidth < 760 ? 220 : 520;
    const positions = new Float32Array(count * 6);
    const drops = [];
    for (let i = 0; i < count; i++) {
      drops.push({
        x: (this.rainRng() * 2 - 1) * 34,
        y: 1.5 + this.rainRng() * 13,
        z: (this.rainRng() * 2 - 1) * 34,
        speed: 11 + this.rainRng() * 10,
        length: 0.32 + this.rainRng() * 0.58,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), 80);
    const material = new THREE.LineBasicMaterial({
      color: 0xb7e4ff, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 4;
    const group = new THREE.Group();
    group.name = "Monsoon rain";
    group.add(lines);
    this.root.add(group);
    this.rain = { group, geometry, positions, drops, material };
    this.updateRain(0, new THREE.Vector3(0, 0, 0));
  }

  updateRain(dt, playerPos) {
    if (!this.rain) return;
    const { group, geometry, positions, drops } = this.rain;
    group.position.set(playerPos.x, 0, playerPos.z);
    const wind = dt * 1.1;
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      drop.y -= drop.speed * dt;
      drop.x += wind;
      if (drop.y < 0.12) {
        drop.y = 10 + this.rainRng() * 8;
        drop.x = (this.rainRng() * 2 - 1) * 34;
        drop.z = (this.rainRng() * 2 - 1) * 34;
      }
      const o = i * 6;
      positions[o] = drop.x;
      positions[o + 1] = drop.y;
      positions[o + 2] = drop.z;
      positions[o + 3] = drop.x + 0.055;
      positions[o + 4] = drop.y - drop.length;
      positions[o + 5] = drop.z - 0.018;
    }
    geometry.attributes.position.needsUpdate = true;
  }

  buildCharacters() {
    const rng = mulberry32(this.seed + 4242);
    const nearStyles = [
      { asset: this.assets.charPedestrian, color: "#2ec4b6", count: 4 },
      { asset: this.assets.charConstable, color: "#dce8ff", count: 2 },
      { asset: this.assets.charChaiwala, color: "#e07a5f", count: 2 },
    ];
    for (const style of nearStyles) {
      for (let i = 0; i < style.count; i++) {
        const api = makeCharacter(style.asset, { color: style.color, baseY: 0.02, scale: 1 });
        const axis = rng() < 0.5 ? "x" : "z";
        const road = ROAD_COORDS[Math.floor(rng() * ROAD_COORDS.length)];
        const dir = rng() < 0.5 ? 1 : -1;
        const t = (rng() * 2 - 1) * CITY_SIZE;
        const side = ROAD_WIDTH / 2 + 1.15 + rng() * 1.6;
        const speed = 0.5 + rng() * 0.5;
        const yaw = axis === "z" ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        api.group.position.set(axis === "z" ? road + dir * side : t, 0.02, axis === "z" ? t : road + dir * side);
        api.group.rotation.y = yaw;
        this.root.add(api.group);
        this.nearCharacters.push({ api, axis, road, dir, t, side, speed, yaw });
      }
    }

    const crowdStyles = [this.assets.charPedestrian, this.assets.charMeera, this.assets.charChaiwala];
    const perStyle = window.innerWidth < 760 ? 8 : 14;
    for (const asset of crowdStyles) {
      const mesh = makeCrowdMesh(asset, perStyle, 0xffffff);
      this.root.add(mesh);
      const entries = [];
      for (let i = 0; i < perStyle; i++) {
        const axis = rng() < 0.5 ? "x" : "z";
        const road = ROAD_COORDS[Math.floor(rng() * ROAD_COORDS.length)];
        const dir = rng() < 0.5 ? 1 : -1;
        const t = (rng() * 2 - 1) * CITY_SIZE;
        const side = ROAD_WIDTH / 2 + 1.05 + rng() * 2.1;
        const speed = 0.42 + rng() * 0.62;
        const scale = 0.82 + rng() * 0.28;
        const phase = rng() * TAU;
        const yaw = axis === "z" ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        entries.push({ axis, road, dir, t, side, speed, scale, phase, yaw });
        this.characterColor.setHSL(0.52 + rng() * 0.18, 0.10, 0.88 + rng() * 0.12);
        mesh.setColorAt(i, this.characterColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.crowd.push({ mesh, entries });
    }
  }

  updateCharacters(dt, playerPos, ambient = false) {
    this.crowdTime += dt;
    const limit = CITY_SIZE + 6;
    for (const npc of this.nearCharacters) {
      npc.t += npc.dir * npc.speed * dt;
      if (npc.t > limit) npc.t = -limit;
      else if (npc.t < -limit) npc.t = limit;
      const x = npc.axis === "z" ? npc.road + npc.dir * npc.side : npc.t;
      const z = npc.axis === "z" ? npc.t : npc.road + npc.dir * npc.side;
      npc.api.update(dt, npc.speed);
      npc.api.group.position.x = x;
      npc.api.group.position.z = z;
      npc.api.group.rotation.y = npc.yaw;
      const dx = x - playerPos.x;
      const dz = z - playerPos.z;
      npc.api.group.visible = ambient || dx * dx + dz * dz < 95 * 95;
    }

    for (const group of this.crowd) {
      const { mesh, entries } = group;
      for (let i = 0; i < entries.length; i++) {
        const npc = entries[i];
        npc.t += npc.dir * npc.speed * dt;
        if (npc.t > limit) npc.t = -limit;
        else if (npc.t < -limit) npc.t = limit;
        const x = npc.axis === "z" ? npc.road + npc.dir * npc.side : npc.t;
        const z = npc.axis === "z" ? npc.t : npc.road + npc.dir * npc.side;
        const bob = Math.abs(Math.sin(this.crowdTime * 5.2 * npc.speed + npc.phase)) * 0.032;
        this.characterDummy.position.set(x, 0.02 + bob, z);
        this.characterDummy.rotation.set(0, npc.yaw + Math.sin(this.crowdTime * 0.7 + npc.phase) * 0.045, 0);
        this.characterDummy.scale.setScalar(npc.scale);
        this.characterDummy.updateMatrix();
        mesh.setMatrixAt(i, this.characterDummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  addCollider(minX, maxX, minZ, maxZ) {
    const collider = { minX, maxX, minZ, maxZ };
    this.colliders.push(collider);
    const minCellX = Math.floor(minX / COLLIDER_CELL);
    const maxCellX = Math.floor(maxX / COLLIDER_CELL);
    const minCellZ = Math.floor(minZ / COLLIDER_CELL);
    const maxCellZ = Math.floor(maxZ / COLLIDER_CELL);
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const key = `${cx},${cz}`;
        if (!this.colliderGrid.has(key)) this.colliderGrid.set(key, []);
        this.colliderGrid.get(key).push(collider);
      }
    }
  }

  getNearbyColliders(x, z, radius = 2) {
    this._nearby.length = 0;
    this._nearbySet.clear();
    const minX = Math.floor((x - radius) / COLLIDER_CELL);
    const maxX = Math.floor((x + radius) / COLLIDER_CELL);
    const minZ = Math.floor((z - radius) / COLLIDER_CELL);
    const maxZ = Math.floor((z + radius) / COLLIDER_CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = this.colliderGrid.get(`${cx},${cz}`);
        if (!bucket) continue;
        for (const collider of bucket) {
          if (this._nearbySet.has(collider)) continue;
          this._nearbySet.add(collider);
          this._nearby.push(collider);
        }
      }
    }
    return this._nearby;
  }

  isOnRoad(x, z) {
    let nearestX = Infinity;
    let nearestZ = Infinity;
    for (const r of ROAD_COORDS) {
      nearestX = Math.min(nearestX, Math.abs(x - r));
      nearestZ = Math.min(nearestZ, Math.abs(z - r));
    }
    if (nearestX < ROAD_WIDTH / 2 + 1.3 || nearestZ < ROAD_WIDTH / 2 + 1.3) return true;
    for (const plaza of this.plazas) {
      if (Math.hypot(x - plaza.x, z - plaza.z) < plaza.radius) return true;
    }
    return false;
  }

  buildBlocksAndBuildings() {
    const blockCenters = [];
    for (let i = 0; i < ROAD_COORDS.length - 1; i++) {
      for (let j = 0; j < ROAD_COORDS.length - 1; j++) {
        blockCenters.push({
          i, j,
          x: (ROAD_COORDS[i] + ROAD_COORDS[i + 1]) / 2,
          z: (ROAD_COORDS[j] + ROAD_COORDS[j + 1]) / 2,
        });
      }
    }

    const sidewalks = new THREE.InstancedMesh(this.geometries.unitBox, this.materials.sidewalk, blockCenters.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    blockCenters.forEach((block, index) => {
      dummy.position.set(block.x, 0.11, block.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(BLOCK_SIZE, 0.22, BLOCK_SIZE);
      dummy.updateMatrix();
      sidewalks.setMatrixAt(index, dummy.matrix);
      color.set(index % 3 === 0 ? "#6d5b64" : index % 3 === 1 ? "#5e6575" : "#75625c");
      sidewalks.setColorAt(index, color);
    });
    sidewalks.instanceMatrix.needsUpdate = true;
    if (sidewalks.instanceColor) sidewalks.instanceColor.needsUpdate = true;
    sidewalks.receiveShadow = true;
    this.root.add(sidewalks);

    const plazaKeys = new Set(["3,3", "1,3"]);
    const buildingData = [];
    const windowData = [];
    const rng = mulberry32(this.seed + 77);
    const slots = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

    for (const block of blockCenters) {
      if (plazaKeys.has(`${block.i},${block.j}`)) continue;
      const count = rng() < 0.35 ? 2 : 3;
      const chosen = [...slots].sort(() => rng() - 0.5).slice(0, count);
      for (const [sx, sz] of chosen) {
        const w = 5.2 + rng() * 4.6;
        const d = 5.2 + rng() * 4.6;
        const h = 8 + rng() * 24;
        const x = block.x + sx * (BLOCK_SIZE * 0.23) + (rng() - 0.5) * 1.3;
        const z = block.z + sz * (BLOCK_SIZE * 0.23) + (rng() - 0.5) * 1.3;
        const bodyColor = randomColor(rng, BUILDING_COLORS);
        buildingData.push({ x, z, w, d, h, color: bodyColor });
        this.addCollider(x - w / 2 - 0.25, x + w / 2 + 0.25, z - d / 2 - 0.25, z + d / 2 + 0.25);

        const floors = Math.max(2, Math.floor(h / 3.15) - 1);
        const cols = Math.max(2, Math.floor(w / 2.1));
        for (let f = 0; f < floors; f++) {
          for (let c = 0; c < cols; c++) {
            if (rng() < 0.2) continue;
            const y = 1.35 + f * 3.05;
            const warm = rng() < 0.72;
            const winColor = warm ? (rng() < 0.5 ? "#ffd166" : "#ff9f1c") : (rng() < 0.5 ? "#20e3b2" : "#6fd6ff");
            windowData.push({
              x: x - w / 2 + (c + 0.5) * (w / cols), z: z + d / 2 + 0.035,
              y, sx: (w / cols) * 0.48, sy: 0.72, sz: 0.055, color: winColor,
            });
            if (rng() < 0.55) {
              windowData.push({
                x: x + w / 2 + 0.035, z: z - d / 2 + (c + 0.5) * (d / cols),
                y, sx: 0.055, sy: 0.72, sz: (d / cols) * 0.48, color: winColor,
              });
            }
          }
        }
      }
    }

    const bodies = new THREE.InstancedMesh(this.geometries.unitBox, this.materials.building, buildingData.length);
    const roofs = new THREE.InstancedMesh(this.geometries.unitBox, this.materials.roof, buildingData.length);
    buildingData.forEach((b, index) => {
      dummy.position.set(b.x, b.h / 2 + 0.22, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(index, dummy.matrix);
      color.set(b.color);
      bodies.setColorAt(index, color);

      dummy.position.set(b.x, b.h + 0.31, b.z);
      dummy.scale.set(b.w + 0.45, 0.18, b.d + 0.45);
      dummy.updateMatrix();
      roofs.setMatrixAt(index, dummy.matrix);
      color.set("#2d3347");
      roofs.setColorAt(index, color);
    });
    bodies.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
    bodies.receiveShadow = true;
    this.root.add(bodies, roofs);

    const windows = new THREE.InstancedMesh(this.geometries.unitBox, this.materials.window, windowData.length);
    windowData.forEach((win, index) => {
      dummy.position.set(win.x, win.y, win.z);
      dummy.scale.set(win.sx, win.sy, win.sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      windows.setMatrixAt(index, dummy.matrix);
      color.set(win.color);
      windows.setColorAt(index, color);
    });
    windows.instanceMatrix.needsUpdate = true;
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    windows.frustumCulled = false;
    this.root.add(windows);

    const tankCount = Math.max(1, Math.floor(buildingData.length / 3));
    const tanks = new THREE.InstancedMesh(this.geometries.tank, this.materials.tank, tankCount);
    for (let i = 0; i < tankCount; i++) {
      const b = buildingData[Math.floor(rng() * buildingData.length)];
      dummy.position.set(b.x + (rng() - 0.5) * b.w * 0.45, b.h + 0.9, b.z + (rng() - 0.5) * b.d * 0.45);
      dummy.scale.setScalar(0.75 + rng() * 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      tanks.setMatrixAt(i, dummy.matrix);
    }
    tanks.instanceMatrix.needsUpdate = true;
    this.root.add(tanks);

    this.buildSigns(buildingData, rng);
  }

  buildSigns(buildingData, rng) {
    const signs = [
      ["MONSOON FM", "#20e3b2"],
      ["CHAI 24×7", "#ffd166"],
      ["BOLLYWOOD NIGHTS", "#ff4d6d"],
      ["MASALA MILES", "#ff9f1c"],
      ["GATEWAY RUN", "#8b7cff"],
      ["AUTO UNION", "#20e3b2"],
      ["SPICE MARKET", "#ffd166"],
      ["NAMASTE CITY", "#ff9f1c"],
    ];
    const geometry = new THREE.PlaneGeometry(8.4, 3.15);
    signs.forEach(([text, accent], index) => {
      const b = buildingData[(index * 7 + 3) % buildingData.length];
      const material = new THREE.MeshBasicMaterial({
        map: makeSignTexture(text, accent),
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const sign = new THREE.Mesh(geometry, material);
      sign.position.set(b.x, b.h + 2.3, b.z + b.d / 2 + 0.14);
      sign.rotation.y = rng() < 0.25 ? Math.PI : 0;
      this.root.add(sign);
      const frame = new THREE.Mesh(
        this.geometries.unitBox,
        new THREE.MeshStandardMaterial({ color: 0x202741, roughness: 0.5, metalness: 0.4 }),
      );
      frame.position.copy(sign.position);
      frame.position.z -= 0.08;
      frame.scale.set(8.8, 3.5, 0.12);
      frame.rotation.copy(sign.rotation);
      this.root.add(frame);
    });
  }

  buildStreetlights() {
    const positions = [];
    for (const r of ROAD_COORDS) {
      for (let p = -CITY_SIZE + 8; p < CITY_SIZE; p += 17) {
        for (const side of [-1, 1]) {
          const offset = ROAD_WIDTH / 2 + 1.25;
          positions.push({ x: r + side * offset, z: p });
          positions.push({ x: p, z: r + side * offset });
        }
      }
    }
    const poles = new THREE.InstancedMesh(this.geometries.streetPole, this.materials.pole, positions.length);
    const lamps = new THREE.InstancedMesh(this.geometries.streetLamp, this.materials.lamp, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach((position, index) => {
      dummy.position.set(position.x, 2.7, position.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poles.setMatrixAt(index, dummy.matrix);
      dummy.position.y = 5.35;
      dummy.updateMatrix();
      lamps.setMatrixAt(index, dummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    poles.frustumCulled = false;
    lamps.frustumCulled = false;
    this.root.add(poles, lamps);
  }

  buildGarlands() {
    const rng = mulberry32(this.seed + 404);
    const intersections = [];
    for (const x of ROAD_COORDS) {
      for (const z of ROAD_COORDS) intersections.push({ x, z });
    }
    const chosen = intersections.sort(() => rng() - 0.5).slice(0, 8);
    const bulbMatrices = [];
    const bulbColors = [];
    const linePositions = [];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const palette = ["#ff9f1c", "#ffd166", "#20e3b2", "#ff4d6d"];
    for (const intersection of chosen) {
      const alongX = rng() < 0.5;
      const count = 15;
      let previous = null;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const span = ROAD_WIDTH + 7;
        const sag = Math.sin(t * Math.PI) * 0.65;
        const x = alongX ? intersection.x - span / 2 + t * span : intersection.x;
        const z = alongX ? intersection.z : intersection.z - span / 2 + t * span;
        const y = 6.4 - sag;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(0.8 + rng() * 0.6);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        bulbMatrices.push(dummy.matrix.clone());
        color.set(randomColor(rng, palette));
        bulbColors.push(color.clone());
        if (previous) linePositions.push(previous.x, previous.y, previous.z, x, y, z);
        previous = { x, y, z };
      }
    }
    const bulbs = new THREE.InstancedMesh(this.geometries.garlandBulb, this.materials.garlandBulb, bulbMatrices.length);
    bulbMatrices.forEach((matrix, index) => {
      bulbs.setMatrixAt(index, matrix);
      bulbs.setColorAt(index, bulbColors[index]);
    });
    bulbs.instanceMatrix.needsUpdate = true;
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    this.root.add(bulbs);

    const wireGeometry = new THREE.BufferGeometry();
    wireGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const wire = new THREE.LineSegments(wireGeometry, this.materials.garlandWire);
    this.root.add(wire);
  }

  buildPalms() {
    const rng = mulberry32(this.seed + 909);
    const positions = [];
    for (let i = 0; i < ROAD_COORDS.length - 1; i++) {
      for (let j = 0; j < ROAD_COORDS.length - 1; j++) {
        if (rng() < 0.45) continue;
        const cx = (ROAD_COORDS[i] + ROAD_COORDS[i + 1]) / 2;
        const cz = (ROAD_COORDS[j] + ROAD_COORDS[j + 1]) / 2;
        positions.push({ x: cx + (rng() < 0.5 ? -1 : 1) * 8.2, z: cz + (rng() < 0.5 ? -1 : 1) * 8.2 });
      }
    }
    const trunks = new THREE.InstancedMesh(this.geometries.palmTrunk, this.materials.palmTrunk, positions.length);
    const frondsPerPalm = 6;
    const fronds = new THREE.InstancedMesh(this.geometries.palmFrond, this.materials.palmFrond, positions.length * frondsPerPalm);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    positions.forEach((position, index) => {
      const heightScale = 0.8 + rng() * 0.45;
      dummy.position.set(position.x, 2.5 * heightScale + 0.22, position.z);
      dummy.rotation.set(0, 0, (rng() - 0.5) * 0.16);
      dummy.scale.set(1, heightScale, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
      const topY = 5.0 * heightScale + 0.22;
      for (let f = 0; f < frondsPerPalm; f++) {
        const angle = (f / frondsPerPalm) * TAU + rng() * 0.3;
        dummy.position.set(position.x + Math.cos(angle) * 0.55, topY, position.z + Math.sin(angle) * 0.55);
        dummy.rotation.set(Math.PI / 2.7, angle, 0.25);
        dummy.scale.set(1, 0.9 + rng() * 0.35, 1);
        dummy.updateMatrix();
        const frondIndex = index * frondsPerPalm + f;
        fronds.setMatrixAt(frondIndex, dummy.matrix);
        color.set(rng() < 0.5 ? "#2f8f6b" : "#48b06a");
        fronds.setColorAt(frondIndex, color);
      }
    });
    trunks.instanceMatrix.needsUpdate = true;
    fronds.instanceMatrix.needsUpdate = true;
    if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
    this.root.add(trunks, fronds);
  }

  buildLandmarks() {
    const temple = makeMergedCar(this.assets.temple, 0xffffff);
    temple.scale.setScalar(1.15);
    temple.position.set(17, 0.22, 17);
    temple.rotation.y = Math.PI / 5;
    this.root.add(temple);
    this.addCollider(13.5, 20.5, 13.5, 20.5);

    const stallPositions = [
      { x: -34 + 8.5, z: 0 + 8.5, yaw: Math.PI },
      { x: 34 - 8.5, z: -34 + 8.5, yaw: -Math.PI / 2 },
      { x: 0 - 8.5, z: 68 - 8.5, yaw: Math.PI / 2 },
      { x: 68 - 8.5, z: 0 - 8.5, yaw: 0 },
    ];
    for (const spot of stallPositions) {
      const stall = makeMergedCar(this.assets.chaiStall, 0xffffff);
      stall.scale.setScalar(0.78);
      stall.position.set(spot.x, 0.22, spot.z);
      stall.rotation.y = spot.yaw;
      this.root.add(stall);
      this.addCollider(spot.x - 1.4, spot.x + 1.4, spot.z - 1.2, spot.z + 1.2);
    }
  }

  buildTraffic() {
    const rng = mulberry32(this.seed + 1234);
    for (let i = 0; i < 18; i++) {
      const type = i < 12 ? "car" : "auto";
      const asset = type === "car" ? this.assets.cityCar : this.assets.autoRickshaw;
      const color = type === "car" ? randomColor(rng, TRAFFIC_COLORS) : 0xffffff;
      const mesh = makeMergedCar(asset, color);
      mesh.scale.setScalar(type === "auto" ? 0.86 : 1);
      this.trafficGroup.add(mesh);
      this.traffic.push({
        mesh,
        type,
        radius: type === "auto" ? 1.45 : 1.75,
        axis: "z",
        road: 0,
        dir: 1,
        pos: 0,
        speed: 8,
        yaw: 0,
        nearMissCooldown: 0,
        bumpCooldown: 0,
      });
    }
    this.resetTraffic(this.seed);
  }

  placeTraffic(car) {
    if (car.axis === "z") {
      car.mesh.position.set(car.road + car.dir * 3.05, 0.025, car.pos);
      car.mesh.rotation.y = car.dir > 0 ? 0 : Math.PI;
    } else {
      car.mesh.position.set(car.pos, 0.025, car.road - car.dir * 3.05);
      car.mesh.rotation.y = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    car.yaw = car.mesh.rotation.y;
  }

  resetTraffic(seed) {
    const rng = mulberry32(seed + 777);
    for (const car of this.traffic) {
      car.axis = rng() < 0.5 ? "x" : "z";
      car.road = ROAD_COORDS[Math.floor(rng() * ROAD_COORDS.length)];
      car.dir = rng() < 0.5 ? 1 : -1;
      car.pos = (rng() * 2 - 1) * CITY_SIZE;
      if (car.road === 0 && Math.abs(car.pos) < 30) car.pos += car.pos >= 0 ? 42 : -42;
      car.speed = car.type === "auto" ? 5.5 + rng() * 4 : 9 + rng() * 7;
      car.nearMissCooldown = 0;
      car.bumpCooldown = 0;
      this.placeTraffic(car);
    }
  }

  updateTraffic(dt) {
    const limit = CITY_SIZE + 12;
    for (const car of this.traffic) {
      car.pos += car.dir * car.speed * dt;
      if (car.pos > limit) car.pos = -limit;
      if (car.pos < -limit) car.pos = limit;
      car.nearMissCooldown = Math.max(0, car.nearMissCooldown - dt);
      car.bumpCooldown = Math.max(0, car.bumpCooldown - dt);
      this.placeTraffic(car);
    }
  }

  clearDynamic() {
    while (this.dynamic.children.length) this.dynamic.remove(this.dynamic.children[0]);
    this.pickups.length = 0;
    this.pads.length = 0;
    this.gate = null;
  }

  createGate(position, index, yaw = 0) {
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    group.rotation.y = yaw;

    const ring = new THREE.Mesh(this.geometries.gateRing, this.materials.gateRing);
    ring.position.y = 4.2;
    group.add(ring);
    const inner = new THREE.Mesh(this.geometries.gateInner, this.materials.gateInner);
    inner.position.y = 4.2;
    group.add(inner);
    for (const x of [-4.2, 4.2]) {
      const pillar = new THREE.Mesh(this.geometries.gatePillar, this.materials.gatePillar);
      pillar.position.set(x, 2.1, 0);
      group.add(pillar);
    }
    const beam = new THREE.Mesh(this.geometries.gateBeam, this.materials.gateBeam);
    beam.position.y = 12;
    group.add(beam);

    const cup = new THREE.Group();
    const cupBody = new THREE.Mesh(this.geometries.cup, this.materials.cup);
    cup.add(cupBody);
    const handle = new THREE.Mesh(this.geometries.cupHandle, this.materials.cup);
    handle.rotation.y = Math.PI / 2;
    handle.position.set(0.36, 0, 0);
    cup.add(handle);
    cup.position.y = 1.65;
    group.add(cup);

    const light = new THREE.PointLight(0xffb347, 2.4, 22, 2);
    light.position.y = 4.2;
    group.add(light);

    this.dynamic.add(group);
    return {
      group,
      position: new THREE.Vector3(position.x, 0, position.z),
      radius: 6.4,
      index,
      yaw,
      ring,
      inner,
      beam,
      cup,
      light,
      collected: false,
    };
  }

  createPickup(x, z) {
    const group = new THREE.Group();
    const cup = new THREE.Mesh(this.geometries.cup, this.materials.cup);
    cup.scale.setScalar(0.8);
    group.add(cup);
    const handle = new THREE.Mesh(this.geometries.cupHandle, this.materials.cup);
    handle.rotation.y = Math.PI / 2;
    handle.position.x = 0.3;
    handle.scale.setScalar(0.8);
    group.add(handle);
    const glow = new THREE.Mesh(this.geometries.cupGlow, this.materials.cupGlow);
    group.add(glow);
    group.position.set(x, 1.18, z);
    group.userData.phase = this.runRng() * TAU;
    this.dynamic.add(group);
    return { group, position: new THREE.Vector3(x, 0, z), collected: false, phase: group.userData.phase };
  }

  createPad(x, z, yaw = 0) {
    const mesh = new THREE.Mesh(this.geometries.pad, this.materials.pad);
    mesh.position.set(x, 0.09, z);
    mesh.rotation.y = yaw;
    this.dynamic.add(mesh);
    return { mesh, position: new THREE.Vector3(x, 0, z), used: false, phase: this.runRng() * TAU };
  }

  spawnPickupLine(from, to, count) {
    for (let i = 0; i < count; i++) {
      const t = lerp(0.08, 0.88, count === 1 ? 0 : i / (count - 1));
      const wave = Math.sin(i * 1.7 + this.gateIndex) * 0.65;
      const x = lerp(from.x, to.x, t) + (Math.abs(to.x - from.x) < 1 ? wave : 0);
      const z = lerp(from.z, to.z, t) + (Math.abs(to.z - from.z) < 1 ? 0 : wave * 0.25);
      this.pickups.push(this.createPickup(x, z));
    }
  }

  resetRun(seed = Date.now()) {
    this.runSeed = seed >>> 0;
    this.runRng = mulberry32(this.runSeed);
    this.gateIndex = 1;
    this.clearDynamic();
    this.gate = this.createGate(new THREE.Vector3(0, 0, 28), this.gateIndex, 0);
    this.spawnPickupLine(new THREE.Vector3(0, 0, 1), this.gate.position, 7);
    this.pads.push(this.createPad(0, 16, 0));
    this.resetTraffic(this.runSeed);
  }

  gateYaw(axis, dir) {
    if (axis === "z") return dir > 0 ? 0 : Math.PI;
    return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  chooseGatePosition(previous, playerPos) {
    const candidates = [];
    for (const x of ROAD_COORDS) {
      for (const z of ROAD_COORDS) {
        const distPrev = Math.hypot(x - previous.x, z - previous.z);
        const distPlayer = Math.hypot(x - playerPos.x, z - playerPos.z);
        if (distPrev < 44 || distPrev > 132 || distPlayer < 38 || distPlayer > 154) continue;
        for (const axis of ["x", "z"]) {
          for (const dir of [-1, 1]) {
            const approach = axis === "z"
              ? new THREE.Vector3(x, 0, z - dir * 42)
              : new THREE.Vector3(x - dir * 42, 0, z);
            if (Math.abs(approach.x) > CITY_SIZE - 8 || Math.abs(approach.z) > CITY_SIZE - 8) continue;
            candidates.push({ x, z, axis, dir, approach, score: Math.abs(distPrev - 82) + Math.abs(distPlayer - 78) * 0.35 + this.runRng() * 22 });
          }
        }
      }
    }
    if (!candidates.length) {
      const x = ROAD_COORDS[Math.floor(this.runRng() * ROAD_COORDS.length)];
      const z = ROAD_COORDS[Math.floor(this.runRng() * ROAD_COORDS.length)];
      return { x, z, axis: "z", dir: 1, approach: new THREE.Vector3(x, 0, z - 42) };
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[Math.floor(this.runRng() * Math.min(5, candidates.length))];
  }

  nextGate(playerPos) {
    const previous = this.gate?.position || new THREE.Vector3(0, 0, 28);
    const choice = this.chooseGatePosition(previous, playerPos);
    this.clearDynamic();
    this.gateIndex += 1;
    const yaw = this.gateYaw(choice.axis, choice.dir);
    this.gate = this.createGate(new THREE.Vector3(choice.x, 0, choice.z), this.gateIndex, yaw);
    this.spawnPickupLine(choice.approach, this.gate.position, 9);
    const padT = 0.5;
    const padX = lerp(choice.approach.x, choice.x, padT);
    const padZ = lerp(choice.approach.z, choice.z, padT);
    this.pads.push(this.createPad(padX, padZ, yaw));
    return this.gate;
  }

  update(dt, playerPos, options = {}) {
    this.time += dt;
    this.updateTraffic(dt * (options.ambient ? 0.38 : 1));
    this.updateCharacters(dt * (options.ambient ? 0.45 : 1), playerPos, !!options.ambient);
    this.updateRain(dt, playerPos);

    if (this.gate && !this.gate.collected) {
      const gate = this.gate;
      gate.ring.rotation.z += dt * 0.45;
      gate.inner.rotation.z -= dt * 0.78;
      gate.cup.rotation.y += dt * 2.1;
      gate.cup.position.y = 1.65 + Math.sin(this.time * 3.1) * 0.18;
      const pulse = 0.5 + Math.sin(this.time * 4.2) * 0.5;
      gate.light.intensity = 1.8 + pulse * 1.2;
      gate.beam.material.opacity = 0.055 + pulse * 0.045;
      if (options.particles) {
        this.sparkTimer -= dt;
        if (this.sparkTimer <= 0) {
          this.sparkTimer = 0.075;
          const angle = Math.random() * TAU;
          const spark = new THREE.Vector3(
            gate.position.x + Math.cos(angle) * 3.7,
            4.2 + Math.sin(angle) * 3.7,
            gate.position.z + (Math.random() - 0.5) * 0.5,
          );
          options.particles.emit(spark, 0xffd166, 1, {
            speed: 1.6, spread: 0.8, lift: 0.2, life: 0.6, size: 0.15, gravity: -0.6, drag: 2,
          });
        }
      }
    }

    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      pickup.group.rotation.y += dt * 2.4;
      pickup.group.position.y = 1.18 + Math.sin(this.time * 3.4 + pickup.phase) * 0.16;
    }
    for (const pad of this.pads) {
      if (pad.used) continue;
      pad.mesh.material.opacity = 0.68 + Math.sin(this.time * 5 + pad.phase) * 0.16;
      pad.mesh.scale.z = 1 + Math.sin(this.time * 4 + pad.phase) * 0.03;
    }
  }
}
