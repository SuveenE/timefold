import type {
  CSSProperties,
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MemoryRouter as Router,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { Clock3, House, MapPin, Settings as SettingsIcon } from 'lucide-react';
import type { ImageSplat, ListedImage } from '../main/preload';
import './App.css';

type ClusterLayout = {
  sphereX: number;
  sphereY: number;
  sphereZ: number;
  width: number;
  rotation: number;
  orbitX: number;
  orbitY: number;
  orbitDuration: number;
  orbitDelay: number;
  counterDuration: number;
  bobX: number;
  bobY: number;
  bobDuration: number;
  opacity: number;
  blur: number;
};

type TileStyle = CSSProperties & {
  '--sphere-x': string;
  '--sphere-y': string;
  '--sphere-z': string;
  '--orbit-x': string;
  '--orbit-y': string;
  '--orbit-duration': string;
  '--orbit-delay': string;
  '--counter-duration': string;
  '--bob-x': string;
  '--bob-y': string;
  '--bob-duration': string;
  '--tile-rotation': string;
  '--tile-opacity': string;
  '--tile-blur': string;
};

type ExploreLayout = {
  x: number;
  y: number;
  z: number;
  width: number;
  rotation: number;
  opacity: number;
};

type ExploreCardStyle = CSSProperties & {
  '--ex-x': string;
  '--ex-y': string;
  '--ex-z': string;
  '--ex-rotate': string;
  '--ex-opacity': string;
};

type HomeProps = {
  activeFolder: string | null;
  images: ListedImage[];
  isSelecting: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  onSelectFolder: () => Promise<void>;
  onReload: () => Promise<void>;
  onImageSelect: (image: ListedImage) => void;
};

type ExploreProps = {
  images: ListedImage[];
  onImageSelect: (image: ListedImage) => void;
};

type ExploreMode = 'free' | 'location' | 'time';

type SettingsValues = {
  photoAlbumLocation: string;
  metadataLocation: string;
  yourName: string;
};

type SettingsProps = {
  settings: SettingsValues;
  onSettingsChange: (nextSettings: SettingsValues) => void;
};

type ImageCardModalProps = {
  image: ListedImage | null;
  splat: ImageSplat | null;
  isSplatLoading: boolean;
  splatLookupError: string | null;
  onClose: () => void;
};

const MAX_RENDERED_IMAGES = 220;
const MAX_FILTER_CHIPS = 6;
const SETTINGS_STORAGE_KEY = 'timefold.settings';
const LAST_ACTIVE_FOLDER_STORAGE_KEY = 'timefold.lastActiveFolder';
const CLOUD_DRAG_ROTATION_PER_PIXEL = 0.18;
const CLOUD_ZOOM_MIN = -520;
const CLOUD_ZOOM_MAX = 920;
const CLOUD_ZOOM_PER_WHEEL = 0.72;
const EXPLORE_DRAG_ROTATION_PER_PIXEL = 0.18;
const EXPLORE_ZOOM_MIN = -520;
const EXPLORE_ZOOM_MAX = 920;
const EXPLORE_ZOOM_PER_WHEEL = 0.72;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const buildMetadataLocation = (albumLocation: string): string => {
  const normalizedPath = albumLocation.replace(/[\\/]+$/, '');
  const separator =
    normalizedPath.includes('\\') && !normalizedPath.includes('/') ? '\\' : '/';
  return `${normalizedPath}${separator}metadata`;
};

const buildExpectedSplatName = (imageName: string): string => {
  const imageBaseName = imageName.replace(/\.[^.]+$/, '');
  return `${imageBaseName}.ply`;
};

const formatCapturedAt = (capturedAt?: string | null): string => {
  if (!capturedAt) {
    return 'Unknown date';
  }

  const parsedDate = new Date(capturedAt);

  if (Number.isNaN(parsedDate.getTime())) {
    return capturedAt;
  }

  return parsedDate.toLocaleString();
};

const createSeed = (input: string): number => {
  let seed = 1;

  for (let index = 0; index < input.length; index += 1) {
    seed = (seed * 31 + input.charCodeAt(index)) % 2147483647;
  }

  return seed;
};

const createRandom = (initialSeed: number): (() => number) => {
  let seed = initialSeed;

  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
};

const createClusterLayout = (
  seedKey: string,
  index: number,
  total: number,
): ClusterLayout => {
  const random = createRandom(createSeed(`${seedKey}:${index}:${total}`));
  const safeTotal = Math.max(total, 1);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const unitY = 1 - ((index + 0.5) / safeTotal) * 2;
  const radial = Math.sqrt(Math.max(0, 1 - unitY * unitY));
  const theta = goldenAngle * index + (random() - 0.5) * 0.22;
  const sphereRadius = 312 + (random() - 0.5) * 54;
  const depth = random();
  const orbitDuration = 13 + random() * 14;
  const sphereX =
    Math.cos(theta) * radial * sphereRadius + (random() - 0.5) * 16;
  const sphereY = unitY * sphereRadius * 1.02 + (random() - 0.5) * 22;
  const sphereZ =
    Math.sin(theta) * radial * sphereRadius + (random() - 0.5) * 16;

  return {
    sphereX,
    sphereY,
    sphereZ,
    width: 64 + random() * 90 + depth * 38,
    rotation: (random() - 0.5) * 7,
    orbitX: (random() - 0.5) * (8 + (1 - depth) * 14),
    orbitY: (random() - 0.5) * (8 + (1 - depth) * 12),
    orbitDuration,
    orbitDelay: random() * 20,
    counterDuration: orbitDuration,
    bobX: (random() - 0.5) * 10,
    bobY: (random() - 0.5) * 14,
    bobDuration: 4 + random() * 6,
    opacity: clamp(0.72 + depth * 0.28, 0.7, 1),
    blur: 0,
  };
};

const createExploreLayout = (
  seedKey: string,
  index: number,
  total: number,
): ExploreLayout => {
  const random = createRandom(
    createSeed(`explore:${seedKey}:${index}:${total}`),
  );
  const safeTotal = Math.max(total, 1);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const unitY = 1 - ((index + 0.5) / safeTotal) * 2;
  const radial = Math.sqrt(Math.max(0, 1 - unitY * unitY));
  const theta = goldenAngle * index + (random() - 0.5) * 0.18;
  const sphereRadius = 330 + (random() - 0.5) * 70;
  const x = Math.cos(theta) * radial * sphereRadius + (random() - 0.5) * 18;
  const y = unitY * sphereRadius * 1.02 + (random() - 0.5) * 22;
  const z = Math.sin(theta) * radial * sphereRadius + (random() - 0.5) * 18;
  const depthHint = clamp((z + sphereRadius) / (sphereRadius * 2), 0, 1);

  return {
    x,
    y,
    z,
    width: 92 + random() * 132 + depthHint * 26,
    rotation: 0,
    opacity: clamp(0.62 + depthHint * 0.35, 0.5, 1),
  };
};

function Home({
  activeFolder,
  images,
  isSelecting,
  isLoading,
  errorMessage,
  onSelectFolder,
  onReload,
  onImageSelect,
}: HomeProps) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [isCloudDragging, setIsCloudDragging] = useState(false);
  const cloudLayerRef = useRef<HTMLDivElement | null>(null);
  const cloudMotion = useRef({
    dragging: false,
    pointerId: -1,
    lastX: 0,
    lastPointerTime: 0,
    lastFrameTime: 0,
    position: 0,
    target: 0,
    velocity: 0,
    zoom: 0,
    zoomTarget: 0,
    rafId: 0,
  });
  const [failedImagePaths, setFailedImagePaths] = useState<
    Record<string, true>
  >({});

  useEffect(() => {
    setFailedImagePaths({});
  }, [images]);

  const extensionCounts = useMemo(() => {
    const counts = new Map<string, number>();

    images.forEach((image) => {
      counts.set(image.ext, (counts.get(image.ext) || 0) + 1);
    });

    return [...counts.entries()].sort((first, second) => second[1] - first[1]);
  }, [images]);

  const filterChips = useMemo(() => {
    return [
      { key: 'all', label: 'all', count: images.length },
      ...extensionCounts.slice(0, MAX_FILTER_CHIPS).map(([ext, count]) => {
        return { key: ext, label: ext, count };
      }),
    ];
  }, [extensionCounts, images.length]);

  useEffect(() => {
    const isCurrentFilterValid = filterChips.some(
      (chip) => chip.key === activeFilter,
    );

    if (!isCurrentFilterValid) {
      setActiveFilter('all');
    }
  }, [activeFilter, filterChips]);

  const filteredPool = useMemo(() => {
    if (activeFilter === 'all') {
      return images;
    }

    return images.filter((image) => image.ext === activeFilter);
  }, [activeFilter, images]);

  const filteredImages = useMemo(() => {
    return filteredPool.slice(0, MAX_RENDERED_IMAGES);
  }, [filteredPool]);

  const renderableImages = useMemo(() => {
    return filteredImages.filter((image) => !failedImagePaths[image.path]);
  }, [failedImagePaths, filteredImages]);

  const hasLoadedImages = images.length > 0 && !isLoading;

  const statusTitle = useMemo(() => {
    if (isLoading) {
      return 'Loading images...';
    }

    if (
      activeFolder &&
      filteredPool.length > 0 &&
      renderableImages.length === 0
    ) {
      return 'Unable to preview these images';
    }

    if (activeFolder) {
      return 'No images in this view';
    }

    return 'Choose a folder to begin';
  }, [activeFolder, filteredPool.length, isLoading, renderableImages.length]);

  const statusCopy = useMemo(() => {
    if (isLoading) {
      return 'Scanning your folder and preparing the collage.';
    }

    if (errorMessage) {
      return errorMessage;
    }

    if (
      activeFolder &&
      filteredPool.length > 0 &&
      renderableImages.length === 0
    ) {
      return 'No compatible previews were generated for this filter.';
    }

    return 'Select a local folder and the page will build a floating image cloud.';
  }, [
    activeFolder,
    errorMessage,
    filteredPool.length,
    isLoading,
    renderableImages.length,
  ]);

  const cloudItems = useMemo(() => {
    return renderableImages.map((image, index) => {
      return {
        image,
        layout: createClusterLayout(image.path, index, renderableImages.length),
      };
    });
  }, [renderableImages]);

  const renderCloudState = useCallback(
    (rotationDeg: number, zoomDepth: number) => {
      const cloudNode = cloudLayerRef.current;

      if (!cloudNode) {
        return;
      }

      const rotationValue = rotationDeg.toFixed(2);
      const rotation = `${rotationValue}deg`;
      const zoomValue = `${zoomDepth.toFixed(2)}px`;
      cloudNode.style.setProperty('--cloud-rotation-y', rotation);
      cloudNode.style.setProperty('--cloud-zoom-z', zoomValue);
      cloudNode.style.transform = `translate3d(0, 0, ${zoomValue}) rotateX(-5deg) rotateY(${rotation})`;
    },
    [],
  );

  const runCloudFrame = (timestamp: number) => {
    const motion = cloudMotion.current;

    if (motion.lastFrameTime === 0) {
      motion.lastFrameTime = timestamp;
    }

    const elapsed = clamp(timestamp - motion.lastFrameTime, 8, 34);
    motion.lastFrameTime = timestamp;
    const frameFactor = elapsed / 16.667;

    if (!motion.dragging) {
      motion.target += motion.velocity * elapsed;
      motion.velocity *= 0.9 ** frameFactor;
    }

    const zoomFollow = 1 - 0.2 ** frameFactor;
    motion.zoom += (motion.zoomTarget - motion.zoom) * zoomFollow;

    const follow = 1 - 0.2 ** frameFactor;
    motion.position += (motion.target - motion.position) * follow;

    if (Math.abs(motion.position) > 1080) {
      const turns = Math.trunc(motion.position / 360);
      const normalizedOffset = turns * 360;
      motion.position -= normalizedOffset;
      motion.target -= normalizedOffset;
    }

    renderCloudState(motion.position, motion.zoom);

    const shouldContinue =
      motion.dragging ||
      Math.abs(motion.target - motion.position) > 0.04 ||
      Math.abs(motion.velocity) > 0.002 ||
      Math.abs(motion.zoomTarget - motion.zoom) > 0.08;

    if (shouldContinue) {
      motion.rafId = window.requestAnimationFrame(runCloudFrame);
      return;
    }

    motion.target = motion.position;
    motion.zoom = motion.zoomTarget;
    motion.velocity = 0;
    motion.lastFrameTime = 0;
    motion.rafId = 0;
    renderCloudState(motion.position, motion.zoom);
  };

  const startCloudAnimation = () => {
    const motion = cloudMotion.current;

    if (motion.rafId !== 0) {
      return;
    }

    motion.rafId = window.requestAnimationFrame(runCloudFrame);
  };

  const beginCloudDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (renderableImages.length === 0) {
      return;
    }

    const motion = cloudMotion.current;
    motion.dragging = true;
    motion.pointerId = event.pointerId;
    motion.lastX = event.clientX;
    motion.lastPointerTime = event.timeStamp;
    motion.velocity = 0;
    setIsCloudDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    startCloudAnimation();
  };

  const updateCloudDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const motion = cloudMotion.current;

    if (!motion.dragging || motion.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - motion.lastX;
    const elapsedPointer = clamp(
      event.timeStamp - motion.lastPointerTime,
      8,
      42,
    );
    const deltaRotation = deltaX * CLOUD_DRAG_ROTATION_PER_PIXEL;
    motion.lastX = event.clientX;
    motion.lastPointerTime = event.timeStamp;
    motion.target += deltaRotation;
    motion.velocity = deltaRotation / elapsedPointer;

    startCloudAnimation();
  };

  const endCloudDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const motion = cloudMotion.current;

    if (motion.pointerId !== event.pointerId) {
      return;
    }

    motion.dragging = false;
    motion.pointerId = -1;
    setIsCloudDragging(false);
    startCloudAnimation();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCloudWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (renderableImages.length === 0) {
      return;
    }

    event.preventDefault();
    const motion = cloudMotion.current;
    motion.zoomTarget = clamp(
      motion.zoomTarget - event.deltaY * CLOUD_ZOOM_PER_WHEEL,
      CLOUD_ZOOM_MIN,
      CLOUD_ZOOM_MAX,
    );
    startCloudAnimation();
  };

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      const motion = cloudMotion.current;
      renderCloudState(motion.position, motion.zoom);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [cloudItems, renderCloudState]);

  useEffect(() => {
    if (renderableImages.length > 0) {
      return;
    }

    const motion = cloudMotion.current;

    if (motion.rafId !== 0) {
      window.cancelAnimationFrame(motion.rafId);
    }

    motion.dragging = false;
    motion.pointerId = -1;
    motion.lastX = 0;
    motion.lastPointerTime = 0;
    motion.lastFrameTime = 0;
    motion.position = 0;
    motion.target = 0;
    motion.velocity = 0;
    motion.zoom = 0;
    motion.zoomTarget = 0;
    motion.rafId = 0;
    renderCloudState(0, 0);
    setIsCloudDragging(false);
  }, [renderCloudState, renderableImages.length]);

  useEffect(() => {
    const motion = cloudMotion.current;

    return () => {
      if (motion.rafId !== 0) {
        window.cancelAnimationFrame(motion.rafId);
      }
    };
  }, []);

  return (
    <main className="gallery-screen">
      <div className="nebula" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <section
        className={`cloud-viewport ${isCloudDragging ? 'dragging' : ''}`}
        onPointerDown={beginCloudDrag}
        onPointerMove={updateCloudDrag}
        onPointerUp={endCloudDrag}
        onPointerCancel={endCloudDrag}
        onWheel={handleCloudWheel}
        aria-live="polite"
      >
        {renderableImages.length > 0 && (
          <div className="cloud-drag-layer" ref={cloudLayerRef}>
            <div className="photo-cloud">
              {cloudItems.map(({ image, layout }) => {
                const tileStyle: TileStyle = {
                  left: '50%',
                  top: '47%',
                  width: `${layout.width}px`,
                  '--sphere-x': `${layout.sphereX}px`,
                  '--sphere-y': `${layout.sphereY}px`,
                  '--sphere-z': `${layout.sphereZ}px`,
                  '--orbit-x': `${layout.orbitX}px`,
                  '--orbit-y': `${layout.orbitY}px`,
                  '--orbit-duration': `${layout.orbitDuration}s`,
                  '--orbit-delay': `-${layout.orbitDelay}s`,
                  '--counter-duration': `${layout.counterDuration}s`,
                  '--bob-x': `${layout.bobX}px`,
                  '--bob-y': `${layout.bobY}px`,
                  '--bob-duration': `${layout.bobDuration}s`,
                  '--tile-rotation': `${layout.rotation}deg`,
                  '--tile-opacity': `${layout.opacity}`,
                  '--tile-blur': `${layout.blur}px`,
                };

                return (
                  <figure
                    key={image.path}
                    className="photo-tile"
                    style={tileStyle}
                  >
                    <div className="orbit-track">
                      <div className="orbit-orient">
                        <div className="photo-motion">
                          <button
                            type="button"
                            className="photo-frame photo-frame-button"
                            aria-label={`Open details for ${image.name}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              onImageSelect(image);
                            }}
                          >
                            <img
                              src={image.url}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              onError={() => {
                                setFailedImagePaths((current) => {
                                  if (current[image.path]) {
                                    return current;
                                  }

                                  return {
                                    ...current,
                                    [image.path]: true,
                                  };
                                });
                              }}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  </figure>
                );
              })}
            </div>
          </div>
        )}

        {(isLoading ||
          renderableImages.length === 0 ||
          Boolean(errorMessage)) && (
          <div className="status-panel">
            <p className="status-title">{statusTitle}</p>
            <p className="status-copy">{statusCopy}</p>
          </div>
        )}
      </section>

      <footer className="control-dock">
        {images.length > 0 && (
          <div className="dock-explore-row">
            <button
              type="button"
              className={`ghost-button explore-button ${
                hasLoadedImages ? 'highlighted' : ''
              }`}
              onClick={() => navigate('/explore')}
              disabled={isLoading}
            >
              explore
            </button>
          </div>
        )}

        <div className="dock-controls-row">
          <div className="chip-row">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={`chip ${activeFilter === chip.key ? 'active' : ''}`}
                onClick={() => setActiveFilter(chip.key)}
                disabled={chip.count === 0}
              >
                {chip.label}
                <small>{chip.count}</small>
              </button>
            ))}
          </div>

          <div className="dock-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={onReload}
              disabled={!activeFolder || isLoading}
            >
              reload
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={onSelectFolder}
              disabled={isSelecting}
            >
              {isSelecting ? 'opening...' : 'choose folder'}
            </button>
          </div>
        </div>

        <p className="folder-path">
          {activeFolder || 'Select a local folder containing image files'}
        </p>
      </footer>
    </main>
  );
}

function Explore({ images, onImageSelect }: ExploreProps) {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<ExploreMode>('free');
  const exploreWorldRef = useRef<HTMLDivElement | null>(null);
  const motion = useRef({
    dragging: false,
    pointerId: -1,
    lastX: 0,
    lastPointerTime: 0,
    lastFrameTime: 0,
    position: 0,
    target: 0,
    velocity: 0,
    zoom: 0,
    zoomTarget: 0,
    rafId: 0,
  });

  const exploreItems = useMemo(() => {
    return images.map((image, index) => {
      return {
        image,
        layout: createExploreLayout(image.path, index, images.length),
      };
    });
  }, [images]);

  const locationClusters = useMemo(() => {
    const groups = new Map<string, ListedImage[]>();

    images.forEach((image) => {
      const key = image.location?.trim() || 'Unknown location';
      const current = groups.get(key) || [];
      groups.set(key, [...current, image]);
    });

    return [...groups.entries()]
      .map(([label, groupedImages]) => ({
        label,
        images: groupedImages,
      }))
      .sort((first, second) => second.images.length - first.images.length);
  }, [images]);

  const timeClusters = useMemo(() => {
    const groups = new Map<string, ListedImage[]>();

    images.forEach((image) => {
      if (!image.capturedAt) {
        const currentUnknown = groups.get('Unknown year') || [];
        groups.set('Unknown year', [...currentUnknown, image]);
        return;
      }

      const parsed = new Date(image.capturedAt);
      const year = Number.isNaN(parsed.getTime())
        ? 'Unknown year'
        : String(parsed.getUTCFullYear());
      const current = groups.get(year) || [];
      groups.set(year, [...current, image]);
    });

    return [...groups.entries()]
      .map(([label, groupedImages]) => ({
        label,
        images: groupedImages,
      }))
      .sort((first, second) => {
        if (first.label === 'Unknown year') {
          return 1;
        }

        if (second.label === 'Unknown year') {
          return -1;
        }

        return Number(second.label) - Number(first.label);
      });
  }, [images]);

  const renderExploreState = useCallback(
    (rotationDeg: number, zoomDepth: number) => {
      const worldNode = exploreWorldRef.current;

      if (!worldNode) {
        return;
      }

      const rotation = `${rotationDeg.toFixed(2)}deg`;
      const zoomValue = `${zoomDepth.toFixed(2)}px`;
      worldNode.style.setProperty('--ex-world-rotation-y', rotation);
      worldNode.style.setProperty('--ex-world-zoom-z', zoomValue);
      worldNode.style.transform = `translate3d(0, 0, ${zoomValue}) rotateX(-5deg) rotateY(${rotation})`;
    },
    [],
  );

  const runFrame = (timestamp: number) => {
    const currentMotion = motion.current;

    if (currentMotion.lastFrameTime === 0) {
      currentMotion.lastFrameTime = timestamp;
    }

    const elapsed = clamp(timestamp - currentMotion.lastFrameTime, 8, 34);
    currentMotion.lastFrameTime = timestamp;
    const frameFactor = elapsed / 16.667;

    if (!currentMotion.dragging) {
      currentMotion.target += currentMotion.velocity * elapsed;
      currentMotion.velocity *= 0.9 ** frameFactor;
    }

    const zoomFollow = 1 - 0.2 ** frameFactor;
    currentMotion.zoom +=
      (currentMotion.zoomTarget - currentMotion.zoom) * zoomFollow;

    const rotationFollow = 1 - 0.2 ** frameFactor;
    currentMotion.position +=
      (currentMotion.target - currentMotion.position) * rotationFollow;

    if (Math.abs(currentMotion.position) > 1080) {
      const turns = Math.trunc(currentMotion.position / 360);
      const normalizedOffset = turns * 360;
      currentMotion.position -= normalizedOffset;
      currentMotion.target -= normalizedOffset;
    }

    renderExploreState(currentMotion.position, currentMotion.zoom);

    const shouldContinue =
      currentMotion.dragging ||
      Math.abs(currentMotion.target - currentMotion.position) > 0.04 ||
      Math.abs(currentMotion.velocity) > 0.002 ||
      Math.abs(currentMotion.zoomTarget - currentMotion.zoom) > 0.08;

    if (shouldContinue) {
      currentMotion.rafId = window.requestAnimationFrame(runFrame);
      return;
    }

    currentMotion.target = currentMotion.position;
    currentMotion.zoom = currentMotion.zoomTarget;
    currentMotion.velocity = 0;
    currentMotion.lastFrameTime = 0;
    currentMotion.rafId = 0;
    renderExploreState(currentMotion.position, currentMotion.zoom);
  };

  const startAnimation = () => {
    const currentMotion = motion.current;

    if (currentMotion.rafId !== 0) {
      return;
    }

    currentMotion.rafId = window.requestAnimationFrame(runFrame);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    const currentMotion = motion.current;
    currentMotion.dragging = true;
    currentMotion.pointerId = event.pointerId;
    currentMotion.lastX = event.clientX;
    currentMotion.lastPointerTime = event.timeStamp;
    currentMotion.velocity = 0;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    startAnimation();
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    const currentMotion = motion.current;

    if (
      !currentMotion.dragging ||
      currentMotion.pointerId !== event.pointerId
    ) {
      return;
    }

    const deltaX = event.clientX - currentMotion.lastX;
    const elapsedPointer = clamp(
      event.timeStamp - currentMotion.lastPointerTime,
      8,
      42,
    );
    const deltaRotation = deltaX * EXPLORE_DRAG_ROTATION_PER_PIXEL;

    currentMotion.lastX = event.clientX;
    currentMotion.lastPointerTime = event.timeStamp;
    currentMotion.target += deltaRotation;
    currentMotion.velocity = deltaRotation / elapsedPointer;

    startAnimation();
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    const currentMotion = motion.current;

    if (currentMotion.pointerId !== event.pointerId) {
      return;
    }

    currentMotion.dragging = false;
    currentMotion.pointerId = -1;
    setIsDragging(false);
    startAnimation();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    event.preventDefault();
    const currentMotion = motion.current;
    currentMotion.zoomTarget = clamp(
      currentMotion.zoomTarget - event.deltaY * EXPLORE_ZOOM_PER_WHEEL,
      EXPLORE_ZOOM_MIN,
      EXPLORE_ZOOM_MAX,
    );
    startAnimation();
  };

  useEffect(() => {
    let rafId = 0;

    if (mode !== 'free') {
      const currentMotion = motion.current;
      currentMotion.dragging = false;
      currentMotion.pointerId = -1;
      setIsDragging(false);
    } else {
      rafId = window.requestAnimationFrame(() => {
        const currentMotion = motion.current;
        renderExploreState(currentMotion.position, currentMotion.zoom);
      });
    }

    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [exploreItems, mode, renderExploreState]);

  useEffect(() => {
    const currentMotion = motion.current;

    return () => {
      if (currentMotion.rafId !== 0) {
        window.cancelAnimationFrame(currentMotion.rafId);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        navigate('/');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate]);

  return (
    <main className="gallery-screen explore-screen">
      <div className="nebula" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <section
        className={`explore-stage ${isDragging ? 'dragging' : ''} ${
          mode !== 'free' ? 'cluster-mode' : ''
        }`}
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={handleWheel}
        aria-label="Interactive image space"
      >
        <aside
          className="explore-sidebar"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="explore-sidebar-button"
            aria-label="Go to home"
            onClick={() => navigate('/')}
          >
            <House className="explore-sidebar-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="explore-sidebar-button"
            aria-label="Go to settings"
            onClick={() => navigate('/settings')}
          >
            <SettingsIcon className="explore-sidebar-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`explore-sidebar-button ${
              mode === 'location' ? 'active' : ''
            }`}
            aria-label="Show location clusters"
            onClick={() =>
              setMode((current) =>
                current === 'location' ? 'free' : 'location',
              )
            }
          >
            <MapPin className="explore-sidebar-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`explore-sidebar-button ${mode === 'time' ? 'active' : ''}`}
            aria-label="Show year clusters"
            onClick={() =>
              setMode((current) => (current === 'time' ? 'free' : 'time'))
            }
          >
            <Clock3 className="explore-sidebar-icon" aria-hidden="true" />
          </button>
        </aside>

        {images.length > 0 && mode === 'free' ? (
          <div className="explore-scene">
            <div className="explore-world" ref={exploreWorldRef}>
              {exploreItems.map(({ image, layout }) => {
                const cardStyle: ExploreCardStyle = {
                  left: '50%',
                  top: '50%',
                  width: `${layout.width}px`,
                  '--ex-x': `${layout.x}px`,
                  '--ex-y': `${layout.y}px`,
                  '--ex-z': `${layout.z}px`,
                  '--ex-rotate': `${layout.rotation}deg`,
                  '--ex-opacity': `${layout.opacity}`,
                };

                return (
                  <figure
                    key={`explore-${image.path}`}
                    className="explore-card"
                    style={cardStyle}
                  >
                    <button
                      type="button"
                      className="explore-card-frame explore-card-button"
                      aria-label={`Open details for ${image.name}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onImageSelect(image);
                      }}
                    >
                      <img
                        src={image.url}
                        alt=""
                        loading="lazy"
                        draggable={false}
                      />
                    </button>
                  </figure>
                );
              })}
            </div>
          </div>
        ) : null}

        {images.length > 0 && mode !== 'free' ? (
          <div
            className="explore-cluster-board"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="explore-cluster-grid">
              {(mode === 'location' ? locationClusters : timeClusters).map(
                (cluster) => (
                  <section
                    key={`${mode}-${cluster.label}`}
                    className="explore-cluster-card"
                  >
                    <header className="explore-cluster-header">
                      <p className="explore-cluster-label">{cluster.label}</p>
                      <span className="explore-cluster-count">
                        {cluster.images.length}
                      </span>
                    </header>
                    <div className="explore-cluster-thumbs">
                      {cluster.images.slice(0, 8).map((image) => (
                        <button
                          key={`${cluster.label}-${image.path}`}
                          type="button"
                          className="explore-thumb-button"
                          aria-label={`Open details for ${image.name}`}
                          onClick={() => onImageSelect(image)}
                        >
                          <img
                            src={image.url}
                            alt=""
                            loading="lazy"
                            draggable={false}
                          />
                        </button>
                      ))}
                    </div>
                  </section>
                ),
              )}
            </div>
          </div>
        ) : null}

        {images.length === 0 ? (
          <div className="status-panel explore-empty">
            <p className="status-title">No images loaded yet</p>
            <p className="status-copy">
              Go back and choose a local folder first.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Settings({ settings, onSettingsChange }: SettingsProps) {
  const navigate = useNavigate();

  const setField =
    (field: keyof SettingsValues) => (event: ChangeEvent<HTMLInputElement>) => {
      onSettingsChange({
        ...settings,
        [field]: event.target.value,
      });
    };

  return (
    <main className="gallery-screen settings-screen">
      <div className="nebula" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <section className="settings-body">
        <form
          className="settings-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="ghost-button settings-back"
            onClick={() => navigate('/')}
          >
            back
          </button>

          <label className="settings-field" htmlFor="photo-album-location">
            Photo album location
            <input
              id="photo-album-location"
              type="text"
              value={settings.photoAlbumLocation}
              onChange={setField('photoAlbumLocation')}
              placeholder="/Users/you/Pictures/Album"
              autoComplete="off"
            />
          </label>

          <label className="settings-field" htmlFor="metadata-location">
            Metadata location
            <input
              id="metadata-location"
              type="text"
              value={settings.metadataLocation}
              onChange={setField('metadataLocation')}
              placeholder="/Users/you/Documents/photo-metadata.json"
              autoComplete="off"
            />
          </label>

          <label className="settings-field" htmlFor="your-name">
            Your name
            <input
              id="your-name"
              type="text"
              value={settings.yourName}
              onChange={setField('yourName')}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>
        </form>
      </section>
    </main>
  );
}

function ImageCardModal({
  image,
  splat,
  isSplatLoading,
  splatLookupError,
  onClose,
}: ImageCardModalProps) {
  useEffect(() => {
    if (!image) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [image, onClose]);

  if (!image) {
    return null;
  }

  const expectedSplatName = buildExpectedSplatName(image.name);

  return (
    <div className="image-card-overlay">
      <button
        type="button"
        className="image-card-backdrop"
        aria-label="Close image details"
        onClick={onClose}
      />
      <article
        className="image-card"
        role="dialog"
        aria-modal="true"
        aria-label="Image details"
      >
        <button
          type="button"
          className="image-card-close"
          aria-label="Close image card"
          onClick={onClose}
        >
          close
        </button>

        <div className="image-card-media">
          <img src={image.url} alt={image.name} />
        </div>

        <section className="image-card-details">
          <h2 className="image-card-title">{image.name}</h2>

          <dl className="image-card-meta">
            <div>
              <dt>Date</dt>
              <dd>{formatCapturedAt(image.capturedAt)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{image.location?.trim() || 'Unknown location'}</dd>
            </div>
          </dl>

          <div className="image-card-splat">
            <h3>Gaussian splat</h3>

            {isSplatLoading ? (
              <p className="image-card-splat-note">
                Checking for matching file...
              </p>
            ) : null}

            {!isSplatLoading && splatLookupError ? (
              <p className="image-card-splat-note">{splatLookupError}</p>
            ) : null}

            {!isSplatLoading && !splatLookupError && splat ? (
              <>
                <p className="image-card-splat-note">{splat.name}</p>
                <p className="image-card-splat-path">{splat.path}</p>
                {splat.previewText ? (
                  <pre className="image-card-splat-preview">
                    {splat.previewText}
                  </pre>
                ) : (
                  <p className="image-card-splat-note">
                    No preview text available for this `.ply` file.
                  </p>
                )}
                {splat.isBinary ? (
                  <p className="image-card-splat-note">
                    Binary `.ply` detected. Showing header preview.
                  </p>
                ) : null}
              </>
            ) : null}

            {!isSplatLoading && !splatLookupError && !splat ? (
              <p className="image-card-splat-note">
                No matching file found at `splats/{expectedSplatName}`.
              </p>
            ) : null}
          </div>
        </section>
      </article>
    </div>
  );
}

function AppRoutes() {
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [images, setImages] = useState<ListedImage[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSettingsHydrated, setIsSettingsHydrated] = useState(false);
  const hasRestoredFolderRef = useRef(false);
  const [settings, setSettings] = useState<SettingsValues>({
    photoAlbumLocation: '',
    metadataLocation: '',
    yourName: '',
  });
  const [selectedImage, setSelectedImage] = useState<ListedImage | null>(null);
  const [selectedImageSplat, setSelectedImageSplat] =
    useState<ImageSplat | null>(null);
  const [isSplatLoading, setIsSplatLoading] = useState(false);
  const [splatLookupError, setSplatLookupError] = useState<string | null>(null);
  const splatLookupCache = useRef<Record<string, ImageSplat | null>>({});
  const splatLookupRequestId = useRef(0);

  useEffect(() => {
    const rawSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!rawSettings) {
      setIsSettingsHydrated(true);
      return;
    }

    try {
      const parsedSettings = JSON.parse(rawSettings) as Partial<SettingsValues>;
      setSettings((current) => ({
        ...current,
        photoAlbumLocation: parsedSettings.photoAlbumLocation ?? '',
        metadataLocation: parsedSettings.metadataLocation ?? '',
        yourName: parsedSettings.yourName ?? '',
      }));
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } finally {
      setIsSettingsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isSettingsHydrated) {
      return;
    }

    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [isSettingsHydrated, settings]);

  useEffect(() => {
    splatLookupCache.current = {};
    setSelectedImage(null);
    setSelectedImageSplat(null);
    setIsSplatLoading(false);
    setSplatLookupError(null);
  }, [activeFolder]);

  const loadFolderImages = useCallback(
    async (folderPath: string, metadataFolderPath?: string) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const folderImages = await window.electron.folder.listImages(
          folderPath,
          metadataFolderPath,
        );
        setImages(folderImages);

        if (folderImages.length === 0) {
          setErrorMessage(
            'No supported image files were found in this folder.',
          );
        }
      } catch {
        setImages([]);
        setErrorMessage(
          'Unable to read this folder. Please try another location.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isSettingsHydrated || hasRestoredFolderRef.current) {
      return;
    }

    hasRestoredFolderRef.current = true;
    const lastActiveFolder =
      window.localStorage.getItem(LAST_ACTIVE_FOLDER_STORAGE_KEY)?.trim() || '';
    const configuredAlbumFolder = settings.photoAlbumLocation.trim();
    const folderToRestore = lastActiveFolder || configuredAlbumFolder;

    if (!folderToRestore) {
      return;
    }

    setActiveFolder(folderToRestore);
    const effectiveMetadataLocation =
      settings.metadataLocation.trim() ||
      buildMetadataLocation(folderToRestore);
    loadFolderImages(folderToRestore, effectiveMetadataLocation).catch(
      () => undefined,
    );
  }, [
    isSettingsHydrated,
    loadFolderImages,
    settings.metadataLocation,
    settings.photoAlbumLocation,
  ]);

  const handleFolderSelect = async () => {
    setIsSelecting(true);

    try {
      const selectedFolder = await window.electron.folder.select();

      if (!selectedFolder) {
        return;
      }

      setActiveFolder(selectedFolder);
      window.localStorage.setItem(
        LAST_ACTIVE_FOLDER_STORAGE_KEY,
        selectedFolder,
      );
      const shouldSeedAlbumLocation = settings.photoAlbumLocation.trim() === '';
      const nextSettings = shouldSeedAlbumLocation
        ? {
            ...settings,
            photoAlbumLocation: selectedFolder,
            metadataLocation: buildMetadataLocation(selectedFolder),
          }
        : settings;

      if (shouldSeedAlbumLocation) {
        setSettings(nextSettings);
        window.localStorage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify(nextSettings),
        );
      }

      const effectiveMetadataLocation =
        nextSettings.metadataLocation.trim() ||
        buildMetadataLocation(selectedFolder);
      await loadFolderImages(selectedFolder, effectiveMetadataLocation);
    } finally {
      setIsSelecting(false);
    }
  };

  const handleReload = async () => {
    if (!activeFolder) {
      return;
    }

    const effectiveMetadataLocation =
      settings.metadataLocation.trim() ||
      buildMetadataLocation(settings.photoAlbumLocation.trim() || activeFolder);
    await loadFolderImages(activeFolder, effectiveMetadataLocation);
  };

  const closeImageCard = () => {
    splatLookupRequestId.current += 1;
    setSelectedImage(null);
    setSelectedImageSplat(null);
    setIsSplatLoading(false);
    setSplatLookupError(null);
  };

  const handleImageSelect = async (image: ListedImage) => {
    const requestId = splatLookupRequestId.current + 1;
    splatLookupRequestId.current = requestId;
    setSelectedImage(image);
    setSplatLookupError(null);

    const resolvedAlbumPath = activeFolder?.trim();

    if (!resolvedAlbumPath) {
      setSelectedImageSplat(null);
      setIsSplatLoading(false);
      return;
    }

    const cacheKey = `${resolvedAlbumPath}:${image.name}`;

    if (
      Object.prototype.hasOwnProperty.call(splatLookupCache.current, cacheKey)
    ) {
      setSelectedImageSplat(splatLookupCache.current[cacheKey]);
      setIsSplatLoading(false);
      return;
    }

    setIsSplatLoading(true);
    setSelectedImageSplat(null);

    try {
      const splat = await window.electron.folder.getImageSplat(
        resolvedAlbumPath,
        image.name,
      );
      splatLookupCache.current[cacheKey] = splat;

      if (splatLookupRequestId.current !== requestId) {
        return;
      }

      setSelectedImageSplat(splat);
    } catch {
      if (splatLookupRequestId.current !== requestId) {
        return;
      }

      setSelectedImageSplat(null);
      setSplatLookupError('Unable to load matching splat file.');
    } finally {
      if (splatLookupRequestId.current === requestId) {
        setIsSplatLoading(false);
      }
    }
  };

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <Home
              activeFolder={activeFolder}
              images={images}
              isSelecting={isSelecting}
              isLoading={isLoading}
              errorMessage={errorMessage}
              onSelectFolder={handleFolderSelect}
              onReload={handleReload}
              onImageSelect={handleImageSelect}
            />
          }
        />
        <Route
          path="/explore"
          element={
            <Explore images={images} onImageSelect={handleImageSelect} />
          }
        />
        <Route
          path="/settings"
          element={
            <Settings settings={settings} onSettingsChange={setSettings} />
          }
        />
      </Routes>

      <ImageCardModal
        image={selectedImage}
        splat={selectedImageSplat}
        isSplatLoading={isSplatLoading}
        splatLookupError={splatLookupError}
        onClose={closeImageCard}
      />
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}
