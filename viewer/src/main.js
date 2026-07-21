import './style.css'
import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const FEET_TO_UNITS = 0.18
const CAMERA_SENSOR_WIDTH_MM = 36

const presets = {
  amazon: {
    name: 'Amazon MGM Stage 15',
    diameterFt: 80,
    heightFt: 26,
    arcDeg: 360,
    ceiling: true,
    ceilingCoverage: 1.02,
    panelWidthFt: 1.8,
    panelHeightFt: 1.8,
    doorGapDeg: 0,
    notes: 'Public baseline: 80 ft diameter, 26 ft high, 3,000+ LED tiles, suspended ceiling panels.',
  },
  mandalorian: {
    name: '270 Semi-Circle',
    diameterFt: 70,
    heightFt: 20,
    arcDeg: 270,
    ceiling: true,
    ceilingCoverage: 1.02,
    panelWidthFt: 2.5,
    panelHeightFt: 2.5,
    doorGapDeg: 0,
    notes: 'Classic volume shape for checking side coverage and spill.',
  },
  insert: {
    name: 'Commercial Insert Wall',
    diameterFt: 48,
    heightFt: 18,
    arcDeg: 180,
    ceiling: false,
    ceilingCoverage: 0,
    panelWidthFt: 2.4,
    panelHeightFt: 2.4,
    doorGapDeg: 0,
    notes: 'Useful smaller-stage comparison for car plates and stock demos.',
  },
}

const shotGroups = [
  {
    name: 'Wide',
    shots: [
      { key: 'wideFrontLeft', label: 'Front L', position: [4.2, 0.95, 2.15], target: [0.25, 0.72, 0], fov: 58 },
      { key: 'wideFrontRight', label: 'Front R', position: [4.2, 0.95, -2.15], target: [0.25, 0.72, 0], fov: 58 },
      { key: 'wideRear', label: 'Rear', position: [-4.35, 0.92, 0], target: [-0.35, 0.7, 0], fov: 60 },
    ],
  },
  {
    name: 'Medium 3/4',
    shots: [
      { key: 'mediumFrontLeft', label: 'Front L', position: [2.75, 0.68, 1.35], target: [0.48, 0.58, 0.04], fov: 43 },
      { key: 'mediumFrontRight', label: 'Front R', position: [2.75, 0.68, -1.35], target: [0.48, 0.58, -0.04], fov: 43 },
      { key: 'mediumRearLeft', label: 'Rear L', position: [-2.9, 0.7, 1.4], target: [-0.5, 0.58, 0.04], fov: 44 },
      { key: 'mediumRearRight', label: 'Rear R', position: [-2.9, 0.7, -1.4], target: [-0.5, 0.58, -0.04], fov: 44 },
    ],
  },
  {
    name: 'Interior',
    shots: [
      { key: 'overShoulder', label: 'Over Shoulder', position: [-0.72, 1.02, 0.38], target: [1.25, 0.9, -0.22], fov: 58 },
      { key: 'passengerToDriver', label: 'Passenger -> Driver', position: [0.15, 0.94, -0.72], target: [0.12, 0.86, 0.58], fov: 55 },
      { key: 'driverToPassenger', label: 'Driver -> Passenger', position: [0.15, 0.94, 0.72], target: [0.12, 0.86, -0.58], fov: 55 },
      { key: 'sideWindow', label: 'Side Window', position: [0.18, 0.98, 2.1], target: [0.08, 0.78, 0], fov: 48 },
    ],
  },
  {
    name: 'Utility',
    shots: [
      { key: 'paintReflection', label: 'Paint', position: [2.35, 0.62, 1.0], target: [0.35, 0.52, 0], fov: 42 },
      { key: 'ceiling', label: 'Ceiling', position: [0, 2.45, 0.1], target: [0, 0.25, 0], fov: 82 },
      { key: 'top', label: 'Plan', position: [0, 18, 0], target: [0, 0, 0], fov: 50 },
    ],
  },
]

const views = Object.fromEntries(shotGroups.flatMap((group) => group.shots.map((shot) => [shot.key, shot])))

const finishPresets = {
  black: { label: 'Black', color: '#14191d', metalness: 0.7, roughness: 0.16 },
  silver: { label: 'Silver', color: '#aeb7ba', metalness: 0.82, roughness: 0.14 },
  red: { label: 'Red', color: '#8e121c', metalness: 0.55, roughness: 0.2 },
  white: { label: 'White', color: '#ecece5', metalness: 0.35, roughness: 0.24 },
}

const footagePresets = {
  canyon: { label: 'Canyon', sourceMode: 'sphere', cropTop: 7, cropBottom: 57, ceilingTop: 7, ceilingBottom: 25, vertical: 0 },
  dtla: { label: 'DTLA', sourceMode: 'sphere', cropTop: 0, cropBottom: 62, ceilingTop: 0, ceilingBottom: 22, vertical: 0 },
  fullSphere: { label: 'Full 360 sphere', sourceMode: 'sphere', cropTop: 0, cropBottom: 100, ceilingTop: 0, ceilingBottom: 50, vertical: 0 },
}

const vehicleModels = {
  ferrari: {
    label: 'Sports convertible',
    file: `${import.meta.env.BASE_URL}models/ferrari.glb`,
    credit: 'Ferrari 458 Italia by vicent091036 via the official Three.js car materials example.',
    rotationY: -Math.PI / 2,
    targetLength: 4.65,
    shadow: 'ferrari',
  },
  bmwM5: {
    label: 'BMW M5 sedan',
    file: `${import.meta.env.BASE_URL}models/bmw_m5.glb`,
    credit: 'BMW M5 sedan test model from Get3DModels/DreamCar.',
    rotationY: 0,
    targetLength: 4.96,
    shadow: 'soft',
  },
  escalade: {
    label: 'Escalade SUV',
    file: `${import.meta.env.BASE_URL}models/escalade.glb`,
    credit: 'Cadillac Escalade ESV test model from Get3DModels/OUTPISTON.',
    rotationY: 0,
    targetLength: 5.7,
    shadow: 'soft',
  },
}

const state = {
  presetKey: 'amazon',
  selectedView: 'wideFrontLeft',
  finishKey: 'silver',
  vehicleKey: 'ferrari',
  vehicleYaw: 0,
  exposure: 1.15,
  panelGrid: true,
  reflections: true,
  playRate: 1,
  footageYaw: 0,
  footageVertical: 0,
  footagePreset: 'canyon',
  sourceMode: 'sphere',
  cropTop: 7,
  cropBottom: 57,
  ceilingTop: 7,
  ceilingBottom: 25,
  cameraRig: {
    orbitDeg: 27,
    distance: 4.72,
    lensHeight: 0.95,
    aimHeight: 0.72,
    focalLength: 31,
    custom: false,
  },
  customShots: loadCustomShots(),
  dimensions: { ...presets.amazon },
}

const app = document.querySelector('#app')
app.innerHTML = `
  <main class="workbench">
    <section class="viewport" aria-label="LED wall preview">
      <div class="viewport__bar">
        <div>
          <p class="eyebrow">Virtual production stock preview</p>
          <h1>LED Wall Footage Viewer</h1>
        </div>
        <div class="status" id="playbackStatus">No footage loaded</div>
      </div>
      <canvas id="stageCanvas"></canvas>
      <div class="view-strip" id="viewStrip" aria-label="Camera views"></div>
      <button id="panelToggle" class="panel-toggle" type="button" title="Hide controls" aria-label="Hide controls">›</button>
    </section>

    <aside class="control-panel" aria-label="Viewer controls">
      <section class="control-group">
        <div class="group-title">
          <span>Footage</span>
          <button class="icon-button" id="playPause" type="button" title="Play or pause footage" aria-label="Play or pause footage">
            <span data-icon="play"></span>
          </button>
        </div>
        <label class="file-drop" for="videoFile">
          <span class="file-drop__title">Load 360 footage</span>
          <span id="fileName">MP4, MOV, WebM</span>
          <input id="videoFile" type="file" accept="video/*" />
        </label>
        <label class="field">
          <span>Video URL</span>
          <div class="inline-field">
            <input id="videoUrl" type="url" placeholder="https://..." />
            <button id="loadUrl" type="button">Load</button>
          </div>
        </label>
        <label class="field">
          <span>Footage preset</span>
          <select id="footagePreset">
            <option value="canyon" selected>Canyon</option>
            <option value="dtla">DTLA</option>
            <option value="fullSphere">Full 360 sphere</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label class="field">
          <span>Source format</span>
          <select id="sourceMode">
            <option value="sphere">360 dome / equirect</option>
            <option value="strip">Flat wall strip</option>
          </select>
        </label>
        <label class="range-field">
          <span>Wall rotation <output id="yawOut">0 deg</output></span>
          <input id="footageYaw" type="range" min="-180" max="180" step="1" value="0" />
        </label>
        <label class="range-field">
          <span>Vertical offset <output id="verticalOut">0%</output></span>
          <input id="footageVertical" type="range" min="-50" max="50" step="1" value="0" />
        </label>
        <label class="range-field">
          <span>Crop top <output id="cropTopOut">7%</output></span>
          <input id="cropTop" type="range" min="0" max="45" step="1" value="7" />
        </label>
        <label class="range-field">
          <span>Crop bottom <output id="cropBottomOut">57%</output></span>
          <input id="cropBottom" type="range" min="45" max="100" step="1" value="57" />
        </label>
        <label class="range-field">
          <span>Ceiling top <output id="ceilingTopOut">7%</output></span>
          <input id="ceilingTop" type="range" min="0" max="50" step="1" value="7" />
        </label>
        <label class="range-field">
          <span>Ceiling bottom <output id="ceilingBottomOut">25%</output></span>
          <input id="ceilingBottom" type="range" min="1" max="70" step="1" value="25" />
        </label>
      </section>

      <section class="control-group">
        <div class="group-title">
          <span>Wall Replica</span>
          <span class="chip" id="panelCount">0 panels</span>
        </div>
        <label class="field">
          <span>Preset</span>
          <select id="presetSelect"></select>
        </label>
        <div class="metrics">
          <div><strong id="diameterMetric">80 ft</strong><span>diameter</span></div>
          <div><strong id="heightMetric">26 ft</strong><span>height</span></div>
          <div><strong id="arcMetric">320 deg</strong><span>wall arc</span></div>
        </div>
        <label class="range-field">
          <span>Diameter <output id="diameterOut">80 ft</output></span>
          <input id="diameter" type="range" min="24" max="120" step="1" value="80" />
        </label>
        <label class="range-field">
          <span>Height <output id="heightOut">26 ft</output></span>
          <input id="height" type="range" min="10" max="40" step="1" value="26" />
        </label>
        <label class="range-field">
          <span>Arc <output id="arcOut">320 deg</output></span>
          <input id="arc" type="range" min="90" max="360" step="5" value="320" />
        </label>
        <div class="toggle-grid">
          <label><input id="ceilingToggle" type="checkbox" checked /> Ceiling LEDs</label>
          <label><input id="gridToggle" type="checkbox" checked /> Panel grid</label>
        </div>
        <p class="notes" id="presetNotes"></p>
      </section>

      <section class="control-group">
        <div class="group-title">
          <span>Camera Framing</span>
          <span class="chip" id="cameraMode">Locked shot</span>
        </div>
        <label class="range-field">
          <span>Orbit angle <output id="orbitOut">27 deg</output></span>
          <input id="cameraOrbit" type="range" min="-180" max="180" step="1" value="27" />
        </label>
        <label class="range-field">
          <span>Camera distance <output id="distanceOut">4.7 m</output></span>
          <input id="cameraDistance" type="range" min="1.2" max="7.5" step="0.1" value="4.7" />
        </label>
        <label class="range-field">
          <span>Lens height <output id="lensHeightOut">0.95 m</output></span>
          <input id="cameraHeight" type="range" min="0.25" max="2.2" step="0.05" value="0.95" />
        </label>
        <label class="range-field">
          <span>Aim height <output id="aimHeightOut">0.72 m</output></span>
          <input id="cameraAimHeight" type="range" min="0.15" max="1.6" step="0.05" value="0.72" />
        </label>
        <label class="range-field">
          <span>Focal length <output id="focalOut">31 mm</output></span>
          <input id="cameraFocal" type="range" min="16" max="85" step="1" value="31" />
        </label>
        <div class="toggle-grid">
          <button id="useCameraRig" type="button" class="panel-button">Use custom rig</button>
          <button id="resetCameraRig" type="button" class="panel-button">Reset to shot</button>
          <button id="saveCameraView" type="button" class="panel-button">Save view</button>
          <button id="clearCameraViews" type="button" class="panel-button">Clear saved</button>
        </div>
      </section>

      <section class="control-group">
        <div class="group-title">
          <span>Car Look</span>
          <button class="icon-button" id="resetView" type="button" title="Reset camera view" aria-label="Reset camera view">
            <span data-icon="rotate"></span>
          </button>
        </div>
        <div class="swatches" id="finishSwatches" aria-label="Car paint finish"></div>
        <label class="field">
          <span>Vehicle model</span>
          <select id="vehicleSelect"></select>
        </label>
        <label class="range-field">
          <span>Vehicle rotation <output id="vehicleYawOut">0 deg</output></span>
          <input id="vehicleYaw" type="range" min="-180" max="180" step="1" value="0" />
        </label>
        <label class="range-field">
          <span>Screen brightness <output id="exposureOut">115%</output></span>
          <input id="exposure" type="range" min="40" max="180" step="5" value="115" />
        </label>
        <label class="range-field">
          <span>Playback speed <output id="rateOut">1.0x</output></span>
          <input id="rate" type="range" min="25" max="150" step="5" value="100" />
        </label>
        <div class="toggle-grid">
          <label><input id="reflectionToggle" type="checkbox" checked /> Footage reflections</label>
        </div>
        <p class="notes" id="vehicleCredit"></p>
      </section>
    </aside>
  </main>
`

// Collapsible control panel: a drawer pull pinned to the viewport/panel edge.
const workbench = document.querySelector('.workbench')
const panelToggle = document.querySelector('#panelToggle')
panelToggle.addEventListener('click', () => {
  const collapsed = workbench.classList.toggle('is-collapsed')
  panelToggle.textContent = collapsed ? '‹' : '›'
  panelToggle.title = collapsed ? 'Show controls' : 'Hide controls'
  panelToggle.setAttribute('aria-label', panelToggle.title)
})

const canvas = document.querySelector('#stageCanvas')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x07090b, 1)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = state.exposure

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x07090b, 15, 38)

const camera = new THREE.PerspectiveCamera(views[state.selectedView].fov, 1, 0.1, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.enableRotate = true
controls.enablePan = true
controls.screenSpacePanning = true
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
controls.touches.ONE = THREE.TOUCH.ROTATE
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
controls.maxPolarAngle = Math.PI * 0.49
controls.minDistance = 1
controls.maxDistance = 32

const stageGroup = new THREE.Group()
const gridGroup = new THREE.Group()
const carGroup = new THREE.Group()
scene.add(stageGroup, gridGroup, carGroup)

const video = document.createElement('video')
video.loop = true
video.muted = true
video.playsInline = true
video.crossOrigin = 'anonymous'
video.preload = 'auto'

const ferrariShadowTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}models/ferrari_ao.png`)
ferrariShadowTexture.colorSpace = THREE.SRGBColorSpace

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/gltf/`)

const vehicleLoader = new GLTFLoader()
vehicleLoader.setDRACOLoader(dracoLoader)

const fallbackTexture = makeFallbackTexture()
const stageVideoUniforms = {
  map: { value: fallbackTexture },
  yaw: { value: 0 },
  verticalOffset: { value: 0 },
  originY: { value: 1.0 },
  stageHeight: { value: 5.0 },
  stageRadius: { value: 6.0 },
  mode: { value: 1 },
  cropTop: { value: 0.07 },
  cropBottom: { value: 0.57 },
  ceilingTop: { value: 0.07 },
  ceilingBottom: { value: 0.25 },
}
const screenMaterial = makeEquirectStageMaterial(stageVideoUniforms, 0)
const ceilingMaterial = makeEquirectStageMaterial(stageVideoUniforms, 1)
const dimMaterial = new THREE.MeshBasicMaterial({
  color: 0x07090b,
  transparent: true,
  opacity: 0.48,
  side: THREE.DoubleSide,
})
const gridMaterial = new THREE.LineBasicMaterial({
  color: 0xd8e3d0,
  transparent: true,
  opacity: 0.23,
})

function makeEquirectStageMaterial(sharedUniforms, surfaceType) {
  const uniforms = {
    ...sharedUniforms,
    surfaceType: { value: surfaceType },
  }
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float yaw;
      uniform float verticalOffset;
      uniform float originY;
      uniform float stageHeight;
      uniform float stageRadius;
      uniform float mode;
      uniform float cropTop;
      uniform float cropBottom;
      uniform float ceilingTop;
      uniform float ceilingBottom;
      uniform float surfaceType;
      varying vec3 vWorldPosition;

      const float PI = 3.141592653589793;

      void main() {
        vec3 direction = normalize(vec3(vWorldPosition.x, vWorldPosition.y - originY, vWorldPosition.z));
        float u = fract(atan(direction.z, direction.x) / (2.0 * PI) + 0.5 + yaw);
        float visualV;

        if (mode < 0.5) {
          float sphereV = 0.5 - asin(clamp(direction.y, -1.0, 1.0)) / PI + verticalOffset;
          if (surfaceType > 0.5) {
            visualV = mix(ceilingTop, ceilingBottom, clamp(sphereV, 0.0, 1.0));
          } else {
            visualV = mix(cropTop, cropBottom, clamp(sphereV, 0.0, 1.0));
          }
        } else if (surfaceType > 0.5) {
          float radial = clamp(length(vWorldPosition.xz) / max(stageRadius, 0.001), 0.0, 1.0);
          float skyBand = min(cropTop + 0.2, cropBottom);
          visualV = mix(cropTop, skyBand, radial) + verticalOffset;
        } else {
          float heightT = clamp(vWorldPosition.y / max(stageHeight, 0.001), 0.0, 1.0);
          visualV = mix(cropBottom, cropTop, heightT) + verticalOffset;
        }

        visualV = clamp(visualV, 0.0, 1.0);
        vec4 color = texture2D(map, vec2(u, 1.0 - visualV));
        gl_FragColor = color;
      }
    `,
  })
}

const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x060708,
  roughness: 0.86,
  metalness: 0.02,
  envMapIntensity: 0,
})
const floorLogoTexture = makePlateLabLogoTexture()
const floorLogoMaterial = new THREE.MeshBasicMaterial({
  map: floorLogoTexture,
  transparent: true,
  opacity: 0.62,
  depthWrite: false,
  toneMapped: false,
})

const carMaterials = {
  paint: new THREE.MeshPhysicalMaterial({
    color: finishPresets.silver.color,
    metalness: 1,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    envMapIntensity: 2.8,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xdcecff,
    metalness: 0.08,
    roughness: 0.01,
    transmission: 0.72,
    transparent: true,
    opacity: 0.42,
    envMapIntensity: 2.2,
  }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.82, metalness: 0.08, envMapIntensity: 0.35 }),
  chrome: new THREE.MeshPhysicalMaterial({ color: 0xe8eeee, metalness: 1, roughness: 0.06, envMapIntensity: 2.6 }),
  details: new THREE.MeshStandardMaterial({ color: 0xcfd6d3, roughness: 0.34, metalness: 1, envMapIntensity: 1.8 }),
  redLight: new THREE.MeshPhysicalMaterial({ color: 0x8f1017, emissive: 0x2a0305, roughness: 0.18, metalness: 0.25 }),
  amberLight: new THREE.MeshPhysicalMaterial({ color: 0xf2a340, emissive: 0x301303, roughness: 0.18, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0e1011, roughness: 0.64, metalness: 0.18, envMapIntensity: 0.45 }),
}
const dynamicVehicleMaterials = new Set()

const keyLight = new THREE.DirectionalLight(0xffffff, 1.8)
keyLight.position.set(5, 8, 4)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight(0xb7e37d, 1.2)
rimLight.position.set(-5, 5, -6)
scene.add(rimLight)
scene.add(new THREE.HemisphereLight(0x91b9ff, 0x121008, 0.65))
scene.add(new THREE.AmbientLight(0xffffff, 0.18))

const reflectionTarget = new THREE.WebGLCubeRenderTarget(256, {
  type: THREE.HalfFloatType,
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
})
const reflectionCamera = new THREE.CubeCamera(0.1, 80, reflectionTarget)
reflectionCamera.position.set(0, 1.05, 0)
scene.add(reflectionCamera)
assignReflectionMap(reflectionTarget.texture)

buildCar()
buildControls()
bindCameraNavigation()
applyPreset('amazon')
setView(state.selectedView, false)

function buildControls() {
  const presetSelect = document.querySelector('#presetSelect')
  Object.entries(presets).forEach(([key, preset]) => {
    const option = document.createElement('option')
    option.value = key
    option.textContent = preset.name
    presetSelect.append(option)
  })
  presetSelect.value = state.presetKey
  presetSelect.addEventListener('change', (event) => applyPreset(event.target.value))

  const vehicleSelect = document.querySelector('#vehicleSelect')
  if (vehicleSelect) {
    Object.entries(vehicleModels).forEach(([key, vehicle]) => {
      const option = document.createElement('option')
      option.value = key
      option.textContent = vehicle.label
      vehicleSelect.append(option)
    })
    vehicleSelect.value = state.vehicleKey
    vehicleSelect.addEventListener('change', (event) => loadVehicle(event.target.value))
  }
  updateVehicleCredit()

  const viewStrip = document.querySelector('#viewStrip')
  shotGroups.forEach((group) => {
    const wrapper = document.createElement('div')
    wrapper.className = 'view-group'

    const groupLabel = document.createElement('span')
    groupLabel.textContent = group.name
    wrapper.append(groupLabel)

    group.shots.forEach((view) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.view = view.key
      button.textContent = view.label
      button.title = `${group.name}: ${view.label}`
      button.addEventListener('click', () => setView(view.key))
      wrapper.append(button)
    })
    viewStrip.append(wrapper)
  })
  const customWrapper = document.createElement('div')
  customWrapper.className = 'view-group'
  customWrapper.id = 'customViewGroup'
  const customLabel = document.createElement('span')
  customLabel.textContent = 'Custom'
  customWrapper.append(customLabel)
  viewStrip.append(customWrapper)
  renderCustomShots()

  const swatches = document.querySelector('#finishSwatches')
  Object.entries(finishPresets).forEach(([key, finish]) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'swatch'
    button.dataset.finish = key
    button.title = finish.label
    button.ariaLabel = finish.label
    button.style.setProperty('--swatch', finish.color)
    button.addEventListener('click', () => setFinish(key))
    swatches.append(button)
  })
  setFinish(state.finishKey)

  bindRange('diameter', 'diameterOut', 'diameterFt', ' ft')
  bindRange('height', 'heightOut', 'heightFt', ' ft')
  bindRange('arc', 'arcOut', 'arcDeg', ' deg')
  bindCameraRigControls()

  document.querySelector('#ceilingToggle').addEventListener('change', (event) => {
    state.dimensions.ceiling = event.target.checked
    rebuildStage()
  })
  document.querySelector('#gridToggle').addEventListener('change', (event) => {
    state.panelGrid = event.target.checked
    gridGroup.visible = state.panelGrid
  })
  document.querySelector('#reflectionToggle').addEventListener('change', (event) => {
    state.reflections = event.target.checked
    syncEnvironment()
  })
  document.querySelector('#exposure').addEventListener('input', (event) => {
    state.exposure = Number(event.target.value) / 100
    renderer.toneMappingExposure = state.exposure
    document.querySelector('#exposureOut').textContent = `${event.target.value}%`
  })
  document.querySelector('#rate').addEventListener('input', (event) => {
    state.playRate = Number(event.target.value) / 100
    video.playbackRate = state.playRate
    document.querySelector('#rateOut').textContent = `${state.playRate.toFixed(2).replace(/0$/, '')}x`
  })
  document.querySelector('#videoFile').addEventListener('change', loadVideoFile)
  document.querySelector('#vehicleYaw').addEventListener('input', (event) => {
    state.vehicleYaw = Number(event.target.value)
    document.querySelector('#vehicleYawOut').textContent = `${state.vehicleYaw} deg`
    applyVehicleYaw()
  })
  document.querySelector('#loadUrl').addEventListener('click', loadVideoUrl)
  document.querySelector('#videoUrl').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadVideoUrl()
  })
  document.querySelector('#footagePreset').addEventListener('change', (event) => {
    if (event.target.value === 'custom') return
    applyFootagePreset(event.target.value)
  })
  document.querySelector('#sourceMode').addEventListener('change', (event) => {
    markFootagePresetCustom()
    state.sourceMode = event.target.value
    applyFootageTransform()
  })
  document.querySelector('#footageYaw').addEventListener('input', (event) => {
    state.footageYaw = Number(event.target.value)
    document.querySelector('#yawOut').textContent = `${state.footageYaw} deg`
    applyFootageTransform()
  })
  document.querySelector('#footageVertical').addEventListener('input', (event) => {
    markFootagePresetCustom()
    state.footageVertical = Number(event.target.value)
    document.querySelector('#verticalOut').textContent = `${state.footageVertical}%`
    applyFootageTransform()
  })
  document.querySelector('#cropTop').addEventListener('input', (event) => {
    markFootagePresetCustom()
    state.cropTop = Math.min(Number(event.target.value), state.cropBottom - 1)
    event.target.value = state.cropTop
    document.querySelector('#cropTopOut').textContent = `${state.cropTop}%`
    applyFootageTransform()
  })
  document.querySelector('#cropBottom').addEventListener('input', (event) => {
    markFootagePresetCustom()
    state.cropBottom = Math.max(Number(event.target.value), state.cropTop + 1)
    event.target.value = state.cropBottom
    document.querySelector('#cropBottomOut').textContent = `${state.cropBottom}%`
    applyFootageTransform()
  })
  document.querySelector('#ceilingTop').addEventListener('input', (event) => {
    markFootagePresetCustom()
    state.ceilingTop = Math.min(Number(event.target.value), state.ceilingBottom - 1)
    event.target.value = state.ceilingTop
    document.querySelector('#ceilingTopOut').textContent = `${state.ceilingTop}%`
    applyFootageTransform()
  })
  document.querySelector('#ceilingBottom').addEventListener('input', (event) => {
    markFootagePresetCustom()
    state.ceilingBottom = Math.max(Number(event.target.value), state.ceilingTop + 1)
    event.target.value = state.ceilingBottom
    document.querySelector('#ceilingBottomOut').textContent = `${state.ceilingBottom}%`
    applyFootageTransform()
  })
  document.querySelector('#playPause').addEventListener('click', togglePlayback)
  document.querySelector('#resetView').addEventListener('click', () => setView(state.selectedView, false))

  video.addEventListener('play', () => setPlaybackStatus('Playing'))
  video.addEventListener('pause', () => setPlaybackStatus('Paused'))
  video.addEventListener('error', () => setPlaybackStatus('Video could not load'))
}

function bindRange(id, outputId, key, suffix) {
  const input = document.querySelector(`#${id}`)
  const output = document.querySelector(`#${outputId}`)
  input.addEventListener('input', () => {
    const value = Number(input.value)
    state.dimensions[key] = value
    output.textContent = `${value}${suffix}`
    rebuildStage()
  })
}

function bindCameraRigControls() {
  const controlsMap = [
    ['cameraOrbit', 'orbitOut', 'orbitDeg', (value) => `${value} deg`],
    ['cameraDistance', 'distanceOut', 'distance', (value) => `${Number(value).toFixed(1)} m`],
    ['cameraHeight', 'lensHeightOut', 'lensHeight', (value) => `${Number(value).toFixed(2)} m`],
    ['cameraAimHeight', 'aimHeightOut', 'aimHeight', (value) => `${Number(value).toFixed(2)} m`],
    ['cameraFocal', 'focalOut', 'focalLength', (value) => `${value} mm`],
  ]

  controlsMap.forEach(([inputId, outputId, key, format]) => {
    const input = document.querySelector(`#${inputId}`)
    const output = document.querySelector(`#${outputId}`)
    input.addEventListener('input', () => {
      const value = Number(input.value)
      state.cameraRig[key] = value
      state.cameraRig.custom = true
      output.textContent = format(value)
      document.querySelector('#cameraMode').textContent = 'Custom rig'
      document.querySelectorAll('.view-strip button').forEach((button) => button.classList.remove('is-active'))
      applyCameraRig()
    })
  })

  document.querySelector('#useCameraRig').addEventListener('click', () => {
    state.cameraRig.custom = true
    document.querySelector('#cameraMode').textContent = 'Custom rig'
    applyCameraRig()
  })

  document.querySelector('#resetCameraRig').addEventListener('click', () => {
    setView(state.selectedView)
  })

  document.querySelector('#saveCameraView').addEventListener('click', saveCurrentCameraView)
  document.querySelector('#clearCameraViews').addEventListener('click', () => {
    state.customShots = []
    persistCustomShots()
    renderCustomShots()
  })
}

function applyPreset(key) {
  state.presetKey = key
  state.dimensions = { ...presets[key] }
  document.querySelector('#presetSelect').value = key
  document.querySelector('#diameter').value = state.dimensions.diameterFt
  document.querySelector('#height').value = state.dimensions.heightFt
  document.querySelector('#arc').value = state.dimensions.arcDeg
  document.querySelector('#diameterOut').textContent = `${state.dimensions.diameterFt} ft`
  document.querySelector('#heightOut').textContent = `${state.dimensions.heightFt} ft`
  document.querySelector('#arcOut').textContent = `${state.dimensions.arcDeg} deg`
  document.querySelector('#ceilingToggle').checked = state.dimensions.ceiling
  document.querySelector('#presetNotes').textContent = state.dimensions.notes
  rebuildStage()
  setView(state.selectedView, false)
}

function rebuildStage() {
  clearGroup(stageGroup)
  clearGroup(gridGroup)

  const diameter = state.dimensions.diameterFt * FEET_TO_UNITS
  const radius = diameter / 2
  const height = state.dimensions.heightFt * FEET_TO_UNITS
  const arc = THREE.MathUtils.degToRad(state.dimensions.arcDeg)
  const thetaStart = Math.PI / 2 - arc / 2
  stageVideoUniforms.originY.value = state.cameraRig?.lensHeight || 1.0
  stageVideoUniforms.stageHeight.value = height
  stageVideoUniforms.stageRadius.value = radius

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 128, 1, true, thetaStart, arc),
    screenMaterial,
  )
  wall.position.y = height / 2
  stageGroup.add(wall)

  const doorGap = Math.min(state.dimensions.doorGapDeg, 30)
  if (doorGap > 0 && state.dimensions.arcDeg < 356) {
    const mask = makeOpeningMask(radius, height, doorGap)
    stageGroup.add(mask)
  }

  if (state.dimensions.ceiling) {
    const ceilingRadius = radius * (state.dimensions.ceilingCoverage || 0.88)
    const ceiling = new THREE.Mesh(new THREE.CircleGeometry(ceilingRadius, 96), ceilingMaterial)
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.y = height
    stageGroup.add(ceiling)
  }

  buildPanelGrid(radius, height, arc, thetaStart)
  gridGroup.visible = state.panelGrid
  updateMetrics(radius, height, arc)
}

function buildPanelGrid(radius, height, arc, thetaStart) {
  const panelW = state.dimensions.panelWidthFt * FEET_TO_UNITS
  const panelH = state.dimensions.panelHeightFt * FEET_TO_UNITS
  const columns = Math.max(8, Math.round((radius * arc) / panelW))
  const rows = Math.max(4, Math.round(height / panelH))
  const points = []

  for (let i = 0; i <= columns; i += 1) {
    const theta = thetaStart + (arc * i) / columns
    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius
    points.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z))
  }

  for (let row = 0; row <= rows; row += 1) {
    const y = (height * row) / rows
    for (let i = 0; i < columns; i += 1) {
      const a = thetaStart + (arc * i) / columns
      const b = thetaStart + (arc * (i + 1)) / columns
      points.push(
        new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius),
        new THREE.Vector3(Math.cos(b) * radius, y, Math.sin(b) * radius),
      )
    }
  }

  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), gridMaterial)
  gridGroup.add(grid)

  if (state.dimensions.ceiling) {
    const ceilingRadius = radius * (state.dimensions.ceilingCoverage || 0.88)
    const ceilingPoints = []
    const rings = 5
    for (let r = 1; r <= rings; r += 1) {
      const ring = (ceilingRadius * r) / rings
      for (let i = 0; i < 72; i += 1) {
        const a = (Math.PI * 2 * i) / 72
        const b = (Math.PI * 2 * (i + 1)) / 72
        ceilingPoints.push(
          new THREE.Vector3(Math.cos(a) * ring, height + 0.006, Math.sin(a) * ring),
          new THREE.Vector3(Math.cos(b) * ring, height + 0.006, Math.sin(b) * ring),
        )
      }
    }
    for (let i = 0; i < 16; i += 1) {
      const a = (Math.PI * 2 * i) / 16
      ceilingPoints.push(
        new THREE.Vector3(0, height + 0.006, 0),
        new THREE.Vector3(Math.cos(a) * ceilingRadius, height + 0.006, Math.sin(a) * ceilingRadius),
      )
    }
    gridGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ceilingPoints), gridMaterial))
  }

  const wallPanels = columns * rows
  const ceilingPanels = state.dimensions.ceiling
    ? Math.round((Math.PI * (radius * (state.dimensions.ceilingCoverage || 0.88)) ** 2) / (panelW * panelH))
    : 0
  document.querySelector('#panelCount').textContent = `${Math.round((wallPanels + ceilingPanels) / 100) * 100}+ panels`
}

function makeOpeningMask(radius, height, doorGapDeg) {
  const width = Math.tan(THREE.MathUtils.degToRad(doorGapDeg) / 2) * radius * 2
  const mask = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.06), dimMaterial)
  mask.position.set(0, height / 2, radius - 0.02)
  return mask
}

function updateMetrics(radius, height, arc) {
  document.querySelector('#diameterMetric').textContent = `${state.dimensions.diameterFt} ft`
  document.querySelector('#heightMetric').textContent = `${state.dimensions.heightFt} ft`
  document.querySelector('#arcMetric').textContent = `${state.dimensions.arcDeg} deg`

  const carScale = Math.max(0.82, Math.min(1.12, radius / 7.2))
  carGroup.scale.setScalar(carScale)
  controls.maxDistance = Math.max(18, radius * 3.2)
}

function buildCar() {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(8.2, 96), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.015
  scene.add(floor)

  addFloorLogo(0, 2.15, -0.08)
  addFloorLogo(0, -2.15, Math.PI + 0.08)

  loadVehicle(state.vehicleKey)
}

function loadVehicle(key) {
  const vehicle = vehicleModels[key] || vehicleModels.ferrari
  state.vehicleKey = vehicleModels[key] ? key : 'ferrari'
  const vehicleSelect = document.querySelector('#vehicleSelect')
  if (vehicleSelect) vehicleSelect.value = state.vehicleKey
  updateVehicleCredit()
  loadVehicleSpec(vehicle)
}

function loadVehicleSpec(vehicle) {
  dynamicVehicleMaterials.clear()
  clearGroup(carGroup)
  applyVehicleYaw()

  vehicleLoader.load(
    vehicle.file,
    (gltf) => {
      const carModel = gltf.scene.children[0] || gltf.scene
      carModel.name = vehicle.label
      carModel.rotation.y = vehicle.rotationY
      applyCarMaterials(carModel)
      normalizeVehicleModel(carModel, vehicle)

      carGroup.add(makeVehicleShadow(vehicle))
      carGroup.add(carModel)
      setPlaybackStatus(video.src ? 'Playing' : `${vehicle.label} loaded`)
      document.querySelector('#vehicleCredit').textContent = vehicle.credit
    },
    undefined,
    () => {
      clearGroup(carGroup)
      buildFallbackCar()
      setPlaybackStatus('Using fallback car')
    },
  )
}

function applyVehicleYaw() {
  carGroup.rotation.y = THREE.MathUtils.degToRad(state.vehicleYaw)
}

function applyCarMaterials(carModel) {
  const byName = (name) => carModel.getObjectByName(name)
  const body = byName('body')
  const glass = byName('glass')
  if (body) body.material = carMaterials.paint
  if (glass) glass.material = carMaterials.glass
  ;['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim'].forEach((name) => {
    const mesh = byName(name)
    if (mesh) mesh.material = carMaterials.details
  })

  carModel.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    const name = child.name.toLowerCase()
    const materialName = child.material?.name?.toLowerCase() || ''
    const label = `${name} ${materialName}`
    if (label.includes('window') || label.includes('glass')) child.material = carMaterials.glass
    else if (label.includes('wheel') || label.includes('tire') || label.includes('tyre') || materialName === 'black') {
      child.material = carMaterials.rubber
    }
    else if (label.includes('taillight') || label.includes('tail') || (label.includes('light') && label.includes('red'))) {
      child.material = carMaterials.redLight
    } else if (label.includes('headlight') || label.includes('signal') || label.includes('yellow')) {
      child.material = carMaterials.amberLight
    } else if (label.includes('chrome') || label.includes('metal') || label.includes('badge') || materialName === 'grey') {
      child.material = carMaterials.chrome
    }
    else if (label.includes('interior') || label.includes('leather') || label.includes('carpet')) child.material = carMaterials.dark
    else if (
      label.includes('paint')
      || label.includes('carpaint')
      || label.includes('body')
      || label.includes('base')
      || materialName === 'blue'
      || materialName === 'white'
      || name.includes('cube')
    ) {
      child.material = carMaterials.paint
    }
    registerVehicleMaterial(child.material)
  })
}

function registerVehicleMaterial(material) {
  const materials = Array.isArray(material) ? material : [material]
  materials.forEach((item) => {
    if (!item) return
    dynamicVehicleMaterials.add(item)
    item.needsUpdate = true
  })
}

function normalizeVehicleModel(carModel, vehicle) {
  carModel.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(carModel)
  const size = new THREE.Vector3()
  box.getSize(size)
  const length = Math.max(size.x, size.z)
  const scale = vehicle.targetLength / Math.max(length, 0.001)
  carModel.scale.setScalar(scale)
  carModel.updateMatrixWorld(true)

  const scaledBox = new THREE.Box3().setFromObject(carModel)
  const center = new THREE.Vector3()
  scaledBox.getCenter(center)
  carModel.position.x -= center.x
  carModel.position.z -= center.z
  carModel.position.y -= scaledBox.min.y - 0.02
}

function makeVehicleShadow(vehicle) {
  const materialOptions = {
    blending: THREE.MultiplyBlending,
    toneMapped: false,
    transparent: true,
    premultipliedAlpha: true,
    opacity: vehicle.shadow === 'ferrari' ? 0.68 : 0.28,
  }
  if (vehicle.shadow === 'ferrari') materialOptions.map = ferrariShadowTexture

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(vehicle.targetLength * 1.06, vehicle.targetLength * 0.5),
    new THREE.MeshBasicMaterial(materialOptions),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.018
  shadow.renderOrder = 2
  return shadow
}

function updateVehicleCredit() {
  const credit = document.querySelector('#vehicleCredit')
  if (!credit) return
  credit.textContent = vehicleModels[state.vehicleKey]?.credit || vehicleModels.ferrari.credit
}

function buildFallbackCar() {
  const body = roundedBox(4.8, 0.8, 2.05, 0.22, carMaterials.paint)
  body.position.y = 0.85
  carGroup.add(body)

  const cabin = roundedBox(2.25, 0.75, 1.65, 0.18, carMaterials.glass)
  cabin.position.set(-0.18, 1.45, -0.08)
  carGroup.add(cabin)
}

function addFloorLogo(x, z, rotationZ) {
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.72), floorLogoMaterial.clone())
  logo.rotation.x = -Math.PI / 2
  logo.rotation.z = rotationZ
  logo.position.set(x, 0.021, z)
  logo.renderOrder = 3
  scene.add(logo)
}

function makePlateLabLogoTexture() {
  const logoCanvas = document.createElement('canvas')
  logoCanvas.width = 1024
  logoCanvas.height = 320
  const ctx = logoCanvas.getContext('2d')
  ctx.clearRect(0, 0, logoCanvas.width, logoCanvas.height)

  ctx.fillStyle = 'rgba(238, 244, 238, 0.92)'
  ctx.font = '900 108px Inter, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('PLATE LAB', 512, 154)

  ctx.strokeStyle = 'rgba(130, 215, 208, 0.7)'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.roundRect(126, 70, 772, 168, 28)
  ctx.stroke()

  ctx.fillStyle = 'rgba(183, 227, 125, 0.82)'
  ctx.fillRect(190, 248, 644, 8)

  const texture = new THREE.CanvasTexture(logoCanvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function roundedBox(width, height, depth, radius, material) {
  const shape = new THREE.Shape()
  const x = -width / 2
  const y = -height / 2
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + height - radius)
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  shape.lineTo(x + radius, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - radius)
  shape.lineTo(x, y + radius)
  shape.quadraticCurveTo(x, y, x + radius, y)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 8,
    bevelSize: 0.08,
    bevelThickness: 0.08,
  })
  geometry.center()
  return new THREE.Mesh(geometry, material)
}

function setFinish(key) {
  state.finishKey = key
  const finish = finishPresets[key]
  carMaterials.paint.color.set(finish.color)
  carMaterials.paint.metalness = finish.metalness
  carMaterials.paint.roughness = finish.roughness
  document.querySelectorAll('.swatch').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.finish === key)
  })
}

function setView(key, animate = true) {
  state.selectedView = key
  state.cameraRig.custom = false
  const view = views[key]
  document.querySelectorAll('.view-strip button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === key)
  })
  document.querySelector('#cameraMode').textContent = 'Locked shot'
  syncCameraRigFromView(view)
  stageVideoUniforms.originY.value = state.cameraRig.lensHeight

  const destination = new THREE.Vector3(...view.position)
  const target = new THREE.Vector3(...view.target)
  camera.fov = view.fov
  camera.updateProjectionMatrix()

  if (!animate) {
    camera.position.copy(destination)
    controls.target.copy(target)
    controls.update()
    return
  }

  const startPosition = camera.position.clone()
  const startTarget = controls.target.clone()
  const started = performance.now()
  const duration = 900

  function tween(now) {
    const t = Math.min(1, (now - started) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    camera.position.lerpVectors(startPosition, destination, eased)
    controls.target.lerpVectors(startTarget, target, eased)
    controls.update()
    if (t < 1) requestAnimationFrame(tween)
  }
  requestAnimationFrame(tween)
}

function applyCameraRig() {
  const rig = state.cameraRig
  stageVideoUniforms.originY.value = rig.lensHeight
  const yaw = THREE.MathUtils.degToRad(rig.orbitDeg)
  const target = new THREE.Vector3(0, rig.aimHeight, 0)
  const destination = new THREE.Vector3(
    Math.cos(yaw) * rig.distance,
    rig.lensHeight,
    Math.sin(yaw) * rig.distance,
  )
  camera.position.copy(destination)
  controls.target.copy(target)
  camera.fov = focalLengthToFov(rig.focalLength)
  camera.updateProjectionMatrix()
  controls.update()
}

function bindCameraNavigation() {
  let spaceOrbit = false
  let pointerOverCanvas = false
  const pressedKeys = new Set()

  const isTypingTarget = (target) => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target?.tagName)
  const isViewportKeyEvent = (event) => !isTypingTarget(event.target) && (pointerOverCanvas || document.activeElement === canvas)
  const setSpaceOrbit = (enabled) => {
    spaceOrbit = enabled
    canvas.classList.toggle('is-orbiting', enabled)
    controls.enableZoom = !enabled
  }
  const resetKeyNavigation = () => {
    pressedKeys.clear()
    setSpaceOrbit(false)
  }

  canvas.tabIndex = 0
  canvas.addEventListener('pointerenter', () => {
    pointerOverCanvas = true
  })
  canvas.addEventListener('pointerleave', () => {
    pointerOverCanvas = false
    resetKeyNavigation()
  })
  canvas.addEventListener('pointerdown', () => {
    canvas.focus()
  })

  window.addEventListener('keydown', (event) => {
    if (!isViewportKeyEvent(event)) return
    if (event.code === 'KeyF' || event.code === 'KeyZ') {
      pressedKeys.add(event.code)
      return
    }
    if (event.code !== 'Space' || spaceOrbit) return
    event.preventDefault()
    setSpaceOrbit(true)
  })

  window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyF' || event.code === 'KeyZ') {
      pressedKeys.delete(event.code)
      return
    }
    if (event.code !== 'Space') return
    setSpaceOrbit(false)
  })
  window.addEventListener('blur', resetKeyNavigation)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetKeyNavigation()
  })

  canvas.addEventListener(
    'wheel',
    (event) => {
      const focalScroll = pressedKeys.has('KeyF') || pressedKeys.has('KeyZ')
      const activeModes = [
        spaceOrbit ? 'Space' : '',
        event.shiftKey ? 'Shift' : '',
        event.altKey ? 'Option' : '',
        focalScroll ? 'F/Z' : '',
      ].filter(Boolean)

      if (activeModes.length > 1) {
        event.preventDefault()
        event.stopImmediatePropagation()
        document.querySelector('#cameraMode').textContent = `Choose one: ${activeModes.join(' / ')}`
        return
      }
      if (spaceOrbit) {
        event.preventDefault()
        event.stopImmediatePropagation()
        orbitCameraFromWheel(event)
        return
      }
      if (event.shiftKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
        trimCameraHeightFromWheel(event)
        return
      }
      if (event.altKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
        tiltCameraFromWheel(event)
        return
      }
      if (focalScroll) {
        event.preventDefault()
        event.stopImmediatePropagation()
        trimFocalLengthFromWheel(event)
        return
      }
    },
    { passive: false, capture: true },
  )

  canvas.addEventListener('dblclick', () => setView(state.selectedView))

  controls.addEventListener('start', () => {
    state.cameraRig.custom = true
    document.querySelector('#cameraMode').textContent = 'Free orbit'
    document.querySelectorAll('.view-strip button').forEach((button) => button.classList.remove('is-active'))
  })
  controls.addEventListener('end', markCameraCustomFromLiveView)
}

function orbitCameraFromWheel(event) {
  const offset = camera.position.clone().sub(controls.target)
  const spherical = new THREE.Spherical().setFromVector3(offset)
  const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  spherical.theta += primaryDelta * 0.0045
  offset.setFromSpherical(spherical)
  camera.position.copy(controls.target).add(offset)
  controls.update()
  document.querySelectorAll('.view-strip button').forEach((button) => button.classList.remove('is-active'))
  markCameraCustomFromLiveView('Space orbit')
}

function trimCameraHeightFromWheel(event) {
  const amount = THREE.MathUtils.clamp(-event.deltaY * 0.0014, -0.18, 0.18)
  camera.position.y = THREE.MathUtils.clamp(camera.position.y + amount, 0.25, 2.6)
  controls.target.y = THREE.MathUtils.clamp(controls.target.y + amount * 0.55, 0.12, 1.8)
  controls.update()
  markCameraCustomFromLiveView('Height trim')
}

function tiltCameraFromWheel(event) {
  const amount = THREE.MathUtils.clamp(-event.deltaY * 0.0012, -0.14, 0.14)
  controls.target.y = THREE.MathUtils.clamp(controls.target.y + amount, 0.12, 1.8)
  controls.update()
  markCameraCustomFromLiveView('Tilt trim')
}

function trimFocalLengthFromWheel(event) {
  const current = fovToFocalLength(camera.fov)
  const amount = THREE.MathUtils.clamp(-event.deltaY * 0.035, -4, 4)
  const nextFocalLength = THREE.MathUtils.clamp(current + amount, 16, 85)
  camera.fov = focalLengthToFov(nextFocalLength)
  camera.updateProjectionMatrix()
  controls.update()
  markCameraCustomFromLiveView('Focal trim')
}

function markCameraCustomFromLiveView(label = 'Custom rig') {
  state.cameraRig.custom = true
  document.querySelector('#cameraMode').textContent = label
  syncCameraRigFromLiveCamera()
}

function syncCameraRigFromLiveCamera() {
  const offset = camera.position.clone().sub(controls.target)
  state.cameraRig.orbitDeg = Math.round(THREE.MathUtils.radToDeg(Math.atan2(camera.position.z, camera.position.x)))
  state.cameraRig.distance = Number(Math.sqrt(offset.x ** 2 + offset.z ** 2).toFixed(1))
  state.cameraRig.lensHeight = Number(camera.position.y.toFixed(2))
  state.cameraRig.aimHeight = Number(controls.target.y.toFixed(2))
  state.cameraRig.focalLength = Math.round(fovToFocalLength(camera.fov))
  stageVideoUniforms.originY.value = state.cameraRig.lensHeight
  updateCameraRigOutputs()
}

function syncCameraRigFromView(view) {
  const position = new THREE.Vector3(...view.position)
  const target = new THREE.Vector3(...view.target)
  const offset = position.clone().sub(target)
  state.cameraRig.orbitDeg = Math.round(THREE.MathUtils.radToDeg(Math.atan2(position.z, position.x)))
  state.cameraRig.distance = Number(Math.sqrt(offset.x ** 2 + offset.z ** 2).toFixed(1))
  state.cameraRig.lensHeight = Number(position.y.toFixed(2))
  state.cameraRig.aimHeight = Number(target.y.toFixed(2))
  state.cameraRig.focalLength = Math.round(fovToFocalLength(view.fov))
  updateCameraRigOutputs()
}

function updateCameraRigOutputs() {
  const rig = state.cameraRig
  document.querySelector('#cameraOrbit').value = rig.orbitDeg
  document.querySelector('#orbitOut').textContent = `${rig.orbitDeg} deg`
  document.querySelector('#cameraDistance').value = rig.distance
  document.querySelector('#distanceOut').textContent = `${rig.distance.toFixed(1)} m`
  document.querySelector('#cameraHeight').value = rig.lensHeight
  document.querySelector('#lensHeightOut').textContent = `${rig.lensHeight.toFixed(2)} m`
  document.querySelector('#cameraAimHeight').value = rig.aimHeight
  document.querySelector('#aimHeightOut').textContent = `${rig.aimHeight.toFixed(2)} m`
  document.querySelector('#cameraFocal').value = rig.focalLength
  document.querySelector('#focalOut').textContent = `${rig.focalLength} mm`
}

function focalLengthToFov(focalLength) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(CAMERA_SENSOR_WIDTH_MM / (2 * focalLength)))
}

function fovToFocalLength(fov) {
  return CAMERA_SENSOR_WIDTH_MM / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
}

function saveCurrentCameraView() {
  const nextNumber = state.customShots.length + 1
  const key = `custom-${Date.now()}`
  const shot = {
    key,
    label: `Custom ${nextNumber}`,
    position: camera.position.toArray().map((value) => Number(value.toFixed(3))),
    target: controls.target.toArray().map((value) => Number(value.toFixed(3))),
    fov: Number(camera.fov.toFixed(2)),
  }
  state.customShots = [...state.customShots, shot].slice(-6).map((saved, index) => ({
    ...saved,
    label: `Custom ${index + 1}`,
  }))
  persistCustomShots()
  renderCustomShots()
  setView(state.customShots[state.customShots.length - 1].key)
}

function renderCustomShots() {
  const wrapper = document.querySelector('#customViewGroup')
  if (!wrapper) return
  wrapper.querySelectorAll('button').forEach((button) => button.remove())
  wrapper.hidden = state.customShots.length === 0
  wrapper.style.display = state.customShots.length === 0 ? 'none' : ''

  state.customShots.forEach((shot) => {
    views[shot.key] = shot
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.view = shot.key
    button.textContent = shot.label
    button.title = `Saved camera: ${shot.label}`
    button.addEventListener('click', () => setView(shot.key))
    wrapper.append(button)
  })
}

function loadCustomShots() {
  try {
    return JSON.parse(localStorage.getItem('plateLabCustomViews') || '[]')
  } catch {
    return []
  }
}

function persistCustomShots() {
  localStorage.setItem('plateLabCustomViews', JSON.stringify(state.customShots))
}

function detectFootagePreset(label) {
  const normalized = label.toLowerCase()
  if (normalized.includes('a001a003') || normalized.includes('stitch_v01')) return 'dtla'
  if (normalized.includes('fp_c15')) return 'canyon'
  return footagePresets[state.footagePreset] ? state.footagePreset : 'canyon'
}

function applyFootagePreset(key, texture = stageVideoUniforms.map.value) {
  const preset = footagePresets[key]
  if (!preset) return
  state.footagePreset = key
  state.sourceMode = preset.sourceMode
  state.cropTop = preset.cropTop
  state.cropBottom = preset.cropBottom
  state.ceilingTop = preset.ceilingTop
  state.ceilingBottom = preset.ceilingBottom
  state.footageVertical = preset.vertical
  updateFootageFormatControls()
  applyFootageTransform(texture)
}

function markFootagePresetCustom() {
  state.footagePreset = 'custom'
  const presetSelect = document.querySelector('#footagePreset')
  if (presetSelect) presetSelect.value = 'custom'
}

function updateFootageFormatControls() {
  document.querySelector('#footagePreset').value = state.footagePreset
  document.querySelector('#sourceMode').value = state.sourceMode
  document.querySelector('#footageVertical').value = state.footageVertical
  document.querySelector('#verticalOut').textContent = `${state.footageVertical}%`
  document.querySelector('#cropTop').value = state.cropTop
  document.querySelector('#cropTopOut').textContent = `${state.cropTop}%`
  document.querySelector('#cropBottom').value = state.cropBottom
  document.querySelector('#cropBottomOut').textContent = `${state.cropBottom}%`
  document.querySelector('#ceilingTop').value = state.ceilingTop
  document.querySelector('#ceilingTopOut').textContent = `${state.ceilingTop}%`
  document.querySelector('#ceilingBottom').value = state.ceilingBottom
  document.querySelector('#ceilingBottomOut').textContent = `${state.ceilingBottom}%`
}

function loadVideoFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  document.querySelector('#fileName').textContent = file.name
  loadVideoSource(url, file.name)
}

function loadVideoUrl() {
  const url = document.querySelector('#videoUrl').value.trim()
  if (!url) return
  loadVideoSource(url, 'URL footage')
}

async function loadVideoSource(src, label) {
  video.src = src
  video.playbackRate = state.playRate
  video.load()

  const texture = new THREE.VideoTexture(video)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  stageVideoUniforms.map.value = texture
  applyFootagePreset(detectFootagePreset(label), texture)
  screenMaterial.needsUpdate = true
  ceilingMaterial.needsUpdate = true
  syncEnvironment(texture)

  setPlaybackStatus(`Loaded ${label}`)
  try {
    await video.play()
  } catch {
    setPlaybackStatus('Loaded, press play')
  }
}

function togglePlayback() {
  if (!video.src) {
    setPlaybackStatus('Load footage first')
    return
  }
  if (video.paused) {
    video.play().catch(() => setPlaybackStatus('Press play again'))
  } else {
    video.pause()
  }
}

function syncEnvironment(texture = stageVideoUniforms.map.value) {
  if (state.reflections && texture) {
    assignReflectionMap(reflectionTarget.texture)
    carMaterials.paint.envMapIntensity = 1.7
    carMaterials.chrome.envMapIntensity = 2.2
    carMaterials.glass.envMapIntensity = 1.35
  } else {
    assignReflectionMap(null)
    carMaterials.paint.envMapIntensity = 0.7
    carMaterials.chrome.envMapIntensity = 0.8
    carMaterials.glass.envMapIntensity = 0.45
  }
}

function assignReflectionMap(envMap) {
  ;[
    carMaterials.paint,
    carMaterials.glass,
    carMaterials.chrome,
    carMaterials.details,
    ...dynamicVehicleMaterials,
  ].forEach((material) => {
    material.envMap = envMap
    if ('envMapIntensity' in material && material.envMapIntensity < 1.1) material.envMapIntensity = envMap ? 1.25 : 0.45
    material.needsUpdate = true
  })
}

function applyFootageTransform(texture = stageVideoUniforms.map.value) {
  if (!texture) return
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.repeat.set(1, 1)
  texture.offset.set(0, 0)
  stageVideoUniforms.yaw.value = THREE.MathUtils.euclideanModulo(state.footageYaw / 360, 1)
  stageVideoUniforms.verticalOffset.value = THREE.MathUtils.clamp(state.footageVertical / 100, -0.5, 0.5)
  stageVideoUniforms.mode.value = state.sourceMode === 'sphere' ? 0 : 1
  stageVideoUniforms.cropTop.value = THREE.MathUtils.clamp(state.cropTop / 100, 0, 0.98)
  stageVideoUniforms.cropBottom.value = THREE.MathUtils.clamp(state.cropBottom / 100, stageVideoUniforms.cropTop.value + 0.01, 1)
  stageVideoUniforms.ceilingTop.value = THREE.MathUtils.clamp(state.ceilingTop / 100, 0, 0.98)
  stageVideoUniforms.ceilingBottom.value = THREE.MathUtils.clamp(
    state.ceilingBottom / 100,
    stageVideoUniforms.ceilingTop.value + 0.01,
    1,
  )
  texture.needsUpdate = true
  screenMaterial.needsUpdate = true
  ceilingMaterial.needsUpdate = true
}

function setPlaybackStatus(message) {
  document.querySelector('#playbackStatus').textContent = message
}

function makeFallbackTexture() {
  const canvasTexture = document.createElement('canvas')
  canvasTexture.width = 2048
  canvasTexture.height = 1024
  const ctx = canvasTexture.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, canvasTexture.width, canvasTexture.height)
  gradient.addColorStop(0, '#15252f')
  gradient.addColorStop(0.34, '#2f695d')
  gradient.addColorStop(0.62, '#b7b15a')
  gradient.addColorStop(1, '#802a35')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvasTexture.width, canvasTexture.height)

  for (let i = 0; i < 220; i += 1) {
    const x = Math.random() * canvasTexture.width
    const y = Math.random() * canvasTexture.height
    const r = 30 + Math.random() * 130
    const hue = 170 + Math.random() * 80
    ctx.fillStyle = `hsla(${hue}, 70%, 62%, ${0.03 + Math.random() * 0.08})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '700 74px Inter, Arial, sans-serif'
  ctx.fillText('LOAD YOUR 360 FOOTAGE', 116, 150)
  ctx.font = '400 38px Inter, Arial, sans-serif'
  ctx.fillText('Amazon MGM Stage 15 replica baseline: 80 ft diameter / 26 ft high', 116, 214)

  const texture = new THREE.CanvasTexture(canvasTexture)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  return texture
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop()
    if (child.geometry) child.geometry.dispose()
  }
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = canvas
  renderer.setSize(clientWidth, clientHeight, false)
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
}

function animate() {
  resizeRenderer()
  controls.update()
  if (state.reflections) {
    carGroup.visible = false
    reflectionCamera.position.set(0, 1.05, 0)
    reflectionCamera.update(renderer, scene)
    carGroup.visible = true
  }
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}

window.addEventListener('resize', resizeRenderer)
animate()
