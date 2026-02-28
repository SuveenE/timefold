import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, House, MapPin, Settings as SettingsIcon } from 'lucide-react';
import useGlobeMotion from '../hooks/useGlobeMotion';
import type {
  ExploreMode,
  ExploreProps,
  ExploreLayout,
  ListedImage,
} from '../types/gallery';
import {
  EXPLORE_DRAG_ROTATION_PER_PIXEL,
  EXPLORE_ZOOM_MAX,
  EXPLORE_ZOOM_MIN,
  EXPLORE_ZOOM_PER_WHEEL,
  clamp,
  createExploreLayout,
} from '../utils/gallery';

const LOCATION_GLOBE_RADIUS = 320;
const LOCATION_TEXT_PATTERN = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/;

type ExploreCardStyle = CSSProperties & {
  '--ex-x': string;
  '--ex-y': string;
  '--ex-z': string;
  '--ex-rotate': string;
  '--ex-opacity': string;
};

type ExploreSceneItem = {
  image: ListedImage;
  layout: ExploreLayout;
};

type ParsedCoordinates = {
  latitude: number;
  longitude: number;
};

const hasValidCoordinates = (latitude: number, longitude: number): boolean => {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

const parseCoordinatesFromImage = (
  image: ListedImage,
): ParsedCoordinates | null => {
  if (
    typeof image.latitude === 'number' &&
    typeof image.longitude === 'number'
  ) {
    if (hasValidCoordinates(image.latitude, image.longitude)) {
      return {
        latitude: image.latitude,
        longitude: image.longitude,
      };
    }
  }

  const fallbackLocation = image.location?.trim();

  if (!fallbackLocation) {
    return null;
  }

  const match = fallbackLocation.match(LOCATION_TEXT_PATTERN);

  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

  if (!hasValidCoordinates(latitude, longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
};

const projectCoordinatesToGlobe = (
  latitude: number,
  longitude: number,
  radius: number,
) => {
  const latRadians = (latitude * Math.PI) / 180;
  const lonRadians = (longitude * Math.PI) / 180;
  const cosLatitude = Math.cos(latRadians);

  return {
    x: Math.sin(lonRadians) * cosLatitude * radius,
    y: -Math.sin(latRadians) * radius,
    z: Math.cos(lonRadians) * cosLatitude * radius,
  };
};

export default function Explore({ images, onImageSelect }: ExploreProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ExploreMode>('free');
  const exploreStageRef = useRef<HTMLElement | null>(null);
  const exploreSidebarRef = useRef<HTMLElement | null>(null);
  const exploreWorldRef = useRef<HTMLDivElement | null>(null);
  const [exploreFrame, setExploreFrame] = useState({
    offsetX: 0,
    fitZoom: -220,
  });

  const exploreItems = useMemo<ExploreSceneItem[]>(() => {
    const items = images.map((image, index) => {
      return {
        image,
        layout: createExploreLayout(image.path, index, images.length),
      };
    });

    if (items.length === 0) {
      return items;
    }

    const centroid = items.reduce(
      (acc, item) => {
        return {
          x: acc.x + item.layout.x,
          y: acc.y + item.layout.y,
          z: acc.z + item.layout.z,
        };
      },
      { x: 0, y: 0, z: 0 },
    );

    const invLength = 1 / items.length;
    const centerX = centroid.x * invLength;
    const centerY = centroid.y * invLength;
    const centerZ = centroid.z * invLength;

    return items.map((item) => ({
      ...item,
      layout: {
        ...item.layout,
        x: item.layout.x - centerX,
        y: item.layout.y - centerY,
        z: item.layout.z - centerZ,
      },
    }));
  }, [images]);

  const locationItems = useMemo<ExploreSceneItem[]>(() => {
    return images.reduce<ExploreSceneItem[]>((current, image, index) => {
      const coordinates = parseCoordinatesFromImage(image);

      if (!coordinates) {
        return current;
      }

      const point = projectCoordinatesToGlobe(
        coordinates.latitude,
        coordinates.longitude,
        LOCATION_GLOBE_RADIUS,
      );
      const depthHint = clamp(
        (point.z + LOCATION_GLOBE_RADIUS) / (LOCATION_GLOBE_RADIUS * 2),
        0,
        1,
      );
      const variation = (index % 7) / 7;

      return [
        ...current,
        {
          image,
          layout: {
            x: point.x,
            y: point.y,
            z: point.z,
            width: 68 + depthHint * 26 + variation * 8,
            rotation: (variation - 0.5) * 4,
            opacity: clamp(0.56 + depthHint * 0.42, 0.45, 1),
          },
        },
      ];
    }, []);
  }, [images]);

  const timeClusters = useMemo(() => {
    const groups = new Map<string, typeof images>();

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

  const isSceneMode = mode !== 'time';
  const activeSceneItems = mode === 'location' ? locationItems : exploreItems;
  const imagesMissingCoordinates = images.length - locationItems.length;

  useEffect(() => {
    let frameId = 0;
    let observer: ResizeObserver | null = null;
    let recomputeFit: (() => void) | null = null;

    if (isSceneMode && activeSceneItems.length > 0) {
      const stageNode = exploreStageRef.current;

      if (stageNode) {
        const perspective = 1700;

        recomputeFit = () => {
          if (frameId !== 0) {
            window.cancelAnimationFrame(frameId);
          }

          frameId = window.requestAnimationFrame(() => {
            const stageRect = stageNode.getBoundingClientRect();

            if (stageRect.width < 2 || stageRect.height < 2) {
              return;
            }

            const sidebarRect =
              exploreSidebarRef.current?.getBoundingClientRect();
            const sidebarRight = sidebarRect
              ? clamp(
                  sidebarRect.right - stageRect.left,
                  0,
                  stageRect.width * 0.6,
                )
              : 0;
            const sidebarPad = sidebarRight > 0 ? sidebarRight + 14 : 0;
            const availableHalfWidth = Math.max(
              (stageRect.width - sidebarPad - 30) * 0.5,
              160,
            );
            const availableHalfHeight = Math.max(
              (stageRect.height - 34) * 0.5,
              150,
            );

            const fitsAtZoom = (zoom: number): boolean => {
              return activeSceneItems.every(({ layout }) => {
                const translatedZ = layout.z + zoom;
                const denominator = perspective - translatedZ;

                if (denominator <= 120) {
                  return false;
                }

                const scale = perspective / denominator;
                const halfWidth = layout.width * 0.5 + 10;
                const halfHeight = Math.min(140, layout.width * 0.85) + 10;
                const projectedHalfX = (Math.abs(layout.x) + halfWidth) * scale;
                const projectedHalfY =
                  (Math.abs(layout.y) + halfHeight) * scale;
                return (
                  projectedHalfX <= availableHalfWidth &&
                  projectedHalfY <= availableHalfHeight
                );
              });
            };

            let lower = EXPLORE_ZOOM_MIN;
            let upper = EXPLORE_ZOOM_MAX;
            let bestZoom = EXPLORE_ZOOM_MIN;

            if (fitsAtZoom(lower)) {
              for (let iteration = 0; iteration < 26; iteration += 1) {
                const mid = (lower + upper) * 0.5;

                if (fitsAtZoom(mid)) {
                  bestZoom = mid;
                  lower = mid;
                } else {
                  upper = mid;
                }
              }
            }

            const nextFrame = {
              offsetX: sidebarPad * 0.5,
              fitZoom: clamp(bestZoom - 24, EXPLORE_ZOOM_MIN, EXPLORE_ZOOM_MAX),
            };

            setExploreFrame((current) => {
              if (
                Math.abs(current.offsetX - nextFrame.offsetX) < 0.25 &&
                Math.abs(current.fitZoom - nextFrame.fitZoom) < 0.25
              ) {
                return current;
              }

              return nextFrame;
            });
          });
        };

        recomputeFit();

        observer = new ResizeObserver(() => {
          if (recomputeFit) {
            recomputeFit();
          }
        });

        observer.observe(stageNode);

        const sidebarNode = exploreSidebarRef.current;
        if (sidebarNode) {
          observer.observe(sidebarNode);
        }

        window.addEventListener('resize', recomputeFit);
      }
    }

    return () => {
      if (recomputeFit) {
        window.removeEventListener('resize', recomputeFit);
      }
      if (observer) {
        observer.disconnect();
      }
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [activeSceneItems, isSceneMode]);

  const renderExploreState = useCallback(
    (rotationDeg: number, zoomDepth: number) => {
      const worldNode = exploreWorldRef.current;

      if (!worldNode) {
        return;
      }

      const rotation = `${rotationDeg.toFixed(2)}deg`;
      const finalZoom = zoomDepth + exploreFrame.fitZoom;
      const zoomValue = `${finalZoom.toFixed(2)}px`;
      const offsetXValue = `${exploreFrame.offsetX.toFixed(2)}px`;
      worldNode.style.setProperty('--ex-world-rotation-y', rotation);
      worldNode.style.setProperty('--ex-world-zoom-z', zoomValue);
      worldNode.style.transform = `translate3d(${offsetXValue}, 0, ${zoomValue}) rotateX(-5deg) rotateY(${rotation})`;
    },
    [exploreFrame.fitZoom, exploreFrame.offsetX],
  );

  const exploreMotion = useGlobeMotion({
    enabled: isSceneMode && activeSceneItems.length > 0,
    syncToken: activeSceneItems,
    onRender: renderExploreState,
    dragRotationPerPixel: EXPLORE_DRAG_ROTATION_PER_PIXEL,
    zoomMin: EXPLORE_ZOOM_MIN,
    zoomMax: EXPLORE_ZOOM_MAX,
    zoomPerWheel: EXPLORE_ZOOM_PER_WHEEL,
  });

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
        ref={exploreStageRef}
        className={`explore-stage ${exploreMotion.isDragging ? 'dragging' : ''} ${
          mode === 'time' ? 'cluster-mode' : ''
        }`}
        onPointerDown={exploreMotion.onPointerDown}
        onPointerMove={exploreMotion.onPointerMove}
        onPointerUp={exploreMotion.onPointerUp}
        onPointerCancel={exploreMotion.onPointerCancel}
        onWheel={exploreMotion.onWheel}
        aria-label="Interactive image space"
      >
        <aside
          ref={exploreSidebarRef}
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
            aria-label="Show location globe"
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

        {images.length > 0 && isSceneMode ? (
          <div className="explore-scene">
            <div className="explore-world" ref={exploreWorldRef}>
              {mode === 'location' ? (
                <div className="explore-location-globe" aria-hidden="true" />
              ) : null}
              {activeSceneItems.map(({ image, layout }) => {
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
                    key={`${mode}-${image.path}`}
                    className={`explore-card ${
                      mode === 'location' ? 'location-card' : ''
                    }`}
                    style={cardStyle}
                  >
                    <button
                      type="button"
                      className="explore-card-frame explore-card-button"
                      aria-label={`Open details for ${image.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (exploreMotion.consumeDragClick()) {
                          event.preventDefault();
                          return;
                        }
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

            {mode === 'location' ? (
              <div
                className="explore-location-meta"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <p className="explore-location-meta-title">
                  {locationItems.length} geotagged
                  {locationItems.length === 1 ? ' photo' : ' photos'}
                </p>
                <p className="explore-location-meta-copy">
                  {imagesMissingCoordinates > 0
                    ? `${imagesMissingCoordinates} without latitude/longitude metadata`
                    : 'All photos include latitude/longitude metadata'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {images.length > 0 && mode === 'time' ? (
          <div
            className="explore-cluster-board"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="explore-cluster-grid">
              {timeClusters.map((cluster) => (
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
              ))}
            </div>
          </div>
        ) : null}

        {mode === 'location' &&
        images.length > 0 &&
        locationItems.length === 0 ? (
          <div className="status-panel explore-empty">
            <p className="status-title">No geotagged images found</p>
            <p className="status-copy">
              Load photos with latitude and longitude metadata to map them on
              the globe.
            </p>
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
