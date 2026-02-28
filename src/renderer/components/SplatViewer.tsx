import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ImageSplat } from '../types/gallery';

type SparkSplatMesh = THREE.Object3D & {
  initialized: Promise<unknown>;
  update: (args: {
    time: number;
    deltaTime: number;
    viewToWorld: THREE.Matrix4;
    globalEdits: unknown[];
  }) => void;
  dispose: () => void;
  getBoundingBox: (centersOnly?: boolean) => THREE.Box3;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

type SplatViewerProps = {
  splat: ImageSplat;
};

type SparkModuleLike = {
  PlyReader: new (args: { fileBytes: Uint8Array }) => {
    numSplats: number;
    parseHeader: () => Promise<void>;
    parseSplats: (
      splatCallback: (
        index: number,
        x: number,
        y: number,
        z: number,
        scaleX: number,
        scaleY: number,
        scaleZ: number,
        quatX: number,
        quatY: number,
        quatZ: number,
        quatW: number,
        opacity: number,
        r: number,
        g: number,
        b: number,
      ) => void,
      shCallback?: (...args: unknown[]) => void,
    ) => void;
  };
  SplatMesh: new (options: {
    fileBytes?: Uint8Array;
    fileType?: unknown;
    fileName?: string;
    url?: string;
  }) => SparkSplatMesh;
  SplatFileType: {
    PLY: unknown;
  };
};

const MAX_FALLBACK_POINTS = 180000;

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
    let loadedSplat: SparkSplatMesh | null = null;
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

    const createPointFallback = async (
      sparkModule: SparkModuleLike,
      bytes: Uint8Array,
    ): Promise<THREE.Points<THREE.BufferGeometry>> => {
      const reader = new sparkModule.PlyReader({ fileBytes: bytes });
      await reader.parseHeader();

      if (!Number.isFinite(reader.numSplats) || reader.numSplats < 1) {
        throw new Error('PLY file has no splats');
      }

      const stride = Math.max(
        1,
        Math.ceil(reader.numSplats / MAX_FALLBACK_POINTS),
      );
      const sampleCount = Math.ceil(reader.numSplats / stride);
      const positions = new Float32Array(sampleCount * 3);
      const colors = new Float32Array(sampleCount * 3);
      let writeIndex = 0;

      reader.parseSplats(
        (
          index: number,
          x: number,
          y: number,
          z: number,
          _scaleX: number,
          _scaleY: number,
          _scaleZ: number,
          _quatX: number,
          _quatY: number,
          _quatZ: number,
          _quatW: number,
          _opacity: number,
          r: number,
          g: number,
          b: number,
        ) => {
          if (index % stride !== 0) {
            return;
          }

          if (writeIndex >= sampleCount) {
            return;
          }

          const base = writeIndex * 3;
          positions[base] = x;
          positions[base + 1] = y;
          positions[base + 2] = z;
          colors[base] = clamp(r, 0, 1);
          colors[base + 1] = clamp(g, 0, 1);
          colors[base + 2] = clamp(b, 0, 1);
          writeIndex += 1;
        },
      );

      if (writeIndex === 0) {
        throw new Error('No splats sampled from PLY');
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

      if (loadedSplat || loadedPoints) {
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

        if (loadedSplat) {
          try {
            loadedSplat.update({
              time: timeMs / 1000,
              deltaTime,
              viewToWorld: camera.matrixWorld,
              globalEdits: [],
            });
          } catch {
            // Spark update failed – remove the mesh so the loop can
            // continue rendering any fallback content without retrying.
            scene.remove(loadedSplat);
            try {
              loadedSplat.dispose();
            } catch {
              // best-effort disposal
            }
            loadedSplat = null;
          }
        }
      }

      renderer.render(scene, camera);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    const loadSplat = async () => {
      setLoadError(null);
      setLoadInfo(null);
      setIsViewerReady(false);

      try {
        const sparkModule = (await import(
          '@sparkjsdev/spark'
        )) as SparkModuleLike;
        const bytesFromMain = await window.electron.folder.getSplatBytes(
          splat.path,
        );
        const splatBytes = toUint8Array(bytesFromMain);
        let sparkError: unknown = null;

        try {
          const mesh = new sparkModule.SplatMesh(
            splatBytes
              ? {
                  fileBytes: splatBytes,
                  fileType: sparkModule.SplatFileType.PLY,
                  fileName: splat.name,
                }
              : {
                  url: splat.url,
                  fileName: splat.name,
                },
          ) as SparkSplatMesh;
          await mesh.initialized;

          if (isDisposed) {
            mesh.dispose();
            return;
          }

          // Verify the mesh can actually render before committing to it.
          // Some environments allow WASM init but fail at runtime.
          mesh.update({
            time: 0,
            deltaTime: 0,
            viewToWorld: camera.matrixWorld,
            globalEdits: [],
          });

          loadedSplat = mesh;
          scene.add(mesh);

          try {
            applyOrbitFromBounds(mesh.getBoundingBox(true));
          } catch {
            // Keep default camera framing when Spark cannot report bounds.
          }

          setIsViewerReady(true);
          return;
        } catch (error) {
          sparkError = error;
        }

        if (splatBytes) {
          try {
            const points = await createPointFallback(sparkModule, splatBytes);

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

            const pointBounds = points.userData.bounds as
              | THREE.Box3
              | undefined;
            if (pointBounds) {
              applyOrbitFromBounds(pointBounds);
            }

            setLoadInfo(
              'Spark could not render this file. Showing simplified point-cloud preview.',
            );
            setIsViewerReady(true);
            return;
          } catch (fallbackError) {
            if (!isDisposed) {
              const sparkMessage = toErrorMessage(sparkError);
              const fallbackMessage = toErrorMessage(fallbackError);
              setLoadError(
                `Unable to render this \`.ply\`. Spark: ${sparkMessage}. Fallback: ${fallbackMessage}.`,
              );
            }
            return;
          }
        }

        if (!isDisposed) {
          setLoadError(
            `Unable to render this \`.ply\`: ${toErrorMessage(sparkError)}.`,
          );
        }
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
        setLoadError('Unable to render this `.ply` with Spark.');
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

      if (loadedSplat) {
        scene.remove(loadedSplat);
        loadedSplat.dispose();
      }

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
