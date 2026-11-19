import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadAssets, makeCharacter, makeFullCar, makeRemoteCar, tintAsset } from "./assets.js";
import { AudioEngine } from "./audio.js";
import { Input } from "./input.js";
import { NetworkClient } from "./network.js";
import { ParticleSystem } from "./particles.js";
import { UI } from "./ui.js";
import { clamp, cleanName, damp, dampAngle, isTouchDevice, safeGet, safeSet, saveHighScore, vibrate } from "./utils.js";
import { Vehicle } from "./vehicle.js";
import { CITY_ORDER, CITY_PRESETS, resolveCityId } from "./cities.js";
import { World } from "./world.js";

const NAME_KEY = "monsoon-drift-name-v1";
const CHARACTER_KEY = "monsoon-drift-character-v1";
const COMBO_WINDOW = 4;
const SOLO_DURATION = 75;

const CHARACTER_OPTIONS = {
  ayaan: {
    asset: "charAyaan", color: "#ff9f1c", label: "Ayaan · Street Racer",
    tag: "Helmet, jacket, full throttle",
  },
  meera: {
    asset: "charMeera", color: "#20e3b2", label: "Meera · Monsoon Courier",
    tag: "Kurta, dupatta, quick lines",
  },
  constable: {
    asset: "charConstable", color: "#dce8ff", label: "Constable Rao · Traffic Cop",
    tag: "Reflective vest, city authority",
  },
  chaiwala: {
    asset: "charChaiwala", color: "#e07a5f", label: "Chaiwala · Stall Owner",
    tag: "Turban, apron, kettle in hand",
  },
  pedestrian: {
    asset: "charPedestrian", color: "#2ec4b6", label: "Pedestrian · Rainy Commute",
    tag: "Raincoat, umbrella, shopping bag",
  },
};

const QUALITY_KEY = "monsoon-drift-quality-v1";
const CITY_KEY = "monsoon-drift-city-v1";

const GRAPHICS_PRESETS = {
  performance: {
    label: "PERFORMANCE",
    note: "60fps-first · lower resolution, no bloom/SMAA, lighter rain",
    maxPixelRatio: 1.0, exposure: 1.08,
    bloom: 0, bloomRadius: 0.4, bloomThreshold: 0.9,
    smaa: false, colorGrade: false,
    saturation: 1.0, contrast: 1.0, vignette: 0.08,
    shadows: false, rainOpacity: 0.14, envIntensity: 0.45,
  },
  balanced: {
    label: "BALANCED",
    note: "Default · bloom, clean edges, wet roads, adaptive shadows",
    maxPixelRatio: 1.5, exposure: 1.22,
    bloom: 0.62, bloomRadius: 0.50, bloomThreshold: 0.72,
    smaa: true, colorGrade: true,
    saturation: 1.08, contrast: 1.05, vignette: 0.18,
    shadows: true, rainOpacity: 0.24, envIntensity: 0.75,
  },
  cinematic: {
    label: "CINEMATIC",
    note: "Widescreen horizon · stronger bloom, grade, reflections and rain",
    maxPixelRatio: 1.8, exposure: 1.30,
    bloom: 0.86, bloomRadius: 0.62, bloomThreshold: 0.66,
    smaa: true, colorGrade: true,
    saturation: 1.14, contrast: 1.10, vignette: 0.25,
    shadows: true, rainOpacity: 0.30, envIntensity: 1.0,
  },
  ultra: {
    label: "ULTRA",
    note: "Max visuals · higher pixel cap, strongest bloom, reflections and wide FOV",
    maxPixelRatio: 2.0, exposure: 1.36,
    bloom: 1.02, bloomRadius: 0.68, bloomThreshold: 0.60,
    smaa: true, colorGrade: true,
    saturation: 1.18, contrast: 1.13, vignette: 0.28,
    shadows: true, rainOpacity: 0.36, envIntensity: 1.22,
  },
};

const CAMERA_PROFILES = {
  performance: { distance: 8.6, height: 4.0, fov: 60, lookAhead: 6, menuFov: 58 },
  balanced: { distance: 9.2, height: 4.2, fov: 62, lookAhead: 7, menuFov: 54 },
  cinematic: { distance: 10.6, height: 3.45, fov: 70, lookAhead: 11, menuFov: 50 },
  ultra: { distance: 11.2, height: 3.2, fov: 74, lookAhead: 13, menuFov: 48 },
};

const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.08 },
    contrast: { value: 1.05 },
    vignette: { value: 0.18 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, saturation);
      color = (color - 0.5) * contrast + 0.5;
      float d = distance(vUv, vec2(0.5));
      color *= 1.0 - smoothstep(0.42, 0.86, d) * vignette;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
};

export class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.isMobile = isTouchDevice() || window.innerWidth < 760;
    const params = new URLSearchParams(location.search);
    const urlCity = resolveCityId(params.get("city"));
    const savedCity = safeGet(CITY_KEY, "mumbai");
    this.cityId = urlCity || (CITY_PRESETS[savedCity] ? savedCity : "mumbai");
    if (urlCity) safeSet(CITY_KEY, urlCity);
    this.city = CITY_PRESETS[this.cityId];

    const savedQuality = safeGet(QUALITY_KEY, "balanced");
    this.qualityPreset = GRAPHICS_PRESETS[savedQuality] ? savedQuality : "balanced";
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !this.isMobile, alpha: false,
      stencil: false, powerPreference: "high-performance",
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.35 : 1.75);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = !this.isMobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.62, 0.50, 0.72,
    );
    this.smaaPass = new SMAAPass();
    this.colorGradePass = new ShaderPass(ColorGradeShader);
    this.outputPass = new OutputPass();

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
    this.renderPass.scene = this.scene;
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);
    this.camera.position.set(0, 6, -16);
    this.renderPass.camera = this.camera;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.colorGradePass);
    this.composer.addPass(this.outputPass);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.clock = new THREE.Clock();

    this.state = "loading";
    this.mode = "solo";
    this.assets = null;
    this.world = null;
    this.hero = null;
    this.vehicle = null;
    this.remotePlayers = new Map();

    this.audio = new AudioEngine();
    this.input = new Input();
    this.ui = new UI(this);
    this.ui.setCity(this.cityId, this.city);
    document.documentElement.style.setProperty("--city-accent", this.city.accent);
    document.title = `Monsoon Drift · ${this.city.label} · India City Rush 3D`;
    this.particles = new ParticleSystem(this.scene, this.isMobile ? 430 : 720);

    const savedCharacter = safeGet(CHARACTER_KEY, "ayaan");
    this.characterId = CHARACTER_OPTIONS[savedCharacter] ? savedCharacter : "ayaan";
    this.carColor = CHARACTER_OPTIONS[this.characterId].color;
    this.characterStage = null;
    this.characterPreview = null;
    this.characterRing = null;
    this.previewCanvas = document.getElementById("character-canvas");
    this.previewRenderer = null;
    this.previewScene = null;
    this.previewCamera = null;
    this.previewModel = null;
    this.previewRing = null;
    this.previewAngle = 0;

    this.playerName = cleanName(safeGet(NAME_KEY, "RIDER"));
    this.ui.setPlayerName(this.playerName);
    this.ui.setCharacter(this.characterId, CHARACTER_OPTIONS[this.characterId]);
    this.roomFromUrl = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    this.autoJoined = false;
    this.connectStatus = "Not connected";

    this.score = 0;
    this.combo = 1;
    this.comboCharge = 0;
    this.comboTimer = 0;
    this.comboWindow = COMBO_WINDOW;
    this.bestCombo = 1;
    this.gates = 0;
    this.timeLeft = SOLO_DURATION;
    this.distance = 0;
    this.driftScoreBuffer = 0;
    this.driftPopTimer = 0;
    this.dustTimer = 0;
    this.boostTrailTimer = 0;
    this.shake = 0;
    this.hudTimer = 0;
    this.minimapTimer = 0;
    this.menuAngle = 0.7;
    this.menuRadius = 8.6;
    this.frameAccum = 0;
    this.frameCount = 0;
    this.qualityReduced = false;

    this.up = new THREE.Vector3(0, 1, 0);
    this.cameraDesired = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.menuCenter = new THREE.Vector3(0, 1.25, 4);
    this.effectA = new THREE.Vector3();
    this.effectB = new THREE.Vector3();
    this.effectC = new THREE.Vector3();
    this.projectVec = new THREE.Vector3();
    this.neutralControls = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };

    this.network = new NetworkClient({
      onStatus: (status) => {
        this.connectStatus = status;
        if (this.state === "connect") this.updateConnectUI();
      },
      onCity: (city) => this.applyCityFromNetwork(city),
      onWelcome: (msg) => {
        if (msg.city) this.applyCityFromNetwork(msg.city);
        this.ui.showToast(`Room ${msg.room} ready · share the invite`, 2400);
        this.updateConnectUI();
      },
      onPlayers: (players) => {
        this.syncRemotePlayersFromPlayers(players);
        const host = players.find((player) => player.id === this.network.hostId);
        if (host?.city) this.applyCityFromNetwork(host.city);
        if (this.state === "connect") this.updateConnectUI();
      },
      onState: (msg) => this.updateRemotePlayer(msg),
      onStart: (msg) => {
        if (msg.city) this.applyCityFromNetwork(msg.city);
        this.beginConnectRun(msg);
      },
      onReset: () => {
        if (this.state === "gameover" || this.state === "connect") {
          this.state = "connect";
          this.input.setEnabled(false);
          this.audio.stopEngine();
          this.ui.showConnect();
          this.ui.showToast("Room reset — host can start again", 2200);
        }
        this.updateConnectUI();
      },
      onError: (message) => this.ui.showToast(message, 3600),
      onClose: () => {
        this.clearRemotePlayers();
        if (["playing", "countdown", "connect"].includes(this.state)) {
          this.ui.showToast("Connection lost — solo play is still available", 2600);
        }
      },
    });

    this.bindGlobalEvents();
    this.bindInputActions();
    this.ui.setMuteState(this.audio.muted);
    this.applyQualityPreset();
    this.ui.updateOrientation();
  }

  bindGlobalEvents() {
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => this.ui.updateOrientation());
    screen.orientation?.addEventListener?.("change", () => this.ui.updateOrientation());
    window.addEventListener("pointerdown", () => this.audio.unlock(), { once: true });
    window.addEventListener("keydown", () => this.audio.unlock(), { once: true });
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && ["playing", "countdown"].includes(this.state)) this.pause();
    });
  }

  bindInputActions() {
    const fromInput = (event) => event?.target?.tagName === "INPUT";
    this.input.onKey("KeyP", () => {
      if (["playing", "countdown", "paused"].includes(this.state)) this.togglePause();
    });
    this.input.onKey("Escape", () => {
      if (this.state === "paused") this.resume();
      else if (["playing", "countdown"].includes(this.state)) this.pause();
      else if (this.state === "connect") this.toMenu();
    });
    this.input.onKey("KeyR", (event) => {
      if (!fromInput(event) && ["playing", "paused", "gameover"].includes(this.state)) this.restart();
    });
    this.input.onKey("Enter", (event) => this.handleConfirm(event));
    this.input.onKey("Space", (event) => this.handleConfirm(event));
    this.input.onKey("KeyM", (event) => {
      if (!fromInput(event)) this.toggleMute();
    });
    this.input.onKey("KeyF", (event) => {
      if (!fromInput(event)) this.enterLandscapeMode();
    });
    this.input.onKey("KeyC", (event) => {
      if (fromInput(event)) return;
      if (["menu", "connect", "paused", "gameover"].includes(this.state)) this.cycleCity(1);
    });
    CITY_ORDER.forEach((cityId, index) => {
      this.input.onKey(`Digit${index + 1}`, (event) => {
        if (fromInput(event)) return;
        if (["menu", "connect", "paused", "gameover"].includes(this.state)) this.setCity(cityId);
      });
    });
  }

  handleConfirm(event) {
    if (event?.target?.tagName === "INPUT" || event?.target?.closest?.("button")) return;
    if (["menu", "loading"].includes(this.state)) this.startSolo();
    else if (this.state === "connect" && this.network.isHost() && !this.network.started) this.startConnectRun();
    else if (this.state === "gameover") this.restart();
    else if (this.state === "paused") this.resume();
  }

  async init() {
    this.ui.setLoading(0.04, "Preparing renderer");
    try {
      const assets = await loadAssets((progress, key) => {
        const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        this.ui.setLoading(0.08 + progress * 0.52, `Loading ${label}`);
      });
      this.assets = assets;
      this.ui.setLoading(0.66, `Sculpting ${this.city.label}`);
      this.world = new World(this.scene, assets, 20261119, this.cityId);
      this.hero = makeFullCar(assets.heroCar, this.carColor);
      this.scene.add(this.hero.group);
      this.vehicle = new Vehicle(this.hero, this.world);
      this.vehicle.reset({ x: 0, z: -4, yaw: 0 });
      this.setupCharacterStage();
      this.setupPreviewRenderer();
      this.setCharacter(this.characterId, true);
      this.applyQualityPreset();
      this.ui.setLoading(0.94, "Warming engines");
      await new Promise((resolve) => setTimeout(resolve, 160));
      this.ui.setLoading(1, "Ready");
      this.state = "menu";
      this.input.setEnabled(false);
      this.ui.showStart();
      this.clock.start();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
      if (this.roomFromUrl) this.openConnect(true);
    } catch (error) {
      console.error("Monsoon Drift failed to start:", error);
      this.ui.setLoading(1, "Could not start the game");
      this.ui.showToast("The game could not start. Please refresh and try again.", 6000);
    }
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.resizePreviewRenderer();
    this.ui.updateOrientation();
  }

  applyQualityPreset() {
    const preset = GRAPHICS_PRESETS[this.qualityPreset] || GRAPHICS_PRESETS.balanced;
    const city = this.city || CITY_PRESETS[this.cityId] || CITY_PRESETS.mumbai;
    const cap = preset.maxPixelRatio * (this.isMobile ? 0.85 : 1);
    const ratio = Math.min(window.devicePixelRatio || 1, cap);
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.renderer.toneMappingExposure = preset.exposure * city.exposure;
    this.bloomPass.strength = preset.bloom * city.bloom;
    this.bloomPass.radius = preset.bloomRadius;
    this.bloomPass.threshold = preset.bloomThreshold;
    this.bloomPass.enabled = this.bloomPass.strength > 0;
    this.smaaPass.enabled = preset.smaa && !this.isMobile;
    this.colorGradePass.enabled = preset.colorGrade;
    this.colorGradePass.uniforms.saturation.value = preset.saturation * city.saturation;
    this.colorGradePass.uniforms.contrast.value = preset.contrast * city.contrast;
    this.colorGradePass.uniforms.vignette.value = preset.vignette * city.vignette;
    this.renderer.shadowMap.enabled = preset.shadows && !this.isMobile;
    if (this.world?.sun) {
      this.world.sun.castShadow = preset.shadows && !this.isMobile;
      this.world.sun.intensity = city.sunIntensity * (preset.shadows ? 1.12 : 0.84);
    }
    if (this.world?.rain) {
      this.world.rain.material.opacity = preset.rainOpacity * city.rainScale;
      this.world.rain.group.visible = city.rainScale > 0.02;
    }
    if (this.world?.puddles) {
      const weatherBoost = clamp(preset.rainOpacity / 0.24, 0.5, 1.5);
      this.world.puddles.material.opacity = city.puddleOpacity * weatherBoost;
      this.world.puddles.visible = city.puddleOpacity > 0.005;
    }
    this.scene.environmentIntensity = preset.envIntensity * city.envIntensity;
    this.qualityReduced = this.qualityPreset === "performance";
    this.ui.setQuality(this.qualityPreset, preset);
  }

  setQualityPreset(id) {
    if (!GRAPHICS_PRESETS[id] || id === this.qualityPreset) return;
    this.qualityPreset = id;
    safeSet(QUALITY_KEY, id);
    this.applyQualityPreset();
    this.audio.unlock();
    this.audio.sfx("ui");
    this.ui.showToast(`${GRAPHICS_PRESETS[id].label} graphics selected`, 1800);
  }

  applyCityFromNetwork(city) {
    const key = resolveCityId(city);
    if (!key || key === this.cityId) return;
    this.setCity(key, { fromNetwork: true, silent: true });
  }

  setCity(id, { fromNetwork = false, silent = false } = {}) {
    const key = resolveCityId(id);
    if (!key) return;
    const city = CITY_PRESETS[key];
    if (key === this.cityId && this.world) {
      if (!silent) this.ui.showToast(`${city.label} is already loaded`, 1200);
      return;
    }
    if (["playing", "countdown"].includes(this.state) && !fromNetwork) {
      this.ui.showToast("City change ke liye pehle pause karo", 2200);
      return;
    }
    this.cityId = key;
    this.city = city;
    if (!fromNetwork) safeSet(CITY_KEY, key);
    document.documentElement.style.setProperty("--city-accent", city.accent);
    document.title = `Monsoon Drift · ${city.label} · India City Rush 3D`;
    if (this.world) {
      this.world.setCity(key);
      this.vehicle.world = this.world;
      this.vehicle.reset({ x: 0, z: -4, yaw: 0, health: 3, boost: 38 });
      this.particles.reset();
      this.applyQualityPreset();
    }
    this.ui.setCity(key, city);
    if (this.state === "connect") this.updateConnectUI();
    if (!silent) {
      this.audio.unlock();
      this.audio.sfx("ui");
      this.ui.showToast(`${city.label} loaded · ${city.tag}`, 2400);
    }
  }

  cycleCity(delta = 1) {
    const index = CITY_ORDER.indexOf(this.cityId);
    const next = CITY_ORDER[(index + delta + CITY_ORDER.length) % CITY_ORDER.length];
    this.setCity(next);
  }

  async enterLandscapeMode() {
    this.audio.unlock();
    this.audio.sfx("ui");
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch { /* fullscreen is optional */ }
    try {
      if (screen.orientation?.lock) {
        await screen.orientation.lock("landscape");
        this.ui.showToast("Landscape / horizontal horizon locked", 2000);
      } else {
        this.ui.showToast("Rotate your phone to landscape for the wide horizon view", 2800);
      }
    } catch {
      this.ui.showToast("Auto-lock unsupported — please rotate your device manually", 2800);
    }
    this.ui.updateOrientation();
  }

  setupCharacterStage() {
    const stage = new THREE.Group();
    stage.name = "Character Select Stage";
    stage.position.set(this.menuCenter.x, 0, this.menuCenter.z);

    const pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0x182442, roughness: 0.34, metalness: 0.55,
    });
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.28, 1.48, 0.22, 40),
      pedestalMaterial,
    );
    pedestal.position.y = 0.11;
    pedestal.receiveShadow = true;
    stage.add(pedestal);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x20e3b2, transparent: true, opacity: 0.58,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.035, 8, 56), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.235;
    stage.add(ring);

    const key = new THREE.PointLight(0xffd6a3, 2.5, 12, 2);
    key.position.set(2.6, 3.4, 2.8);
    stage.add(key);
    const rim = new THREE.PointLight(0x38f7ff, 1.5, 10, 2);
    rim.position.set(-2.4, 2.2, -1.8);
    stage.add(rim);

    this.scene.add(stage);
    this.characterStage = stage;
    this.characterRing = ring;
  }

  refreshCharacterPreview(option) {
    if (!this.assets || !this.characterStage) return;
    if (this.characterPreview) {
      const old = this.characterPreview;
      this.characterStage.remove(old.group);
      old.model.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material?.dispose?.();
      });
    }
    const asset = this.assets[option.asset] || this.assets.charAyaan;
    this.characterPreview = makeCharacter(asset, {
      color: option.color, baseY: 0.24, scale: 1.08,
    });
    this.characterPreview.group.rotation.y = 0.55;
    this.characterStage.add(this.characterPreview.group);
  }

  setupPreviewRenderer() {
    if (!this.previewCanvas || this.previewRenderer) return;
    this.previewRenderer = new THREE.WebGLRenderer({
      canvas: this.previewCanvas,
      alpha: false,
      antialias: true,
      powerPreference: "low-power",
    });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewRenderer.toneMappingExposure = 1.35;
    this.previewRenderer.shadowMap.enabled = false;

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x0a1024);
    this.previewScene.fog = new THREE.FogExp2(0x10183a, 0.045);
    this.previewCamera = new THREE.PerspectiveCamera(34, 4 / 3, 0.1, 40);
    this.previewCamera.position.set(1.65, 2.05, 4.35);
    this.previewCamera.lookAt(0, 1.02, 0);

    this.previewScene.add(new THREE.HemisphereLight(0xbddcff, 0x2b1838, 2.1));
    const key = new THREE.DirectionalLight(0xffd6a3, 2.5);
    key.position.set(3, 5, 3);
    this.previewScene.add(key);
    const rim = new THREE.PointLight(0x38f7ff, 2.2, 9, 2);
    rim.position.set(-2.4, 2.3, -1.8);
    this.previewScene.add(rim);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.24, 0.18, 40),
      new THREE.MeshStandardMaterial({ color: 0x17223f, roughness: 0.36, metalness: 0.52 }),
    );
    pedestal.position.y = 0.09;
    this.previewScene.add(pedestal);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.12, 0.028, 8, 56),
      new THREE.MeshBasicMaterial({
        color: 0x20e3b2, transparent: true, opacity: 0.62,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.19;
    this.previewScene.add(ring);
    this.previewRing = ring;
    this.resizePreviewRenderer();
  }

  refreshPreviewRenderer(option) {
    if (!this.previewRenderer || !this.previewScene || !this.assets) return;
    if (this.previewModel) {
      const old = this.previewModel;
      this.previewScene.remove(old.group);
      old.model.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material?.dispose?.();
      });
    }
    const asset = this.assets[option.asset] || this.assets.charAyaan;
    this.previewModel = makeCharacter(asset, {
      color: option.color, baseY: 0.20, scale: 1.06,
    });
    this.previewModel.group.rotation.y = 0.45;
    this.previewScene.add(this.previewModel.group);
  }

  resizePreviewRenderer() {
    if (!this.previewRenderer || !this.previewCanvas || !this.previewCamera) return;
    const width = Math.max(1, this.previewCanvas.clientWidth || 320);
    const height = Math.max(1, this.previewCanvas.clientHeight || 240);
    this.previewRenderer.setSize(width, height, false);
    this.previewCamera.aspect = width / height;
    this.previewCamera.updateProjectionMatrix();
  }

  updatePreviewRenderer(dt) {
    if (!this.previewRenderer || !this.previewScene || !this.previewCamera) return;
    if (this.ui.screens.start.classList.contains("hidden")) return;
    this.previewAngle += dt * 0.35;
    this.previewModel?.update(dt, 0.36);
    if (this.previewModel) this.previewModel.group.rotation.y = 0.45 + Math.sin(this.previewAngle) * 0.32;
    if (this.previewRing) this.previewRing.material.opacity = 0.5 + Math.sin(this.previewAngle * 3) * 0.18;
    this.previewRenderer.render(this.previewScene, this.previewCamera);
  }

  setCharacter(id, silent = false) {
    const key = CHARACTER_OPTIONS[id] ? id : "ayaan";
    const option = CHARACTER_OPTIONS[key];
    this.characterId = key;
    this.carColor = option.color;
    safeSet(CHARACTER_KEY, key);
    if (this.hero?.model) tintAsset(this.hero.model, option.color);
    this.refreshCharacterPreview(option);
    this.refreshPreviewRenderer(option);
    this.ui.setCharacter(key, option);
    if (!silent) {
      this.audio.unlock();
      this.audio.sfx("ui");
      this.ui.showToast(`${option.label} selected`, 1700);
    }
  }

  makeSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  makeInviteUrl(room) {
    const url = new URL(location.href);
    url.searchParams.set("room", room);
    url.searchParams.set("city", this.cityId);
    url.hash = "";
    return url.toString();
  }

  setPlayerName(value, persist = true) {
    this.playerName = cleanName(value);
    if (persist) safeSet(NAME_KEY, this.playerName);
  }

  toggleMute() {
    const muted = this.audio.toggleMute();
    this.ui.setMuteState(muted);
    if (!muted) {
      if (["playing", "countdown"].includes(this.state)) this.audio.startEngine();
      this.audio.sfx("ui");
    }
    this.ui.showToast(muted ? "Sound off" : "Sound on", 1200);
  }

  openConnect(fromInvite = false) {
    this.audio.unlock();
    if (!fromInvite) this.audio.sfx("ui");
    this.state = "connect";
    this.input.setEnabled(false);
    this.ui.showConnect();
    this.updateConnectUI();
    if (this.roomFromUrl && !this.autoJoined) {
      this.autoJoined = true;
      this.ui.setJoinCode(this.roomFromUrl);
      this.joinRoom(this.roomFromUrl);
    }
  }

  updateConnectUI() {
    const room = this.network.room;
    this.ui.updateConnect({
      status: this.connectStatus,
      room,
      inviteUrl: room ? this.makeInviteUrl(room) : "",
      players: this.network.players || [],
      hostId: this.network.hostId,
      selfId: this.network.id,
      connected: this.network.isConnected(),
      started: this.network.started,
      city: CITY_PRESETS[this.cityId],
    });
  }

  createRoom() {
    this.audio.unlock();
    this.audio.sfx("ui");
    this.network.connect({ name: this.playerName, room: "", create: true, city: this.cityId });
    this.connectStatus = "Connecting…";
    this.updateConnectUI();
  }

  joinRoom(code = null) {
    const room = String(typeof code === "string" ? code : this.ui.getJoinCode()).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (!room) {
      this.ui.showToast("Enter a 4-letter room code", 2200);
      return;
    }
    this.audio.unlock();
    this.audio.sfx("ui");
    if (this.state !== "connect") {
      this.state = "connect";
      this.ui.showConnect();
      this.input.setEnabled(false);
    }
    this.ui.setJoinCode(room);
    this.network.connect({ name: this.playerName, room, create: false, city: this.cityId });
    this.connectStatus = "Connecting…";
    this.updateConnectUI();
  }

  async copyInvite() {
    const room = this.network.room;
    if (!room) {
      this.ui.showToast("Create a room first", 1800);
      return;
    }
    const url = this.makeInviteUrl(room);
    this.audio.sfx("ui");
    try {
      await navigator.clipboard.writeText(url);
      this.ui.showToast("Invite link copied", 1800);
    } catch {
      this.ui.el.inviteLink.value = url;
      this.ui.el.inviteLink.select();
      try { document.execCommand("copy"); } catch { /* clipboard is optional */ }
      this.ui.showToast("Invite link selected — copy it to share", 2600);
    }
  }

  startConnectRun() {
    if (!this.network.isConnected()) {
      this.ui.showToast("Connect to a room first", 2200);
      return;
    }
    if (!this.network.isHost()) {
      this.ui.showToast("Only the host can start the run", 2200);
      return;
    }
    this.audio.unlock();
    this.audio.sfx("ui");
    this.network.start(this.makeSeed(), this.cityId);
  }

  startSolo() {
    this.audio.unlock();
    this.audio.sfx("ui");
    this.network.leave();
    this.mode = "solo";
    this.resetRun({ mode: "solo", seed: this.makeSeed(), timeLeft: SOLO_DURATION });
    this.state = "playing";
    this.input.setEnabled(true);
    this.ui.showPlaying();
    this.ui.setRoomHud(null, [], null);
    this.ui.showGo();
    this.audio.startEngine();
    this.audio.sfx("start");
  }

  beginConnectRun(msg) {
    if (!this.world || !this.assets) return;
    this.audio.unlock();
    this.mode = "connect";
    this.resetRun({ mode: "connect", seed: msg.seed || this.makeSeed(), timeLeft: msg.duration || 90 });
    this.state = "countdown";
    this.input.setEnabled(false);
    this.ui.showPlaying();
    this.ui.setTouchVisible(false);
    this.ui.showCountdown("GET READY");
    this.connectStatus = `Room ${this.network.room} · shared run`;
    this.updateConnectUI();
    this.ui.showToast(`Room ${this.network.room} · 90-second score attack`, 2400);
  }

  resetRun({ mode, seed, timeLeft }) {
    this.mode = mode;
    this.score = 0;
    this.combo = 1;
    this.comboCharge = 0;
    this.comboTimer = 0;
    this.bestCombo = 1;
    this.gates = 0;
    this.timeLeft = timeLeft;
    this.distance = 0;
    this.driftScoreBuffer = 0;
    this.driftPopTimer = 0;
    this.dustTimer = 0;
    this.boostTrailTimer = 0;
    this.shake = 0;
    this.hudTimer = 0;
    this.minimapTimer = 0;
    this.world.resetRun(seed >>> 0);
    this.vehicle.reset({ x: 0, z: -4, yaw: 0, health: 3, boost: 38 });
    this.particles.reset();
    if (mode === "solo") this.clearRemotePlayers();
    else {
      for (const remote of this.remotePlayers.values()) {
        remote.target.set(0, 0, -4);
        remote.targetYaw = 0;
        remote.score = 0;
        remote.gates = 0;
        remote.group.position.set(0, 0, -4);
        remote.group.rotation.y = 0;
      }
    }
    this.ui.hideGo();
    this.ui.hideCountdown();
    this.ui.el.damageFlash.style.opacity = "0";
    this.ui.el.boostFlash.style.opacity = "0";
    document.documentElement.style.setProperty("--speed-opacity", "0");
  }

  toMenu() {
    this.network.leave();
    this.state = "menu";
    this.mode = "solo";
    this.input.setEnabled(false);
    this.audio.stopEngine();
    this.clearRemotePlayers();
    this.particles.reset();
    this.ui.showStart();
    this.ui.setRoomHud(null, [], null);
    this.updateConnectUI();
  }

  pause() {
    if (!["playing", "countdown"].includes(this.state)) return;
    this.prePauseState = this.state;
    this.state = "paused";
    this.input.setEnabled(false);
    this.audio.stopEngine();
    this.ui.showPause();
    if (this.mode === "connect") this.ui.showToast("Paused locally — the shared clock keeps running", 1900);
  }

  resume() {
    if (this.state !== "paused") return;
    if (this.mode === "connect" && this.network.remainingTime() <= 0) {
      this.endRun("THE SHARED CLOCK RAN OUT");
      return;
    }
    this.state = this.prePauseState || "playing";
    this.ui.showScreen(null);
    this.ui.showHUD(true);
    if (this.state === "playing") {
      this.input.setEnabled(true);
      this.ui.setTouchVisible(true);
      this.audio.startEngine();
    } else {
      this.input.setEnabled(false);
      this.ui.setTouchVisible(false);
      this.ui.showCountdown("GET READY");
    }
  }

  togglePause() {
    if (this.state === "paused") this.resume();
    else this.pause();
  }

  restart() {
    if (this.mode === "connect" && this.network.isConnected()) {
      if (this.network.isHost()) {
        this.audio.unlock();
        this.network.start(this.makeSeed(), this.cityId);
        this.ui.showToast("Restarting room…", 1500);
      } else {
        this.state = "connect";
        this.input.setEnabled(false);
        this.audio.stopEngine();
        this.ui.showConnect();
        this.updateConnectUI();
        this.ui.showToast("Waiting for the host to restart", 2200);
      }
      return;
    }
    this.startSolo();
  }

  endRun(reason) {
    if (this.state === "gameover") return;
    this.state = "gameover";
    this.input.setEnabled(false);
    this.audio.stopEngine();
    this.audio.sfx("gameover");
    this.ui.setTouchVisible(false);
    this.ui.hideGo();
    this.ui.hideCountdown();
    const entry = {
      name: this.playerName,
      score: Math.round(this.score),
      gates: this.gates,
      bestCombo: this.bestCombo,
      distance: Math.round(this.vehicle.distance),
      mode: this.mode,
      date: new Date().toISOString(),
    };
    const result = saveHighScore(entry);
    this.ui.showGameOver({
      score: entry.score,
      gates: entry.gates,
      bestCombo: entry.bestCombo,
      distance: entry.distance,
      reason,
      rank: result.rank,
      highlightDate: result.rank >= 0 ? entry.date : null,
    });
    this.sendFinalState();
    vibrate([30, 40, 30]);
  }

  syncRemotePlayersFromPlayers(players) {
    const ids = new Set(players.map((player) => player.id));
    for (const [id, remote] of this.remotePlayers) {
      if (!ids.has(id)) {
        this.disposeRemotePlayer(remote);
        this.remotePlayers.delete(id);
      }
    }
  }

  clearRemotePlayers() {
    for (const remote of this.remotePlayers.values()) this.disposeRemotePlayer(remote);
    this.remotePlayers.clear();
  }

  disposeRemotePlayer(remote) {
    this.scene.remove(remote.group);
    try {
      remote.label?.material?.map?.dispose();
      remote.label?.material?.dispose();
      remote.ring?.geometry?.dispose();
      remote.ring?.material?.dispose();
    } catch { /* disposal is best-effort */ }
  }

  updateRemotePlayer(msg) {
    if (!this.assets || msg.id === this.network.id) return;
    let remote = this.remotePlayers.get(msg.id);
    if (!remote) {
      remote = makeRemoteCar(this.assets.heroCar, msg.color || "#8b7cff", msg.name || "RIDER");
      remote.target = new THREE.Vector3(msg.x || 0, 0, msg.z || 0);
      remote.targetYaw = msg.yaw || 0;
      remote.score = msg.score || 0;
      remote.gates = msg.gates || 0;
      remote.alive = msg.alive !== false;
      remote.color = msg.color || "#8b7cff";
      remote.name = msg.name || "RIDER";
      remote.lastUpdate = performance.now();
      remote.group.position.copy(remote.target);
      remote.group.rotation.y = remote.targetYaw;
      this.scene.add(remote.group);
      this.remotePlayers.set(msg.id, remote);
    }
    remote.target.set(msg.x || 0, 0, msg.z || 0);
    remote.targetYaw = msg.yaw || 0;
    remote.score = msg.score || 0;
    remote.gates = msg.gates || 0;
    remote.combo = msg.combo || 1;
    remote.alive = msg.alive !== false;
    remote.color = msg.color || remote.color;
    remote.name = msg.name || remote.name;
    remote.lastUpdate = performance.now();
  }

  updateRemotePlayers(dt) {
    const visible = this.mode === "connect" && ["countdown", "playing", "paused", "gameover"].includes(this.state);
    const now = performance.now();
    for (const [id, remote] of this.remotePlayers) {
      if (now - remote.lastUpdate > 9000) {
        this.disposeRemotePlayer(remote);
        this.remotePlayers.delete(id);
        continue;
      }
      remote.group.visible = visible;
      const t = 1 - Math.exp(-10 * dt);
      remote.group.position.lerp(remote.target, t);
      remote.group.rotation.y = dampAngle(remote.group.rotation.y, remote.targetYaw, 9, dt);
      remote.ring.material.opacity = 0.22 + Math.sin(now * 0.005) * 0.08;
    }
  }

  getMultiplayerHudPlayers() {
    const players = (this.network.players || []).map((player) => ({ ...player }));
    const index = players.findIndex((player) => player.id === this.network.id);
    if (index >= 0) players[index].score = Math.round(this.score);
    else players.push({
      id: this.network.id,
      name: this.playerName,
      color: this.carColor,
      score: Math.round(this.score),
      gates: this.gates,
      host: this.network.isHost(),
    });
    return players;
  }

  sendNetworkState() {
    if (this.mode !== "connect" || !this.network.isConnected() || !this.network.started) return;
    if (["menu", "connect"].includes(this.state)) return;
    this.network.sendState({
      ...this.vehicle.getState(),
      score: Math.round(this.score),
      gates: this.gates,
      combo: this.combo,
    });
  }

  sendFinalState() {
    if (this.mode !== "connect" || !this.network.isConnected() || !this.network.started) return;
    this.network.send({
      type: "state",
      ...this.vehicle.getState(),
      alive: false,
      score: Math.round(this.score),
      gates: this.gates,
      combo: this.combo,
    });
  }

  projectToScreen(position) {
    this.projectVec.set(position.x, position.y, position.z).project(this.camera);
    return {
      x: (this.projectVec.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projectVec.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  computeCompassAngle(gate) {
    if (!gate) return 0;
    const dx = gate.position.x - this.vehicle.pos.x;
    const dz = gate.position.z - this.vehicle.pos.z;
    const targetAngle = Math.atan2(dx, dz);
    const delta = Math.atan2(Math.sin(targetAngle - this.vehicle.yaw), Math.cos(targetAngle - this.vehicle.yaw));
    return delta * 180 / Math.PI;
  }

  addComboCharge(amount) {
    if (amount <= 0) return;
    this.comboTimer = this.comboWindow;
    if (this.combo >= 8) {
      this.comboCharge = 0;
      return;
    }
    this.comboCharge += amount;
    while (this.comboCharge >= 1 && this.combo < 8) {
      this.comboCharge -= 1;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.audio.sfx("combo");
      this.effectC.set(this.vehicle.pos.x, 2.2, this.vehicle.pos.z);
      const screen = this.projectToScreen(this.effectC);
      this.ui.floatScore(`×${this.combo} COMBO`, screen.x, screen.y, "#ffd166");
      this.shake = Math.max(this.shake, 0.18);
      vibrate(10);
    }
  }

  decayCombo(dt) {
    if (this.comboTimer <= 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.comboTimer = 0;
      this.combo = 1;
      this.comboCharge = 0;
    }
  }

  awardAction({ label, points, charge = 0, color = "#ffd166", position, sound = "coin", burst = 14, shake = 0.12 }) {
    this.addComboCharge(charge);
    const gained = Math.round(points * this.combo);
    this.score += gained;
    this.effectA.set(position.x, position.y > 0 ? position.y : 1.2, position.z);
    const screen = this.projectToScreen(this.effectA);
    this.ui.floatScore(label ? `${label} +${gained}` : `+${gained}`, screen.x, screen.y, color);
    this.particles.burst(this.effectA, color, burst, {
      speed: 6.5, spread: 0.85, lift: 0.5, life: 0.7, size: 0.2, gravity: 4.5, drag: 1.5,
    });
    if (sound) this.audio.sfx(sound);
    this.shake = Math.max(this.shake, shake);
    vibrate(8);
  }

  comboBreak() {
    this.combo = 1;
    this.comboCharge = 0;
    this.comboTimer = 0;
    this.driftScoreBuffer = 0;
  }

  handleCrash(crash) {
    this.comboBreak();
    this.audio.sfx("crash");
    this.ui.flashDamage(0.95);
    this.effectA.set(crash.position.x, 1.1, crash.position.z);
    this.particles.burst(this.effectA, 0xff4d6d, 28, {
      speed: 9, spread: 1, lift: 0.6, life: 0.8, size: 0.24, gravity: 7, drag: 1.3,
    });
    this.particles.burst(this.effectA, 0xffd166, 14, {
      speed: 6, spread: 1.1, lift: 0.7, life: 0.6, size: 0.18, gravity: 6, drag: 1.4,
    });
    const screen = this.projectToScreen(this.effectA);
    this.ui.floatScore("CRASH!", screen.x, screen.y, "#ff4d6d");
    this.shake = Math.max(this.shake, 1.05);
    vibrate([20, 30, 20]);
    if (this.vehicle.health <= 0) this.endRun("THE RIDE WAS WRECKED");
  }

  handleVehicleEvents(events) {
    if (events.boostStarted) {
      this.audio.sfx("boost");
      this.shake = Math.max(this.shake, 0.42);
      vibrate(18);
      this.effectA.set(this.vehicle.pos.x, 1.6, this.vehicle.pos.z);
      const screen = this.projectToScreen(this.effectA);
      this.ui.floatScore("BOOST!", screen.x, screen.y, "#20e3b2");
    }
    if (events.collision) this.handleCrash(events.collision);
    if (events.boundary) this.shake = Math.max(this.shake, 0.35);
  }

  updateEffects(dt, events) {
    if (this.vehicle.boosting) {
      this.boostTrailTimer -= dt;
      if (this.boostTrailTimer <= 0) {
        this.boostTrailTimer = 0.035;
        this.effectA.copy(this.vehicle.pos).addScaledVector(this.vehicle.forward, -2.05);
        this.effectA.y = 0.45;
        this.effectB.copy(this.vehicle.forward).multiplyScalar(-1);
        this.particles.trail(this.effectA, 0x38f7ff, this.effectB, 3);
      }
    }
    if ((events?.drift || 0) > 0 || (events?.offroad || 0) > 0) {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.07;
        this.effectA.copy(this.vehicle.pos).addScaledVector(this.vehicle.right, -0.9).addScaledVector(this.vehicle.forward, -1.35);
        this.effectA.y = 0.25;
        this.particles.smoke(this.effectA, 0xbfc7df, 2);
        this.effectA.addScaledVector(this.vehicle.right, 1.8);
        this.particles.smoke(this.effectA, 0x9fb3d9, 2);
      }
    }
  }

  updateScoreContinuous(dt, events) {
    this.score += Math.max(0, this.vehicle.speed - 18) * 0.55 * dt;
    if ((events?.drift || 0) > 0) {
      this.addComboCharge(events.drift * 0.24);
      this.driftScoreBuffer += 65 * this.combo * events.drift;
      this.driftPopTimer -= dt;
      if (this.driftScoreBuffer >= 120 && this.driftPopTimer <= 0) {
        const gained = Math.floor(this.driftScoreBuffer);
        this.score += gained;
        this.driftScoreBuffer -= gained;
        this.driftPopTimer = 0.65;
        this.effectA.set(this.vehicle.pos.x, 1.8, this.vehicle.pos.z);
        const screen = this.projectToScreen(this.effectA);
        this.ui.floatScore(`DRIFT +${gained}`, screen.x, screen.y, "#20e3b2");
      }
    }
    this.decayCombo(dt);
  }

  checkTraffic() {
    const pos = this.vehicle.pos;
    const forward = this.vehicle.forward;
    for (const car of this.world.traffic) {
      const cp = car.mesh.position;
      const dx = pos.x - cp.x;
      const dz = pos.z - cp.z;
      const distSq = dx * dx + dz * dz;
      const collisionRadius = car.radius + 1.05;
      if (distSq < collisionRadius * collisionRadius && car.bumpCooldown <= 0) {
        const dist = Math.sqrt(distSq) || 1;
        const pushX = distSq > 0.001 ? dx / dist : (Math.random() - 0.5);
        const pushZ = distSq > 0.001 ? dz / dist : (Math.random() - 0.5);
        if (this.vehicle.takeHit(Math.abs(this.vehicle.speed), pushX, pushZ)) {
          car.bumpCooldown = 1.15;
          this.handleCrash({ impact: Math.abs(this.vehicle.speed), position: pos.clone(), type: "traffic" });
          if (this.state === "gameover") return;
        }
      } else {
        const toX = cp.x - pos.x;
        const toZ = cp.z - pos.z;
        const ahead = toX * forward.x + toZ * forward.z;
        if (distSq < 27 && distSq > 9 && Math.abs(ahead) < 7 && car.nearMissCooldown <= 0 && Math.abs(this.vehicle.speed) > 18) {
          car.nearMissCooldown = 1.5;
          this.vehicle.addBoost(8);
          this.awardAction({
            label: "NEAR MISS", points: 80, charge: 0.28, color: "#20e3b2",
            position: { x: cp.x, y: 1.2, z: cp.z }, sound: "near", burst: 10, shake: 0.16,
          });
        }
      }
    }
  }

  checkPickups() {
    const pos = this.vehicle.pos;
    for (const pickup of this.world.pickups) {
      if (pickup.collected) continue;
      if (pos.distanceToSquared(pickup.position) < 2.6 * 2.6) {
        pickup.collected = true;
        pickup.group.visible = false;
        this.vehicle.addBoost(7);
        this.awardAction({
          label: "CHAI CUP", points: 45, charge: 0.16, color: "#ffd166",
          position: { x: pickup.position.x, y: 1.2, z: pickup.position.z },
          sound: "coin", burst: 14, shake: 0.1,
        });
      }
    }
  }

  checkPads() {
    const pos = this.vehicle.pos;
    for (const pad of this.world.pads) {
      if (pad.used) continue;
      if (pos.distanceToSquared(pad.position) < 3.6 * 3.6) {
        pad.used = true;
        pad.mesh.visible = false;
        this.vehicle.triggerBoostPad();
        this.awardAction({
          label: "BOOST PAD", points: 70, charge: 0.22, color: "#20e3b2",
          position: { x: pad.position.x, y: 0.8, z: pad.position.z },
          sound: "boost", burst: 22, shake: 0.36,
        });
      }
    }
  }

  checkGate() {
    const gate = this.world.gate;
    if (!gate || gate.collected) return;
    if (this.vehicle.pos.distanceToSquared(gate.position) < gate.radius * gate.radius) {
      gate.collected = true;
      gate.group.visible = false;
      this.gates += 1;
      const position = { x: gate.position.x, y: 2.6, z: gate.position.z };
      this.awardAction({
        label: "CHAI GATE", points: 600, charge: 0.55, color: "#ffd166",
        position, sound: "gate", burst: 70, shake: 0.72,
      });
      this.effectA.set(position.x, 3.8, position.z);
      this.particles.burst(this.effectA, 0x20e3b2, 30, {
        speed: 9, spread: 1.1, lift: 0.7, life: 1.1, size: 0.24, gravity: 3.5, drag: 1.2,
      });
      if (this.mode === "solo") {
        this.timeLeft = Math.min(120, this.timeLeft + 9);
        this.ui.showToast("+9 SECONDS · NEXT DROP", 1600);
      } else {
        this.ui.showToast("GATE BANKED · SHARED CLOCK", 1400);
      }
      this.world.nextGate(this.vehicle.pos);
    }
  }

  updateHUD(dt) {
    this.hudTimer -= dt;
    this.minimapTimer -= dt;
    if (this.hudTimer <= 0) {
      const gate = this.world.gate;
      const gateDistance = gate ? Math.round(this.vehicle.pos.distanceTo(gate.position)) : 0;
      const speedRatio = clamp(Math.abs(this.vehicle.speed) / this.vehicle.boostSpeed, 0, 1);
      this.ui.updateHUD({
        score: this.score,
        combo: this.combo,
        timeLeft: this.timeLeft,
        speedKmh: Math.abs(this.vehicle.speed) * 3.6,
        speedRatio,
        healthRatio: this.vehicle.health / this.vehicle.maxHealth,
        boost: this.vehicle.boost,
        boosting: this.vehicle.boosting,
        comboTimer: this.comboTimer,
        comboWindow: this.comboWindow,
        objective: this.mode === "connect" ? "Bank gates · shared clock" : "Reach the chai gate",
        gateDistance,
        compassAngle: this.computeCompassAngle(gate),
        mode: this.mode,
      });
      if (this.mode === "connect") this.ui.setRoomHud(this.network.room, this.getMultiplayerHudPlayers(), this.network.id);
      else this.ui.setRoomHud(null, [], null);
      this.hudTimer = 1 / 30;
    }
    if (this.minimapTimer <= 0) {
      const gate = this.world.gate;
      this.ui.drawMinimap({
        roads: this.world.roadCoords,
        citySize: this.world.citySize,
        roadWidth: this.world.roadWidth,
        player: { x: this.vehicle.pos.x, z: this.vehicle.pos.z, yaw: this.vehicle.yaw },
        gate: gate ? { x: gate.position.x, z: gate.position.z } : null,
        pickups: this.world.pickups.map((p) => ({ x: p.position.x, z: p.position.z, collected: p.collected })),
        pads: this.world.pads.map((p) => ({ x: p.position.x, z: p.position.z, used: p.used })),
        traffic: this.world.traffic.map((car) => ({ x: car.mesh.position.x, z: car.mesh.position.z })),
        remotes: [...this.remotePlayers.values()].map((remote) => ({
          x: remote.group.position.x, z: remote.group.position.z, color: remote.color,
        })),
      });
      this.minimapTimer = 0.1;
    }
  }

  updateCamera(dt) {
    const speedRatio = clamp(Math.abs(this.vehicle.speed) / this.vehicle.boostSpeed, 0, 1);
    const profile = CAMERA_PROFILES[this.qualityPreset] || CAMERA_PROFILES.balanced;
    const distance = profile.distance + speedRatio * 3.2;
    const height = profile.height + speedRatio * 0.7;
    this.cameraDesired.copy(this.vehicle.pos)
      .addScaledVector(this.vehicle.forward, -distance)
      .addScaledVector(this.up, height)
      .addScaledVector(this.vehicle.right, -this.vehicle.steer * 0.7);
    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-8 * dt));
    this.lookTarget.copy(this.vehicle.pos).addScaledVector(this.vehicle.forward, profile.lookAhead + speedRatio * 4);
    this.lookTarget.y = 1.2;
    this.camera.lookAt(this.lookTarget);
    const targetFov = profile.fov + speedRatio * 10 + (this.vehicle.boosting ? 7 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 5, dt);
    this.camera.updateProjectionMatrix();
    const shakeAmount = this.shake + this.vehicle.shake * 0.45;
    if (shakeAmount > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * shakeAmount * 0.32;
      this.camera.position.y += (Math.random() - 0.5) * shakeAmount * 0.22;
      this.camera.position.z += (Math.random() - 0.5) * shakeAmount * 0.32;
      this.camera.rotation.z += (Math.random() - 0.5) * shakeAmount * 0.025;
    }
    this.shake = damp(this.shake, 0, 4.5, dt);
  }

  updateMenu(dt) {
    this.menuAngle += dt * 0.1;
    const radius = this.menuRadius;
    this.cameraDesired.set(
      this.menuCenter.x + Math.sin(this.menuAngle) * radius,
      4.8 + Math.sin(this.menuAngle * 0.7) * 0.8,
      this.menuCenter.z + Math.cos(this.menuAngle) * radius,
    );
    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-2.5 * dt));
    this.camera.lookAt(this.menuCenter);
    const menuProfile = CAMERA_PROFILES[this.qualityPreset] || CAMERA_PROFILES.balanced;
    this.camera.fov = damp(this.camera.fov, menuProfile.menuFov, 2, dt);
    this.camera.updateProjectionMatrix();
    this.world.update(dt, this.vehicle.pos, { ambient: true, particles: this.particles });
    this.particles.update(dt);
    this.updateRemotePlayers(dt);
    if (this.characterStage) {
      this.characterStage.rotation.y += dt * 0.22;
      this.characterPreview?.update(dt, 0.42);
      if (this.characterRing) {
        this.characterRing.material.opacity = 0.42 + Math.sin(this.menuAngle * 4) * 0.18;
      }
    }
    this.updatePreviewRenderer(dt);
  }

  updateGameoverCamera(dt) {
    this.menuAngle += dt * 0.16;
    const radius = 11;
    this.cameraDesired.set(
      this.vehicle.pos.x + Math.sin(this.menuAngle) * radius,
      5.4,
      this.vehicle.pos.z + Math.cos(this.menuAngle) * radius,
    );
    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-2.2 * dt));
    this.lookTarget.set(this.vehicle.pos.x, 1.1, this.vehicle.pos.z);
    this.camera.lookAt(this.lookTarget);
    this.camera.fov = damp(this.camera.fov, 56, 2, dt);
    this.camera.updateProjectionMatrix();
  }

  updateWorldAmbient(dt, orbit) {
    this.world.update(dt * 0.35, this.vehicle.pos, { ambient: true, particles: this.particles });
    this.particles.update(dt);
    this.updateRemotePlayers(dt);
    if (orbit) this.updateGameoverCamera(dt);
  }

  updateAdaptiveQuality(dt) {
    if (this.qualityReduced || this.state !== "playing" || dt > 0.1) return;
    this.frameAccum += dt;
    this.frameCount += 1;
    if (this.frameCount < 90) return;
    const average = this.frameAccum / this.frameCount;
    this.frameAccum = 0;
    this.frameCount = 0;
    if (average > 1 / 46) {
      this.qualityReduced = true;
      const ratio = Math.min(1, window.devicePixelRatio || 1);
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
      this.bloomPass.enabled = false;
      this.smaaPass.enabled = false;
      this.colorGradePass.enabled = false;
      this.renderer.shadowMap.enabled = false;
      if (this.world?.sun) this.world.sun.castShadow = false;
      this.ui.showToast("Performance mode enabled for smooth 60fps", 2200);
    }
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.updateAdaptiveQuality(dt);
    if (this.state === "menu" || this.state === "connect") this.updateMenu(dt);
    else if (this.state === "countdown" || this.state === "playing") this.updateRun(dt);
    else if (this.state === "paused") this.updateWorldAmbient(dt, false);
    else if (this.state === "gameover") this.updateWorldAmbient(dt, true);
    if (this.characterStage) {
      this.characterStage.visible = this.state === "menu" || this.state === "connect";
    }
    if (this.qualityReduced) this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  updateRun(dt) {
    if (this.mode === "connect") {
      this.timeLeft = this.network.remainingTime();
      if (this.state === "countdown") {
        if (this.network.isCountdown()) {
          const seconds = Math.ceil((this.network.startAt - this.network.serverNow()) / 1000);
          this.ui.showCountdown(seconds > 0 ? `GET READY · ${seconds}` : "GET READY");
        } else {
          this.state = "playing";
          this.input.setEnabled(true);
          this.ui.hideCountdown();
          this.ui.showGo();
          this.audio.startEngine();
          this.audio.sfx("start");
        }
      }
      if (this.timeLeft <= 0 && this.state === "playing") {
        this.timeLeft = 0;
        this.endRun("THE SHARED CLOCK RAN OUT");
        return;
      }
    } else if (this.state === "playing") {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endRun("THE CLOCK RAN OUT");
        return;
      }
    }

    const playing = this.state === "playing";
    const controls = playing ? this.input.getControls() : this.neutralControls;
    const events = playing ? this.vehicle.update(dt, controls) : null;
    if (events) this.handleVehicleEvents(events);
    if (this.state === "gameover") {
      this.particles.update(dt);
      this.updateRemotePlayers(dt);
      return;
    }

    this.world.update(dt, this.vehicle.pos, { ambient: !playing, particles: this.particles });
    if (playing && this.state === "playing") {
      this.checkTraffic();
      if (this.state === "gameover") {
        this.particles.update(dt);
        this.updateRemotePlayers(dt);
        return;
      }
      this.checkPickups();
      this.checkPads();
      this.checkGate();
      this.updateScoreContinuous(dt, events);
      this.updateEffects(dt, events);
    }

    this.particles.update(dt);
    this.updateRemotePlayers(dt);
    this.updateCamera(dt);
    this.audio.setEngine(clamp(Math.abs(this.vehicle.speed) / this.vehicle.boostSpeed, 0, 1), this.vehicle.boosting);
    this.updateHUD(dt);
    this.sendNetworkState();
  }
}
