import type {
  CSSProperties,
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  left: number;
  top: number;
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
  zIndex: number;
};

type TileStyle = CSSProperties & {
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
  zStart: number;
  zEnd: number;
  width: number;
  rotation: number;
  spin: number;
  duration: number;
  delay: number;
  opacity: number;
  zIndex: number;
};

type ExploreCardStyle = CSSProperties & {
  '--ex-x': string;
  '--ex-y': string;
  '--ex-z-start': string;
  '--ex-z-end': string;
  '--ex-rotate': string;
  '--ex-spin': string;
  '--ex-duration': string;
  '--ex-delay': string;
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

type CameraState = {
  x: number;
  y: number;
  rotateX: number;
  rotateY: number;
  zoom: number;
};

const MAX_RENDERED_IMAGES = 220;
const MAX_FILTER_CHIPS = 6;
const SETTINGS_STORAGE_KEY = 'timefold.settings';

const INITIAL_CAMERA: CameraState = {
  x: 0,
  y: 0,
  rotateX: -8,
  rotateY: 18,
  zoom: -180,
};

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
  const angle = random() * Math.PI * 2;
  const radius = 8 + random() ** 0.75 * 34;
  const xJitter = (random() - 0.5) * 9;
  const yJitter = (random() - 0.5) * 11;
  const depth = random();
  const orbitDuration = 14 + random() * 22;

  return {
    left: clamp(50 + Math.cos(angle) * radius + xJitter, 5, 95),
    top: clamp(46 + Math.sin(angle) * radius * 0.86 + yJitter, 8, 90),
    width: 56 + random() * 94 + depth * 35,
    rotation: 0,
    orbitX: (random() - 0.5) * (14 + (1 - depth) * 34),
    orbitY: (random() - 0.5) * (12 + (1 - depth) * 24),
    orbitDuration,
    orbitDelay: random() * 20,
    counterDuration: orbitDuration,
    bobX: (random() - 0.5) * 13,
    bobY: (random() - 0.5) * 16,
    bobDuration: 4 + random() * 8,
    opacity: clamp(0.58 + depth * 0.45, 0.46, 1),
    blur: clamp((1 - depth) * 0.55, 0, 0.7),
    zIndex: 5 + Math.round(depth * 140),
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
  const theta = random() * Math.PI * 2;
  const radius = 170 + random() ** 0.8 * 520;
  const ovalStretch = 0.64 + random() * 0.28;
  const spreadOffset = (index / Math.max(total, 1)) * Math.PI * 0.24;
  const depthBase = (random() - 0.5) * 760;
  const depthTravel = 210 + random() * 380;
  const perspectiveHint = clamp((depthBase + 760) / 1520, 0, 1);

  return {
    x: Math.cos(theta + spreadOffset) * radius,
    y: Math.sin(theta * 1.08 + spreadOffset) * radius * ovalStretch,
    zStart: depthBase - depthTravel * 0.5,
    zEnd: depthBase + depthTravel * 0.5,
    width: 92 + random() * 132 + perspectiveHint * 42,
    rotation: 0,
    spin: 0,
    duration: 14 + random() * 18,
    delay: random() * 20,
    opacity: clamp(0.52 + perspectiveHint * 0.48, 0.44, 1),
    zIndex: 10 + Math.round(perspectiveHint * 250),
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
  const [cloudOffsetX, setCloudOffsetX] = useState(0);
  const [isCloudDragging, setIsCloudDragging] = useState(false);
  const cloudDragState = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
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

  const beginCloudDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (renderableImages.length === 0) {
      return;
    }

    cloudDragState.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: event.clientX,
    };
    setIsCloudDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateCloudDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      !cloudDragState.current.active ||
      cloudDragState.current.pointerId !== event.pointerId
    ) {
      return;
    }

    const deltaX = event.clientX - cloudDragState.current.lastX;
    cloudDragState.current.lastX = event.clientX;

    setCloudOffsetX((current) => clamp(current + deltaX, -420, 420));
  };

  const endCloudDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (cloudDragState.current.pointerId !== event.pointerId) {
      return;
    }

    cloudDragState.current.active = false;
    cloudDragState.current.pointerId = -1;
    setIsCloudDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

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
        aria-live="polite"
      >
        {renderableImages.length > 0 && (
          <div
            className="cloud-drag-layer"
            style={{ transform: `translate3d(${cloudOffsetX}px, 0, 0)` }}
          >
            <div className="photo-cloud">
              {cloudItems.map(({ image, layout }) => {
                const tileStyle: TileStyle = {
                  left: `${layout.left}%`,
                  top: `${layout.top}%`,
                  width: `${layout.width}px`,
                  zIndex: layout.zIndex,
                  transform: 'translate(-50%, -50%)',
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
  const [camera, setCamera] = useState<CameraState>(INITIAL_CAMERA);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<ExploreMode>('free');
  const dragState = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
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

  const worldStyle = useMemo((): CSSProperties => {
    return {
      transform: `translate3d(${camera.x}px, ${camera.y}px, ${camera.zoom}px) rotateX(${camera.rotateX}deg) rotateY(${camera.rotateY}deg)`,
    };
  }, [camera]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    dragState.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    if (
      !dragState.current.active ||
      dragState.current.pointerId !== event.pointerId
    ) {
      return;
    }

    const deltaX = event.clientX - dragState.current.lastX;
    const deltaY = event.clientY - dragState.current.lastY;

    dragState.current.lastX = event.clientX;
    dragState.current.lastY = event.clientY;

    setCamera((current) => {
      return {
        x: clamp(current.x + deltaX, -360, 360),
        y: clamp(current.y + deltaY, -280, 280),
        rotateX: clamp(current.rotateX - deltaY * 0.08, -52, 52),
        rotateY: clamp(current.rotateY + deltaX * 0.08, -62, 62),
        zoom: current.zoom,
      };
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    if (dragState.current.pointerId !== event.pointerId) {
      return;
    }

    dragState.current.active = false;
    dragState.current.pointerId = -1;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (mode !== 'free') {
      return;
    }

    event.preventDefault();

    setCamera((current) => {
      return {
        ...current,
        zoom: clamp(current.zoom - event.deltaY * 0.55, -900, 260),
      };
    });
  };

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
            <div className="explore-world" style={worldStyle}>
              {exploreItems.map(({ image, layout }) => {
                const cardStyle: ExploreCardStyle = {
                  left: '50%',
                  top: '50%',
                  width: `${layout.width}px`,
                  zIndex: layout.zIndex,
                  '--ex-x': `${layout.x}px`,
                  '--ex-y': `${layout.y}px`,
                  '--ex-z-start': `${layout.zStart}px`,
                  '--ex-z-end': `${layout.zEnd}px`,
                  '--ex-rotate': `${layout.rotation}deg`,
                  '--ex-spin': `${layout.spin}deg`,
                  '--ex-duration': `${layout.duration}s`,
                  '--ex-delay': `-${layout.delay}s`,
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
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    splatLookupCache.current = {};
    setSelectedImage(null);
    setSelectedImageSplat(null);
    setIsSplatLoading(false);
    setSplatLookupError(null);
  }, [activeFolder]);

  const loadFolderImages = async (
    folderPath: string,
    metadataFolderPath?: string,
  ) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const folderImages = await window.electron.folder.listImages(
        folderPath,
        metadataFolderPath,
      );
      setImages(folderImages);

      if (folderImages.length === 0) {
        setErrorMessage('No supported image files were found in this folder.');
      }
    } catch {
      setImages([]);
      setErrorMessage(
        'Unable to read this folder. Please try another location.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFolderSelect = async () => {
    setIsSelecting(true);

    try {
      const selectedFolder = await window.electron.folder.select();

      if (!selectedFolder) {
        return;
      }

      setActiveFolder(selectedFolder);
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
