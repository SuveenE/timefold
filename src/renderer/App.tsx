import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import type { ListedImage } from '../main/preload';
import './App.css';

type RecentFolder = {
  name: string;
  path: string;
};

type ClusterLayout = {
  left: number;
  top: number;
  width: number;
  rotation: number;
  driftX: number;
  driftY: number;
  delay: number;
  duration: number;
  opacity: number;
  blur: number;
  zIndex: number;
};

type TileStyle = CSSProperties & {
  '--drift-x': string;
  '--drift-y': string;
  '--tile-opacity': string;
  '--tile-blur': string;
};

const MAX_RENDERED_IMAGES = 220;
const MAX_FILTER_CHIPS = 6;

const getFolderName = (folderPath: string): string => {
  return (
    folderPath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || 'Workspace'
  );
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
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

  return {
    left: clamp(50 + Math.cos(angle) * radius + xJitter, 5, 95),
    top: clamp(46 + Math.sin(angle) * radius * 0.86 + yJitter, 8, 90),
    width: 56 + random() * 94 + depth * 35,
    rotation: (random() - 0.5) * 32,
    driftX: (random() - 0.5) * 26,
    driftY: (random() - 0.5) * 20,
    duration: 10 + random() * 16,
    delay: random() * 12,
    opacity: clamp(0.58 + depth * 0.45, 0.46, 1),
    blur: clamp((1 - depth) * 0.55, 0, 0.7),
    zIndex: 5 + Math.round(depth * 140),
  };
};

function Home() {
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);
  const [images, setImages] = useState<ListedImage[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [failedImagePaths, setFailedImagePaths] = useState<
    Record<string, true>
  >({});

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

  const hiddenImageCount = Math.max(
    0,
    filteredPool.length - filteredImages.length,
  );
  const failedPreviewCount = filteredImages.length - renderableImages.length;

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

  const loadFolderImages = async (folderPath: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setFailedImagePaths({});

    try {
      const folderImages = await window.electron.folder.listImages(folderPath);
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
      setRecentFolders((previous) => {
        const updated = previous.filter(
          (folder) => folder.path !== selectedFolder,
        );
        updated.unshift({
          name: getFolderName(selectedFolder),
          path: selectedFolder,
        });
        return updated.slice(0, 4);
      });
      await loadFolderImages(selectedFolder);
    } finally {
      setIsSelecting(false);
    }
  };

  const handleRecentFolder = async (folderPath: string) => {
    setActiveFolder(folderPath);
    await loadFolderImages(folderPath);
  };

  const handleReload = async () => {
    if (!activeFolder) {
      return;
    }

    await loadFolderImages(activeFolder);
  };

  return (
    <main className="gallery-screen">
      <div className="nebula" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="library-header">
        <div className="window-controls" aria-hidden="true">
          <span className="traffic-dot traffic-dot-close" />
          <span className="traffic-dot traffic-dot-minimize" />
          <span className="traffic-dot traffic-dot-expand" />
        </div>

        <div className="header-breadcrumb" aria-label="Current section">
          <span className="header-breadcrumb-primary">My Library</span>
          <span className="header-breadcrumb-separator">/</span>
          <span className="header-breadcrumb-secondary">Recent</span>
        </div>

        <button
          type="button"
          className="header-utility"
          aria-label="Open library controls"
        >
          <span className="orbit-icon" aria-hidden="true" />
        </button>
      </header>

      <section className="cloud-viewport" aria-live="polite">
        {renderableImages.length > 0 && (
          <div className="photo-cloud">
            {cloudItems.map(({ image, layout }) => {
              const tileStyle: TileStyle = {
                left: `${layout.left}%`,
                top: `${layout.top}%`,
                width: `${layout.width}px`,
                zIndex: layout.zIndex,
                transform: `translate(-50%, -50%) rotate(${layout.rotation}deg)`,
                animationDuration: `${layout.duration}s`,
                animationDelay: `-${layout.delay}s`,
                '--drift-x': `${layout.driftX}px`,
                '--drift-y': `${layout.driftY}px`,
                '--tile-opacity': `${layout.opacity}`,
                '--tile-blur': `${layout.blur}px`,
              };

              return (
                <figure
                  key={image.path}
                  className="photo-tile"
                  style={tileStyle}
                >
                  <div className="photo-motion">
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
                  </div>
                </figure>
              );
            })}
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
            onClick={handleReload}
            disabled={!activeFolder || isLoading}
          >
            reload
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleFolderSelect}
            disabled={isSelecting}
          >
            {isSelecting ? 'opening...' : 'choose folder'}
          </button>
        </div>

        <section className="dock-meta">
          <p className="folder-name">
            {activeFolder ? getFolderName(activeFolder) : 'No folder selected'}
          </p>
          <p className="folder-path">
            {activeFolder || 'Select a local folder containing image files'}
          </p>
          {hiddenImageCount > 0 && (
            <p className="hint">
              Showing first {MAX_RENDERED_IMAGES} images for smooth animation (
              {hiddenImageCount} more not rendered).
            </p>
          )}
          {failedPreviewCount > 0 && (
            <p className="hint">
              {failedPreviewCount} image previews failed to load in this view.
            </p>
          )}
        </section>

        {recentFolders.length > 0 && (
          <div className="recent-row">
            {recentFolders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                className="recent-folder"
                onClick={() => handleRecentFolder(folder.path)}
              >
                {folder.name}
              </button>
            ))}
          </div>
        )}
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Router>
  );
}
