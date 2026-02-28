import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
const TIME_GLOBE_RADIUS = 300;
const TIME_CLUSTER_BASE_SPREAD = 14;
const TIME_CLUSTER_SPIRAL_SPREAD = 20;
const TIME_CLUSTER_COMPRESSION_MIN = 0.82;
const EXPLORE_WORLD_BASE_OFFSET_X = -24;
// Move the explore cloud upward by ~3cm (about 113px at 96dpi).
const EXPLORE_WORLD_BASE_OFFSET_Y = -131;
const GOLDEN_ANGLE_RADIANS = Math.PI * (3 - Math.sqrt(5));
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

type TimeCluster = {
  label: string;
  year: number | null;
  images: ListedImage[];
};

type TimeClusterLayout = {
  cluster: TimeCluster;
  latitude: number;
  longitude: number;
  center: {
    x: number;
    y: number;
    z: number;
  };
};

type ExploreTimeMarkerStyle = CSSProperties & {
  '--ex-x': string;
  '--ex-y': string;
  '--ex-z': string;
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

const buildYearValue = (capturedAt?: string | null): number | null => {
  if (!capturedAt) {
    return null;
  }

  const parsed = new Date(capturedAt);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.getUTCFullYear();
};

const buildTangentBasis = (latitude: number, longitude: number) => {
  const latRadians = (latitude * Math.PI) / 180;
  const lonRadians = (longitude * Math.PI) / 180;

  return {
    east: {
      x: Math.cos(lonRadians),
      y: 0,
      z: -Math.sin(lonRadians),
    },
    north: {
      x: -Math.sin(lonRadians) * Math.sin(latRadians),
      y: -Math.cos(latRadians),
      z: -Math.cos(lonRadians) * Math.sin(latRadians),
    },
  };
};

const resolveModeFromPathname = (pathname: string): ExploreMode | null => {
  if (pathname === '/location') {
    return 'location';
  }

  if (pathname === '/time') {
    return 'time';
  }

  if (pathname === '/explore') {
    return 'free';
  }

  return null;
};

export default function Explore({
  images,
  onImageSelect,
  initialMode = 'free',
}: ExploreProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<ExploreMode>(initialMode);
  const exploreStageRef = useRef<HTMLElement | null>(null);
  const exploreSidebarRef = useRef<HTMLElement | null>(null);
  const exploreWorldRef = useRef<HTMLDivElement | null>(null);
  const [loadedImagePaths, setLoadedImagePaths] = useState<
    Record<string, true>
  >({});
  const [exploreFrame, setExploreFrame] = useState({
    offsetX: 0,
    fitZoom: -220,
  });

  useEffect(() => {
    setLoadedImagePaths({});
  }, [images]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const pathMode = resolveModeFromPathname(location.pathname);

    if (!pathMode) {
      return;
    }

    setMode(pathMode);
  }, [location.pathname]);

  const markImageLoaded = useCallback((path: string) => {
    setLoadedImagePaths((current) => {
      if (current[path]) {
        return current;
      }

      return {
        ...current,
        [path]: true,
      };
    });
  }, []);

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
            z: point.z + 12 + variation * 10,
            width: 60 + depthHint * 20 + variation * 8,
            rotation: (variation - 0.5) * 4,
            opacity: clamp(0.4 + depthHint * 0.52, 0.34, 1),
          },
        },
      ];
    }, []);
  }, [images]);

  const timeClusters = useMemo<TimeCluster[]>(() => {
    const groups = new Map<string, TimeCluster>();

    images.forEach((image) => {
      const yearValue = buildYearValue(image.capturedAt);
      const label = yearValue === null ? 'Unknown year' : String(yearValue);
      const existing = groups.get(label);

      if (existing) {
        existing.images.push(image);
        return;
      }

      groups.set(label, {
        label,
        year: yearValue,
        images: [image],
      });
    });

    return [...groups.values()].sort((first, second) => {
      if (first.year === null) {
        return 1;
      }

      if (second.year === null) {
        return -1;
      }

      return second.year - first.year;
    });
  }, [images]);

  const timeClusterLayouts = useMemo<TimeClusterLayout[]>(() => {
    const totalClusters = timeClusters.length;

    if (totalClusters === 0) {
      return [];
    }

    const indexSpan = Math.max(totalClusters - 1, 1);

    return timeClusters.map((cluster, clusterIndex) => {
      const latitude =
        cluster.year === null ? -72 : 60 - (clusterIndex / indexSpan) * 120;
      const longitude = ((clusterIndex * 137.50776405003785) % 360) - 180;
      const center = projectCoordinatesToGlobe(
        latitude,
        longitude,
        TIME_GLOBE_RADIUS,
      );

      return {
        cluster,
        latitude,
        longitude,
        center,
      };
    });
  }, [timeClusters]);

  const timeItems = useMemo<ExploreSceneItem[]>(() => {
    if (timeClusterLayouts.length === 0) {
      return [];
    }

    return timeClusterLayouts.flatMap(
      ({ cluster, latitude, longitude, center }) => {
        const basis = buildTangentBasis(latitude, longitude);
        const clusterCompression = clamp(
          1 - Math.min(cluster.images.length, 18) * 0.018,
          TIME_CLUSTER_COMPRESSION_MIN,
          1,
        );

        return cluster.images.map((image, imageIndex) => {
          const angle = imageIndex * GOLDEN_ANGLE_RADIANS;
          const radialDistance =
            TIME_CLUSTER_BASE_SPREAD +
            Math.sqrt(imageIndex + 1) *
              TIME_CLUSTER_SPIRAL_SPREAD *
              clusterCompression;
          const offsetEast = Math.cos(angle) * radialDistance;
          const offsetNorth = Math.sin(angle) * radialDistance;
          const x =
            center.x + basis.east.x * offsetEast + basis.north.x * offsetNorth;
          const y =
            center.y + basis.east.y * offsetEast + basis.north.y * offsetNorth;
          const z =
            center.z + basis.east.z * offsetEast + basis.north.z * offsetNorth;
          const depthHint = clamp(
            (z + TIME_GLOBE_RADIUS) / (TIME_GLOBE_RADIUS * 2),
            0,
            1,
          );

          return {
            image,
            layout: {
              x,
              y,
              z,
              width: 50 + depthHint * 20,
              rotation: Math.sin(angle) * 4,
              opacity: clamp(0.48 + depthHint * 0.46, 0.42, 1),
            },
          };
        });
      },
    );
  }, [timeClusterLayouts]);

  const activeSceneItems = useMemo<ExploreSceneItem[]>(() => {
    if (mode === 'location') {
      return locationItems;
    }

    if (mode === 'time') {
      return timeItems;
    }

    return exploreItems;
  }, [exploreItems, locationItems, mode, timeItems]);
  const imagesMissingCoordinates = images.length - locationItems.length;
  const imagesWithCountry = useMemo(() => {
    return locationItems.filter((item) => {
      return Boolean(item.image.country?.trim());
    }).length;
  }, [locationItems]);
  const visibleTimeClusters = timeClusters.slice(0, 8);
  const hiddenTimeClusterCount = Math.max(timeClusters.length - 8, 0);
  const yearRangeLabel = useMemo(() => {
    const knownYears = timeClusters
      .map((cluster) => cluster.year)
      .filter((year): year is number => year !== null);

    if (knownYears.length === 0) {
      return 'No dated photos';
    }

    const newestYear = Math.max(...knownYears);
    const oldestYear = Math.min(...knownYears);

    if (newestYear === oldestYear) {
      return String(newestYear);
    }

    return `${oldestYear} - ${newestYear}`;
  }, [timeClusters]);

  useEffect(() => {
    let frameId = 0;
    let observer: ResizeObserver | null = null;
    let recomputeFit: (() => void) | null = null;

    if (activeSceneItems.length > 0) {
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
  }, [activeSceneItems]);

  const renderExploreState = useCallback(
    (rotationDeg: number, zoomDepth: number) => {
      const worldNode = exploreWorldRef.current;

      if (!worldNode) {
        return;
      }

      const rotation = `${rotationDeg.toFixed(2)}deg`;
      const finalZoom = zoomDepth + exploreFrame.fitZoom;
      const zoomValue = `${finalZoom.toFixed(2)}px`;
      const offsetXValue = `${(
        exploreFrame.offsetX + EXPLORE_WORLD_BASE_OFFSET_X
      ).toFixed(2)}px`;
      const offsetYValue = `${EXPLORE_WORLD_BASE_OFFSET_Y.toFixed(2)}px`;
      worldNode.style.setProperty('--ex-world-rotation-y', rotation);
      worldNode.style.setProperty('--ex-world-zoom-z', zoomValue);
      worldNode.style.transform = `translate3d(${offsetXValue}, ${offsetYValue}, ${zoomValue}) rotateX(-5deg) rotateY(${rotation})`;
    },
    [exploreFrame.fitZoom, exploreFrame.offsetX],
  );

  const exploreMotion = useGlobeMotion({
    enabled: activeSceneItems.length > 0,
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
          mode === 'time' ? 'time-mode' : ''
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
              navigate(mode === 'location' ? '/explore' : '/location')
            }
          >
            <MapPin className="explore-sidebar-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`explore-sidebar-button ${mode === 'time' ? 'active' : ''}`}
            aria-label="Show year clusters"
            onClick={() => navigate(mode === 'time' ? '/explore' : '/time')}
          >
            <Clock3 className="explore-sidebar-icon" aria-hidden="true" />
          </button>
        </aside>

        {images.length > 0 ? (
          <div className="explore-scene">
            <div className="explore-world" ref={exploreWorldRef}>
              {mode === 'location' ? (
                <div className="explore-location-map" aria-hidden="true" />
              ) : null}
              {mode === 'time' ? (
                <div className="explore-time-stars" aria-hidden="true" />
              ) : null}
              {mode === 'time'
                ? timeClusterLayouts.map(({ cluster, center }) => {
                    const markerStyle: ExploreTimeMarkerStyle = {
                      left: '50%',
                      top: '50%',
                      '--ex-x': `${center.x}px`,
                      '--ex-y': `${center.y - 64}px`,
                      '--ex-z': `${center.z + 10}px`,
                    };

                    return (
                      <div
                        key={`time-marker-${cluster.label}`}
                        className="explore-time-marker"
                        style={markerStyle}
                        aria-hidden="true"
                      >
                        <span className="explore-time-marker-year">
                          {cluster.label}
                        </span>
                      </div>
                    );
                  })
                : null}
              {activeSceneItems.map(({ image, layout }) => {
                const isImageLoaded = Boolean(loadedImagePaths[image.path]);
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
                    } ${mode === 'time' ? 'time-card' : ''}`}
                    style={cardStyle}
                  >
                    <button
                      type="button"
                      className={`explore-card-frame explore-card-button ${
                        isImageLoaded ? 'is-loaded' : 'is-loading'
                      }`}
                      aria-label={`Open details for ${image.name}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (exploreMotion.consumeDragClick()) {
                          event.preventDefault();
                          return;
                        }
                        onImageSelect(image);
                      }}
                    >
                      {!isImageLoaded ? (
                        <span
                          className="media-loading-indicator"
                          aria-hidden="true"
                        >
                          Loading...
                        </span>
                      ) : null}
                      <img
                        src={image.url}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        ref={(node) => {
                          if (!node) {
                            return;
                          }

                          // Cached/local images can already be complete before onLoad fires.
                          if (node.complete && node.naturalWidth > 0) {
                            markImageLoaded(image.path);
                          }
                        }}
                        onLoad={() => markImageLoaded(image.path)}
                        onError={() => markImageLoaded(image.path)}
                      />
                    </button>
                    {mode === 'location' ? (
                      <figcaption className="explore-location-country">
                        {image.country?.trim() || 'Unknown country'}
                      </figcaption>
                    ) : null}
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
                <p className="explore-location-meta-copy">
                  {imagesWithCountry} with country metadata
                </p>
              </div>
            ) : null}

            {mode === 'time' ? (
              <div
                className="explore-time-meta"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <p className="explore-time-meta-title">
                  {timeClusters.length} year
                  {timeClusters.length === 1 ? ' cluster' : ' clusters'}
                </p>
                <p className="explore-time-meta-copy">
                  Years: {yearRangeLabel}
                </p>
                <div className="explore-time-meta-chips">
                  {visibleTimeClusters.map((cluster) => (
                    <span
                      key={`time-cluster-${cluster.label}`}
                      className="explore-time-meta-chip"
                    >
                      {cluster.label} ({cluster.images.length})
                    </span>
                  ))}
                  {hiddenTimeClusterCount > 0 ? (
                    <span className="explore-time-meta-chip muted">
                      +{hiddenTimeClusterCount} more
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
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
