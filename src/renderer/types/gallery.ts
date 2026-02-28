import type {
  ImageAiAttributes,
  ImageSplat,
  ListedImage,
} from '../../main/preload';

export type ClusterLayout = {
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

export type ExploreLayout = {
  x: number;
  y: number;
  z: number;
  width: number;
  rotation: number;
  opacity: number;
};

export type ExploreMode = 'free' | 'location' | 'time';

export type SettingsValues = {
  photoAlbumLocation: string;
  metadataLocation: string;
  yourName: string;
};

export type HomeProps = {
  activeFolder: string | null;
  images: ListedImage[];
  isSelecting: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  onSelectFolder: () => Promise<void>;
  onReload: () => Promise<void>;
  onImageSelect: (image: ListedImage) => void;
};

export type ExploreProps = {
  images: ListedImage[];
  onImageSelect: (image: ListedImage) => void;
  initialMode?: ExploreMode;
};

export type SettingsProps = {
  settings: SettingsValues;
  onSettingsChange: (nextSettings: SettingsValues) => void;
};

export type ImageCardModalProps = {
  image: ListedImage | null;
  splat: ImageSplat | null;
  isSplatLoading: boolean;
  splatLookupError: string | null;
  onClose: () => void;
};

export type { ImageAiAttributes, ImageSplat, ListedImage };
