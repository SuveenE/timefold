// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'ipc-example';
export type ListedImage = {
  name: string;
  path: string;
  url: string;
  ext: string;
  capturedAt?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type ImageSplat = {
  name: string;
  path: string;
  previewText: string | null;
  isBinary: boolean;
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
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
