import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ImageSplat } from '../types/gallery';

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

type SplatViewerProps = {
  splat: ImageSplat;
};

const MAX_FALLBACK_POINTS = 180000;
const SH_C0 = 0.28209479177387814;

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
    let loadedPoints: THREE.Points<THREE.BufferGeometry> | null = null;
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);

    const ambient = new THREE.AmbientLight(0xffffff, 0.86);
    scene.add(ambient);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 1200);
    camera.position.set(0, 0, 3.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountNode.appendChild(renderer.domElement);

    const updateCameraFrustum = () => {
      // Keep large real-world coordinate splats inside the camera frustum.
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
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    const createPointCloud = (
      bytes: Uint8Array,
    ): THREE.Points<THREE.BufferGeometry> => {
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

      const stride = Math.max(1, Math.ceil(vertexCount / MAX_FALLBACK_POINTS));
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
        writeIndex === sampleCount
          ? colors
          : colors.subarray(0, writeIndex * 3);
      const positionAttribute = new THREE.BufferAttribute(finalPositions, 3);
      const colorAttribute = new THREE.BufferAttribute(finalColors, 3);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', positionAttribute);
      geometry.setAttribute('color', colorAttribute);

      const bounds = new THREE.Box3().setFromBufferAttribute(positionAttribute);
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const pointSize =
        Number.isFinite(sphere.radius) && sphere.radius > 0
          ? Math.max(0.004, sphere.radius / 440)
          : 0.01;
      const material = new THREE.PointsMaterial({
        size: pointSize,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
      });
      const points = new THREE.Points(geometry, material);
      points.userData.bounds = bounds;
      points.frustumCulled = false;
      return points;
    };

    const renderFrame = (timeMs: number) => {
      if (isDisposed) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);
      const deltaTime = Math.max(0, (timeMs - previousFrameTime) / 1000);
      previousFrameTime = timeMs;

      if (loadedPoints) {
        if (!hasManualOrbitInput) {
          orbitYaw += deltaTime * 0.16;
        }
        updateCameraFrustum();
        const pitch = clamp(orbitPitch, -1.2, 1.2);
        const cosPitch = Math.cos(pitch);

        camera.position.set(
          orbitTarget.x + Math.sin(orbitYaw) * orbitRadius * cosPitch,
          orbitTarget.y + Math.sin(pitch) * orbitRadius,
          orbitTarget.z + Math.cos(orbitYaw) * orbitRadius * cosPitch,
        );
        camera.lookAt(orbitTarget);
        camera.updateMatrixWorld();
      }

      renderer.render(scene, camera);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    const loadSplat = async () => {
      setLoadError(null);
      setLoadInfo(null);
      setIsViewerReady(false);

      try {
        const bytesFromMain = await window.electron.folder.getSplatBytes(
          splat.path,
        );
        const splatBytes = toUint8Array(bytesFromMain);
        if (!splatBytes) {
          throw new Error('No .ply bytes available');
        }

        const points = createPointCloud(splatBytes);
        if (isDisposed) {
          const pointsMaterial = points.material;
          points.geometry.dispose();
          if (pointsMaterial instanceof THREE.Material) {
            pointsMaterial.dispose();
          }
          return;
        }

        loadedPoints = points;
        scene.add(points);

        const pointBounds = points.userData.bounds as THREE.Box3 | undefined;
        if (pointBounds) {
          applyOrbitFromBounds(pointBounds);
        }
        setIsViewerReady(true);
      } catch (error) {
        if (!isDisposed) {
          setLoadError(
            `Unable to render this \`.ply\`: ${toErrorMessage(error)}.`,
          );
        }
      }
    };

    loadSplat().catch(() => {
      if (!isDisposed) {
        setLoadError('Unable to render this `.ply`.');
      }
    });

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);

      if (loadedPoints) {
        scene.remove(loadedPoints);
        loadedPoints.geometry.dispose();
        const pointsMaterial = loadedPoints.material;
        if (pointsMaterial instanceof THREE.Material) {
          pointsMaterial.dispose();
        }
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
