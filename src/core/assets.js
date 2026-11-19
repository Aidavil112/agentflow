import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const MANIFEST = {
  heroCar: "hero_car.glb",
  cityCar: "city_car.glb",
  autoRickshaw: "auto_rickshaw.glb",
  temple: "temple.glb",
  chaiStall: "chai_stall.glb",
  charAyaan: "char_ayaan.glb",
  charMeera: "char_meera.glb",
  charConstable: "char_constable.glb",
  charChaiwala: "char_chaiwala.glb",
  charPedestrian: "char_pedestrian.glb",
};

const TAU = Math.PI * 2;

const mergedGeometryCache = new Map();
const mergedMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.38,
  metalness: 0.18,
});

function asColor(value) {
  return value?.isColor ? value.clone() : new THREE.Color(value || 0xffffff);
}

/** Mark a mesh as using cached/merged geometry and shared material, so World disposal will not free it. */
function markExternalAsset(object) {
  object.userData.externalAsset = true;
  return object;
}

/** Mark a cloned GLB hierarchy: geometry is shared with the asset, but materials are per-clone. */
function markClonedAsset(object) {
  object.userData.externalAsset = true;
  object.traverse((child) => {
    child.userData.externalAsset = true;
    if (child.isMesh) child.userData.cloneMaterial = true;
  });
  return object;
}

function cloneMaterials(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => material.clone());
    } else if (child.material) {
      child.material = child.material.clone();
    }
  });
}

export function cloneAsset(asset) {
  const clone = asset.clone(true);
  cloneMaterials(clone);
  return clone;
}

export function tintAsset(root, color, materialName = "Body_Paint") {
  const tint = asColor(color);
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material.name?.includes(materialName) && material.color) material.color.copy(tint);
    }
  });
}

function ensureGeometryShape(geometry) {
  let result = geometry;
  if (result.index) result = result.toNonIndexed();
  result.morphAttributes = {};
  result.clearGroups();
  const allowed = new Set(["position", "normal", "uv", "color"]);
  for (const name of Object.keys(result.attributes)) {
    if (!allowed.has(name)) result.deleteAttribute(name);
  }
  if (!result.attributes.normal) result.computeVertexNormals();
  if (!result.attributes.uv || result.attributes.uv.itemSize !== 2) {
    result.deleteAttribute("uv");
    const uv = new Float32Array(result.attributes.position.count * 2);
    result.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }
  return result;
}

export function getMergedGeometry(asset, color = 0xffffff) {
  const body = asColor(color);
  const key = `${asset.uuid}:${body.getHexString()}`;
  if (mergedGeometryCache.has(key)) return mergedGeometryCache.get(key);

  asset.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(asset.matrixWorld).invert();
  const matrix = new THREE.Matrix4();
  const geometries = [];

  asset.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    matrix.multiplyMatrices(rootInverse, child.matrixWorld);
    let geometry = ensureGeometryShape(child.geometry.clone());
    geometry.applyMatrix4(matrix);

    const source = Array.isArray(child.material) ? child.material[0] : child.material;
    const sourceColor = source?.color ? source.color.clone() : new THREE.Color(0xffffff);
    const finalColor = source?.name?.includes("Body_Paint") ? body : sourceColor;
    if (source?.emissiveIntensity > 1) finalColor.multiplyScalar(1.35);

    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = finalColor.r;
      colors[i * 3 + 1] = finalColor.g;
      colors[i * 3 + 2] = finalColor.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);
  });

  let merged = geometries.length ? mergeGeometries(geometries, false) : null;
  for (const geometry of geometries) geometry.dispose();
  if (!merged) {
    merged = new THREE.BoxGeometry(2, 1, 4);
    const count = merged.attributes.position.count;
    const colors = new Float32Array(count * 3).fill(1);
    merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  merged.computeBoundingSphere();
  mergedGeometryCache.set(key, merged);
  return merged;
}

export function makeMergedCar(asset, color) {
  const mesh = new THREE.Mesh(getMergedGeometry(asset, color), mergedMaterial);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  return markExternalAsset(mesh);
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function makeNameSprite(name, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const tint = asColor(color).getStyle();
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(6, 10, 25, 0.78)";
  ctx.strokeStyle = tint;
  ctx.lineWidth = 3;
  roundedRect(ctx, 4, 6, 248, 52, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff3d6";
  ctx.font = "800 25px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(name).slice(0, 14), 128, 33, 220);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.4, 0.85, 1);
  sprite.position.y = 2.65;
  sprite.renderOrder = 20;
  return sprite;
}

export function makeRemoteCar(asset, color, name) {
  const group = new THREE.Group();
  const mesh = makeMergedCar(asset, color);
  group.add(mesh);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: asColor(color),
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.78, 32), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.045;
  group.add(ring);

  const label = makeNameSprite(name, color);
  group.add(label);
  return { group, mesh, ring, label };
}

/** A full, limb-animated Blender character for the menu preview and near-field NPCs. */
export function makeCharacter(asset, options = {}) {
  const { color = "#ff9f1c", tint = true, baseY = 0, scale = 1 } = options;
  const group = new THREE.Group();
  const model = cloneAsset(asset);
  markClonedAsset(model);
  group.userData.externalAsset = true;
  if (tint) tintAsset(model, color, "Body_Paint");
  group.add(model);
  group.scale.setScalar(scale);

  const limbs = { armL: null, armR: null, legL: null, legR: null, head: null };
  model.traverse((child) => {
    if (child.name.endsWith("Arm_L")) limbs.armL = child;
    else if (child.name.endsWith("Arm_R")) limbs.armR = child;
    else if (child.name.endsWith("Leg_L")) limbs.legL = child;
    else if (child.name.endsWith("Leg_R")) limbs.legR = child;
    else if (child.name.endsWith("Head")) limbs.head = child;
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const api = {
    group,
    model,
    limbs,
    baseY,
    phase: Math.random() * TAU,
    speed: 1,
    update(dt, speed = 1) {
      this.speed = speed;
      const rate = 5.2 + speed * 1.2;
      this.phase += dt * rate;
      const swing = Math.sin(this.phase) * 0.42 * Math.min(speed, 1.5);
      const sway = Math.cos(this.phase) * 0.06;
      if (limbs.legL) limbs.legL.rotation.x = -swing;
      if (limbs.legR) limbs.legR.rotation.x = swing;
      if (limbs.armL) limbs.armL.rotation.x = swing * 0.72;
      if (limbs.armR) limbs.armR.rotation.x = -swing * 0.72;
      if (limbs.head) {
        limbs.head.rotation.y = Math.sin(this.phase * 0.43) * 0.09;
        limbs.head.rotation.z = sway * 0.25;
      }
      const bob = Math.abs(Math.sin(this.phase * 2)) * 0.028 * Math.min(speed, 1.5);
      group.position.y = this.baseY + bob;
      return bob;
    },
  };
  api.update(0, 1);
  return api;
}

/** One draw call for an entire crowd, using the same merged vertex-color pipeline as traffic. */
export function makeCrowdMesh(asset, count, tint = 0xffffff) {
  const mesh = new THREE.InstancedMesh(getMergedGeometry(asset, tint), mergedMaterial, count);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return markExternalAsset(mesh);
}

function makeFallbackCharacter() {
  const group = new THREE.Group();
  group.name = "Fallback_Character_Root";
  const cloth = new THREE.MeshStandardMaterial({ name: "Fallback_Body_Paint", color: 0xff9f1c, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ name: "Fallback_Skin", color: 0xc98d63, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.34), cloth);
  body.position.y = 1.1;
  group.add(body);
  const head = new THREE.Group();
  head.name = "Fallback_Head";
  head.position.set(0, 1.65, 0);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
  head.add(face);
  group.add(head);
  for (const [name, x] of [["Arm_L", -0.38], ["Arm_R", 0.38], ["Leg_L", -0.16], ["Leg_R", 0.16]]) {
    const pivot = new THREE.Group();
    pivot.name = `Fallback_${name}`;
    pivot.position.set(x, name.startsWith("Arm") ? 1.38 : 0.82, 0);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, name.startsWith("Arm") ? 0.7 : 0.78, 10), name.startsWith("Arm") ? cloth : skin);
    limb.position.y = -0.36;
    pivot.add(limb);
    group.add(pivot);
  }
  return group;
}

function findWheels(root) {
  const wheels = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    const match = child.name.match(/^Wheel_(FL|FR|RL|RR)/);
    if (!match) return;
    wheels.push({ mesh: child, front: match[1].startsWith("F") });
  });
  return wheels;
}

export function makeFullCar(asset, color = "#ff9f1c") {
  const group = new THREE.Group();
  const visual = new THREE.Group();
  group.add(visual);

  const model = cloneAsset(asset);
  tintAsset(model, color);
  visual.add(model);

  const wheels = findWheels(model);
  const underglowMaterial = new THREE.MeshBasicMaterial({
    color: 0x20e3b2,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const underglow = new THREE.Mesh(new THREE.CircleGeometry(2.25, 32), underglowMaterial);
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.028;
  group.add(underglow);

  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x38f7ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const flames = [];
  for (const x of [-0.46, 0.46]) {
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.35, 10, 1, true), outerMaterial);
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(x, 0.55, -2.18);
    visual.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.9, 8, 1, true), innerMaterial);
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(x, 0.55, -2.30);
    visual.add(inner);
    flames.push({ outer, inner });
  }

  const car = { group, visual, model, wheels, underglow, flames, outerMaterial, innerMaterial };
  car.setBoost = (amount, speedRatio = 0) => {
    const pulse = 0.86 + Math.sin(performance.now() * 0.035) * 0.14;
    outerMaterial.opacity = amount * 0.62;
    innerMaterial.opacity = amount * 0.9;
    for (const flame of flames) {
      flame.outer.scale.set(1, amount * pulse * (1 + speedRatio * 0.3), 1);
      flame.inner.scale.set(1, amount * pulse * 0.85, 1);
    }
    underglowMaterial.opacity = 0.1 + amount * 0.22 + speedRatio * 0.06;
  };
  car.setBoost(0, 0);
  return car;
}

function makeFallbackCarAsset() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.8, 4),
    new THREE.MeshStandardMaterial({ name: "Body_Paint", color: 0xff9f1c, roughness: 0.4 }),
  );
  body.name = "Fallback_Body";
  body.position.y = 0.7;
  group.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.7, 1.9),
    new THREE.MeshStandardMaterial({ name: "Smoked_Glass", color: 0x06111e, roughness: 0.18 }),
  );
  cabin.position.set(0, 1.35, 0.1);
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ name: "Tire_Rubber", color: 0x111111, roughness: 0.9 });
  for (const [x, z, n] of [[-0.9, 1.3, "FL"], [0.9, 1.3, "FR"], [-0.9, -1.3, "RL"], [0.9, -1.3, "RR"]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.name = `Wheel_${n}`;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.45, z);
    group.add(wheel);
  }
  return group;
}

function makeFallbackLandmark() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1, 3),
    new THREE.MeshStandardMaterial({ color: 0xd39a64, roughness: 0.7 }),
  );
  base.position.y = 0.5;
  group.add(base);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 16, 10),
    new THREE.MeshStandardMaterial({ color: 0xff9f1c, roughness: 0.5 }),
  );
  dome.position.y = 2;
  group.add(dome);
  return group;
}

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const entries = Object.entries(MANIFEST);
  const result = {};
  let loaded = 0;

  await Promise.all(entries.map(async ([key, file]) => {
    try {
      const gltf = await loader.loadAsync(`/assets/${file}`);
      result[key] = gltf.scene;
    } catch (error) {
      console.warn(`Could not load ${file}; using a procedural fallback.`, error);
      if (key.startsWith("char")) result[key] = makeFallbackCharacter();
      else if (key === "temple" || key === "chaiStall") result[key] = makeFallbackLandmark();
      else result[key] = makeFallbackCarAsset();
    }
    loaded += 1;
    onProgress?.(loaded / entries.length, key);
  }));

  return result;
}
