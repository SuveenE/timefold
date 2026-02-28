import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
// @ts-expect-error -- JS module exists at runtime; node16 resolution cannot find the types.
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer';
import type { ImageSplat } from '../types/gallery';
import SPARK_SPLAT_DEFINES from '../utils/sparkSplatDefines';

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

type SplatViewerProps = {
  splat: ImageSplat;
};

const MAX_POINTS = 180000;
const SH_C0 = 0.28209479177387814;

// ---------------------------------------------------------------------------
// Inline GLSL shaders (no webpack loader needed)
// ---------------------------------------------------------------------------

const SIMPLEX_NOISE_4D = /* glsl */ `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
float permute(float x){return floor(mod(((x*34.0)+1.0)*x, 289.0));}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float taylorInvSqrt(float r){return 1.79284291400159 - 0.85373472095314 * r;}

vec4 grad4(float j, vec4 ip){
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p,s;
  p.xyz = floor( fract (vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www;
  return p;
}

float simplexNoise4d(vec4 v){
  const vec2 C = vec2( 0.138196601125010504, 0.309016994374947451);
  vec4 i  = floor(v + dot(v, C.yyyy) );
  vec4 x0 = v -   i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step( x0.yzw, x0.xxx );
  vec3 isYZ = step( x0.zww, x0.yyz );
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp( i0, 0.0, 1.0 );
  vec4 i2 = clamp( i0-1.0, 0.0, 1.0 );
  vec4 i1 = clamp( i0-2.0, 0.0, 1.0 );
  vec4 x1 = x0 - i1 + 1.0 * C.xxxx;
  vec4 x2 = x0 - i2 + 2.0 * C.xxxx;
  vec4 x3 = x0 - i3 + 3.0 * C.xxxx;
  vec4 x4 = x0 - 1.0 + 4.0 * C.xxxx;
  i = mod(i, 289.0);
  float j0 = permute( permute( permute( permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute( permute( permute( permute (
             i.w + vec4(i1.w, i2.w, i3.w, 1.0 ))
           + i.z + vec4(i1.z, i2.z, i3.z, 1.0 ))
           + i.y + vec4(i1.y, i2.y, i3.y, 1.0 ))
           + i.x + vec4(i1.x, i2.x, i3.x, 1.0 ));
  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0) ;
  vec4 p0 = grad4(j0,   ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4,p4));
  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)            ), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 49.0 * ( dot(m0*m0, vec3( dot( p0, x0 ), dot( p1, x1 ), dot( p2, x2 )))
               + dot(m1*m1, vec2( dot( p3, x3 ), dot( p4, x4 ) ) ) ) ;
}
`;

const GPGPU_PARTICLES_SHADER = /* glsl */ `
uniform float uTime;
uniform float uDeltaTime;
uniform sampler2D uBase;
uniform float uFlowFieldInfluence;
uniform float uFlowFieldStrength;
uniform float uFlowFieldFrequency;

${SIMPLEX_NOISE_4D}

void main() {
  float time = uTime * 0.2;
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 particle = texture2D(uParticles, uv);
  vec4 base = texture2D(uBase, uv);

  if (particle.a >= 1.0) {
    particle.a = mod(particle.a, 1.0);
    particle.xyz = base.xyz;
  } else {
    float strength = simplexNoise4d(vec4(base.xyz * 0.7, time + 1.0));
    float influence = (uFlowFieldInfluence - 0.5) * (-2.0);
    strength = smoothstep(influence, 1.0, strength);

    vec3 flowField = vec3(
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 0.0, time)),
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 1.0, time)),
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 2.0, time))
    );
    flowField = normalize(flowField);
    particle.xyz += flowField * uDeltaTime * strength * uFlowFieldStrength;

    particle.a += uDeltaTime * 0.9;
  }

  gl_FragColor = particle;
}
`;

const PARTICLES_VERT = /* glsl */ `
uniform vec2 uResolution;
uniform float uSize;
uniform sampler2D uParticlesTexture;

attribute vec2 aParticlesUv;
attribute vec3 aColor;
attribute float aSize;

varying vec3 vColor;

void main() {
  vec4 particle = texture2D(uParticlesTexture, aParticlesUv);

  vec4 modelPosition = modelMatrix * vec4(particle.xyz, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  vec4 projectedPosition = projectionMatrix * viewPosition;
  gl_Position = projectedPosition;

  float sizeIn = smoothstep(0.0, 0.6, particle.a);
  float sizeOut = 1.0 - smoothstep(0.6, 1.0, particle.a);
  float size = min(sizeIn, sizeOut);

  gl_PointSize = size * aSize * uSize * uResolution.y;
  gl_PointSize *= (1.0 / -viewPosition.z);

  vColor = aColor;
}
`;

const PARTICLES_FRAG = /* glsl */ `
varying vec3 vColor;

void main() {
  vec2 coord = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(coord, coord);

  if (r2 > 1.0)
    discard;

  vec3 normal = vec3(coord, sqrt(1.0 - r2));
  vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));

  float diffuse = max(dot(normal, lightDir), 0.0);

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 32.0);

  vec3 color = vColor * (0.5 + 0.5 * diffuse) + vec3(0.05) * specular;

  gl_FragColor = vec4(color, 1.0);
}
`;

// ---------------------------------------------------------------------------
// PLY parsing helpers
// ---------------------------------------------------------------------------

type PlyScalarType =
  | 'char'
  | 'uchar'
  | 'short'
  | 'ushort'
  | 'int'
  | 'uint'
  | 'float'
  | 'double';

type VertexProperty = {
  name: string;
  type: PlyScalarType;
  offset: number;
};

const PLY_TYPE_BYTE_SIZE: Record<PlyScalarType, number> = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  double: 8,
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }

  return 'Unknown error';
};

const toUint8Array = (bytes: unknown): Uint8Array | null => {
  if (!bytes) {
    return null;
  }

  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes);
  }

  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }

  if (ArrayBuffer.isView(bytes)) {
    const view = bytes;
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
    );
  }

  if (
    typeof bytes === 'object' &&
    bytes &&
    (bytes as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((bytes as { data?: unknown }).data)
  ) {
    return new Uint8Array((bytes as { data: number[] }).data);
  }

  if (Array.isArray(bytes)) {
    return new Uint8Array(bytes);
  }

  return null;
};

const getSplatExtension = (splatPath: string): string => {
  const match = splatPath.toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
};

const findHeaderEndOffset = (bytes: Uint8Array): number => {
  const marker = new TextEncoder().encode('end_header');
  let i = 0;
  while (i <= bytes.length - marker.length) {
    let matched = true;
    for (let j = 0; j < marker.length; j += 1) {
      if (bytes[i + j] !== marker[j]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      const markerEnd = i + marker.length;
      if (markerEnd < bytes.length && bytes[markerEnd] === 10) {
        return markerEnd + 1;
      }
      if (
        markerEnd + 1 < bytes.length &&
        bytes[markerEnd] === 13 &&
        bytes[markerEnd + 1] === 10
      ) {
        return markerEnd + 2;
      }
    }

    i += 1;
  }

  return -1;
};

const parsePlyVertexLayout = (
  bytes: Uint8Array,
): {
  vertexCount: number;
  vertexStrideBytes: number;
  vertexProperties: VertexProperty[];
  dataOffset: number;
} => {
  const dataOffset = findHeaderEndOffset(bytes);
  if (dataOffset < 0) {
    throw new Error('PLY header is missing end_header');
  }

  const headerText = new TextDecoder().decode(bytes.subarray(0, dataOffset));
  const lines = headerText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines[0] !== 'ply') {
    throw new Error('Not a PLY file');
  }

  const formatLine = lines.find((line) => line.startsWith('format '));
  if (!formatLine || !formatLine.includes('binary_little_endian')) {
    throw new Error('Only binary_little_endian PLY is supported');
  }

  let activeElement: string | null = null;
  let vertexCount = 0;
  let vertexStrideBytes = 0;
  const vertexProperties: VertexProperty[] = [];

  lines.forEach((line) => {
    const tokens = line.split(/\s+/);
    if (tokens[0] === 'element' && tokens.length >= 3) {
      [, activeElement] = tokens;
      if (activeElement === 'vertex') {
        vertexCount = Number.parseInt(tokens[2], 10);
      }
    } else if (tokens[0] === 'property' && activeElement === 'vertex') {
      if (tokens[1] === 'list') {
        throw new Error('List properties in vertex element are not supported');
      }

      const type = tokens[1] as PlyScalarType;
      const name = tokens[2];
      const byteSize = PLY_TYPE_BYTE_SIZE[type];

      if (!byteSize || !name) {
        throw new Error(`Unsupported vertex property: ${line}`);
      }

      vertexProperties.push({ name, type, offset: vertexStrideBytes });
      vertexStrideBytes += byteSize;
    }
  });

  if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
    throw new Error('PLY file has no vertices');
  }
  if (vertexStrideBytes <= 0 || vertexProperties.length === 0) {
    throw new Error('PLY vertex layout is empty');
  }

  return { vertexCount, vertexStrideBytes, vertexProperties, dataOffset };
};

const readScalar = (
  view: DataView,
  byteOffset: number,
  type: PlyScalarType,
): number => {
  switch (type) {
    case 'char':
      return view.getInt8(byteOffset);
    case 'uchar':
      return view.getUint8(byteOffset);
    case 'short':
      return view.getInt16(byteOffset, true);
    case 'ushort':
      return view.getUint16(byteOffset, true);
    case 'int':
      return view.getInt32(byteOffset, true);
    case 'uint':
      return view.getUint32(byteOffset, true);
    case 'float':
      return view.getFloat32(byteOffset, true);
    case 'double':
      return view.getFloat64(byteOffset, true);
    default:
      return 0;
  }
};

// ---------------------------------------------------------------------------
// Parse PLY bytes into flat position + color arrays
// ---------------------------------------------------------------------------

const parsePlyData = (
  bytes: Uint8Array,
): { positions: Float32Array; colors: Float32Array; count: number } => {
  const { vertexCount, vertexStrideBytes, vertexProperties, dataOffset } =
    parsePlyVertexLayout(bytes);

  const requiredByteLength = dataOffset + vertexCount * vertexStrideBytes;
  if (bytes.byteLength < requiredByteLength) {
    throw new Error('PLY file is truncated');
  }

  const propertyMap = new Map(
    vertexProperties.map((property) => [property.name, property] as const),
  );
  const positionX = propertyMap.get('x');
  const positionY = propertyMap.get('y');
  const positionZ = propertyMap.get('z');
  if (!positionX || !positionY || !positionZ) {
    throw new Error('PLY vertex properties x/y/z are required');
  }

  const colorDc0 = propertyMap.get('f_dc_0');
  const colorDc1 = propertyMap.get('f_dc_1');
  const colorDc2 = propertyMap.get('f_dc_2');
  const colorRed = propertyMap.get('red') ?? propertyMap.get('r');
  const colorGreen = propertyMap.get('green') ?? propertyMap.get('g');
  const colorBlue = propertyMap.get('blue') ?? propertyMap.get('b');
  const hasShColor = Boolean(colorDc0 && colorDc1 && colorDc2);
  const hasRgbColor = Boolean(colorRed && colorGreen && colorBlue);

  const stride = Math.max(1, Math.ceil(vertexCount / MAX_POINTS));
  const sampleCount = Math.ceil(vertexCount / stride);
  const positions = new Float32Array(sampleCount * 3);
  const colors = new Float32Array(sampleCount * 3);
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + dataOffset,
    vertexCount * vertexStrideBytes,
  );
  let writeIndex = 0;

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    if (vertexIndex % stride === 0 && writeIndex < sampleCount) {
      const vertexOffset = vertexIndex * vertexStrideBytes;
      const x = readScalar(
        view,
        vertexOffset + positionX.offset,
        positionX.type,
      );
      const y = readScalar(
        view,
        vertexOffset + positionY.offset,
        positionY.type,
      );
      const z = readScalar(
        view,
        vertexOffset + positionZ.offset,
        positionZ.type,
      );

      const base = writeIndex * 3;
      positions[base] = x;
      positions[base + 1] = y;
      positions[base + 2] = z;

      if (hasShColor) {
        const rawR = readScalar(
          view,
          vertexOffset + (colorDc0 as VertexProperty).offset,
          (colorDc0 as VertexProperty).type,
        );
        const rawG = readScalar(
          view,
          vertexOffset + (colorDc1 as VertexProperty).offset,
          (colorDc1 as VertexProperty).type,
        );
        const rawB = readScalar(
          view,
          vertexOffset + (colorDc2 as VertexProperty).offset,
          (colorDc2 as VertexProperty).type,
        );
        colors[base] = clamp(0.5 + SH_C0 * rawR, 0, 1);
        colors[base + 1] = clamp(0.5 + SH_C0 * rawG, 0, 1);
        colors[base + 2] = clamp(0.5 + SH_C0 * rawB, 0, 1);
      } else if (hasRgbColor) {
        const rawR = readScalar(
          view,
          vertexOffset + (colorRed as VertexProperty).offset,
          (colorRed as VertexProperty).type,
        );
        const rawG = readScalar(
          view,
          vertexOffset + (colorGreen as VertexProperty).offset,
          (colorGreen as VertexProperty).type,
        );
        const rawB = readScalar(
          view,
          vertexOffset + (colorBlue as VertexProperty).offset,
          (colorBlue as VertexProperty).type,
        );
        const normalizedR = rawR > 1 ? rawR / 255 : rawR;
        const normalizedG = rawG > 1 ? rawG / 255 : rawG;
        const normalizedB = rawB > 1 ? rawB / 255 : rawB;
        colors[base] = clamp(normalizedR, 0, 1);
        colors[base + 1] = clamp(normalizedG, 0, 1);
        colors[base + 2] = clamp(normalizedB, 0, 1);
      } else {
        colors[base] = 1;
        colors[base + 1] = 1;
        colors[base + 2] = 1;
      }
      writeIndex += 1;
    }
  }

  if (writeIndex === 0) {
    throw new Error('No vertices sampled from PLY');
  }

  const finalPositions =
    writeIndex === sampleCount
      ? positions
      : positions.subarray(0, writeIndex * 3);
  const finalColors =
    writeIndex === sampleCount ? colors : colors.subarray(0, writeIndex * 3);

  return { positions: finalPositions, colors: finalColors, count: writeIndex };
};

type SparkSplatMesh = THREE.Object3D & {
  initialized?: Promise<unknown>;
  dispose?: () => void;
  getBoundingBox?: (centersOnly?: boolean) => THREE.Box3;
};

type SparkModule = {
  SplatMesh?: new (options?: {
    fileBytes?: Uint8Array | ArrayBuffer;
    fileName?: string;
  }) => SparkSplatMesh;
};

let sparkModulePromise: Promise<SparkModule> | null = null;
let sparkWasmDataFetchPatched = false;

const patchSparkWasmDataFetch = () => {
  if (sparkWasmDataFetchPatched) {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  const patchedFetch: typeof window.fetch = async (
    input: Parameters<typeof window.fetch>[0],
    init?: Parameters<typeof window.fetch>[1],
  ) => {
    let requestUrl = '';
    if (typeof input === 'string') {
      requestUrl = input;
    } else if (input instanceof URL) {
      requestUrl = input.toString();
    } else {
      requestUrl = input.url;
    }
    const dataPrefix = 'data:application/wasm;base64,';

    if (requestUrl.startsWith(dataPrefix)) {
      const base64 = requestUrl.slice(dataPrefix.length);
      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Response(bytes, {
        headers: { 'Content-Type': 'application/wasm' },
      });
    }

    return nativeFetch(input, init);
  };

  window.fetch = patchedFetch;
  sparkWasmDataFetchPatched = true;
};

const loadSparkModule = async (): Promise<SparkModule> => {
  patchSparkWasmDataFetch();
  if (
    typeof THREE.ShaderChunk.splatDefines !== 'string' ||
    THREE.ShaderChunk.splatDefines.length === 0
  ) {
    THREE.ShaderChunk.splatDefines = SPARK_SPLAT_DEFINES;
  }
  if (!sparkModulePromise) {
    sparkModulePromise = import('@sparkjsdev/spark') as Promise<SparkModule>;
  }
  return sparkModulePromise;
};

// ---------------------------------------------------------------------------
// GPGPU particle system setup
// ---------------------------------------------------------------------------

type GpgpuState = {
  gpgpu: GPUComputationRenderer;
  particlesVariable: ReturnType<GPUComputationRenderer['addVariable']>;
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  bounds: THREE.Box3;
};

const setupGpgpuParticles = (
  positions: Float32Array,
  colors: Float32Array,
  vertexCount: number,
  gpgpuRenderer: THREE.WebGLRenderer,
): GpgpuState => {
  const size = Math.ceil(Math.sqrt(vertexCount));

  const gpgpu = new GPUComputationRenderer(size, size, gpgpuRenderer);

  const baseTexture = gpgpu.createTexture();
  const particlesTexture = gpgpu.createTexture();

  for (let i = 0; i < size * size; i += 1) {
    const i3 = i * 3;
    const i4 = i * 4;

    if (i < vertexCount) {
      baseTexture.image.data[i4] = positions[i3];
      baseTexture.image.data[i4 + 1] = positions[i3 + 1];
      baseTexture.image.data[i4 + 2] = positions[i3 + 2];
      baseTexture.image.data[i4 + 3] = Math.random();

      particlesTexture.image.data[i4] = positions[i3];
      particlesTexture.image.data[i4 + 1] = positions[i3 + 1];
      particlesTexture.image.data[i4 + 2] = positions[i3 + 2];
      particlesTexture.image.data[i4 + 3] = Math.random();
    }
  }

  const particlesVariable = gpgpu.addVariable(
    'uParticles',
    GPGPU_PARTICLES_SHADER,
    particlesTexture,
  );

  gpgpu.setVariableDependencies(particlesVariable, [particlesVariable]);

  particlesVariable.material.uniforms.uTime = { value: 0 };
  particlesVariable.material.uniforms.uDeltaTime = { value: 0 };
  particlesVariable.material.uniforms.uBase = { value: baseTexture };
  particlesVariable.material.uniforms.uFlowFieldInfluence = { value: 0.5 };
  particlesVariable.material.uniforms.uFlowFieldStrength = { value: 1.2 };
  particlesVariable.material.uniforms.uFlowFieldFrequency = { value: 0.5 };

  const gpgpuError = gpgpu.init();
  if (gpgpuError) {
    throw new Error(`GPGPU init failed: ${gpgpuError}`);
  }

  // Build particle geometry
  const particlesUv = new Float32Array(vertexCount * 2);
  const sizesArray = new Float32Array(vertexCount);

  for (let i = 0; i < vertexCount; i += 1) {
    const y = Math.floor(i / size);
    const x = i % size;
    particlesUv[i * 2] = (x + 0.5) / size;
    particlesUv[i * 2 + 1] = (y + 0.5) / size;
    sizesArray[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setDrawRange(0, vertexCount);
  geometry.setAttribute(
    'aParticlesUv',
    new THREE.BufferAttribute(particlesUv, 2),
  );
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizesArray, 1));

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: PARTICLES_VERT,
    fragmentShader: PARTICLES_FRAG,
    uniforms: {
      uSize: { value: 0.05 },
      uResolution: {
        value: new THREE.Vector2(
          window.innerWidth * pixelRatio,
          window.innerHeight * pixelRatio,
        ),
      },
      uParticlesTexture: {
        value: gpgpu.getCurrentRenderTarget(particlesVariable).texture,
      },
    },
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  // Compute bounds from positions
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const bounds = new THREE.Box3().setFromBufferAttribute(posAttr);

  return { gpgpu, particlesVariable, points, material, bounds };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SplatViewer({ splat }: SplatViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadInfo, setLoadInfo] = useState<string | null>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);

  useEffect(() => {
    const mountNode = mountRef.current;

    if (!mountNode) {
      return undefined;
    }

    let isDisposed = false;
    let animationFrameId = 0;
    let previousFrameTime = performance.now();
    let gpgpuState: GpgpuState | null = null;
    let sparkMesh: SparkSplatMesh | null = null;
    const orbitTarget = new THREE.Vector3(0, 0, 0);
    let orbitRadius = 3.2;
    let orbitYaw = 0.42;
    let orbitPitch = 0.14;
    let minOrbitRadius = 0.8;
    let maxOrbitRadius = 24;
    let hasManualOrbitInput = false;
    let isPointerDragging = false;
    let activePointerId: number | null = null;
    let pointerLastX = 0;
    let pointerLastY = 0;
    let elapsedTime = 0;
    let hoverYawOffset = 0;
    let hoverPitchOffset = 0;
    let hoverYawTarget = 0;
    let hoverPitchTarget = 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 1200);
    camera.position.set(0, 0, 3.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountNode.appendChild(renderer.domElement);

    const updateCameraFrustum = () => {
      const safeNear = Math.max(0.01, orbitRadius / 2000);
      const safeFar = Math.max(1200, orbitRadius * 6);
      if (camera.near !== safeNear || camera.far !== safeFar) {
        camera.near = safeNear;
        camera.far = safeFar;
        camera.updateProjectionMatrix();
      }
    };

    const updateSize = () => {
      const width = Math.max(1, mountNode.clientWidth);
      const height = Math.max(1, mountNode.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);

      if (gpgpuState) {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        gpgpuState.material.uniforms.uResolution.value.set(
          width * pixelRatio,
          height * pixelRatio,
        );
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(mountNode);

    const applyOrbitFromBounds = (bounds: THREE.Box3) => {
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());

      if (
        Number.isFinite(sphere.radius) &&
        Number.isFinite(sphere.center.x) &&
        Number.isFinite(sphere.center.y) &&
        Number.isFinite(sphere.center.z) &&
        sphere.radius > 0
      ) {
        orbitTarget.copy(sphere.center);
        orbitRadius = Math.max(1.45, sphere.radius * 3.2);
        orbitPitch = 0.14;
        minOrbitRadius = Math.max(0.35, sphere.radius * 0.22);
        maxOrbitRadius = Math.max(minOrbitRadius * 2, sphere.radius * 14);
        orbitRadius = clamp(orbitRadius, minOrbitRadius, maxOrbitRadius);
        updateCameraFrustum();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
        return;
      }
      hasManualOrbitInput = true;
      isPointerDragging = true;
      activePointerId = event.pointerId;
      pointerLastX = event.clientX;
      pointerLastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      const safeWidth = Math.max(1, bounds.width);
      const safeHeight = Math.max(1, bounds.height);
      const pointerX = clamp((event.clientX - bounds.left) / safeWidth, 0, 1);
      const pointerY = clamp((event.clientY - bounds.top) / safeHeight, 0, 1);
      hoverYawTarget = (pointerX * 2 - 1) * 0.36;
      hoverPitchTarget = (1 - pointerY * 2) * 0.22;

      if (!isPointerDragging || activePointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - pointerLastX;
      const deltaY = event.clientY - pointerLastY;
      pointerLastX = event.clientX;
      pointerLastY = event.clientY;

      orbitYaw -= deltaX * 0.006;
      orbitPitch = clamp(orbitPitch - deltaY * 0.0045, -1.2, 1.2);
      event.preventDefault();
    };

    const onPointerLeave = () => {
      hoverYawTarget = 0;
      hoverPitchTarget = 0;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) {
        return;
      }

      isPointerDragging = false;
      activePointerId = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    const onWheel = (event: WheelEvent) => {
      hasManualOrbitInput = true;
      const zoomFactor = Math.exp(event.deltaY * 0.0016);
      orbitRadius = clamp(
        orbitRadius * zoomFactor,
        minOrbitRadius,
        maxOrbitRadius,
      );
      updateCameraFrustum();
      event.preventDefault();
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    const renderFrame = (timeMs: number) => {
      if (isDisposed) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);
      const deltaTime = Math.max(0, (timeMs - previousFrameTime) / 1000);
      previousFrameTime = timeMs;

      if (gpgpuState || sparkMesh) {
        elapsedTime += deltaTime;

        if (!hasManualOrbitInput) {
          orbitYaw += deltaTime * 0.16;
        }
        const hoverLerp = Math.min(1, deltaTime * 8);
        hoverYawOffset += (hoverYawTarget - hoverYawOffset) * hoverLerp;
        hoverPitchOffset += (hoverPitchTarget - hoverPitchOffset) * hoverLerp;
        updateCameraFrustum();
        const yaw = orbitYaw + hoverYawOffset;
        const pitch = clamp(orbitPitch + hoverPitchOffset, -1.2, 1.2);
        const cosPitch = Math.cos(pitch);

        camera.position.set(
          orbitTarget.x + Math.sin(yaw) * orbitRadius * cosPitch,
          orbitTarget.y + Math.sin(pitch) * orbitRadius,
          orbitTarget.z + Math.cos(yaw) * orbitRadius * cosPitch,
        );
        camera.lookAt(orbitTarget);
        camera.updateMatrixWorld();

        // GPGPU update
        gpgpuState.particlesVariable.material.uniforms.uTime.value =
          elapsedTime;
        gpgpuState.particlesVariable.material.uniforms.uDeltaTime.value =
          deltaTime;
        gpgpuState.gpgpu.compute();
        gpgpuState.material.uniforms.uParticlesTexture.value =
          gpgpuState.gpgpu.getCurrentRenderTarget(
            gpgpuState.particlesVariable,
          ).texture;
      }

      renderer.render(scene, camera);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    const loadSplat = async () => {
      setLoadError(null);
      setLoadInfo(null);
      setIsViewerReady(false);

      try {
        const extension = getSplatExtension(splat.path);

        const bytesFromMain = await window.electron.folder.getSplatBytes(
          splat.path,
        );
        const splatBytes = toUint8Array(bytesFromMain);
        if (!splatBytes) {
          throw new Error('No splat bytes available');
        }

        if (extension === 'ply') {
          const parsedData = parsePlyData(splatBytes);
          const { positions, colors, count } = parsedData;

          if (isDisposed) {
            return;
          }

          const state = setupGpgpuParticles(positions, colors, count, renderer);

          if (isDisposed) {
            state.points.geometry.dispose();
            state.material.dispose();
            state.gpgpu.dispose();
            return;
          }

          gpgpuState = state;
          state.points.rotation.x = Math.PI;
          scene.add(state.points);
          applyOrbitFromBounds(state.bounds);
          setIsViewerReady(true);
        } else if (extension === 'spz') {
          setLoadInfo('Loading Spark renderer...');
          const spark = await loadSparkModule();
          if (typeof spark.SplatMesh !== 'function') {
            throw new Error('Spark SplatMesh export is unavailable');
          }

          const mesh = new spark.SplatMesh({
            fileBytes: splatBytes,
            fileName: splat.name,
          });
          if (mesh.initialized) {
            await mesh.initialized;
          }

          if (isDisposed) {
            mesh.dispose?.();
            return;
          }

          sparkMesh = mesh;
          scene.add(mesh);
          const sparkBounds =
            typeof mesh.getBoundingBox === 'function'
              ? mesh.getBoundingBox()
              : new THREE.Box3().setFromObject(mesh);
          applyOrbitFromBounds(sparkBounds);
          setLoadInfo(null);
          setIsViewerReady(true);
        } else {
          throw new Error(
            `Unsupported splat format: .${extension || 'unknown'}`,
          );
        }
      } catch (error) {
        if (!isDisposed) {
          setLoadError(
            `Unable to render this splat: ${toErrorMessage(error)}.`,
          );
        }
      }
    };

    loadSplat().catch(() => {
      if (!isDisposed) {
        setLoadError('Unable to render this splat.');
      }
    });

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);

      if (gpgpuState) {
        scene.remove(gpgpuState.points);
        gpgpuState.points.geometry.dispose();
        gpgpuState.material.dispose();
        gpgpuState.gpgpu.dispose();
      }
      if (sparkMesh) {
        scene.remove(sparkMesh);
        sparkMesh.dispose?.();
      }

      renderer.dispose();

      if (renderer.domElement.parentElement === mountNode) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, [splat.name, splat.path, splat.url]);

  return (
    <div className="image-card-splat-viewer-shell">
      <div
        ref={mountRef}
        className="image-card-splat-viewer"
        role="img"
        aria-label={`3D Gaussian splat preview for ${splat.name}`}
      />
      {!loadError && !isViewerReady ? (
        <p className="image-card-splat-note">Loading 3D preview...</p>
      ) : null}
      {loadInfo ? <p className="image-card-splat-note">{loadInfo}</p> : null}
      {loadError ? <p className="image-card-splat-note">{loadError}</p> : null}
    </div>
  );
}
