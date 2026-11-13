import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { startShaderWarmup, WarmMaterialCache, type ShaderWarmup } from './shaderWarmup'
import { addAfterEffect, Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html, TrackballControls } from '@react-three/drei'
import type { TrackballControls as TrackballImpl } from 'three-stdlib'
import * as T from 'three'
import { travelPosition } from './camera'
import { turnSiteLook } from './look'
import { checkedViewpointStep,viewpointCoordinates,type VisitStep,type ViewpointOffset } from '../lib/surfaceExplorer'
import { advanceAstronaut,launchAstronaut,standingAstronaut,walkingVelocity,motionDelta,ASTRONAUT_EYE_HEIGHT_M,CROUCH_EYE_HEIGHT_M,WALK_SPEED_MPS,type AstronautMotion } from '../lib/astronautMotion'
import { arrivalRadius, type VisitPose } from '../lib/visit'
import { VisitScale } from './VisitScale'
import { SurveyFlags } from './SurveyFlags'
import { AstronautTrail } from './AstronautTrail'
import { SurfaceEquipment } from './SurfaceEquipment'
import { getEquipmentAdjust,useEquipmentAdjust } from './equipmentAdjust'
import { SurfaceOutpost } from './SurfaceOutpost'
import { SurfaceRocks } from './SurfaceRocks'
import { SurfaceFocus } from './SurfaceFocus'
import { AstronautPresence } from './AstronautPresence'
import { LunarDust } from './LunarDust'
import { LandingSequence, LANDED_STATE, type LandingRun, type LandingStage } from './LandingSequence'
import type { LanderState } from '../lib/contracts'
import { BuriFigure, type BuriPresence } from './BuriFigure'
import type { CharacterState } from '../lib/characterController'
import { TerrainOverlay, type TerrainOverlayInfo, type TerrainOverlaySettings } from './TerrainOverlay'
import { FieldMarkers, type FieldMarker } from './FieldMarkers'
import { RouteTrail } from './RouteTrail'
import { DEFAULT_SURFACE_PREFERENCES,type SurfacePreferences,type SurfaceFocus as Focus } from '../lib/surfacePolish'
import { useReducedMotion } from '../useReducedMotion'
import type { SurfaceObject } from '../lib/surfaceMission'
import { AssessmentTarget } from './AssessmentTarget'
import { appendTrail,DEFAULT_EQUIPMENT,type TrailPoint,type JournalPhoto,type Equipment } from '../lib/expedition'
import { parseRowT } from '../lib/sim'
import { MODEL_VERSION } from '../modelIdentity'
import { facetReading,PROBE_RANGE_M,type FieldReading,type FieldResult,type FieldRequest } from '../lib/fieldwork'
import { loadTerrain, LUNAR_RADIUS_M, TERRAIN_POLICY, nearMissionSite, type TerrainStore } from './terrain'
import { LunarTerrain, type TerrainView } from './LunarTerrain'
import { FieldGloves } from './FieldGloves'
import { visitTerrainSampler, type TerrainSampler } from './terrainSampler'
import { QualityController, SurfaceResolutionController, qualityPlan, type QualityLevel, type QualityReport, type QualitySetting } from './renderQuality'
import { probeGraphics, startQuality } from './graphicsProbe'
import { pushOut, reachableTarget, steerBearing, surfaceObstacles } from './obstacles'
import { SurfaceLocate } from './SurfaceFocus'
import { SuitLamp } from './SuitLamp'
// Log depth in metres (before any program compiles): near-field parts no longer fight the regolith.
import './logDepth'
import { SurfaceGrounding } from './SurfaceGrounding'
import {
  sitePosition,
  azElToDir,
  localFrame,
  type Site,
  type Mission,
  type EphRow,
} from '../data'
import type { Layers } from '../SitesPanel'
import {
  attitudeAt,
  BODY_COLORS,
  loadSpace,
  expandSpace,
  hasBodies,
  orbitPoints,
  positionsAt,
  UNIT_KM,
  type BodyData,
  type FlyRequest,
  type SpaceData,
  type SpaceOptions,
} from './ephemeris'

export type SimClock = {
  row: number
  playing: boolean
  speed: number
  direction: 1 | -1
  realtime?: boolean
}
const sceneCamera = {
  fov: 42,
  near: 0.001,
  far: 40_000_000,
  position: [0, 0, 6] as [number, number, number],
}
export type SceneProps = {
  onUnavailable?: () => void
  onTerrainView?: (view: TerrainView) => void
  onArrival?: (progress: number | null) => void
  /** Landing simulation stage after an arrival flight. */
  onLanding?: (stage: LandingStage) => void
  /** Lander status light: power state from the Mission Visor. */
  landerStatus?: 'ok' | 'warn' | 'fail' | 'none'
  /** Chader Buri standing on the surface, driven by her conversation state. */
  buri?: { state: CharacterState; targets: { sun: { az: number; el: number }; earth: { az: number; el: number }; skyline: { az: number; el: number } }; onSelect: () => void } & BuriPresence
  /** Spatial terrain overlay draped on the measured DEM around the visitor (off by default). */
  terrainOverlay?: TerrainOverlaySettings
  /** What the overlay draws and from which DEM product/resolution (null when it is off). */
  onTerrainOverlayInfo?: (info: TerrainOverlayInfo | null) => void
  /** Journal photos, notes and flags shown as pins on the measured ground. */
  fieldMarkers?: FieldMarker[]
  routeLine?: { eastM: number; northM: number }[]
  onMarkerSelect?: (id: string) => void
  scaleBearing?: number | null
  suspended?: boolean
  clock: React.RefObject<SimClock>
  site: Site
  sites: Site[]
  missions: Mission[]
  onSelect: (slug: string) => void
  onMission: (index: number) => void
  layers: Layers
  sunRows: EphRow[]
  fly: FlyRequest | null
  options: SpaceOptions
  onFocus: (name: string) => void
  onFly: (name: string) => void
  /** called with the standing observer's heading/pitch while visiting a site,
   * null when the visit ends; throttled so React can drive a compass */
  onVisit?: (v: VisitPose | null) => void
  visitStep?:VisitStep|null
  fieldRequest?:FieldRequest|null
  fieldFlags?:FieldReading[]
  onFieldResult?:(result:FieldResult)=>void
  trailVisible?:boolean
  assessmentTarget?:boolean
  surfacePreferences?:SurfacePreferences
  onSurfaceFocus?:(focus:Focus|null)=>void
  surfaceInspectorOpen?:boolean
  activeSurfaceObject?:SurfaceObject|null
  onSurfaceObject?:(object:SurfaceObject,payloadIndex?:number)=>void
  onEquipment?:(equipment:Equipment)=>void
  equipment?:Equipment
  photoRequest?:number
  datasetId?:string
  onPhoto?:(photo:JournalPhoto)=>void
  onPhotoError?:(message:string)=>void
  focusMission: Mission | null
  /** Draw the visitor's pressure-suit gloves at the bottom corners while on the surface. */
  fieldGloves?: boolean
  /** On the surface, a click locks the pointer and mouse movement turns the view (Escape releases). */
  pointerLook?: boolean
  onPointerLock?: (locked: boolean) => void
  /** Receives a DEM height sampler (metres, as TerrainStore.bestHeight) for east/north offsets in metres
   * from the visit target while a visit has terrain; null when the visit ends. */
  onTerrainSampler?: (sample: TerrainSampler | null) => void
  /** Guided walk to an east/north offset (metres from the visit target); a new id starts a new walk. */
  goTo?: { id: number; eastM: number; northM: number } | null
  onGoTo?: (id: number, state: 'walking' | 'arrived' | 'blocked' | 'cancelled') => void
  /** Ignore walking, jumping and guided walks (looking still works). */
  movementPaused?: boolean
  /** A graphics failure the scene detects itself (space data failed to load, context lost and not restored). */
  onGraphicsFailure?: (error: unknown) => void
  /** Render quality: 'auto' (default) adapts to sustained frame time; the others fix a level. Presentation only. */
  quality?: QualitySetting
  /** Current quality level and measured frame time, at most once a second. */
  onQuality?: (s: QualityReport) => void
  /** Strength of presentation motion 0..1 (head bob and sway, glove sway, landing camera shake). Without it the
   * head bob follows the surface "motion" preference as before and the gloves sway at full strength. */
  motionScale?: number
  /** A deliberate "locate this" cue (ground ring, beacon, rim glow) on the equipment an activity concerns. */
  highlightObject?: 'lander' | 'antenna' | 'panel' | null
  /** Illustrative helmet lamp (display only, adds no solar generation). Default off. */
  suitLamp?: boolean
}

const vertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){vUv=uv;vN=normal;vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
#include <logdepthbuf_vertex>
}
`
const fragment = `
#include <logdepthbuf_pars_fragment>
uniform sampler2D surfaceMap; uniform sampler2D cloudMap; uniform sampler2D reliefMap; uniform float mapped; uniform float moon;
uniform vec3 sunlight; uniform vec3 eye; uniform vec3 axes; uniform vec3 tint; uniform float earth; uniform float sun;
uniform float inspectionOn; uniform vec3 inspectionDirection;
uniform float terrainActive; uniform vec3 terrainDirection; uniform float terrainCos;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){
 #include <logdepthbuf_fragment>
 if(moon>0.5 && terrainActive>0.5 && dot(normalize(vP),terrainDirection)>terrainCos) discard;
 vec3 n=normalize(vN/axes); float mu=max(dot(n,normalize(eye-vP*axes)),0.0);
 if(moon>0.5){vec3 bump=texture2D(reliefMap,vUv).xyz*2.0-1.0;vec3 tangent=normalize(vec3(n.z,0.000001,-n.x));vec3 bitangent=cross(n,tangent);n=normalize(n*max(0.1,bump.z)+0.32*(bump.x*tangent+bump.y*bitangent));}
 float day=max(dot(n,sunlight),0.0);
 vec3 albedo=tint;
 if(mapped>0.5) albedo=texture2D(surfaceMap,vUv).rgb;
 if(earth>0.5){vec4 clouds=texture2D(cloudMap,vUv);albedo=mix(albedo,clouds.rgb,clouds.a*0.92);}
 // A small display fill preserves the silhouette; it is not a night-side irradiance estimate.
 vec3 col=albedo*(0.012+1.6*pow(day,0.8));
 if(moon>0.5) col+=albedo*2.5*inspectionOn*exp(-length(vP-inspectionDirection)*length(vP-inspectionDirection)/0.008)*(1.0-smoothstep(-0.015,0.0,dot(n,sunlight)));
 if(earth>0.5) col+=vec3(0.12,0.38,0.8)*pow(1.0-mu,4.0)*smoothstep(-0.08,0.4,dot(n,sunlight))*0.5;

 gl_FragColor=vec4(col,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}
`
const ringFragment = `
#include <logdepthbuf_pars_fragment>
uniform vec3 sunlight; uniform vec3 axes; uniform sampler2D ringMap; varying vec3 vP;
void main(){
 #include <logdepthbuf_fragment>
 float r=length(vP.xy); vec4 band=texture2D(ringMap,vec2((r-1.24)/1.03,0.5));
 // Rings lie in the body's equator. Cast the planet's ellipsoidal silhouette onto them.
 vec3 p=vec3(vP.x,0.0,-vP.y); vec3 ray=normalize(sunlight/axes); float along=dot(p,ray);
 float shadow=along<0.0 ? mix(0.08,1.0,smoothstep(0.99,1.025,length(p-along*ray))) : 1.0;
 float light=0.45+0.9*abs(sunlight.y);
 gl_FragColor=vec4(band.rgb*light*shadow,band.a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}
`

export type Runtime = {
  positions: Map<string, T.Vector3>
  origin: T.Vector3
  focus: string
  displayRadii: Map<string, number>
  labels: number[][]
  sky: boolean
  dragged: boolean
  equipmentDrag:boolean
  inspectionDrag: boolean
  controls: TrackballImpl | null
  local: boolean
  surfaceOffset: T.Vector3
  terrainReady: boolean
  terrainDirection: T.Vector3
  terrainCos: number
  inspectionDirection: T.Vector3
  inspectionEnabled: boolean
  terrainStore: TerrainStore | null
  terrainMesh:T.Mesh|null
  systemView: boolean
  /** surface-visit mode: camera stands on the site, drag looks around */
  visit: boolean
  /** set when a visit flight is inbound; consumed when the flight lands */
  visitQueued: boolean
  /** yaw (bearing rad, 0 = north) / pitch (rad) of the standing observer */
  visitLook: { yaw: number; pitch: number } | null
  /** ENU basis of the visited site, body frame */
  visitAnchor: { north: T.Vector3; east: T.Vector3; up: T.Vector3 } | null
  visitOffset:ViewpointOffset
  movementBlocked:boolean
  astronaut:AstronautMotion
  walkInput:{forward:number;right:number}
  crouched:boolean
  eyeHeightM:number
  trail:TrailPoint[]
  trailOrigin:T.Vector3|null
  trailRevision:number
  trailDistanceM:number
  trailStepCount:number
  /** An arrival flight that should end with the landing simulation. */
  landingQueued:boolean
  /** The landing simulation in progress (start null = waiting for terrain). */
  landing:LandingRun|null
  /** The one canonical lander transform, read by the exhibit, plume, dust and markers. */
  lander:LanderState
  /** Plume-surface interaction: radial dust while the engine is low over the pad. */
  dustEmitter:{eastM:number;northM:number;strength:number}|null
  /** One-off dust burst (touchdown). */
  dustBurst:{id:number;eastM:number;northM:number;count:number}|null
  /** Something that casts sunlight shadows changed; the static shadow map needs one refresh. */
  shadowDirty:boolean
  /** Every surface material's shader program has finished linking in the background (see the warm-up in World). */
  shadersWarm:boolean
}

function placeLabel(
  node: HTMLButtonElement,
  position: T.Vector3,
  camera: T.Camera,
  size: { width: number; height: number },
  runtime: Runtime,
  offset = 14,
  connect = true,
) {
  const p = position.clone().project(camera),
    x = ((p.x + 1) * size.width) / 2,
    y = ((1 - p.y) * size.height) / 2
  const width = node.textContent!.length * 7 + 22,
    height = 25
  const bottom =
    size.width < 768
      ? size.height - (runtime.focus === 'Moon' && !runtime.sky ? 325 : 240)
      : size.height - 80
  if (p.z < -1 || p.z > 1 || x < 0 || x > size.width || y < 130 || y > bottom)
    return false
  for (let i = 0; i < 12; i++) {
    const dx = i % 2 === 0 ? 12 : -width - 12,
      dy = offset + Math.floor(i / 2) * 29
    const box = [x + dx, y + dy, width, height]
    if (
      box[0] < 8 ||
      box[0] + width > size.width - 8 ||
      box[1] + height > bottom
    )
      continue
    if (
      runtime.labels.some(
        (b) =>
          box[0] < b[0] + b[2] + 5 &&
          box[0] + width + 5 > b[0] &&
          box[1] < b[1] + b[3] + 3 &&
          box[1] + height + 3 > b[1],
      )
    )
      continue
    runtime.labels.push(box)
    node.style.transform = `translate(${dx}px,${dy}px)`
    node.style.setProperty('--lead-x', `${-dx}px`)
    node.style.setProperty('--lead-y', `${-dy}px`)
    node.style.setProperty('--lead-length', `${Math.hypot(dx, dy)}px`)
    node.style.setProperty('--lead-angle', `${Math.atan2(dy, dx)}rad`)
    node.style.setProperty('--lead-opacity', connect ? '.45' : '0')
    return true
  }
  return false
}

function Sky({ deep,runtime }: { deep: boolean;runtime:Runtime }) {
  const { scene } = useThree()
  // An illustrative directional backdrop, centred on the camera at every scale.
  // A world-fixed shell becomes a visible ball once the camera travels outside it.
  const tiers = useMemo(() => {
    const build = (count: number, size: number) => {
      const pos = new Float32Array(count * 3)
      const col = new Float32Array(count * 3)
      const radius = 300000
      for (let i = 0; i < count; i++) {
        // uniform direction on the sphere
        const u = Math.random() * 2 - 1
        const phi = Math.random() * Math.PI * 2
        const s = Math.sqrt(1 - u * u)
        pos[i * 3] = radius * s * Math.cos(phi)
        pos[i * 3 + 1] = radius * u
        pos[i * 3 + 2] = radius * s * Math.sin(phi)
        // mostly white, a few warm/cool stars
        const w = Math.random()
        if (w < 0.08) {
          col[i * 3] = 1
          col[i * 3 + 1] = 0.82
          col[i * 3 + 2] = 0.62
        } else if (w < 0.16) {
          col[i * 3] = 0.72
          col[i * 3 + 1] = 0.82
          col[i * 3 + 2] = 1
        } else {
          const v = 0.75 + Math.random() * 0.25
          col[i * 3] = v
          col[i * 3 + 1] = v
          col[i * 3 + 2] = v
        }
      }
      const geometry = new T.BufferGeometry()
      geometry.setAttribute('position', new T.BufferAttribute(pos, 3))
      geometry.setAttribute('color', new T.BufferAttribute(col, 3))
      const material = new T.PointsMaterial({
        size,
        sizeAttenuation: false,
        vertexColors: true,
        // Draw before opaque bodies, without writing/testing depth. Distant planets
        // must cover the backdrop even when they are beyond this shell's radius.
        transparent: false,
        depthTest: false,
        depthWrite: false,
      })
      const points = new T.Points(geometry, material)
      points.renderOrder = -1000
      points.frustumCulled = false
      return points
    }
    return [build(7400, 1.1), build(1900, 1.9), build(300, 2.8)]
  }, [])
  useEffect(() => {
    scene.background = new T.Color('#000002')
    for (const p of tiers) scene.add(p)
    return () => {
      scene.background = null
      for (const p of tiers) {
        scene.remove(p)
        p.geometry.dispose()
        ;(p.material as T.Material).dispose()
      }
    }
  }, [scene, tiers])
  useEffect(() => {
    for (const p of tiers) (p.material as T.PointsMaterial).color.setScalar(deep ? 1 : 0.55)
  }, [deep, tiers])
  useFrame(({camera})=>{
    for (const p of tiers){p.position.copy(camera.position);(p.material as T.PointsMaterial).color.setScalar((deep?1:.55)*(runtime.visit ? .025 : 1))}
  })
  return null
}

function Planet({
  body,
  runtime,
  clock,
  options,
  onFly,
  children,
}: {
  body: BodyData
  runtime: Runtime
  clock: React.RefObject<SimClock>
  options: SpaceOptions
  onFly: (name: string) => void
  children?: React.ReactNode
}) {
  const { invalidate } = useThree()
  const group = useRef<T.Group>(null),
    surface = useRef<T.Group>(null),
    tag = useRef<HTMLButtonElement>(null)
  // Html commits through a separate React root, sometimes after the canvas
  // has gone idle. Position its label on that commit, before showing it.
  const attachTag=useCallback((node:HTMLButtonElement|null)=>{
    tag.current=node
    if(node)invalidate()
  },[invalidate])
  // Suspense can reveal streamed textures after a paused flight has settled.
  // Layout effects run again on reveal: repaint after refs/frame subscriptions
  // are restored, without advancing time or keeping the render loop running.
  useLayoutEffect(()=>{
    invalidate()
    const frame=requestAnimationFrame(()=>invalidate())
    return()=>cancelAnimationFrame(frame)
  },[invalidate,body.name])
  const texturePath =
    body.name === 'Earth' ? '/textures/earth_atmos_2048.jpg' : body.texture
  // A white 1x1 texture keeps the shader valid for bodies with a documented color model.
  const white = useMemo(() => {
    const t = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    t.needsUpdate = true
    return t
  }, [])
  const map = useLoader(
    T.TextureLoader,
    texturePath ?? '/textures/space/moon-map.jpg',
  )
  const clouds = useLoader(T.TextureLoader, '/textures/earth_clouds_1024.png')
  const image = map.image as { width: number; height: number }
  if (texturePath && image.width !== image.height * 2)
    throw new Error(`Surface map is not equirectangular: ${body.name}`)
  const relief = useLoader(T.TextureLoader, '/textures/moon_normal.png')
  const ringMap = useLoader(T.TextureLoader, '/textures/space/saturn-rings.png')
  ringMap.colorSpace = T.SRGBColorSpace
  map.colorSpace = T.SRGBColorSpace
  clouds.colorSpace = T.SRGBColorSpace
  const material = useMemo(
    () =>
      new T.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          surfaceMap: { value: texturePath ? map : white },
          cloudMap: { value: clouds },
          reliefMap: { value: relief },
          moon: { value: body.name === 'Moon' ? 1 : 0 },
          mapped: { value: texturePath ? 1 : 0 },
          sunlight: { value: new T.Vector3() },
          eye: { value: new T.Vector3() },
          axes: {
            value: new T.Vector3(
              body.radiiKm[0] / body.radiusKm,
              body.radiiKm[2] / body.radiusKm,
              body.radiiKm[1] / body.radiusKm,
            ),
          },
          tint: { value: new T.Color(BODY_COLORS[body.name] ?? '#bbb9b0') },
          earth: { value: body.name === 'Earth' ? 1 : 0 },
          sun: { value: body.name === 'Sun' ? 1 : 0 },
          inspectionOn: { value: 0 },
          inspectionDirection: { value: runtime.inspectionDirection },
          terrainActive: { value: 0 },
          terrainDirection: { value: runtime.terrainDirection },
          terrainCos: { value: 1 },
        },
      }),
    [map, clouds, relief, white, texturePath, body.name],
  )
  // Preserve the credited texture; fine granulation is illustrative display detail.
  const sunExposure = useMemo(() => ({ value: 0 }), [])
  const exposureReady = useRef(false)
  const glareExtent = useRef(12)
  const glareSprite = useRef<T.Sprite>(null)
  const sunMaterial = useMemo(() => {
    if (body.name !== 'Sun') return null
    const surface = new T.MeshBasicMaterial({ map, toneMapped: false })
    surface.onBeforeCompile = (shader) => {
      shader.uniforms.sunExposure = sunExposure
      shader.fragmentShader = 'uniform float sunExposure;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Continuous spherical coordinates avoid a texture-seam in the added grain.
        float longitude = vMapUv.x * 6.28318530718;
        float latitude = vMapUv.y * 3.14159265359;
        vec3 spherePoint = vec3(sin(latitude) * cos(longitude),
          cos(latitude), sin(latitude) * sin(longitude));
        vec3 grainPoint = spherePoint * 820.0;
        vec3 grainCell = floor(grainPoint);
        vec3 grainBlend = fract(grainPoint);
        grainBlend = grainBlend * grainBlend * (3.0 - 2.0 * grainBlend);
        float granulation = 0.0;
        for (int gx = 0; gx < 2; gx++)
          for (int gy = 0; gy < 2; gy++)
            for (int gz = 0; gz < 2; gz++) {
              vec3 corner = vec3(float(gx), float(gy), float(gz));
              vec3 weights = mix(vec3(1.0) - grainBlend, grainBlend, corner);
              float grain = fract(sin(dot(grainCell + corner,
                vec3(127.1, 311.7, 74.7))) * 43758.5453);
              granulation += grain * weights.x * weights.y * weights.z;
            }
        diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.18));
        diffuseColor.rgb *= 0.78 + 0.44 * granulation;
        diffuseColor.rgb *= vec3(1.0, 0.86, 0.62);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(5.0, 4.4, 3.2), sunExposure);
        `,
      )
    }
    surface.customProgramCacheKey = () => 'sun-granulation-v1'
    return surface
  }, [body.name, map, sunExposure])
  useEffect(() => () => sunMaterial?.dispose(), [sunMaterial])
  const ringMaterial = useMemo(
    () =>
      new T.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: ringFragment,
        transparent: true,
        side: T.DoubleSide,
        depthWrite: false,
        uniforms: {
          sunlight: material.uniforms.sunlight,
          axes: material.uniforms.axes,
          ringMap: { value: ringMap },
        },
      }),
    [material, ringMap],
  )
  const glow = useMemo(() => {
    const size = 1024,
      canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const c = canvas.getContext('2d')!,
      pixels = c.createImageData(size, size)
    // A narrow gold limb and compact amber corona, inspired by the supplied reference.
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const radius =
          (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) * 8) / size
        const altitude = Math.max(0, radius - 1)
        const limb = Math.exp(-altitude * 48)
        const halo = Math.min(1, limb * 0.8 + Math.exp(-altitude * 3.8) * 0.48)
        const edge = 1 - Math.min(1, Math.max(0, (radius - 3.3) / 0.7))
        const warmth = 1 - Math.exp(-altitude * 9),
          i = (y * size + x) * 4
        pixels.data.set(
          [255, 174 - 74 * warmth, 45 - 30 * warmth, 255 * halo * edge],
          i,
        )
      }
    c.putImageData(pixels, 0, 0)
    const texture = new T.CanvasTexture(canvas)
    texture.colorSpace = T.SRGBColorSpace
    return texture
  }, [])
  const glare = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(512, 512)
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const dx = (x + 0.5 - 256) / 256, dy = (y + 0.5 - 256) / 256
        const r = Math.hypot(dx, dy), angle = Math.atan2(dy, dx)
        const core = Math.exp(-r * r * 18)
        const halo = 0.34 * Math.exp(-r * 6)
        const rays = Math.pow(Math.abs(Math.cos(angle * 6)), 28) *
          0.16 * Math.exp(-r * 4) * (1 - Math.exp(-r * 24))
        const fade = 1 - T.MathUtils.smoothstep(r, 0.8, 1)
        const warm = T.MathUtils.smoothstep(r, 0.04, 0.35)
        pixels.data.set([255, 230 - warm * 110, 180 - warm * 160,
          255 * Math.min(1, core + halo + rays) * fade], (y * 512 + x) * 4)
      }
    context.putImageData(pixels, 0, 0)
    const texture = new T.CanvasTexture(canvas)
    texture.colorSpace = T.SRGBColorSpace
    return texture
  }, [])
  useEffect(() => () => glare.dispose(), [glare])
  useEffect(
    () => () => {
      material.dispose()
      ringMaterial.dispose()
      white.dispose()
      glow.dispose()
    },
    [material, ringMaterial, white, glow],
  )
  const q = new T.Quaternion(),
    eye = new T.Vector3(),
    delta = new T.Vector3(),
    ray = new T.Vector3()
  useFrame(({ camera, size, invalidate }, frameDelta) => {
    material.uniforms.terrainActive.value =
      body.name === 'Moon' && runtime.terrainReady ? 1 : 0
    material.uniforms.terrainCos.value = runtime.terrainCos
    if (!group.current || !surface.current) return
    const position = runtime.positions.get(body.name)!
    group.current.position.copy(position).sub(runtime.origin)
    attitudeAt(body, clock.current.row, q)
    surface.current.quaternion.copy(q)
    const distance = camera.position.distanceTo(group.current.position),
      real = body.radiusKm / UNIT_KM
    const pixel =
      (2 *
        distance *
        Math.tan(((camera as T.PerspectiveCamera).fov * Math.PI) / 360)) /
      size.height
    // Optional display enlargement; physical radii and mission geometry stay unchanged.
    const canEnhance =
      body.parent === 'Sun' ||
      body.name === 'Sun' ||
      body.parent === runtime.focus ||
      body.name === runtime.focus
    let scale =
      options.enhanced && canEnhance && distance > real * 100
        ? Math.max(
            real * (body.name === 'Sun' && !runtime.sky ? 1.45 : 1),
            pixel * 2.2,
          )
        : real
    if (body.name === 'Sun') {
      const enhancement = options.enhanced && !runtime.sky
        ? T.MathUtils.smoothstep(distance / real, 70, 130) : 0
      scale = T.MathUtils.lerp(real, Math.max(real * 1.45, pixel * 2.2), enhancement)
    }
    runtime.displayRadii.set(body.name, scale)
    if (body.name === 'Sun') {
      // Camera glare is an exposure effect, not an enlargement of the physical Sun.
      const diameterPixels = (2 * scale) / pixel
      const targetExposure = 1 - T.MathUtils.smoothstep(diameterPixels, 100, 380)
      if (!exposureReady.current) {
        sunExposure.value = targetExposure
        glareExtent.current = Math.max(12, (pixel * 100) / scale)
        exposureReady.current = true
      }
      sunExposure.value = T.MathUtils.damp(
        sunExposure.value, targetExposure, 10, Math.min(frameDelta, 0.05),
      )
      if (Math.abs(sunExposure.value - targetExposure) > 0.001) invalidate()
      else sunExposure.value = targetExposure
      const exposure = sunExposure.value
      if (glareSprite.current) {
        ;(glareSprite.current.material as T.SpriteMaterial).opacity = exposure
        const extent = Math.max(12, (pixel * 100) / scale)
        glareExtent.current = T.MathUtils.damp(
          glareExtent.current, extent, 10, Math.min(frameDelta, 0.05),
        )
        if (Math.abs(glareExtent.current - extent) > 0.001) invalidate()
        else glareExtent.current = extent
        glareSprite.current.scale.set(glareExtent.current, glareExtent.current, 1)
      }
    }
    surface.current.scale.set(
      (body.radiiKm[0] / body.radiusKm) * scale,
      (body.radiiKm[2] / body.radiusKm) * scale,
      (body.radiiKm[1] / body.radiusKm) * scale,
    )
    q.invert()
    material.uniforms.sunlight.value
      .copy(runtime.positions.get('Sun')!)
      .sub(position)
      .normalize()
      .applyQuaternion(q)
    material.uniforms.eye.value
      .copy(camera.position)
      .sub(group.current.position)
      .applyQuaternion(q)
      .divideScalar(scale)
    if (tag.current) {
      const satellite = body.parent !== 'Sun' && body.name !== 'Sun'
      let visible =
        options.names && !runtime.visit && !runtime.visitQueued && !runtime.landing &&
        (body.name === runtime.focus ||
          !satellite ||
          body.parent === runtime.focus ||
          distance < real * 80)
      eye.copy(camera.position).add(runtime.origin)
      ray.copy(position).sub(eye).normalize()
      // Hide labels eclipsed by another disk, using the same display radii as the rendered scene.
      for (const [name, p] of runtime.positions) {
        if (!visible || name === body.name) continue
        delta.copy(p).sub(eye)
        const t = delta.dot(ray),
          radius = runtime.displayRadii.get(name) ?? 0
        if (
          t > 0 &&
          t < distance &&
          delta.addScaledVector(ray, -t).lengthSq() < radius * radius
        )
          visible = false
      }
      if (visible)
        visible = placeLabel(
          tag.current,
          group.current.position,
          camera,
          size,
          runtime,
          Math.max(12, scale / pixel + 9),
          scale / pixel < 15,
        )
      tag.current.style.visibility = visible ? 'visible' : 'hidden'
    }
  })
  material.uniforms.inspectionOn.value = options.inspectionLight ? 1 : 0
  const inspect = (
    e: import('@react-three/fiber').ThreeEvent<PointerEvent>,
  ) => {
    if (
      body.name !== 'Moon' ||
      runtime.terrainReady ||
      !options.inspectionLight ||
      !surface.current
    )
      return
    invalidate()
    e.stopPropagation()
    runtime.inspectionDrag = true
    if (runtime.controls) runtime.controls.enabled = false
    material.uniforms.inspectionDirection.value
      .copy(surface.current.worldToLocal(e.point.clone()))
      .normalize()
  }
  const click = () => onFly(body.name)
  return (
    <group
      ref={group}
      position={runtime.positions.get(body.name)!.clone().sub(runtime.origin)}
    >
      <group
        ref={surface}
        quaternion={attitudeAt(body, clock.current.row)}
        scale={[
          body.radiiKm[0] / UNIT_KM,
          body.radiiKm[2] / UNIT_KM,
          body.radiiKm[1] / UNIT_KM,
        ]}
      >
        <mesh
          raycast={function(this:T.Mesh,ray,hits){ if(body.name !== 'Moon' || !runtime.visit) T.Mesh.prototype.raycast.call(this,ray,hits) }}
          onClick={(e) => {
            if (body.name === 'Moon' && runtime.terrainReady) return
            e.stopPropagation()
            if (
              e.delta > 3 ||
              runtime.dragged ||
              (body.name === 'Moon' && options.inspectionLight)
            )
              return
            click()
          }}
          onPointerDown={inspect}
          onPointerMove={(e) => {
            if (runtime.inspectionDrag && e.buttons) inspect(e)
          }}
          onPointerOver={() => {
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto'
          }}
          material={sunMaterial ?? material}
        >
          <sphereGeometry
            args={[
              1,
              body.name === 'Moon' ? 128 : 80,
              body.name === 'Moon' ? 96 : 64,
            ]}
          />
        </mesh>
        {body.name === 'Saturn' && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            material={ringMaterial}
            onClick={(e) => {
              e.stopPropagation()
              if (e.delta > 3 || runtime.dragged) return
              click()
            }}
          >
            <ringGeometry args={[1.24, 2.27, 192, 1]} />
          </mesh>
        )}
        {body.name === 'Sun' && (
          <sprite ref={glareSprite} scale={[12, 12, 1]}>
            <spriteMaterial map={glare} color={[3.5, 1.0, 0.35]}
              toneMapped={false} transparent blending={T.AdditiveBlending}
              depthWrite={false} />
          </sprite>
        )}
        {body.name === 'Sun' && (
          <sprite scale={[8, 8, 1]}>
            <spriteMaterial
              map={glow}
              color={[2.8, 0.95, 0.3]}
              toneMapped={false}
              transparent
              blending={T.AdditiveBlending}
              depthWrite={false}
            />
          </sprite>
        )}
        {children}
      </group>
      <Html zIndexRange={[7, 0]} wrapperClass="scene-label-anchor" style={{pointerEvents:'none'}}>
        <button
          ref={attachTag}
          data-body-label={body.name}
          className="space-label"
          onClick={click}
          style={
            {
              '--body-color': BODY_COLORS[body.name] ?? '#bed3e1',
              visibility:'hidden',
            } as React.CSSProperties
          }
        >
          {body.name}
        </button>
      </Html>
    </group>
  )
}

const CRATERS: [string, number, number][] = [
  ['Shackleton', -89.67, 129.78],
  ['De Gerlache', -88.5, 275],
  ['Faustini', -87.3, 77],
  ['Shoemaker', -88.1, 45],
  ['Haworth', -86.7, 354],
  ['Nobile', -85.2, 53.8],
  ['Malapert', -85.99, 2.06],
  ['Amundsen', -84.5, 82.8],
]
function SurfaceTag({
  name,
  lat,
  lon,
  active,
  visible,
  onClick,
  runtime,
  nearOnly = false,
  heightM = 0,
}: {
  name: string
  lat: number
  lon: number
  active: boolean
  visible: boolean
  onClick: () => void
  runtime: Runtime
  nearOnly?: boolean
  heightM?: number
}) {
  const marker = useRef<T.Group>(null),
    label = useRef<HTMLButtonElement>(null),
    dot = useRef<T.Mesh>(null)
  const invalidate=useThree(s=>s.invalidate)
  const attachLabel=useCallback((node:HTMLButtonElement|null)=>{
    label.current=node
    if(node)invalidate()
  },[invalidate])
  const pos = useMemo(
    () =>
      new T.Vector3(
        ...sitePosition(lat, lon, 1 + (heightM + 20) / LUNAR_RADIUS_M),
      ),
    [lat, lon, heightM],
  )
  const p = new T.Vector3(),
    normal = new T.Vector3(),
    center = new T.Vector3()
  useFrame(({ camera, size }) => {
    if (!marker.current || !label.current || !dot.current) return
    marker.current.visible=!runtime.visit&&!runtime.visitQueued&&!runtime.landing
    if(runtime.visit||runtime.visitQueued||runtime.landing){label.current.style.visibility='hidden';return}
    if (runtime.local) {
      const height = runtime.terrainStore?.bestHeight(lat, lon) ?? heightM
      marker.current.position.set(
        ...sitePosition(lat, lon, 1 + (height + 1) / LUNAR_RADIUS_M),
      )
    } else marker.current.position.copy(pos)
    marker.current.getWorldPosition(p)
    marker.current.parent!.getWorldPosition(center)
    normal.copy(p).sub(center).normalize()
    const distance = camera.position.distanceTo(p),
      front = normal.dot(camera.position.clone().sub(p).normalize()) > 0.05
    dot.current.visible = front && distance < 50
    const px =
      (2 *
        distance *
        Math.tan(((camera as T.PerspectiveCamera).fov * Math.PI) / 360)) /
      size.height
    dot.current.scale.setScalar(Math.max(1e-7, Math.min(0.012, px * 3)))
    const show =
      visible &&
      (!nearOnly || active || distance < 2.5) &&
      front &&
      distance < 12 &&
      placeLabel(label.current, p, camera, size, runtime, 10)
    label.current.style.visibility = show ? 'visible' : 'hidden'
  })
  return (
    <group ref={marker} position={pos}>
      <mesh
        ref={dot}
        scale={0.006}
        onClick={(e) => {
          e.stopPropagation()
          if (e.delta > 3 || runtime.dragged) return
          onClick()
        }}
      >
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial color={active ? '#f5c77e' : '#79cbd6'} />
      </mesh>
      <Html zIndexRange={[8, 0]} wrapperClass="scene-label-anchor" style={{pointerEvents:'none'}}>
        <button
          ref={attachLabel}
          data-site-label={name}
          style={{visibility:'hidden'}}
          onPointerDown={event=>event.stopPropagation()}
          onClick={event=>{event.stopPropagation();onClick()}}
          className={'surface-label' + (active ? ' active' : '')}
        >
          {name}
        </button>
      </Html>
    </group>
  )
}

function LunarLayers({
  props,
  runtime,
}: {
  props: SceneProps
  runtime: Runtime
}) {
  const grid = useMemo(() => {
    const pts: number[] = []
    for (let lat = -75; lat <= 75; lat += 15)
      for (let lon = 0; lon < 360; lon += 3)
        pts.push(
          ...sitePosition(lat, lon, 1.002),
          ...sitePosition(lat, lon + 3, 1.002),
        )
    for (let lon = 0; lon < 360; lon += 30)
      for (let lat = -90; lat < 90; lat += 3)
        pts.push(
          ...sitePosition(lat, lon, 1.002),
          ...sitePosition(lat + 3, lon, 1.002),
        )
    return new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute(pts, 3),
    )
  }, [])
  const path = useMemo(() => {
    const origin = sitePosition(
        props.site.lat,
        props.site.lonEast,
        1 + ((props.site.siteHeightM ?? 0) + 5) / LUNAR_RADIUS_M,
      ),
      frame = localFrame(origin),
      start = Math.floor(props.clock.current.row)
    const pts: T.Vector3[] = []
    for (let h = 0; h <= 24; h++) {
      const row = props.sunRows[Math.min(props.sunRows.length - 1, start + h)]
      const dir = azElToDir(row.az, row.el, frame)
      pts.push(
        new T.Vector3(...origin).addScaledVector(new T.Vector3(...dir), 0.3),
      )
    }
    return new T.BufferGeometry().setFromPoints(
      pts.slice(0, -1).flatMap((p, i) => [p, pts[i + 1]]),
    )
  }, [props.site, props.sunRows, Math.floor(props.clock.current.row)])
  useEffect(() => () => grid.dispose(), [grid])
  useEffect(() => () => path.dispose(), [path])
  return (
    <>
      {props.layers.graticule && (
        <lineSegments geometry={grid}>
          <lineBasicMaterial color="#a3bacd" transparent opacity={0.22} />
        </lineSegments>
      )}
      {props.layers.sunPath && (
        <lineSegments geometry={path}>
          <lineBasicMaterial color="#f5c77e" transparent opacity={0.75} />
        </lineSegments>
      )}
      {props.sites.map((s) => (
        <SurfaceTag
          key={s.slug}
          name={s.name}
          heightM={s.siteHeightM ?? 0}
          lat={s.lat}
          lon={s.lonEast}
          active={s.slug === props.site.slug}
          visible={props.layers.labels && !props.focusMission}
          onClick={() => props.onSelect(s.slug)}
          runtime={runtime}
          nearOnly
        />
      ))}
      {props.missions.map(
        (m, i) =>
          m.lat !== null &&
          m.lonEast !== null && (
            <SurfaceTag
              key={m.name}
              name={m.name}
              lat={m.lat}
              lon={m.lonEast}
              active={props.focusMission?.name === m.name}
              visible={props.options.names}
              onClick={() => props.onMission(i)}
              runtime={runtime}
            />
          ),
      )}
      {props.layers.craters &&
        CRATERS.map(([name, lat, lon]) => (
          <SurfaceTag
            key={name}
            name={name + ' crater'}
            lat={lat}
            lon={lon}
            active={false}
            visible
            onClick={() => {}}
            runtime={runtime}
          />
        ))}
    </>
  )
}

function Orbit({
  body,
  runtime,
  hour,
  visible,
}: {
  body: BodyData
  runtime: Runtime
  hour: number
  visible: boolean
}) {
  const ref = useRef<T.LineLoop>(null)
  const geometry = useMemo(
    () => new T.BufferGeometry().setFromPoints(orbitPoints(body, hour)),
    [body, Math.floor(hour / 24)],
  )
  const line = useMemo(
    () =>
      new T.LineLoop(
        geometry,
        new T.LineBasicMaterial({
          color: BODY_COLORS[body.name] ?? '#8497a4',
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }),
      ),
    [geometry, body.name],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      line.material.dispose()
    },
    [geometry, line],
  )
  useFrame(() => {
    if (!ref.current || !body.parent) return
    ref.current.position
      .copy(runtime.positions.get(body.parent)!)
      .sub(runtime.origin)
    ref.current.visible =
      visible &&
      !runtime.visit && !runtime.visitQueued && !runtime.landing &&
      (!runtime.systemView || body.parent === 'Earth') &&
      (body.parent === 'Sun' ||
        body.parent === runtime.focus ||
        body.name === runtime.focus)
  })
  return <primitive ref={ref} object={line} />
}

/** Development-only URL switches for checking the world without the interface (?quality=low&highlight=antenna&suitLamp). */
const devParam=(name:string)=>{if(!(import.meta as unknown as {env?:{DEV?:boolean}}).env?.DEV)return null;try{return new URLSearchParams(window.location.search).get(name)??window.localStorage.getItem('chader-dev-'+name)}catch{return null}}
const devQuality=()=>{const q=devParam('quality');return q==='high'||q==='balanced'||q==='low'||q==='auto'?q:null}
const devEquipment=()=>{const v=devParam('equip');if(v===null)return null;const [az,el]=v.split(',').map(Number);return {...DEFAULT_EQUIPMENT,panel:true,antenna:true,panelAz:150,panelTilt:55,antennaAz:Number.isFinite(az)?az:300,antennaEl:Number.isFinite(el)?el:12}}
const devHighlight=()=>{const h=devParam('highlight');return h==='lander'||h==='antenna'||h==='panel'?h:null}
type WorldQuality={level:QualityLevel;auto:boolean;plan:ReturnType<typeof qualityPlan>;onAutoLevel:(level:QualityLevel)=>void;onAutoDpr:(dpr:number)=>void}
// Development-only failure injection (?fail=render or localStorage chader-dev-fail=render): the scene keeps
// throwing until it is rebuilt in low quality (React re-renders once after a render error, so a single throw would
// be "recovered"), which tests the failure state and the low-quality retry. devParam returns null in production.
function World({ data, props, quality }: { data: SpaceData; props: SceneProps; quality: WorldQuality }) {
  const visitTemps=useMemo(()=>({point:new T.Vector3(),normal:new T.Vector3(),up:new T.Vector3(),north:new T.Vector3(),east:new T.Vector3(),forward:new T.Vector3(),right:new T.Vector3(),target:new T.Vector3()}),[])
  const longTaskUntil=useRef(0)
  useEffect(()=>{if(typeof PerformanceObserver==='undefined')return;const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTaskUntil.current=Math.max(longTaskUntil.current,entry.startTime+entry.duration+200)});try{observer.observe({entryTypes:['longtask']})}catch{}return()=>observer.disconnect()},[])
  if(devParam('fail')==='render'&&quality.level!=='low')throw new Error('Injected test failure (development only)')
  const [terrainStore, setTerrainStore] = useState<TerrainStore | null>(null)
  // unit vectors of the mission sites, body frame — used to decide where
  // measured terrain and surface visits are allowed
  const siteUnits = useMemo(
    () => props.sites.map((s) => new T.Vector3(...sitePosition(s.lat, s.lonEast)).normalize()),
    [props.sites],
  )
  useEffect(() => {
    let active = true
    loadTerrain()
      .then((s) => {
        if (active) setTerrainStore(s)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  const controls = useRef<TrackballImpl>(null)
  const { camera, gl, invalidate, scene } = useThree(),getThree=useThree(s=>s.get)
  const attachControls=useCallback((node:TrackballImpl|null)=>{
    controls.current=node
    if(node)invalidate()
  },[invalidate])
  const runtime = useMemo<Runtime>(
    () => ({
      positions: positionsAt(data, props.clock.current.row),
      origin: positionsAt(data, props.clock.current.row).get('Moon')!.clone(),
      focus: 'Moon',
      displayRadii: new Map(),
      labels: [],
      sky: false,
      dragged: false,
      inspectionDrag: false,
      equipmentDrag:false,
      controls: null,
      local: false,
      surfaceOffset: new T.Vector3(),
      terrainReady: false,
      terrainDirection: new T.Vector3(),
      terrainCos: 1,
      inspectionDirection: new T.Vector3(0, -1, 0),
      inspectionEnabled: false,
      terrainStore: null,
      terrainMesh:null,
      systemView: false,
      visit: false,
      visitQueued: false,
      visitLook: null,
      visitAnchor: null,
      visitOffset:{eastM:0,northM:0},
      movementBlocked:false,
      astronaut:standingAstronaut(),
      walkInput:{forward:0,right:0},
      crouched:false,eyeHeightM:ASTRONAUT_EYE_HEIGHT_M,
      trail:[],trailOrigin:null,trailRevision:0,trailDistanceM:0,trailStepCount:0,
      landingQueued:false,landing:null,lander:{...LANDED_STATE},dustEmitter:null,dustBurst:null,shadowDirty:false,shadersWarm:false,
    }),
    [data],
  )
  // Shader warm-up. Linking a program the first time it is drawn blocks the main thread (three's onFirstUse waits
  // for the link); on a slow GPU driver the surface's programs took minutes, freezing the descent. Every material
  // in the scene (surface objects are mounted but hidden) is prepared and polled asynchronously, using
  // KHR_parallel_shader_compile to link in the background; the surface is shown and the landing begins once they
  // are ready, or after a time limit so a missing extension or a stuck program never holds the visit.
  const warmRun=useRef(0),warmMaterials=useMemo(()=>new WarmMaterialCache(),[gl,scene])
  const warmJobs=useRef(new Set<ShaderWarmup>())
  useEffect(()=>()=>{warmRun.current++;for(const job of warmJobs.current)job.cancel();warmJobs.current.clear()},[])
  const warmShaders=(limitMs:number)=>{
    const id=++warmRun.current
    const done=()=>{if(warmRun.current!==id)return;runtime.shadersWarm=true;invalidate()}
    // r180 compile() traverses ALL drawables, including hidden ones. Keep visibility intact: exposing a hidden
    // parent also exposes its lights, which warms the wrong lighting variant and forces linking on first draw.
    warmMaterials.remember(scene)
    try{const job=startShaderWarmup(gl,scene,camera,{limitMs});warmJobs.current.add(job);const finish=()=>{warmJobs.current.delete(job);done()};void job.ready.then(finish,finish)}catch{done()}
  }
  // The surface set (lander, equipment, gloves, rocks, Chader Buri, dust, landing) is built only once a surface
  // visit is requested, and kept afterwards. Measured before: at solar-system startup it generated about 12 s of
  // procedural textures on the main thread and queued about 35 shader programs at once for scenery nobody was
  // looking at. The warm-up now starts with the visit request, during the arrival flight the landing already waits on.
  const [surfaceWanted,setSurfaceWanted]=useState(false)
  useEffect(()=>{if(props.fly?.visit)setSurfaceWanted(true)},[props.fly])
  useEffect(()=>{if(!terrainStore||!surfaceWanted)return;const id=setTimeout(()=>warmShaders(60000),400);return()=>clearTimeout(id)},[terrainStore,surfaceWanted])
  const visitWarm=useRef(false)
  // A new focus overlay often changes object count without adding any shader. Compile only previously unseen
  // material/object variants, against the live scene lights. Never traverse/prepare every program mid-turn.
  const lateWarm=useRef({at:0,pending:false})
  const precompileNew=()=>{
    const batch=warmMaterials.takeNew(scene)
    if(!batch.children.length)return
    lateWarm.current.pending=true
    const done=()=>{lateWarm.current.pending=false;batch.clear()}
    try{const job=startShaderWarmup(gl,batch,camera,{targetScene:scene,limitMs:20000});warmJobs.current.add(job);const finish=()=>{warmJobs.current.delete(job);done()};void job.ready.then(finish,finish)}catch{done()}
  }
  useFrame(()=>{
    if(runtime.visit&&runtime.shadersWarm){
      const now=performance.now(),w=lateWarm.current
      if(now-w.at>1000&&!w.pending){w.at=now;precompileNew()}
    }
    if(!surfaceWanted&&(runtime.visit||runtime.visitQueued))setSurfaceWanted(true)
    // A visit re-checks once: materials created since (a loaded texture, a newly mounted part) are linked too.
    if(runtime.visit&&!visitWarm.current){visitWarm.current=true;if(runtime.shadersWarm){runtime.shadersWarm=false;warmShaders(20000)}}
    else if(!runtime.visit)visitWarm.current=false
  })
  // Development-only handle for the repeatable frame-time profile (scratch scripts); absent from production builds.
  useEffect(()=>{if(!(import.meta as unknown as {env?:{DEV?:boolean}}).env?.DEV)return;const w=window as unknown as {__chaderScene?:unknown};w.__chaderScene={gl,scene,camera,invalidate,runtime,clock:props.clock,raycaster:getThree().raycaster};return()=>{delete w.__chaderScene}},[gl,scene,camera,invalidate,runtime,props.clock])
  const flight = useRef<{
    start: number
    duration: number
    arrival: boolean
    from: T.Vector3
    to: T.Vector3
    target: T.Vector3
    targetEnd: T.Vector3
    fov: number
    endFov: number
    up: T.Vector3
  } | null>(null)
  const guideTurn=useRef<{start:number;yaw:number;pitch:number;deltaYaw:number;deltaPitch:number}|null>(null)
  const pendingFlight=useRef<FlyRequest|null>(null)
  const startFlight = (request: FlyRequest) => {
    guideTurn.current=null
    if ((request.terrain || request.visit) && (request.body !== 'Moon' || request.lat === undefined || request.lon === undefined || !nearMissionSite(request.lat,request.lon,props.sites))) return
    const body = data.bodies.find((b) => b.name === request.body)!
    if (!body) return
    if (!controls.current) {pendingFlight.current=request;invalidate();return}
    pendingFlight.current=null
    if(request.visit && runtime.visit && runtime.visitLook && runtime.visitAnchor && request.visitHeading!==undefined){
      const target=new T.Vector3(...sitePosition(request.lat!,request.lon!)).normalize()
      if(target.dot(runtime.visitAnchor.up)>1-1e-12){
        const look=runtime.visitLook, yaw=request.visitHeading*Math.PI/180
        const pitch=request.visitPitch===undefined?look.pitch:Math.max(-1.56,Math.min(1.56,request.visitPitch*Math.PI/180))
        if(request.guidedTurn&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
          const difference=yaw-look.yaw
          guideTurn.current={start:performance.now(),yaw:look.yaw,pitch:look.pitch,deltaYaw:Math.atan2(Math.sin(difference),Math.cos(difference)),deltaPitch:pitch-look.pitch}
        }else{look.yaw=yaw;look.pitch=pitch}
        invalidate();return
      }
    }
    // any new flight ends a surface visit
    if (runtime.visit || runtime.visitQueued) {
      runtime.visit = false
      runtime.visitQueued = false
      props.onVisit?.(null)
    }
    positionsAt(data, props.clock.current.row, runtime.positions)
    const nextOrigin = runtime.positions.get(body.name)!
    const shift = runtime.origin.clone().sub(nextOrigin)
    camera.position.add(shift)
    controls.current.target.add(shift)
    runtime.local = false
    runtime.surfaceOffset.set(0, 0, 0)
    runtime.origin.copy(nextOrigin)
    runtime.focus = body.name
    runtime.systemView = !!request.system
    runtime.sky = !!request.sky
    const radius = body.radiusKm / UNIT_KM
    let direction = runtime.positions
      .get('Sun')!
      .clone()
      .sub(nextOrigin)
      .normalize()
    if (body.name === 'Sun') direction = new T.Vector3(0, 0.3, 1)
    const tilt = new T.Vector3(0, 1, 0).cross(direction).normalize()
    direction.applyAxisAngle(tilt, 0.55).normalize()
    let distance =
      radius *
      (body.name === 'Saturn'
        ? 11
        : body.name === 'Moon' && window.innerWidth < 768
          ? 9.2
          : body.name === 'Sun'
            ? 4.8
            : 6.4)
    const targetEnd = new T.Vector3()
    if (request.lat !== undefined) {
      direction
        .set(...sitePosition(request.lat, request.lon ?? 0))
        .applyQuaternion(attitudeAt(body, props.clock.current.row))
      distance = window.innerWidth < 768 ? 7.5 : 4.6
      if (request.terrain)
        distance =
          1 +
          ((terrainStore?.bestHeight(request.lat, request.lon ?? 0) ?? 0) +
            12000) /
            LUNAR_RADIUS_M
      if (request.visit) {
        runtime.visitOffset={eastM:0,northM:0};runtime.movementBlocked=false
        runtime.astronaut=standingAstronaut();runtime.walkInput={forward:0,right:0}
        runtime.crouched=false;runtime.eyeHeightM=ASTRONAUT_EYE_HEIGHT_M;runtime.trail=[];runtime.trailOrigin=null;runtime.trailRevision++;runtime.trailDistanceM=0;runtime.trailStepCount=0
        // Eye-level surface arrival; the planner still uses its cached observer height.
        const groundM = terrainStore?.bestHeight(request.lat, request.lon ?? 0) ?? props.sites.find(s => s.lat === request.lat && s.lonEast === request.lon)?.siteHeightM ?? 0
        distance = 1 + (groundM + ASTRONAUT_EYE_HEIGHT_M) / LUNAR_RADIUS_M
        const frame = localFrame(sitePosition(request.lat, request.lon ?? 0))
        runtime.visitAnchor = {
          north: new T.Vector3(...frame.north),
          east: new T.Vector3(...frame.east),
          up: new T.Vector3(...frame.up),
        }
        const moon = data.bodies.find((x) => x.name === 'Moon')!
        const sunBody = runtime.positions
          .get('Sun')!
          .clone()
          .sub(runtime.origin)
          .applyQuaternion(attitudeAt(moon, props.clock.current.row).invert())
        const sN = sunBody.dot(runtime.visitAnchor.north),
          sE = sunBody.dot(runtime.visitAnchor.east),
          sU = sunBody.dot(runtime.visitAnchor.up)
        const yaw =
          request.visitHeading !== undefined
            ? (request.visitHeading * Math.PI) / 180
            : Math.atan2(sE, sN)
        // keep the observer's current pitch when only turning to face something
        const pitch = request.visitPitch!==undefined ? Math.max(-1.56,Math.min(1.56,request.visitPitch*Math.PI/180)) : runtime.visitLook
          ? runtime.visitLook.pitch
          : Math.max(0.04, Math.min(0.5, Math.asin(sU / sunBody.length())))
        runtime.visitLook = { yaw, pitch }
        runtime.visitQueued = true
        // A real arrival ends with the landing simulation; turning to face something does not.
        runtime.landingQueued = !request.guidedTurn && !request.instant
        // land already looking along the seeded bearing (a point just ahead)
        const forwardWorld = runtime.visitAnchor.north
          .clone()
          .multiplyScalar(Math.cos(yaw) * Math.cos(pitch))
          .addScaledVector(runtime.visitAnchor.east, Math.sin(yaw) * Math.cos(pitch))
          .addScaledVector(runtime.visitAnchor.up, Math.sin(pitch))
          .applyQuaternion(attitudeAt(body, props.clock.current.row))
        targetEnd.copy(direction).multiplyScalar(distance).addScaledVector(forwardWorld, 0.05)
      }
    }
    if (request.overview) {
      direction = new T.Vector3(0.05, 0.92, 0.4).normalize()
      distance = 11_500_000
    }
    if (request.system) {
      direction = new T.Vector3(0.05,0.96,0.28).normalize()
      const aspect = Math.max(0.1,Math.min(1,gl.domElement.clientWidth/gl.domElement.clientHeight))
      distance = 1_600_000 / UNIT_KM / aspect
    }
    if (request.sky) {
      direction = runtime.positions
        .get('Earth')!
        .clone()
        .sub(nextOrigin)
        .normalize()
      distance = 1.025
      targetEnd.copy(direction).multiplyScalar(distance + 0.001)
    }
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const duration=request.visit?4800:2200
    lastVisitReport.current=0
    lastVisitPose.current=null
    props.onArrival?.(request.visit?0:null)
    flight.current = {
      start: performance.now() - (reduced || request.instant ? duration : 0),
      duration,
      arrival: !!request.visit,
      from: camera.position.clone(),
      to: direction.multiplyScalar(distance),
      target: controls.current.target.clone(),
      targetEnd,
      fov: (camera as T.PerspectiveCamera).fov,
      endFov: request.overview
        ? 2*Math.atan(Math.tan(21*Math.PI/180)/Math.max(0.1,Math.min(1,gl.domElement.clientWidth/gl.domElement.clientHeight)))*180/Math.PI
        : request.sky ? 10 : request.visit ? 60 : 42,
      up: ((request.terrain || request.visit) && request.lat !== undefined
        ? new T.Vector3(
            ...localFrame(sitePosition(request.lat, request.lon ?? 0)).north,
          )
        : new T.Vector3(0, 1, 0)
      ).applyQuaternion(attitudeAt(body, props.clock.current.row)),
    }
    controls.current.enabled = false
    invalidate()
    props.onFocus(
      request.sky ? 'Lunar sky' : request.system ? 'Earth–Moon system' : request.overview ? 'Solar system' : body.name,
    )
  }
  useFrame(()=>{
    if(pendingFlight.current&&controls.current)startFlight(pendingFlight.current)
  },-3)
  useEffect(() => {
    runtime.origin.copy(runtime.positions.get('Moon')!)
    const moon = data.bodies.find((b) => b.name === 'Moon')!
    const south = new T.Vector3(0, -1, 0).applyQuaternion(
      attitudeAt(moon, props.clock.current.row),
    )
    const direction = runtime.positions
      .get('Sun')!
      .clone()
      .sub(runtime.positions.get('Moon')!)
      .normalize()
      .multiplyScalar(0.82)
      .addScaledVector(south, 0.57)
      .normalize()
    camera.position.copy(
      direction.multiplyScalar(window.innerWidth < 768 ? 9.2 : 5.8),
    )
    camera.up
      .set(0, 1, 0)
      .applyQuaternion(attitudeAt(moon, props.clock.current.row))
    camera.lookAt(0, 0, 0)
    controls.current?.target.set(0, 0, 0)
    props.onFocus('Moon')
  }, [data])
  // Bodies beyond Sun/Earth/Moon stream in only when a flight needs them. The
  // shared data is expanded in place (same identity, so runtime/camera state is
  // untouched); the bump re-renders to mount the newly loaded planets.
  const [, bump] = useState(0)
  useEffect(() => {
    const req = props.fly
    pendingFlight.current=null
    if (!req) return
    const needed = req.overview ? (data.catalog ?? data.bodies).map((b) => b.name) : [req.body]
    if (hasBodies(data, needed)) {
      startFlight(req)
      return
    }
    let live = true
    expandSpace(data, needed)
      .then(() => {
        if (!live) return
        bump((v) => v + 1)
        startFlight(req)
      })
      .catch((e) => console.warn('Could not load the bodies for this flight', e))
    return () => {
      live = false
    }
  }, [props.fly])
  const movementKeys=useRef(new Set<string>())
  // Latest props for long-lived listeners and frame callbacks.
  const propsRef=useRef(props);propsRef.current=props
  // A listener can arrive after the demand canvas has gone idle (including reduced-motion arrivals).
  useEffect(()=>{invalidate()},[props.onTerrainSampler,terrainStore,invalidate])
  const goToRun=useRef<{id:number;eastM:number;northM:number;blockedSince:number|null}|null>(null)
  const lastManualLook=useRef(0)
  const endGoTo=(state:'arrived'|'blocked'|'cancelled')=>{const run=goToRun.current;if(!run)return;goToRun.current=null;propsRef.current.onGoTo?.(run.id,state)}
  const photoPending=useRef(0),lastPhotoRequest=useRef(props.photoRequest??0),photoAlive=useRef(true)
  const photoHandlers=useRef({onPhoto:props.onPhoto,onError:props.onPhotoError,site:props.site,datasetId:props.datasetId})
  photoHandlers.current={onPhoto:props.onPhoto,onError:props.onPhotoError,site:props.site,datasetId:props.datasetId}
  useEffect(()=>{photoAlive.current=true;return()=>{photoAlive.current=false}},[])
  const requestPhoto=()=>{photoPending.current=2;invalidate()}
  useEffect(()=>{if(props.photoRequest!==undefined&&props.photoRequest!==lastPhotoRequest.current){lastPhotoRequest.current=props.photoRequest;requestPhoto()}},[props.photoRequest])
  const fieldState=useRef({site:props.site,onResult:props.onFieldResult}),fieldSequence=useRef(0)
  fieldState.current={site:props.site,onResult:props.onFieldResult}
  const inspectGround=(action:'inspect'|'flag')=>{
    const sequence=++fieldSequence.current,site=fieldState.current.site
    const report=(reading:FieldReading|null,message:string)=>fieldState.current.onResult?.({sequence,action,reading,message})
    const mesh=runtime.terrainMesh,moonPosition=runtime.positions.get('Moon')
    if(!runtime.visit||!runtime.terrainReady||!mesh||!moonPosition){report(null,'Measured terrain is not ready yet.');return}
    if(action==='flag'&&runtime.astronaut.airborne){report(null,'Land before placing a survey flag.');return}
    camera.updateMatrixWorld();mesh.updateWorldMatrix(true,false)
    const ray=new T.Raycaster(),direction=new T.Vector3()
    if(action==='flag')direction.copy(camera.position).add(runtime.origin).sub(moonPosition).normalize().negate()
    else camera.getWorldDirection(direction)
    ray.set(camera.position,direction);ray.far=PROBE_RANGE_M/LUNAR_RADIUS_M
    const hit=ray.intersectObject(mesh,false)[0]
    if(!hit?.face){report(null,'Aim the reticle down at the ground within 2 km, then inspect again.');return}
    const moon=data.bodies.find(b=>b.name==='Moon')!,inverse=attitudeAt(moon,props.clock.current.row).invert()
    const point=hit.point.clone().add(runtime.origin).sub(moonPosition).applyQuaternion(inverse)
    const normal=hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).applyQuaternion(inverse)
    const geometry=facetReading(point.toArray(),normal.toArray(),hit.distance*LUNAR_RADIUS_M)
    if(!geometry){report(null,'No valid measured facet at this bearing.');return}
    const store=runtime.terrainStore,dataset=store&&[...store.manifest.datasets].sort((a,b)=>a.spacingM-b.spacingM).find(d=>store.height(d,geometry.lat,geometry.lonEast)!==null)
    const height=dataset&&store?.height(dataset,geometry.lat,geometry.lonEast)
    if(height==null||!Number.isFinite(height)||!dataset){report(null,'Elevation data is unavailable at that point.');return}
    // Decorative rocks are not in the DEM: if one sits in front of the measured facet, say so in the result.
    const rocks:T.Object3D[]=[];scene.traverse(o=>{if((o as T.InstancedMesh).isInstancedMesh&&o.userData.decorative)rocks.push(o)})
    const rock=action==='inspect'&&ray.intersectObjects(rocks,false).some(r=>r.distance<=hit.distance)
    report({...geometry,elevationM:height,id:`${site.slug}-${Date.now()}-${sequence}`,siteSlug:site.slug,resolutionM:dataset.spacingM,demKey:dataset.key,demSource:dataset.source,sourceSha256:dataset.sourceSha256,sceneRow:props.clock.current.row,recordedUTC:new Date().toISOString()},action==='flag'?'Survey flag placed at your feet.':rock?'Illustrative rock in view; the measured DEM facet behind it was inspected.':'Loaded DEM facet inspected.')
    invalidate()
  }
  useEffect(()=>{if(props.fieldRequest)inspectGround(props.fieldRequest.action)},[props.fieldRequest])
  const moveViewpoint=(forward:number,right:number,metres:number)=>{
    const anchor=runtime.visitAnchor,look=runtime.visitLook
    if(!runtime.visit||!anchor||!look)return
    const site={lat:Math.asin(anchor.up.y)*180/Math.PI,lonEast:Math.atan2(-anchor.up.z,anchor.up.x)*180/Math.PI}
    const step=checkedViewpointStep(site,runtime.visitOffset,look.yaw*180/Math.PI,forward,right,metres,(lat,lon)=>runtime.terrainReady?terrainStore?.bestHeight(lat,lon)??null:null)
    // Illustrative objects are solid: walking into one slides along it (the DEM check above still ran first).
    const solid=pushOut(step,walkObstacles())
    runtime.visitOffset={eastM:solid.eastM,northM:solid.northM};runtime.movementBlocked=step.blocked;invalidate()
    return step
  }
  /** Collision circles for the lander, deployed equipment and Chader Buri's emitter (none during the landing). */
  const walkObstacles=()=>{const p=propsRef.current,e=devEquipment()??p.equipment??DEFAULT_EQUIPMENT;return runtime.landing?[]:surfaceObstacles({panel:!!e.panel,antenna:!!e.antenna,buri:!!p.buri&&p.buri.visible!==false})}
  const jump=()=>{
    if(!runtime.visit||!runtime.visitLook||!runtime.visitAnchor||!runtime.terrainReady||runtime.landing?.start!=null||propsRef.current.movementPaused)return
    const anchor=runtime.visitAnchor,point=viewpointCoordinates({lat:Math.asin(anchor.up.y)*180/Math.PI,lonEast:Math.atan2(-anchor.up.z,anchor.up.x)*180/Math.PI},runtime.visitOffset)
    const keys=movementKeys.current,velocity=walkingVelocity(runtime.visitLook.yaw*180/Math.PI,Number(keys.has('w'))-Number(keys.has('s'))+runtime.walkInput.forward,Number(keys.has('d'))-Number(keys.has('a'))+runtime.walkInput.right)
    runtime.astronaut=launchAstronaut(runtime.astronaut,runtime.terrainStore?.bestHeight(point.lat,point.lonEast)??null,velocity)
    invalidate()
  }
  useEffect(()=>{
    const step=props.visitStep
    if(!step||!runtime.visit)return
    if(step.reset){endGoTo('cancelled');runtime.visitOffset={eastM:0,northM:0};runtime.movementBlocked=false;runtime.astronaut=standingAstronaut();runtime.walkInput={forward:0,right:0};runtime.crouched=false;runtime.eyeHeightM=ASTRONAUT_EYE_HEIGHT_M;runtime.trail=[];runtime.trailOrigin=null;runtime.trailRevision++;runtime.trailDistanceM=0;runtime.trailStepCount=0;movementKeys.current.clear();invalidate()}
    else if(step.crouch!==undefined){if(!runtime.astronaut.airborne)runtime.crouched=step.crouch;invalidate()}
    else if(propsRef.current.movementPaused){runtime.walkInput={forward:0,right:0}}
    else if(step.jump){endGoTo('cancelled');jump()}
    else if(step.walk){if(step.forward||step.right)endGoTo('cancelled');runtime.walkInput={forward:step.forward,right:step.right};invalidate()}
    else if(!runtime.astronaut.airborne){endGoTo('cancelled');moveViewpoint(step.forward,step.right,1)}
  },[props.visitStep])
  useEffect(()=>{
    const target=props.goTo
    if(!target){endGoTo('cancelled');return}
    if(goToRun.current?.id===target.id)return
    endGoTo('cancelled')
    if(!runtime.visit||!runtime.visitLook||!Number.isFinite(target.eastM)||!Number.isFinite(target.northM)){props.onGoTo?.(target.id,'blocked');return}
    goToRun.current={id:target.id,eastM:target.eastM,northM:target.northM,blockedSince:null}
    guideTurn.current=null
    // Reduced motion: face the destination at once instead of a gradual turn.
    const dE=target.eastM-runtime.visitOffset.eastM,dN=target.northM-runtime.visitOffset.northM
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches&&Math.hypot(dE,dN)>1.5)runtime.visitLook.yaw=Math.atan2(dE,dN)
    props.onGoTo?.(target.id,'walking');invalidate()
  },[props.goTo])
  useEffect(()=>()=>{goToRun.current=null},[])
  // Pointer-lock look: on the surface a click captures the mouse; movement turns the head, Escape releases.
  useEffect(()=>{
    const canvas=gl.domElement,locked=()=>document.pointerLockElement===canvas
    const change=()=>{propsRef.current.onPointerLock?.(locked());invalidate()}
    const click=()=>{
      const p=propsRef.current
      // While an instrument is in "Aim by dragging" mode the cursor stays free to drag it.
      if(!p.pointerLook||!runtime.visit||runtime.landing||locked()||runtime.dragged||runtime.equipmentDrag||getEquipmentAdjust())return
      // A click that selects an object opens its card: the cursor must stay free to use it. The selection lands
      // a moment after this DOM click, so decide on the next tick.
      const opened=p.activeSurfaceObject
      setTimeout(()=>{
        const q=propsRef.current
        if(!q.pointerLook||locked()||getEquipmentAdjust()||(q.activeSurfaceObject&&q.activeSurfaceObject!==opened))return
        try{const request=canvas.requestPointerLock() as unknown as Promise<void>|undefined;request?.catch?.(()=>{})}catch{/* Pointer lock unavailable: drag-look still works. */}
      },60)
    }
    const move=(event:MouseEvent)=>{
      if(!locked()||!runtime.visit||!runtime.visitLook||runtime.landing)return
      guideTurn.current=null;lastManualLook.current=performance.now()
      turnSiteLook(runtime.visitLook,-event.movementX*.8,-event.movementY*.8);invalidate()
    }
    document.addEventListener('pointerlockchange',change);canvas.addEventListener('click',click);window.addEventListener('mousemove',move)
    return()=>{document.removeEventListener('pointerlockchange',change);canvas.removeEventListener('click',click);window.removeEventListener('mousemove',move);if(locked())document.exitPointerLock()}
  },[gl,runtime,invalidate])
  useEffect(()=>{if(!props.pointerLook&&document.pointerLockElement===gl.domElement)document.exitPointerLock()},[props.pointerLook,gl])
  // Opening an object's card or switching on "Aim by dragging" frees the cursor (from the keyboard too).
  const aimingEquipment=useEquipmentAdjust()
  useEffect(()=>{if((props.activeSurfaceObject||aimingEquipment)&&document.pointerLockElement===gl.domElement)document.exitPointerLock()},[props.activeSurfaceObject,aimingEquipment,gl])
  useEffect(() => {
    let down: { x: number; y: number } | null = null
    let prev: { x: number; y: number } | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => invalidate(), 270)
    }
    const begin = (event: PointerEvent) => {
      guideTurn.current=null
      if(runtime.visit)gl.domElement.focus({preventScroll:true})
      invalidate()
      down = { x: event.clientX, y: event.clientY }
      prev = { ...down }
      runtime.dragged = false
      // User navigation takes ownership immediately, even during a camera flight.
      // A cancelled inbound visit never becomes a visit.
      flight.current = null
      pendingFlight.current=null
      props.onArrival?.(null)
      if(runtime.visitQueued)props.onVisit?.(null)
      runtime.visitQueued = false
      if (controls.current) controls.current.enabled = !runtime.visit
    }
    const move = (event: PointerEvent) => {
      if (down) invalidate()
      if (
        down &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 3
      )
        runtime.dragged = true
      // standing on the surface: drag turns the observer's head (scene follows
      // the pointer, Street-View style)
      if (down && prev && runtime.visit && runtime.visitLook && !runtime.equipmentDrag && document.pointerLockElement !== gl.domElement) {
        lastManualLook.current = performance.now()
        const look = runtime.visitLook
        turnSiteLook(look,event.clientX-prev.x,event.clientY-prev.y)
        invalidate()
      }
      prev = down ? { x: event.clientX, y: event.clientY } : null
    }
    const end = () => {
      settle()
      down = null
      prev = null
      runtime.inspectionDrag = false
      if (controls.current && !flight.current && !runtime.visit) controls.current.enabled = true
    }
    const wheel = () => {
      guideTurn.current=null
      settle()
      invalidate()
      flight.current = null
      props.onArrival?.(null)
      if(runtime.visitQueued)props.onVisit?.(null)
      runtime.visitQueued = false
      if (controls.current && !flight.current && !runtime.visit) controls.current.enabled = true
    }
    gl.domElement.addEventListener('pointerdown', begin, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    gl.domElement.addEventListener('wheel', wheel, {
      capture: true,
      passive: true,
    })
    return () => {
      clearTimeout(refreshTimer)
      gl.domElement.removeEventListener('pointerdown', begin, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
      gl.domElement.removeEventListener('wheel', wheel, true)
    }
  }, [gl, runtime])
  useEffect(() => {
    const lens = (event: WheelEvent) => {
      if ((!runtime.sky && !runtime.visit) || flight.current) return
      event.preventDefault()
      const perspective = camera as T.PerspectiveCamera
      perspective.fov = Math.max(
        12,
        Math.min(80, perspective.fov * Math.exp(event.deltaY * 0.001)),
      )
      perspective.updateProjectionMatrix()
      invalidate()
    }
    gl.domElement.addEventListener('wheel', lens, { passive: false })
    return () => gl.domElement.removeEventListener('wheel', lens)
  }, [camera, gl, runtime])
  useEffect(()=>{
    const canvas=gl.domElement
    canvas.tabIndex=0
    canvas.setAttribute('aria-label','3D solar system and lunar terrain. In a site visit, drag or use arrow keys to look, WASD to walk, Space to jump, C to crouch, P to photograph, E to inspect, F to plant a flag, plus and minus to adjust the lens.')
    const key=(event:KeyboardEvent)=>{
      guideTurn.current=null
      if(!runtime.visit||!runtime.visitLook)return
      if(event.ctrlKey||event.metaKey||event.altKey)return
      if(event.key.toLowerCase()==='p'){event.preventDefault();event.stopPropagation();if(!event.repeat)requestPhoto();return}
      if(event.key.toLowerCase()==='c'){event.preventDefault();event.stopPropagation();if(!event.repeat&&!runtime.astronaut.airborne){runtime.crouched=!runtime.crouched;invalidate()}return}
      if(['e','f'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();if(!event.repeat)inspectGround(event.key.toLowerCase()==='e'?'inspect':'flag');return}
      if(event.code==='Space'||event.key===' '||event.key==='Spacebar'||event.key==='Space'){
        event.preventDefault();event.stopPropagation();if(!event.repeat&&!propsRef.current.movementPaused){endGoTo('cancelled');jump()}return
      }
      if(['w','a','s','d'].includes(event.key.toLowerCase())){
        event.preventDefault();event.stopPropagation()
        if(propsRef.current.movementPaused)return
        endGoTo('cancelled');movementKeys.current.add(event.key.toLowerCase());invalidate();return
      }
      const step=event.shiftKey?0.12:0.035
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        event.preventDefault();event.stopPropagation();lastManualLook.current=performance.now()
        const look=runtime.visitLook
        look.yaw+=(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)
        look.pitch=Math.max(-1.56,Math.min(1.56,look.pitch+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)))
      }else if(['+','=','-','_'].includes(event.key)){
        event.preventDefault();event.stopPropagation()
        const c=camera as T.PerspectiveCamera
        c.fov=Math.max(12,Math.min(80,c.fov+(event.key==='-'||event.key==='_'?3:-3)));c.updateProjectionMatrix()
      }else return
      invalidate()
    }
    canvas.addEventListener('keydown',key)
    // Surface keys also work without first clicking the canvas: when nothing that takes typing or a modal
    // owns the keyboard, the key is handed to the canvas (where surface focus and the handler above run),
    // ahead of the page's own window shortcuts.
    const typing='input,textarea,select,[contenteditable]:not([contenteditable="false"])'
    const widgets='[role="listbox"],[role="menu"],[role="menubar"],[role="tablist"],[role="radiogroup"],[role="slider"],[role="spinbutton"],[role="tree"],[role="grid"],[role="combobox"]'
    const forward=(event:KeyboardEvent)=>{
      if(event.target===canvas||event.defaultPrevented||!runtime.visit||!runtime.visitLook)return
      if(event.ctrlKey||event.metaKey||event.altKey)return
      const k=event.key.toLowerCase(),space=event.code==='Space'||event.key===' '||event.key==='Spacebar',arrow=event.key.startsWith('Arrow')
      if(!(space||arrow||['w','a','s','d','c','p','e','f'].includes(k)))return
      const target=event.target instanceof Element?event.target:null
      if(target&&(target.closest(typing)||(target as HTMLElement).isContentEditable))return
      if(document.querySelector('[data-guide-open],[role="dialog"][aria-modal="true"]'))return
      if(space&&target?.closest('button,a[href],summary,[role="button"],[role="link"],[role="checkbox"],[role="switch"]'))return
      if(arrow&&target?.closest(widgets))return
      event.preventDefault();event.stopPropagation()
      canvas.dispatchEvent(new KeyboardEvent('keydown',{key:event.key,code:event.code,shiftKey:event.shiftKey,repeat:event.repeat,bubbles:true,cancelable:true}))
    }
    window.addEventListener('keydown',forward,true)
    const release=(event:KeyboardEvent)=>{movementKeys.current.delete(event.key.toLowerCase())}
    const clear=()=>{movementKeys.current.clear();runtime.walkInput={forward:0,right:0}}
    const hidden=()=>{if(document.hidden)clear();else invalidate()}
    window.addEventListener('keyup',release);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',hidden)
    return()=>{canvas.removeEventListener('keydown',key);window.removeEventListener('keydown',forward,true);window.removeEventListener('keyup',release);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',hidden);clear()}
  },[camera,gl,runtime,invalidate])
  // Adaptive render quality. Only frames drawn on consecutive animation ticks during a surface visit are
  // measured (the canvas renders on demand, so idle gaps and key-repeat gaps never count).
  const qualityRef=useRef(quality);qualityRef.current=quality
  const qualityControl=useRef<{controller:QualityController|null;pending:QualityLevel|null;tick:number;time:number;reported:number;key:string;ms:number;timer?:ReturnType<typeof setTimeout>}>({controller:null,pending:null,tick:-9,time:0,reported:0,key:'',ms:0})
  const animationTick=useRef(0)
  const pixelControl=useRef<{key:string;control:SurfaceResolutionController}|null>(null)
  useEffect(()=>{let id=0;const loop=()=>{animationTick.current++;id=requestAnimationFrame(loop)};id=requestAnimationFrame(loop);return()=>{cancelAnimationFrame(id);clearTimeout(qualityControl.current.timer)}},[])
  useFrame(({gl})=>{
    const q=qualityRef.current,c=qualityControl.current,now=performance.now(),tick=animationTick.current
    const ctl=c.controller??=new QualityController(q.level)
    const pixelKey=`${q.level}/${q.auto}/${q.plan.dpr}/${!!runtime.visit}`
    if(pixelControl.current?.key!==pixelKey){
      pixelControl.current={key:pixelKey,control:new SurfaceResolutionController(q.plan.dpr, Math.min(q.plan.dpr, gl.domElement.clientWidth < 760 ? .6 : .75))}
      q.onAutoDpr(q.plan.dpr)
    }
    const pixels=pixelControl.current.control
    const steady=runtime.visit&&runtime.terrainReady&&!runtime.landing&&!document.hidden&&now>longTaskUntil.current&&tick===c.tick+1
    if(q.auto&&q.level==='low'&&!c.pending&&steady&&pixels.sample(now-c.time,now))q.onAutoDpr(pixels.dpr)
    if(!steady)pixels.resetWindow()
    if(c.pending&&q.level===c.pending)c.pending=null
    if(!c.pending)ctl.level=q.level
    // Not while terrain loads or the landing plays: those frames are not the visit's steady cost, and a level
    // change mid-landing would reallocate the shadow map and resize the canvas at the busiest moment.
    if(runtime.visit&&runtime.terrainReady&&!runtime.landing&&!document.hidden&&now>longTaskUntil.current&&tick===c.tick+1&&ctl.sample(now-c.time,now)){
      // A faster frame achieved by reducing pixels is not evidence that heavier shaders will fit again.
      if(q.auto&&(q.level!=='low'||pixels.dpr>=q.plan.dpr||ctl.level==='low')){c.pending=ctl.level;q.onAutoLevel(ctl.level)}else ctl.level=q.level
    }
    c.tick=tick;c.time=now
    const level=c.pending??q.level
    if(gl.domElement.dataset.quality!==level)gl.domElement.dataset.quality=level
    gl.domElement.dataset.qualityAuto=String(q.auto)
    gl.domElement.dataset.pixelRatio=String(gl.getPixelRatio())
    const report=propsRef.current.onQuality,key=`${level}/${q.auto}/${gl.getPixelRatio()}`
    // A level change reports within a second; the frame time only when it moved noticeably (each report re-renders
    // the interface, which cost up to ~150 ms of main thread in development builds on the reference laptop).
    if(report&&(key!==c.key||Math.abs(c.ms-ctl.frameMs)>Math.max(1,c.ms*.15))){
      if(now-c.reported>=1000){clearTimeout(c.timer);c.timer=undefined;c.reported=now;c.key=key;c.ms=ctl.frameMs;report({level,auto:q.auto,frameMs:Math.round(ctl.frameMs*10)/10,dpr:gl.getPixelRatio()})}
      else if(!c.timer)c.timer=setTimeout(()=>{c.timer=undefined;invalidate()},1000-(now-c.reported)+10)
    }
  })
  const lastArrivalReport=useRef(0)
  // Slow clocks (Now at 1x, or playback up to 2 simulated minutes per second) move the Sun and Earth by far less than
  // a pixel per frame, so they redraw at 4 Hz instead of every frame. Continuous redraws there kept this integrated
  // GPU saturated and produced 0.2-4 s stalls while turning. Movement, flights and fast playback still invalidate
  // every frame; the clock itself keeps advancing continuously.
  const slowClock=useRef<{at:number;timer?:ReturnType<typeof setTimeout>}>({at:0})
  useEffect(()=>()=>clearTimeout(slowClock.current.timer),[])
  useFrame(({ size }) => {
    const c=props.clock.current
    if (flight.current || (c.playing && !c.realtime && Math.abs(c.speed) > 120)) invalidate()
    else if (c.playing || c.realtime) {
      const now=performance.now(),s=slowClock.current
      if(now-s.at>=250){s.at=now;clearTimeout(s.timer);s.timer=undefined;invalidate()}
      else if(!s.timer)s.timer=setTimeout(()=>{s.timer=undefined;invalidate()},250-(now-s.at))
    }
    runtime.labels.length = 0
    positionsAt(data, props.clock.current.row, runtime.positions)
    runtime.origin.copy(runtime.positions.get(runtime.focus)!)
    const ctl = controls.current
    if (!ctl) return
    runtime.controls = ctl
    runtime.terrainStore = terrainStore
    runtime.inspectionEnabled = props.options.inspectionLight
    const b = data.bodies.find((x) => x.name === runtime.focus)!,
      radius = Math.max(...b.radiiKm) / UNIT_KM
    const moon = data.bodies.find((x) => x.name === 'Moon')!
    const moonQ = attitudeAt(moon, props.clock.current.row)
    if (runtime.local)
      runtime.origin.add(runtime.surfaceOffset.clone().applyQuaternion(moonQ))
    const bodyCamera = camera.position
      .clone()
      .add(runtime.origin)
      .sub(runtime.positions.get('Moon')!)
      .applyQuaternion(moonQ.clone().invert())
    const direction = bodyCamera.clone().normalize()
    const lat =
        (Math.asin(Math.max(-1, Math.min(1, direction.y))) * 180) / Math.PI,
      lon = (Math.atan2(-direction.z, direction.x) * 180) / Math.PI
    const ground = terrainStore?.bestHeight(lat, lon) ?? 0
    const cosReach = Math.cos(TERRAIN_POLICY.siteRadiusM / LUNAR_RADIUS_M)
    const nearSite = siteUnits.some((u) => u.dot(direction) >= cosReach)
    const altitude =
      bodyCamera.length() * LUNAR_RADIUS_M - LUNAR_RADIUS_M - ground
    if (runtime.focus === 'Moon' && !runtime.sky && !flight.current) {
      if (runtime.local && !nearSite) {
        // Panning out of a supported site returns to the orbital globe; it
        // must never create a ground view backed by unshipped terrain.
        runtime.local = false
        runtime.surfaceOffset.set(0,0,0)
        runtime.origin.copy(runtime.positions.get('Moon')!)
        camera.position.copy(direction).multiplyScalar(1+(ground+TERRAIN_POLICY.orbitalFloorM)/LUNAR_RADIUS_M).applyQuaternion(moonQ)
        ctl.target.set(0,0,0)
      } else if (!runtime.local && nearSite && altitude < 25000 && runtime.terrainReady) {
        runtime.surfaceOffset
          .copy(direction)
          .multiplyScalar(1 + ground / LUNAR_RADIUS_M)
        const shift = runtime.surfaceOffset.clone().applyQuaternion(moonQ)
        camera.position.sub(shift)
        runtime.origin.add(shift)
        ctl.target.set(0, 0, 0)
        runtime.local = true
      } else if (runtime.local && altitude > 100000) {
        const shift = runtime.surfaceOffset.clone().applyQuaternion(moonQ)
        camera.position.add(shift)
        runtime.origin.sub(shift)
        runtime.surfaceOffset.set(0, 0, 0)
        ctl.target.set(0, 0, 0)
        runtime.local = false
      } else if (runtime.local && altitude > 40000)
        ctl.target.lerp(
          runtime.surfaceOffset.clone().applyQuaternion(moonQ).negate(),
          0.06,
        )
    }
    // Zoom floor: measured terrain and surface visits exist only at the mission
    // sites. Elsewhere 25 km keeps a clean orbital view of the bump-mapped
    // globe instead of an empty close-up.
    ctl.minDistance = runtime.sky
      ? 0.0001
      : runtime.local
        ? 2 / LUNAR_RADIUS_M
        : runtime.focus === 'Moon'
          ? 1 + (nearSite
              ? runtime.terrainReady
                ? ground + 2000
                : 15000
              : TERRAIN_POLICY.orbitalFloorM) / LUNAR_RADIUS_M
          : radius * 1.07
    ctl.noPan = !runtime.local
    ctl.rotateSpeed = runtime.local ? 1 : 2.2
    ctl.maxDistance = 20_000_000
    ctl.noZoom = runtime.sky || runtime.visit
    const f = flight.current
    if (f) {
      const t = Math.min(1, (performance.now() - f.start) / f.duration),
        s = t * t * (3 - 2 * t)
      travelPosition(f.from, f.to, s, camera.position)
      if(f.arrival){
        camera.position.setLength(arrivalRadius(f.from.length(),f.to.length(),s))
        const reveal=T.MathUtils.smoothstep(s,0.45,0.92)
        const forward=f.targetEnd.clone().sub(f.to).normalize()
        const approach=f.to.clone().sub(camera.position).normalize().lerp(forward,reveal).normalize()
        ctl.target.copy(camera.position).addScaledVector(approach,0.05)
        camera.up.copy(f.up).lerp(f.to.clone().normalize(),reveal).normalize()
      }else ctl.target.copy(f.target).lerp(f.targetEnd, s)
      ;(camera as T.PerspectiveCamera).fov = f.fov + (f.endFov - f.fov) * s
      ;(camera as T.PerspectiveCamera).updateProjectionMatrix()
      if(!f.arrival)camera.up.lerp(f.up, 0.07).normalize()
      camera.lookAt(ctl.target)
      if(f.arrival && performance.now()-lastArrivalReport.current>100){lastArrivalReport.current=performance.now();props.onArrival?.(t)}
      if (t === 1) {
        flight.current = null
        props.onArrival?.(null)
        if (runtime.visitQueued) {
          // hand the camera to the standing observer: free-look takes over
          runtime.visitQueued = false
          runtime.visit = true
          ctl.enabled = false
          if (runtime.landingQueued) { runtime.landingQueued = false; runtime.landing = { start: null, observer: { eastM: 0, northM: 0 }, approachDeg: 0, burst: false, fov: 60 }; props.onLanding?.('pending') }
          else runtime.lander = { ...LANDED_STATE }
        } else {
          ctl.enabled = true
          ctl.update()
        }
      }
    }
    const perspective = camera as T.PerspectiveCamera
    const offset =
      size.width >= 1000
        ? runtime.focus === 'Moon' && !runtime.sky
          ? -40 * Math.min(1, Math.max(0, altitude / 50000))
          : 110
        : 0
    const offsetY =
      size.width < 768 && runtime.focus === 'Moon' && !runtime.sky
        ? 50 * Math.min(1, Math.max(0, altitude / 50000))
        : 0
    if (
      perspective.view?.offsetX !== offset ||
      perspective.view?.offsetY !== offsetY ||
      perspective.view?.fullWidth !== size.width ||
      perspective.view?.fullHeight !== size.height
    )
      perspective.setViewOffset(
        size.width,
        size.height,
        offset,
        offsetY,
        size.width,
        size.height,
      )
    const near = runtime.visit ? 0.1 / LUNAR_RADIUS_M : Math.max(
      runtime.local ? 1e-9 : 0.00001,
      Math.min(radius * 0.005, camera.position.distanceTo(ctl.target) * 0.002),
    )
    if (Math.abs(perspective.near - near) > near * 0.05) {
      perspective.near = near
      perspective.updateProjectionMatrix()
    }
  }, -2)
  useFrame(() => {
    if (!runtime.local || !terrainStore || !controls.current) return
    const moon = data.bodies.find((b) => b.name === 'Moon')!,
      q = attitudeAt(moon, props.clock.current.row)
    const p = camera.position
      .clone()
      .add(runtime.origin)
      .sub(runtime.positions.get('Moon')!)
      .applyQuaternion(q.clone().invert())
    const unit = p.clone().normalize(),
      lat = (Math.asin(Math.max(-1, Math.min(1, unit.y))) * 180) / Math.PI,
      lon = (Math.atan2(-unit.z, unit.x) * 180) / Math.PI
    const height = terrainStore.bestHeight(lat, lon)
    if (
      height !== null &&
      p.length() * LUNAR_RADIUS_M < LUNAR_RADIUS_M + height + 2
    ) {
      p.copy(unit)
        .multiplyScalar(1 + (height + 2) / LUNAR_RADIUS_M)
        .applyQuaternion(q)
        .add(runtime.positions.get('Moon')!)
        .sub(runtime.origin)
      camera.position.copy(p)
      camera.lookAt(controls.current.target)
    }
  })
  // Standing observer: orientation from the free-look bearing each frame (the
  // Moon's attitude changes under the clock, so this must track every frame).
  // Runs after the terrain clamp above, so the visit pose wins.
  const presentationReduced=useReducedMotion(),presentationDistance=useRef(0),presentationBobM=useRef(0)
  const motionScale=presentationReduced?0:Math.max(0,Math.min(1,Number.isFinite(props.motionScale)?props.motionScale!:1))
  const suitLamp=devParam('suitLamp')!==null||!!props.suitLamp
  /** Presentation state: start/stop ramp of the walking speed, smoothed view, gait strength and landing dip. */
  const walkRamp=useRef({speed:0,forward:0,right:0})
  const presentation=useRef({ready:false,yaw:0,pitch:0,gait:0,dip:0,airborne:false})
  const lastVisitReport = useRef(0)
  const lastVisitPose = useRef<VisitPose|null>(null)
  const visitReportTimer = useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  useEffect(()=>()=>clearTimeout(visitReportTimer.current),[])
  useFrame((_,delta) => {
    if (!runtime.visit || !runtime.visitLook || !runtime.visitAnchor){
      movementKeys.current.clear();runtime.walkInput={forward:0,right:0};endGoTo('cancelled')
      presentation.current.ready=false;walkRamp.current.speed=0
      if(document.pointerLockElement===gl.domElement)document.exitPointerLock()
      return
    }
    if(document.hidden)return
    const dt=motionDelta(delta),keys=movementKeys.current
    // While the landing simulation drives the camera, the visitor does not walk or leave prints.
    const landing=runtime.landing?.start!=null,paused=!!propsRef.current.movementPaused
    if(landing||paused){keys.clear();runtime.walkInput={forward:0,right:0}}
    const moveForward=Number(keys.has('w'))-Number(keys.has('s'))+runtime.walkInput.forward,moveRight=Number(keys.has('d'))-Number(keys.has('a'))+runtime.walkInput.right
    const previousOffset={...runtime.visitOffset}
    if(runtime.astronaut.airborne){
      const speed=Math.hypot(runtime.astronaut.eastMps,runtime.astronaut.northMps)
      if(speed){
        const anchor=runtime.visitAnchor,nominal={lat:Math.asin(anchor.up.y)*180/Math.PI,lonEast:Math.atan2(-anchor.up.z,anchor.up.x)*180/Math.PI}
        const next=checkedViewpointStep(nominal,runtime.visitOffset,0,runtime.astronaut.northMps,runtime.astronaut.eastMps,speed*dt,(lat,lon)=>runtime.terrainReady?terrainStore?.bestHeight(lat,lon)??null:null)
        const solid=pushOut(next,walkObstacles())
        runtime.visitOffset={eastM:solid.eastM,northM:solid.northM};runtime.movementBlocked=next.blocked
        if(next.blocked){runtime.astronaut.eastMps=0;runtime.astronaut.northMps=0}
      }
    }else if(moveForward||moveRight){
      // The walking speed eases in over a fraction of a second (and out below), so starts and stops do not jolt.
      endGoTo('cancelled');const ramp=walkRamp.current;ramp.speed+=(1-ramp.speed)*(1-Math.exp(-dt*10));ramp.forward=moveForward;ramp.right=moveRight
      moveViewpoint(moveForward,moveRight,WALK_SPEED_MPS*(runtime.crouched ? .5 : 1)*dt*ramp.speed);invalidate()
    }
    else if(walkRamp.current.speed>.03&&!goToRun.current&&!landing&&!paused&&runtime.terrainReady){
      const ramp=walkRamp.current;ramp.speed*=Math.exp(-dt*11)
      moveViewpoint(ramp.forward,ramp.right,WALK_SPEED_MPS*(runtime.crouched ? .5 : 1)*dt*ramp.speed);invalidate()
    }
    else if(goToRun.current&&!landing&&!paused&&runtime.terrainReady){
      // Guided walk: the same checked step as the keys, along the bearing to the destination, steering around
      // the illustrative objects; a destination inside one ends at its edge.
      walkRamp.current.speed=0
      const run=goToRun.current,look=runtime.visitLook,obstacles=walkObstacles(),goal=reachableTarget(run,runtime.visitOffset,obstacles)
      const dE=goal.eastM-runtime.visitOffset.eastM,dN=goal.northM-runtime.visitOffset.northM,remaining=Math.hypot(dE,dN)
      if(remaining<=1.5)endGoTo('arrived')
      else{
        const bearing=steerBearing(runtime.visitOffset,goal,obstacles),now=performance.now()
        if(!presentationReduced&&!guideTurn.current&&now-lastManualLook.current>1200){
          const turn=Math.atan2(Math.sin(bearing-look.yaw),Math.cos(bearing-look.yaw))
          look.yaw+=turn*(1-Math.exp(-dt*3.2))
        }
        const anchor=runtime.visitAnchor,site={lat:Math.asin(anchor.up.y)*180/Math.PI,lonEast:Math.atan2(-anchor.up.z,anchor.up.x)*180/Math.PI}
        const step=checkedViewpointStep(site,runtime.visitOffset,bearing*180/Math.PI,1,0,Math.min(remaining,WALK_SPEED_MPS*(runtime.crouched ? .5 : 1)*dt),(lat,lon)=>runtime.terrainReady?terrainStore?.bestHeight(lat,lon)??null:null)
        const solid=pushOut(step,obstacles)
        const progressed=Math.hypot(solid.eastM-runtime.visitOffset.eastM,solid.northM-runtime.visitOffset.northM)>1e-4
        runtime.visitOffset={eastM:solid.eastM,northM:solid.northM};runtime.movementBlocked=step.blocked
        if(step.blocked&&!progressed||step.blocked&&step.reason==='boundary'){run.blockedSince??=now;if(now-run.blockedSince>1000)endGoTo('blocked')}
        else run.blockedSince=null
        invalidate()
      }
    }
    const walking=!landing&&!runtime.astronaut.airborne&&Math.hypot(runtime.visitOffset.eastM-previousOffset.eastM,runtime.visitOffset.northM-previousOffset.northM)>1e-6
    const moon = data.bodies.find((b) => b.name === 'Moon')!
    const q = attitudeAt(moon, props.clock.current.row)
    const turn=guideTurn.current
    if(turn){
      const t=Math.min(1,(performance.now()-turn.start)/850),ease=t*t*(3-2*t)
      runtime.visitLook.yaw=turn.yaw+turn.deltaYaw*ease
      runtime.visitLook.pitch=turn.pitch+turn.deltaPitch*ease
      if(t===1)guideTurn.current=null
      else invalidate()
    }
    const { yaw, pitch } = runtime.visitLook
    const anchor=runtime.visitAnchor
    const nominal={lat:Math.asin(anchor.up.y)*180/Math.PI,lonEast:Math.atan2(-anchor.up.z,anchor.up.x)*180/Math.PI}
    const point=viewpointCoordinates(nominal,runtime.visitOffset),frame=localFrame(sitePosition(point.lat,point.lonEast))
    const a={up:visitTemps.up.set(...frame.up),north:visitTemps.north.set(...frame.north),east:visitTemps.east.set(...frame.east)}
    // Keep the observer on the selected ground as the Moon rotates and finer
    // elevation tiles arrive. Camera movement does not relocate the mission target.
    const lat = Math.asin(a.up.y) * 180 / Math.PI
    const lon = Math.atan2(-a.up.z, a.up.x) * 180 / Math.PI
    const fallback = props.sites.find(s => Math.abs(s.lat-lat)<0.0001 && Math.abs((((s.lonEast-lon)+540)%360)-180)<0.0001)?.siteHeightM ?? 0
    const measuredGround=runtime.terrainReady?terrainStore?.bestHeight(lat,lon)??null:null
    const ground = measuredGround ?? lastVisitPose.current?.groundM ?? fallback
    runtime.astronaut=advanceAstronaut(runtime.astronaut,measuredGround,dt)
    const feet=Math.max(ground,runtime.astronaut.feetM??ground),heightAboveGroundM=feet-ground
    const eyeTarget=runtime.crouched?CROUCH_EYE_HEIGHT_M:ASTRONAUT_EYE_HEIGHT_M
    runtime.eyeHeightM+=(eyeTarget-runtime.eyeHeightM)*(1-Math.exp(-dt*16))
    if(Math.abs(eyeTarget-runtime.eyeHeightM)<.001)runtime.eyeHeightM=eyeTarget;else invalidate()
    // Presentation only (camera, never the reported pose or any value): a footstep bob with a little sway and
    // roll, and a soft knee-dip when landing from a jump, all scaled by motionScale. Without that prop the bob
    // follows the surface "motion" preference as before.
    const moved=Math.hypot(runtime.visitOffset.eastM-previousOffset.eastM,runtime.visitOffset.northM-previousOffset.northM)
    presentationDistance.current+=moved
    const pres=presentation.current,bobScale=props.motionScale!==undefined?motionScale:(props.surfacePreferences?.motion&&!presentationReduced?1:0)
    const pace=walking?Math.min(1,moved/Math.max(dt,1e-3)/WALK_SPEED_MPS):0
    pres.gait+=(pace-pres.gait)*(1-Math.exp(-dt*(walking?7:5)))
    if(pres.airborne&&!runtime.astronaut.airborne)pres.dip=Math.min(.07,.012+Math.abs(runtime.astronaut.verticalMps)*.018)*bobScale
    pres.airborne=runtime.astronaut.airborne;pres.dip*=Math.exp(-dt*6)
    const phase=presentationDistance.current*Math.PI/.85,gait=pres.gait*bobScale
    const bobM=gait*.016*(Math.abs(Math.sin(phase))-.64)-pres.dip,swayM=gait*.009*Math.sin(phase),rollR=gait*.0035*Math.sin(phase)
    presentationBobM.current=bobM
    if(pres.gait>.002||pres.dip>.0005)invalidate()
    camera.position.copy(a.up).multiplyScalar(1+(feet+runtime.eyeHeightM+bobM)/LUNAR_RADIUS_M).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
    const previousTrail=runtime.trail.at(-1)
    if(!landing&&!runtime.astronaut.airborne&&runtime.terrainReady&&runtime.terrainMesh&&(!previousTrail||Math.hypot(runtime.visitOffset.eastM-previousTrail.eastM,runtime.visitOffset.northM-previousTrail.northM)>=.7)){
      const sample=samplerFn.current, de=runtime.visitOffset.eastM,dn=runtime.visitOffset.northM,step=Math.max(1,Number(runtime.terrainMesh?.userData.spacingM)||20)
      const hE=sample?.(de+step,dn),hW=sample?.(de-step,dn),hN=sample?.(de,dn+step),hS=sample?.(de,dn-step)
      if(measuredGround!==null&&hE!=null&&hW!=null&&hN!=null&&hS!=null){
        const point=visitTemps.point.copy(a.up).multiplyScalar(1+(measuredGround+.025)/LUNAR_RADIUS_M)
        const normal=visitTemps.normal.copy(a.up).addScaledVector(a.east,-(hE-hW)/(2*step)).addScaledVector(a.north,-(hN-hS)/(2*step)).normalize()
        runtime.trailOrigin??=point.clone()
        const added=appendTrail(runtime.trail,{...runtime.visitOffset,point:point.toArray() as [number,number,number],normal:normal.toArray() as [number,number,number],heading:yaw*180/Math.PI,step:runtime.trailStepCount++})
        runtime.trail=added.points;runtime.trailDistanceM+=added.distance;runtime.trailRevision++
      }
    }
    if(runtime.astronaut.airborne||moveForward||moveRight)invalidate()
    // Smoothed look: the camera follows the commanded heading/pitch over a few tens of milliseconds, so mouse,
    // keys and touch turn without stepping. Landing, guided turns and reduced motion use it directly.
    if(presentationReduced||landing||!pres.ready||guideTurn.current){pres.yaw=yaw;pres.pitch=pitch;pres.ready=true}
    else{
      const k=1-Math.exp(-Math.min(delta,.05)*26),dYaw=Math.atan2(Math.sin(yaw-pres.yaw),Math.cos(yaw-pres.yaw))
      if(Math.abs(dYaw)>1.2)pres.yaw=yaw;else pres.yaw+=dYaw*k
      pres.pitch+=(pitch-pres.pitch)*k
      if(Math.abs(dYaw)>2e-4||Math.abs(pitch-pres.pitch)>2e-4)invalidate();else{pres.yaw=yaw;pres.pitch=pitch}
    }
    const viewYaw=pres.yaw,viewPitch=pres.pitch
    const forward = visitTemps.forward.copy(a.north)
      .multiplyScalar(Math.cos(viewYaw) * Math.cos(viewPitch))
      .addScaledVector(a.east, Math.sin(viewYaw) * Math.cos(viewPitch))
      .addScaledVector(a.up, Math.sin(viewPitch))
      .applyQuaternion(q)
    if(swayM){const right=visitTemps.right.copy(a.east).multiplyScalar(Math.cos(viewYaw)).addScaledVector(a.north,-Math.sin(viewYaw)).applyQuaternion(q);camera.position.addScaledVector(right,swayM/LUNAR_RADIUS_M)}
    camera.up.copy(a.up).applyQuaternion(q).normalize()
    if(rollR)camera.up.applyAxisAngle(visitTemps.target.copy(forward).normalize(),rollR)
    camera.lookAt(visitTemps.target.copy(camera.position).add(forward))
    if (controls.current)
      controls.current.target.copy(camera.position).addScaledVector(forward, 0.05)
    const now = performance.now()
    const pose={heading:(((yaw*180)/Math.PI)%360+360)%360,pitch:pitch*180/Math.PI,fov:(camera as T.PerspectiveCamera).fov,...runtime.visitOffset,lat,lonEast:lon,groundM:ground,movementBlocked:runtime.movementBlocked,airborne:runtime.astronaut.airborne,heightAboveGroundM,verticalMps:runtime.astronaut.verticalMps,walking,crouched:runtime.crouched,eyeHeightM:runtime.eyeHeightM,trailSteps:Math.max(0,runtime.trailStepCount-1),trailDistanceM:runtime.trailDistanceM}
    const previous=lastVisitPose.current
    if(!previous || pose.crouched!==previous.crouched || Math.abs(pose.eyeHeightM-(previous.eyeHeightM??ASTRONAUT_EYE_HEIGHT_M))>.005 || pose.trailSteps!==previous.trailSteps || Math.abs(pose.heading-previous.heading)>0.005 || Math.abs(pose.pitch-previous.pitch)>0.005 || Math.abs(pose.fov-previous.fov)>0.005 || Math.hypot(pose.eastM-(previous.eastM??0),pose.northM-(previous.northM??0))>.05 || pose.movementBlocked!==previous.movementBlocked || pose.airborne!==previous.airborne || pose.walking!==previous.walking || Math.abs(heightAboveGroundM-(previous.heightAboveGroundM??0))>.01){
      if(props.surfacePreferences?.fieldMode || now-lastVisitReport.current>120){
        clearTimeout(visitReportTimer.current);visitReportTimer.current=undefined
        lastVisitReport.current=now;lastVisitPose.current=pose;props.onVisit?.(pose)
      }else if(!visitReportTimer.current){
        visitReportTimer.current=setTimeout(()=>{visitReportTimer.current=undefined;invalidate()},125-(now-lastVisitReport.current))
      }
    }
    // The demand canvas sleeps while the observer and clock are still. Pointer,
    // keyboard, clock and tile updates invalidate only when a fresh frame is needed.
  })
  // Offer the DEM sampler for the current visit target; a new function only when the target or readiness changes.
  const samplerKey=useRef(''),samplerReport=useRef<SceneProps['onTerrainSampler']>(undefined),samplerFn=useRef<TerrainSampler|null>(null)
  const publishSampler=()=>{
    const report=propsRef.current.onTerrainSampler,a=runtime.visitAnchor
    const ready=runtime.visit&&!!a&&!!terrainStore&&runtime.terrainReady
    const key=ready&&a?`${a.up.x}/${a.up.y}/${a.up.z}`:''
    // A listener that arrives mid-visit is told about the current target too (the same function instance,
    // so a listener that stores it in state settles instead of re-rendering every frame).
    if(key===samplerKey.current&&report===samplerReport.current)return
    if(key!==samplerKey.current)samplerFn.current=ready&&a&&terrainStore?visitTerrainSampler(terrainStore,{lat:Math.asin(a.up.y)*180/Math.PI,lonEast:Math.atan2(-a.up.z,a.up.x)*180/Math.PI}):null
    samplerKey.current=key;samplerReport.current=report
    report?.(samplerFn.current)
  }
  // Publish only after every frame callback has finished, regardless of component subscription order.
  // This also catches terrain becoming ready in the last frame before a demand canvas goes idle.
  useEffect(()=>{const unsubscribe=addAfterEffect(publishSampler);invalidate();return unsubscribe},[runtime,terrainStore,invalidate])
  useEffect(()=>()=>{if(samplerKey.current)propsRef.current.onTerrainSampler?.(null);samplerKey.current='';samplerReport.current=undefined;samplerFn.current=null},[])
  useFrame(({gl,scene,camera})=>{
    if(!photoPending.current||document.hidden)return
    if(photoPending.current>1){photoPending.current--;invalidate();return}
    photoPending.current=0
    const context=photoHandlers.current,look=runtime.visitLook,anchor=runtime.visitAnchor
    if(!runtime.visit||!runtime.terrainReady||!look||!anchor){context.onError?.('Visit loaded mission terrain before taking a photo.');return}
    try{
      gl.render(scene,camera)
      const scale=Math.min(1,1024/Math.max(gl.domElement.width,gl.domElement.height)),width=Math.max(1,Math.round(gl.domElement.width*scale)),imageHeight=Math.max(1,Math.round(gl.domElement.height*scale))
      const target=document.createElement('canvas');target.width=width;target.height=imageHeight+82
      const paint=target.getContext('2d');if(!paint)throw new Error('Camera capture unavailable')
      paint.drawImage(gl.domElement,0,0,width,imageHeight)
      const row=props.clock.current.row,sceneUTC=new Date(parseRowT(props.sunRows[0].t).getTime()+row*3600000).toISOString(),capturedUTC=new Date().toISOString(),point=viewpointCoordinates(context.site,runtime.visitOffset)
      const pose:VisitPose={...lastVisitPose.current,...runtime.visitOffset,heading:((look.yaw*180/Math.PI)%360+360)%360,pitch:look.pitch*180/Math.PI,fov:(camera as T.PerspectiveCamera).fov,lat:point.lat,lonEast:point.lonEast,crouched:runtime.crouched,eyeHeightM:runtime.eyeHeightM,airborne:runtime.astronaut.airborne,verticalMps:runtime.astronaut.verticalMps,heightAboveGroundM:Math.max(0,(runtime.astronaut.feetM??0)-(runtime.terrainStore?.bestHeight(point.lat,point.lonEast)??runtime.astronaut.feetM??0))}
      paint.fillStyle='#0b141c';paint.fillRect(0,imageHeight,width,82);paint.fillStyle='#d9e6ed';paint.font=`${Math.max(10,Math.min(14,width/65))}px sans-serif`
      const lines=[`CHADER BURI SIMULATION · ${context.site.name}`,`Scene ${sceneUTC.slice(0,19).replace('T',' ')} UTC`,`${point.lat.toFixed(5)}°, ${point.lonEast.toFixed(5)}° E · heading ${pose.heading.toFixed(0)}° · lens ${pose.fov.toFixed(0)}°`,`Display light ${runtime.inspectionEnabled?'on':'off'} · illustrative soil, trail and visitor equipment`]
      lines.forEach((line,i)=>paint.fillText(line,12,imageHeight+17+i*18,width-24))
      const light=runtime.inspectionEnabled,id=`photo-${Date.now()}`
      target.toBlob(blob=>{if(!photoAlive.current)return;if(!blob){context.onError?.('Camera capture failed. Please try again.');return}context.onPhoto?.({id,siteSlug:context.site.slug,siteName:context.site.name,sceneRow:row,sceneUTC,capturedUTC,pose,light,equipment:{...(props.equipment??DEFAULT_EQUIPMENT)},trailVisible:!!props.trailVisible,imageUrl:URL.createObjectURL(blob),note:'',width,height:target.height,datasetId:context.datasetId??'',model:MODEL_VERSION})},'image/jpeg',.86)
    }catch{context.onError?.('Camera capture failed. Please try again.')}
  })
  return (
    <>
      <Sky deep={props.options.deepSky} runtime={runtime} />
      {terrainStore && (
        <LunarTerrain
          store={terrainStore}
          moon={data.bodies.find((b) => b.name === 'Moon')!}
          runtime={runtime}
          clock={props.clock}
          sites={props.sites}
          contrast={!!props.options.terrainContrast}
          detailLevel={quality.plan.terrainDetail}
          shadowMapSize={quality.plan.shadowMap}
          suitLamp={suitLamp}
          onView={props.onTerrainView}
        />
      )}
      <VisitScale runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} bearing={props.scaleBearing??null}/>
      <SurveyFlags runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} readings={props.fieldFlags??[]}/>
      <AstronautTrail runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} showLine={!!props.trailVisible}/>
      {/* Built only once a surface visit is requested (see surfaceWanted). */}
      {surfaceWanted&&<>
      <SurfaceEquipment runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} equipment={devEquipment()??props.equipment??DEFAULT_EQUIPMENT} onChange={props.onEquipment} onSelect={props.onSurfaceObject} active={props.activeSurfaceObject}/>
      <SurfaceOutpost runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} site={props.site} missions={props.missions} onSelect={props.onSurfaceObject} status={props.landerStatus}/>
      {props.buri&&<BuriFigure runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} state={props.buri.state} targets={props.buri.targets} onSelect={props.buri.onSelect} presence={props.buri} motionScale={motionScale}/>}
      {props.terrainOverlay&&props.terrainOverlay.mode!=='off'&&<TerrainOverlay runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} settings={props.terrainOverlay} equipment={props.equipment??DEFAULT_EQUIPMENT} buri={!!props.buri&&props.buri.visible!==false} onInfo={props.onTerrainOverlayInfo}/>}
      {!!props.routeLine?.length&&<RouteTrail runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} points={props.routeLine}/>}
      {!!props.fieldMarkers?.length&&<FieldMarkers runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} markers={props.fieldMarkers} onSelect={props.onMarkerSelect}/>}      <SurfaceFocus runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} open={!!props.surfaceInspectorOpen} onFocus={props.onSurfaceFocus} onSelect={props.onSurfaceObject}/>
      <AstronautPresence runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} preferences={props.surfacePreferences??DEFAULT_SURFACE_PREFERENCES}/>
      <FieldGloves runtime={runtime} enabled={!!props.fieldGloves} motionScale={motionScale}/>
      <SurfaceLocate runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} object={props.highlightObject??devHighlight()} pulse={motionScale>0}/>
      <SuitLamp runtime={runtime} enabled={suitLamp}/>
      <SurfaceGrounding runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} buri={!!props.buri&&props.buri.visible!==false}/>
      <SurfaceRocks runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} share={quality.plan.rockShare}/>
      <LunarDust runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} enabled/>
      <LandingSequence runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!} enabled={props.surfacePreferences?.watchLandings??true} onStage={props.onLanding} motionScale={motionScale}/>
      </>}
      {props.assessmentTarget&&<AssessmentTarget runtime={runtime} clock={props.clock} moon={data.bodies.find(b=>b.name==='Moon')!}/>}
      {data.bodies.map((b) => (
        <Suspense key={b.name} fallback={null}>
        <Planet
          body={b}
          runtime={runtime}
          clock={props.clock}
          options={props.options}
          onFly={props.onFly}
        >
          {b.name === 'Moon' && <LunarLayers props={props} runtime={runtime} />}
        </Planet>
        </Suspense>
      ))}
      {data.bodies
        .filter((b) => b.parent)
        .map((b) => (
          <Orbit
            key={b.name}
            body={b}
            runtime={runtime}
            hour={props.clock.current.row}
            visible={props.options.orbits}
          />
        ))}
      <TrackballControls
        ref={attachControls}
        makeDefault
        onStart={() => invalidate()}
        onEnd={() => invalidate()}
        rotateSpeed={2.2}
        zoomSpeed={1.8}
        staticMoving
        dynamicDampingFactor={0.15}
      />
    </>
  )
}

export function SpaceScene(props: SceneProps) {
  const reportFailure = props.onUnavailable
  const [data, setData] = useState<SpaceData | null>(null),
    [error, setError] = useState('')
  const [compact,setCompact]=useState(()=>window.matchMedia('(max-width:767px)').matches)
  useEffect(()=>{
    const query=window.matchMedia('(max-width:767px)'),changed=()=>setCompact(query.matches)
    query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed)
  },[])
  // Render quality: a fixed level, or 'auto' starting from a device guess and adapted in the scene.
  const setting=devQuality()??props.quality??'auto'
  // 'auto' starts from the GPU class (one released probe: integrated GPUs start at balanced, software rasterisers
  // at low) and the device, then adapts to measured frame times.
  const [autoLevel,setAutoLevel]=useState<QualityLevel>(()=>startQuality(probeGraphics().gpu,navigator.hardwareConcurrency,(navigator as Navigator&{deviceMemory?:number}).deviceMemory,window.matchMedia('(max-width:767px)').matches))
  const level=setting==='auto'?autoLevel:setting
  const plan=qualityPlan(level,window.devicePixelRatio,compact)
  // Keep adaptive density in Canvas's declarative configuration. Imperative setDpr is overwritten when
  // any parent refresh configures Canvas again (including the quality report itself).
  const pixelScope=`${setting}/${level}/${plan.dpr}`
  const [pixelRequest,setPixelRequest]=useState<{key:string;dpr:number}|null>(null)
  const renderDpr=setting==='auto'&&level==='low'&&pixelRequest?.key===pixelScope?pixelRequest.dpr:plan.dpr
  const onAutoDpr=(dpr:number)=>setPixelRequest(previous=>previous?.key===pixelScope&&previous.dpr===dpr?previous:{key:pixelScope,dpr})
  // Multisampling is fixed when the context is created: off when the scene starts at low (a conservative start or
  // a retry after a graphics failure), since it multiplies the fill cost the measurements show is the bottleneck.
  const [antialias]=useState(()=>level!=='low')
  // A lost WebGL context that the browser does not restore within a few seconds is reported to the app (which
  // offers a bounded retry); three.js already calls preventDefault so a quick restore just continues.
  const alive=useRef(true),lostTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),contextEvents=useRef<{canvas:HTMLCanvasElement;lost:(e:Event)=>void;restored:()=>void}|null>(null)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(lostTimer.current);const c=contextEvents.current;if(c){c.canvas.removeEventListener('webglcontextlost',c.lost);c.canvas.removeEventListener('webglcontextrestored',c.restored)}}},[])
  const watchContext=(canvas:HTMLCanvasElement)=>{
    const lost=()=>{clearTimeout(lostTimer.current);lostTimer.current=setTimeout(()=>{if(alive.current)props.onGraphicsFailure?.(new Error('WebGL context lost and not restored within 5 s (CONTEXT_LOST_WEBGL)'))},5000)}
    const restored=()=>clearTimeout(lostTimer.current)
    canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored)
    contextEvents.current={canvas,lost,restored}
  }
  useEffect(() => {
    let active = true
    loadSpace()
      .then((x) => {
        if (active) setData(x)
      })
      .catch((e) => {
        if (active) { setError(String(e)); reportFailure?.(); props.onGraphicsFailure?.(e) }
      })
    return () => {
      active = false
    }
  }, [reportFailure])
  if (error)
    return (
      <div className="scene-loading" role="alert">
        Space view unavailable. {error}
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  if (!data)
    return <div className="scene-loading" role="status">Preparing your solar-system view…</div>
  return (
    <Canvas
      shadows
      frameloop={props.suspended ? 'never' : 'demand'}
      camera={sceneCamera}
      dpr={renderDpr}
      gl={{ antialias, alpha: false, logarithmicDepthBuffer: true }}
      onCreated={({ gl }) => watchContext(gl.domElement)}
    >
      <Suspense fallback={null}>
        <World data={data} props={props} quality={{level,auto:setting==='auto',plan,onAutoLevel:setAutoLevel,onAutoDpr}} />
      </Suspense>
    </Canvas>
  )
}
