import { useCallback, useEffect, useRef, useState } from 'react';
import { MemoryRouter as Router, Route, Routes } from 'react-router-dom';
import Home from './components/Home';
import Explore from './components/Explore';
import Settings from './components/Settings';
import ImageCardModal from './components/ImageCardModal';
import type { ImageSplat, ListedImage, SettingsValues } from './types/gallery';
import {
  buildMetadataLocation,
  LAST_ACTIVE_FOLDER_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from './utils/gallery';
import './App.css';

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
