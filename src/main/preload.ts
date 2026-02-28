// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'ipc-example';
export type ImageAiAttributes = {
  detectedObjects: string[];
  primarySubject: string[];
  sceneLocation: string[];
  timeOfDay: string[];
  lighting: string[];
  sky: string[];
  weather: string[];
  season: string[];
  environmentLandscape: string[];
  activity: string[];
  peopleCount: string[];
  socialContext: string[];
  moodVibe: string[];
  aestheticStyleColor: string[];
  ocrText: string[];
};

export type ListedImage = {
  name: string;
  path: string;
  url: string;
  ext: string;
  capturedAt?: string | null;
  location?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  aiAttributes?: ImageAiAttributes | null;
};

export type ImageSplat = {
  name: string;
  path: string;
  url: string;
  previewText: string | null;
  isBinary: boolean;
};

export type CountryLookupResult = {
  country: string | null;
  raw: unknown;
};

export type ApiCallResult = {
  status: number;
  data: unknown;
};

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  folder: {
    select() {
      return ipcRenderer.invoke('dialog:select-folder') as Promise<
        string | null
      >;
    },
    listImages(folderPath: string, metadataFolderPath?: string) {
      return ipcRenderer.invoke(
        'folder:list-images',
        folderPath,
        metadataFolderPath,
      ) as Promise<ListedImage[]>;
    },
    getImageSplat(albumPath: string, imageName: string) {
      return ipcRenderer.invoke(
        'folder:get-image-splat',
        albumPath,
        imageName,
      ) as Promise<ImageSplat | null>;
    },
    getSplatBytes(splatPath: string) {
      return ipcRenderer.invoke(
        'folder:get-splat-bytes',
        splatPath,
      ) as Promise<Uint8Array | null>;
    },
  },
  api: {
    fetchCountryByCoordinates(latitude: number, longitude: number) {
      return ipcRenderer.invoke(
        'api:fetch-country-by-coordinates',
        latitude,
        longitude,
      ) as Promise<CountryLookupResult>;
    },
    generateWorldFromImage(imagePath: string) {
      return ipcRenderer.invoke(
        'api:generate-world-from-image',
        imagePath,
      ) as Promise<ApiCallResult>;
    },
    findPhotoAttributes(imagePath: string) {
      return ipcRenderer.invoke(
        'api:find-photo-attributes',
        imagePath,
      ) as Promise<ApiCallResult>;
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
