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

export default function SplatViewer({ splat }: SplatViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    const orbitTarget = new THREE.Vector3(0, 0, 0);
    let orbitRadius = 3.2;
    let orbitYaw = 0.42;
    let orbitPitch = 0.14;

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

    const renderFrame = (timeMs: number) => {
      if (isDisposed) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);
      const deltaTime = Math.max(0, (timeMs - previousFrameTime) / 1000);
      previousFrameTime = timeMs;

      if (loadedSplat) {
        orbitYaw += deltaTime * 0.16;
        const pitch = clamp(orbitPitch, -0.45, 0.45);
        const cosPitch = Math.cos(pitch);

        camera.position.set(
          orbitTarget.x + Math.sin(orbitYaw) * orbitRadius * cosPitch,
          orbitTarget.y + Math.sin(pitch) * orbitRadius,
          orbitTarget.z + Math.cos(orbitYaw) * orbitRadius * cosPitch,
        );
        camera.lookAt(orbitTarget);
        camera.updateMatrixWorld();

        loadedSplat.update({
          time: timeMs / 1000,
          deltaTime,
          viewToWorld: camera.matrixWorld,
          globalEdits: [],
        });
      }

      renderer.render(scene, camera);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    const loadSplat = async () => {
      setLoadError(null);
      setIsViewerReady(false);

      try {
        const sparkModule = await import('@sparkjsdev/spark');
        const splatBytes = await window.electron.folder.getSplatBytes(
          splat.path,
        );
        const mesh = new sparkModule.SplatMesh(
          splatBytes
            ? {
                fileBytes: splatBytes,
                fileType: sparkModule.SplatFileType.PLY,
                fileName: splat.name,
              }
            : {
                url: splat.url,
              },
        ) as SparkSplatMesh;
        await mesh.initialized;

        if (isDisposed) {
          mesh.dispose();
          return;
        }

        loadedSplat = mesh;
        scene.add(mesh);

        const bounds = mesh.getBoundingBox(true);
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());

        if (
          Number.isFinite(sphere.radius) &&
          Number.isFinite(sphere.center.x) &&
          sphere.radius > 0
        ) {
          orbitTarget.copy(sphere.center);
          orbitRadius = Math.max(1.45, sphere.radius * 3.2);
          orbitPitch = 0.14;
        }

        setIsViewerReady(true);
      } catch {
        if (!isDisposed) {
          setLoadError('Unable to render this `.ply` with Spark.');
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

      if (loadedSplat) {
        scene.remove(loadedSplat);
        loadedSplat.dispose();
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
      {loadError ? <p className="image-card-splat-note">{loadError}</p> : null}
    </div>
  );
}
