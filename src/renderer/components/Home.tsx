import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useGlobeMotion from '../hooks/useGlobeMotion';
import type { HomeProps } from '../types/gallery';
import {
  CLOUD_DRAG_ROTATION_PER_PIXEL,
  CLOUD_ZOOM_MAX,
  CLOUD_ZOOM_MIN,
  CLOUD_ZOOM_PER_WHEEL,
  MAX_FILTER_CHIPS,
  MAX_RENDERED_IMAGES,
  createClusterLayout,
} from '../utils/gallery';

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

export default function Home({
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
  const cloudLayerRef = useRef<HTMLDivElement | null>(null);
  const [failedImagePaths, setFailedImagePaths] = useState<
    Record<string, true>
  >({});
  const [loadedImagePaths, setLoadedImagePaths] = useState<
    Record<string, true>
  >({});

  useEffect(() => {
    setFailedImagePaths({});
    setLoadedImagePaths({});
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
    const items = renderableImages.map((image, index) => {
      return {
        image,
        layout: createClusterLayout(image.path, index, renderableImages.length),
      };
    });

    if (items.length === 0) {
      return items;
    }

    const centroid = items.reduce(
      (acc, item) => {
        return {
          x: acc.x + item.layout.sphereX,
          y: acc.y + item.layout.sphereY,
          z: acc.z + item.layout.sphereZ,
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
        sphereX: item.layout.sphereX - centerX,
        sphereY: item.layout.sphereY - centerY,
        sphereZ: item.layout.sphereZ - centerZ,
      },
    }));
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

  const homeMotion = useGlobeMotion({
    enabled: renderableImages.length > 0,
    syncToken: cloudItems,
    onRender: renderCloudState,
    dragRotationPerPixel: CLOUD_DRAG_ROTATION_PER_PIXEL,
    zoomMin: CLOUD_ZOOM_MIN,
    zoomMax: CLOUD_ZOOM_MAX,
    zoomPerWheel: CLOUD_ZOOM_PER_WHEEL,
    resetOnDisable: true,
  });

  return (
    <main className="gallery-screen">
      <div className="nebula" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <section
        className={`cloud-viewport ${homeMotion.isDragging ? 'dragging' : ''}`}
        onPointerDown={homeMotion.onPointerDown}
        onPointerMove={homeMotion.onPointerMove}
        onPointerUp={homeMotion.onPointerUp}
        onPointerCancel={homeMotion.onPointerCancel}
        onWheel={homeMotion.onWheel}
        aria-live="polite"
      >
        {renderableImages.length > 0 && (
          <div className="cloud-drag-layer" ref={cloudLayerRef}>
            <div className="photo-cloud">
              {cloudItems.map(({ image, layout }) => {
                const isImageLoaded = Boolean(loadedImagePaths[image.path]);
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
                            className={`photo-frame photo-frame-button ${
                              isImageLoaded ? 'is-loaded' : 'is-loading'
                            }`}
                            aria-label={`Open details for ${image.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (homeMotion.consumeDragClick()) {
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
                              onLoad={() => {
                                setLoadedImagePaths((current) => {
                                  if (current[image.path]) {
                                    return current;
                                  }

                                  return {
                                    ...current,
                                    [image.path]: true,
                                  };
                                });
                              }}
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
                                setLoadedImagePaths((current) => {
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
