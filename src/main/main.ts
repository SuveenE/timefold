/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { Dirent } from 'fs';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  nativeImage,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

type ImageAiAttributes = {
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

type ListedImage = {
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

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'tif',
  'avif',
  'heic',
  'heif',
]);

const PREVIEW_DATA_URL_EXTENSIONS = new Set(['heic', 'heif']);
const MAX_IMAGE_RESULTS = 320;
const MAX_SCAN_DEPTH = 6;
const MAX_PREVIEW_WIDTH = 960;
const SPLAT_FOLDER_NAME = 'splats';
const SPLAT_PREVIEW_BYTES = 96 * 1024;
const SPLAT_PREVIEW_LINES = 36;
const MAX_SPLAT_FILE_BYTES = 512 * 1024 * 1024;
const SPLAT_EXTENSIONS = ['.spz', '.ply'] as const;
const LOCAL_API_BASE_URL = 'http://localhost:8000';
const PHOTO_ATTRIBUTES_FILE_NAME = 'photo_attributes_all.json';

const execFileAsync = promisify(execFile);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

type ImageMetadata = {
  capturedAt: string | null;
  location: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
};

type PersistedImageMetadata = {
  name: string;
  path: string;
  ext: string;
  capturedAt: string | null;
  location: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  aiAttributes: ImageAiAttributes | null;
};

type RawPhotoAttribute = {
  key?: unknown;
  value?: unknown;
};

type AttributeCategoryDefinition = {
  field: Exclude<keyof ImageAiAttributes, 'detectedObjects'>;
  aliases: string[];
};

type PhotoAttributeIndex = {
  byName: Map<string, ImageAiAttributes>;
  byPath: Map<string, ImageAiAttributes>;
};

const ATTRIBUTE_CATEGORY_DEFINITIONS: AttributeCategoryDefinition[] = [
  {
    field: 'primarySubject',
    aliases: [
      'main_subject',
      'object',
      'object_present',
      'animal_species',
      'vehicle_type',
    ],
  },
  {
    field: 'sceneLocation',
    aliases: [
      'location_type',
      'location_name',
      'location_hint',
      'primary_setting',
      'scene_type',
      'venue_type',
    ],
  },
  {
    field: 'timeOfDay',
    aliases: ['time_of_day', 'time_of_day_hint', 'time_of_day_suggestion'],
  },
  {
    field: 'lighting',
    aliases: [
      'lighting_condition',
      'lighting_type',
      'lighting_style',
      'light_quality',
    ],
  },
  {
    field: 'sky',
    aliases: ['sky_condition', 'sky_color', 'cloud_presence'],
  },
  {
    field: 'weather',
    aliases: [
      'weather_condition',
      'weather_conditions',
      'weather_hint',
      'temperature_hint',
    ],
  },
  {
    field: 'season',
    aliases: ['season', 'season_hint', 'time_of_year_hint'],
  },
  {
    field: 'environmentLandscape',
    aliases: [
      'environment_type',
      'landscape_type',
      'terrain_type',
      'vegetation_type',
      'water_color',
    ],
  },
  {
    field: 'activity',
    aliases: [
      'activity',
      'activity_type',
      'activity_main',
      'activity_implied',
      'human_action',
    ],
  },
  {
    field: 'peopleCount',
    aliases: [
      'number_of_people_visible',
      'number_of_people',
      'person_count',
      'number_of_people_approx',
    ],
  },
  {
    field: 'socialContext',
    aliases: ['social_setting', 'social_interaction', 'group_size'],
  },
  {
    field: 'moodVibe',
    aliases: ['vibe', 'vibe_suggestion', 'mood_suggestion'],
  },
  {
    field: 'aestheticStyleColor',
    aliases: [
      'aesthetic_style',
      'aesthetic_quality',
      'depth_of_field',
      'perspective',
      'color_palette',
    ],
  },
  {
    field: 'ocrText',
    aliases: ['visible_text', 'text_extracted', 'visible_text_on_screen'],
  },
];

type ImageSplat = {
  name: string;
  path: string;
  url: string;
  previewText: string | null;
  isBinary: boolean;
};

const parseMdlsValue = (output: string, key: string): string | null => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = output.match(new RegExp(`${escapedKey}\\s*=\\s*(.*)`));

  if (!match) {
    return null;
  }

  const value = match[1].trim();

  if (value === '(null)' || value.length === 0) {
    return null;
  }

  return value.replace(/^"(.*)"$/, '$1');
};

const toIsoDateIfValid = (value: string): string | null => {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const createEmptyImageAiAttributes = (): ImageAiAttributes => {
  return {
    detectedObjects: [],
    primarySubject: [],
    sceneLocation: [],
    timeOfDay: [],
    lighting: [],
    sky: [],
    weather: [],
    season: [],
    environmentLandscape: [],
    activity: [],
    peopleCount: [],
    socialContext: [],
    moodVibe: [],
    aestheticStyleColor: [],
    ocrText: [],
  };
};

const toTrimmedStringValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }

  return null;
};

const appendUniqueValues = (target: string[], values: string[]): void => {
  values.forEach((value) => {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      return;
    }

    const isDuplicate = target.some(
      (existingValue) =>
        existingValue.localeCompare(normalizedValue, undefined, {
          sensitivity: 'accent',
        }) === 0,
    );

    if (!isDuplicate) {
      target.push(normalizedValue);
    }
  });
};

const isAliasMatch = (normalizedKey: string, alias: string): boolean => {
  return (
    normalizedKey === alias ||
    normalizedKey.startsWith(`${alias}_`) ||
    normalizedKey.startsWith(`${alias}-`)
  );
};

const findBestAliasMatch = (
  normalizedKey: string,
  aliases: string[],
): string | null => {
  const matchedAliases = aliases
    .filter((alias) => isAliasMatch(normalizedKey, alias))
    .sort((first, second) => second.length - first.length);

  return matchedAliases.length > 0 ? matchedAliases[0] : null;
};

const humanizeCategorySuffix = (value: string): string => {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
};

const collectScalarValues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectScalarValues(item));
  }

  const scalarValue = toTrimmedStringValue(value);
  return scalarValue ? [scalarValue] : [];
};

const extractValuesForAlias = (
  normalizedKey: string,
  matchedAlias: string,
  rawValue: unknown,
): string[] => {
  if (typeof rawValue === 'boolean') {
    if (!rawValue) {
      return [];
    }

    if (normalizedKey === matchedAlias) {
      return ['Yes'];
    }

    const suffix = normalizedKey
      .slice(matchedAlias.length)
      .replace(/^[_-]+/, '');
    const humanizedSuffix = humanizeCategorySuffix(suffix);
    return humanizedSuffix ? [humanizedSuffix] : ['Yes'];
  }

  const scalarValues = collectScalarValues(rawValue);

  if (scalarValues.length > 0) {
    return scalarValues;
  }

  if (normalizedKey !== matchedAlias) {
    const suffix = normalizedKey
      .slice(matchedAlias.length)
      .replace(/^[_-]+/, '');
    const humanizedSuffix = humanizeCategorySuffix(suffix);
    return humanizedSuffix ? [humanizedSuffix] : [];
  }

  return [];
};

const hasAnyAiAttributeValues = (attributes: ImageAiAttributes): boolean => {
  return Object.values(attributes).some((values) => values.length > 0);
};

const normalizeImageNameKey = (value: string): string => {
  return path.basename(value).trim().toLowerCase();
};

const normalizeImagePathKey = (value: string): string => {
  return path.normalize(value).trim().toLowerCase();
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const normalizePhotoAttributesItem = (
  item: Record<string, unknown>,
): ImageAiAttributes | null => {
  const normalizedAttributes = createEmptyImageAiAttributes();
  const florence = isRecord(item.florence) ? item.florence : null;
  const florenceRaw = florence && isRecord(florence.raw) ? florence.raw : null;
  const florenceResults =
    florenceRaw && isRecord(florenceRaw.results) ? florenceRaw.results : null;
  const florenceBboxes = Array.isArray(florenceResults?.bboxes)
    ? florenceResults.bboxes
    : [];

  florenceBboxes.forEach((bbox) => {
    if (!isRecord(bbox)) {
      return;
    }

    const label = toTrimmedStringValue(bbox.label);

    if (label) {
      appendUniqueValues(normalizedAttributes.detectedObjects, [label]);
    }
  });

  const gemini = isRecord(item.gemini) ? item.gemini : null;
  const geminiJson = gemini && isRecord(gemini.json) ? gemini.json : null;
  const rawAttributes = Array.isArray(geminiJson?.attributes)
    ? geminiJson.attributes
    : [];

  rawAttributes.forEach((rawAttribute) => {
    if (!isRecord(rawAttribute)) {
      return;
    }

    const attribute = rawAttribute as RawPhotoAttribute;
    const rawKey = toTrimmedStringValue(attribute.key);

    if (!rawKey) {
      return;
    }

    const normalizedKey = rawKey.toLowerCase();

    ATTRIBUTE_CATEGORY_DEFINITIONS.forEach((categoryDefinition) => {
      const matchedAlias = findBestAliasMatch(
        normalizedKey,
        categoryDefinition.aliases,
      );

      if (!matchedAlias) {
        return;
      }

      const values = extractValuesForAlias(
        normalizedKey,
        matchedAlias,
        attribute.value,
      );
      appendUniqueValues(
        normalizedAttributes[categoryDefinition.field],
        values,
      );
    });
  });

  return hasAnyAiAttributeValues(normalizedAttributes)
    ? normalizedAttributes
    : null;
};

const createPhotoAttributeIndex = async (
  metadataFolderPath: string,
): Promise<PhotoAttributeIndex> => {
  const emptyIndex: PhotoAttributeIndex = {
    byName: new Map(),
    byPath: new Map(),
  };
  const photoAttributesPath = path.join(
    metadataFolderPath,
    PHOTO_ATTRIBUTES_FILE_NAME,
  );

  if (!(await fileExists(photoAttributesPath))) {
    return emptyIndex;
  }

  try {
    const rawContent = await fs.readFile(photoAttributesPath, 'utf8');
    const parsedContent = JSON.parse(rawContent);

    if (!isRecord(parsedContent) || !Array.isArray(parsedContent.items)) {
      return emptyIndex;
    }

    parsedContent.items.forEach((rawItem) => {
      if (!isRecord(rawItem)) {
        return;
      }

      const normalizedAttributes = normalizePhotoAttributesItem(rawItem);

      if (!normalizedAttributes) {
        return;
      }

      const fileName = toTrimmedStringValue(rawItem.file_name);
      const absolutePath = toTrimmedStringValue(rawItem.absolute_path);

      if (fileName) {
        const normalizedFileName = normalizeImageNameKey(fileName);

        if (normalizedFileName) {
          emptyIndex.byName.set(normalizedFileName, normalizedAttributes);
        }
      }

      if (absolutePath) {
        const normalizedPath = normalizeImagePathKey(absolutePath);

        if (normalizedPath) {
          emptyIndex.byPath.set(normalizedPath, normalizedAttributes);
        }

        const normalizedPathBaseName = normalizeImageNameKey(absolutePath);

        if (normalizedPathBaseName) {
          emptyIndex.byName.set(normalizedPathBaseName, normalizedAttributes);
        }
      }
    });
  } catch (error) {
    log.warn('Unable to read photo attributes metadata', {
      photoAttributesPath,
      error,
    });
  }

  return emptyIndex;
};

const applyPhotoAttributes = (
  images: ListedImage[],
  attributeIndex: PhotoAttributeIndex,
): ListedImage[] => {
  if (attributeIndex.byName.size === 0 && attributeIndex.byPath.size === 0) {
    return images;
  }

  return images.map((image) => {
    const byPathMatch = attributeIndex.byPath.get(
      normalizeImagePathKey(image.path),
    );
    const byNameMatch = attributeIndex.byName.get(
      normalizeImageNameKey(image.name),
    );
    const aiAttributes = byPathMatch || byNameMatch || null;

    if (!aiAttributes) {
      return image;
    }

    return {
      ...image,
      aiAttributes,
    };
  });
};

const inferCountryFromCoordinates = (
  latitude: number,
  longitude: number,
): string | null => {
  if (
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  // Local fallback coverage for current library geographies when EXIF country is missing.
  if (
    latitude >= 24 &&
    latitude <= 49 &&
    longitude >= -126 &&
    longitude <= -66
  ) {
    return 'United States';
  }

  if (latitude >= 8 && latitude <= 24 && longitude >= 102 && longitude <= 110) {
    return 'Vietnam';
  }

  if (latitude >= 5 && latitude <= 11 && longitude >= 79 && longitude <= 82) {
    return 'Sri Lanka';
  }

  if (latitude >= 1 && latitude <= 2 && longitude >= 103 && longitude <= 104) {
    return 'Singapore';
  }

  if (latitude >= 5 && latitude <= 21 && longitude >= 97 && longitude <= 106) {
    return 'Thailand';
  }

  return null;
};

const extractImageMetadata = async (
  absolutePath: string,
): Promise<ImageMetadata> => {
  let capturedAt: string | null = null;
  let location: string | null = null;
  let country: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('mdls', [
        '-name',
        'kMDItemContentCreationDate',
        '-name',
        'kMDItemLatitude',
        '-name',
        'kMDItemLongitude',
        '-name',
        'kMDItemCountry',
        absolutePath,
      ]);
      const rawCreationDate = parseMdlsValue(
        stdout,
        'kMDItemContentCreationDate',
      );
      const rawLatitude = parseMdlsValue(stdout, 'kMDItemLatitude');
      const rawLongitude = parseMdlsValue(stdout, 'kMDItemLongitude');
      const rawCountry = parseMdlsValue(stdout, 'kMDItemCountry');

      if (rawCreationDate) {
        capturedAt = toIsoDateIfValid(rawCreationDate) || rawCreationDate;
      }

      if (rawLatitude && rawLongitude) {
        const nextLatitude = Number(rawLatitude);
        const nextLongitude = Number(rawLongitude);

        if (Number.isFinite(nextLatitude) && Number.isFinite(nextLongitude)) {
          latitude = nextLatitude;
          longitude = nextLongitude;
          location = `${nextLatitude.toFixed(6)}, ${nextLongitude.toFixed(6)}`;
        }
      }

      if (rawCountry) {
        country = rawCountry;
      }

      if (!country && latitude !== null && longitude !== null) {
        country = inferCountryFromCoordinates(latitude, longitude);
      }

      if (country) {
        location = country;
      }
    } catch {
      // no-op; use fallback values below
    }
  }

  if (!capturedAt) {
    try {
      const stats = await fs.stat(absolutePath);
      const fileDate = stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime;
      capturedAt = fileDate.toISOString();
    } catch {
      capturedAt = null;
    }
  }

  return {
    capturedAt,
    location,
    country,
    latitude,
    longitude,
  };
};

const readApiResponse = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    return await response.text();
  } catch {
    return null;
  }
};

const parseCountryFromPayload = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidateRecord = payload as Record<string, unknown>;
  const countryCandidate = candidateRecord.country;

  if (typeof countryCandidate === 'string' && countryCandidate.trim().length) {
    return countryCandidate.trim();
  }

  return null;
};

const toImageBlob = async (
  imagePath: string,
): Promise<{ blob: Blob; fileName: string } | null> => {
  const resolvedPath = path.resolve(imagePath.trim());

  if (resolvedPath.length === 0) {
    return null;
  }

  try {
    const stats = await fs.stat(resolvedPath);

    if (!stats.isFile()) {
      return null;
    }

    const extension = path.extname(resolvedPath).slice(1).toLowerCase();
    const mimeType = IMAGE_MIME_BY_EXT[extension] || 'application/octet-stream';
    const buffer = await fs.readFile(resolvedPath);
    const blob = new Blob([buffer], { type: mimeType });

    return {
      blob,
      fileName: path.basename(resolvedPath),
    };
  } catch {
    return null;
  }
};

const postImageToEndpoint = async (
  endpointPath: string,
  imagePath: string,
  includeDisplayName = false,
): Promise<{ status: number; data: unknown }> => {
  const imageData = await toImageBlob(imagePath);

  if (!imageData) {
    return {
      status: 400,
      data: { error: 'Invalid image path' },
    };
  }

  const formData = new FormData();
  formData.set('file', imageData.blob, imageData.fileName);

  if (includeDisplayName) {
    const displayName = path.parse(imageData.fileName).name;
    formData.set('display_name', displayName);
  }

  try {
    const response = await fetch(`${LOCAL_API_BASE_URL}${endpointPath}`, {
      method: 'POST',
      body: formData,
    });
    const data = await readApiResponse(response);
    return {
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      status: 0,
      data: {
        error: 'Request failed',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

const buildSplatPath = (
  albumPath: string,
  imageName: string,
  extension: (typeof SPLAT_EXTENSIONS)[number],
): string => {
  const imageBaseName = path.parse(imageName).name;
  return path.join(
    albumPath,
    SPLAT_FOLDER_NAME,
    `${imageBaseName}${extension}`,
  );
};

const resolveImageSplatPath = async (
  albumPath: string,
  imageName: string,
): Promise<string | null> => {
  const candidatePaths = SPLAT_EXTENSIONS.map((extension) =>
    buildSplatPath(albumPath, imageName, extension),
  );
  const candidateResults = await Promise.all(
    candidatePaths.map(async (candidatePath) => ({
      path: candidatePath,
      exists: await fileExists(candidatePath),
    })),
  );
  const matchedCandidate = candidateResults.find((item) => item.exists);
  return matchedCandidate ? matchedCandidate.path : null;
};

const toSplatPreview = (content: string): string | null => {
  const lines = content.split(/\r?\n/).slice(0, SPLAT_PREVIEW_LINES);
  const preview = lines.join('\n').trimEnd();
  return preview.length > 0 ? preview : null;
};

const readSplat = async (splatPath: string): Promise<ImageSplat | null> => {
  if (!(await fileExists(splatPath))) {
    return null;
  }

  try {
    const handle = await fs.open(splatPath, 'r');

    try {
      const buffer = Buffer.alloc(SPLAT_PREVIEW_BYTES);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        SPLAT_PREVIEW_BYTES,
        0,
      );
      const content = buffer.subarray(0, bytesRead).toString('utf8');
      const isBinary = /format\s+binary_/i.test(content);
      const previewText = toSplatPreview(content);

      return {
        name: path.basename(splatPath),
        path: splatPath,
        url: pathToFileURL(splatPath).toString(),
        previewText,
        isBinary,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
};

const toDataUrl = (buffer: Buffer, mimeType: string): string => {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
};

const createNativePreviewDataUrl = (absolutePath: string): string | null => {
  try {
    const decodedImage = nativeImage.createFromPath(absolutePath);

    if (decodedImage.isEmpty()) {
      return null;
    }

    const { width } = decodedImage.getSize();
    const previewImage =
      width > MAX_PREVIEW_WIDTH
        ? decodedImage.resize({ width: MAX_PREVIEW_WIDTH })
        : decodedImage;

    return previewImage.toDataURL();
  } catch {
    return null;
  }
};

const buildPreviewCachePath = async (absolutePath: string): Promise<string> => {
  const stats = await fs.stat(absolutePath);
  const cacheKey = createHash('sha1')
    .update(`${absolutePath}:${stats.size}:${stats.mtimeMs}`)
    .digest('hex');
  const cacheFolder = path.join(app.getPath('temp'), 'timefold-image-previews');

  await fs.mkdir(cacheFolder, { recursive: true });

  return path.join(cacheFolder, `${cacheKey}.jpg`);
};

const createMacHeifPreviewDataUrl = async (
  absolutePath: string,
): Promise<string | null> => {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const previewPath = await buildPreviewCachePath(absolutePath);
    const alreadyConverted = await fileExists(previewPath);

    if (!alreadyConverted) {
      await execFileAsync('sips', [
        '-s',
        'format',
        'jpeg',
        absolutePath,
        '--out',
        previewPath,
      ]);
    }

    const previewBuffer = await fs.readFile(previewPath);
    return toDataUrl(previewBuffer, 'image/jpeg');
  } catch {
    return null;
  }
};

const createFilePreviewDataUrl = async (
  absolutePath: string,
  extension: string,
): Promise<string | null> => {
  const mimeType = IMAGE_MIME_BY_EXT[extension];

  if (!mimeType) {
    return null;
  }

  try {
    const imageBuffer = await fs.readFile(absolutePath);
    return toDataUrl(imageBuffer, mimeType);
  } catch {
    return null;
  }
};

const createImagePreviewUrl = async (
  absolutePath: string,
  extension: string,
): Promise<string | null> => {
  const nativePreview = createNativePreviewDataUrl(absolutePath);

  if (nativePreview) {
    return nativePreview;
  }

  if (PREVIEW_DATA_URL_EXTENSIONS.has(extension)) {
    const macPreview = await createMacHeifPreviewDataUrl(absolutePath);

    if (macPreview) {
      return macPreview;
    }

    return null;
  }

  return createFilePreviewDataUrl(absolutePath, extension);
};

const toImageRecord = async (
  absolutePath: string,
): Promise<ListedImage | null> => {
  const extension = path.extname(absolutePath).slice(1).toLowerCase();

  if (!IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  const previewUrl = await createImagePreviewUrl(absolutePath, extension);

  if (!previewUrl) {
    return null;
  }

  const metadata = await extractImageMetadata(absolutePath);

  return {
    name: path.basename(absolutePath),
    path: absolutePath,
    url: previewUrl,
    ext: extension,
    capturedAt: metadata.capturedAt,
    location: metadata.location,
    country: metadata.country,
    latitude: metadata.latitude,
    longitude: metadata.longitude,
  };
};

const readDirectorySafely = async (folderPath: string): Promise<Dirent[]> => {
  try {
    return await fs.readdir(folderPath, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
};

const collectDirectImages = async (
  entries: Dirent[],
  folderPath: string,
): Promise<ListedImage[]> => {
  return entries
    .filter((entry) => entry.isFile())
    .reduce<Promise<ListedImage[]>>(async (currentPromise, entry) => {
      const current = await currentPromise;

      if (current.length >= MAX_IMAGE_RESULTS) {
        return current;
      }

      const imageRecord = await toImageRecord(
        path.join(folderPath, entry.name),
      );

      if (!imageRecord) {
        return current;
      }

      return [...current, imageRecord];
    }, Promise.resolve([]));
};

const collectFolderImages = async (
  folderPath: string,
  depth: number,
): Promise<ListedImage[]> => {
  const entries = await readDirectorySafely(folderPath);
  const directImages = await collectDirectImages(entries, folderPath);

  if (depth >= MAX_SCAN_DEPTH || directImages.length >= MAX_IMAGE_RESULTS) {
    return directImages.slice(0, MAX_IMAGE_RESULTS);
  }

  const subfolders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(folderPath, entry.name));

  const nestedImages = await subfolders.reduce<Promise<ListedImage[]>>(
    async (currentPromise, subfolder) => {
      const current = await currentPromise;

      if (directImages.length + current.length >= MAX_IMAGE_RESULTS) {
        return current;
      }

      const remaining =
        MAX_IMAGE_RESULTS - directImages.length - current.length;
      const fromSubfolder = await collectFolderImages(subfolder, depth + 1);

      return [...current, ...fromSubfolder.slice(0, remaining)];
    },
    Promise.resolve([]),
  );

  return [...directImages, ...nestedImages].slice(0, MAX_IMAGE_RESULTS);
};

const listFolderImages = async (rootFolder: string): Promise<ListedImage[]> => {
  const images = await collectFolderImages(rootFolder, 0);

  return images.sort((first, second) => {
    return first.path.localeCompare(second.path, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
};

const persistImageMetadata = async (
  images: ListedImage[],
  metadataFolderPath: string,
): Promise<void> => {
  const metadataFilePath = path.join(metadataFolderPath, 'images.json');
  const items: PersistedImageMetadata[] = images.map((image) => ({
    name: image.name,
    path: image.path,
    ext: image.ext,
    capturedAt: image.capturedAt ?? null,
    location: image.location ?? null,
    country: image.country ?? null,
    latitude: image.latitude ?? null,
    longitude: image.longitude ?? null,
    aiAttributes: image.aiAttributes ?? null,
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    total: items.length,
    items,
  };

  await fs.mkdir(metadataFolderPath, { recursive: true });
  await fs.writeFile(
    metadataFilePath,
    JSON.stringify(payload, null, 2),
    'utf8',
  );
};

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

ipcMain.handle('dialog:select-folder', async () => {
  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Workspace Folder',
    buttonLabel: 'Choose Folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle(
  'folder:list-images',
  async (_event, folderPath: unknown, metadataFolderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
      return [];
    }

    const resolvedPath = folderPath.trim();

    try {
      const stats = await fs.stat(resolvedPath);

      if (!stats.isDirectory()) {
        return [];
      }
    } catch {
      return [];
    }

    const images = await listFolderImages(resolvedPath);
    const resolvedMetadataFolderPath =
      typeof metadataFolderPath === 'string' &&
      metadataFolderPath.trim().length > 0
        ? metadataFolderPath.trim()
        : path.join(resolvedPath, 'metadata');
    const photoAttributeIndex = await createPhotoAttributeIndex(
      resolvedMetadataFolderPath,
    );
    const enrichedImages = applyPhotoAttributes(images, photoAttributeIndex);

    try {
      await persistImageMetadata(enrichedImages, resolvedMetadataFolderPath);
    } catch (error) {
      log.warn('Unable to save image metadata', {
        metadataFolderPath: resolvedMetadataFolderPath,
        error,
      });
    }

    return enrichedImages;
  },
);

ipcMain.handle(
  'folder:get-image-splat',
  async (_event, albumPath: unknown, imageName: unknown) => {
    if (typeof albumPath !== 'string' || typeof imageName !== 'string') {
      return null;
    }

    const resolvedAlbumPath = albumPath.trim();
    const resolvedImageName = path.basename(imageName.trim());

    if (resolvedAlbumPath.length === 0 || resolvedImageName.length === 0) {
      return null;
    }

    try {
      const stats = await fs.stat(resolvedAlbumPath);

      if (!stats.isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }

    const splatPath = await resolveImageSplatPath(
      resolvedAlbumPath,
      resolvedImageName,
    );

    if (!splatPath) {
      return null;
    }

    return readSplat(splatPath);
  },
);

ipcMain.handle('folder:get-splat-bytes', async (_event, splatPath: unknown) => {
  if (typeof splatPath !== 'string') {
    return null;
  }

  const resolvedSplatPath = path.resolve(splatPath.trim());
  const splatExtension = path.extname(resolvedSplatPath).toLowerCase();

  if (
    resolvedSplatPath.length === 0 ||
    !SPLAT_EXTENSIONS.includes(
      splatExtension as (typeof SPLAT_EXTENSIONS)[number],
    )
  ) {
    return null;
  }

  try {
    const stats = await fs.stat(resolvedSplatPath);

    if (!stats.isFile() || stats.size > MAX_SPLAT_FILE_BYTES) {
      return null;
    }

    const fileBuffer = await fs.readFile(resolvedSplatPath);
    return new Uint8Array(
      fileBuffer.buffer,
      fileBuffer.byteOffset,
      fileBuffer.byteLength,
    );
  } catch {
    return null;
  }
});

ipcMain.handle(
  'api:fetch-country-by-coordinates',
  async (_event, latitude: unknown, longitude: unknown) => {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return {
        country: null,
        raw: { error: 'Latitude and longitude must be numbers' },
      };
    }

    try {
      const response = await fetch(
        `${LOCAL_API_BASE_URL}/analyze/photo-attributes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude }),
        },
      );
      const payload = await readApiResponse(response);

      return {
        country: parseCountryFromPayload(payload),
        raw: payload,
      };
    } catch (error) {
      return {
        country: null,
        raw: {
          error: 'Request failed',
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
);

ipcMain.handle(
  'api:generate-world-from-image',
  async (_event, imagePath: unknown) => {
    if (typeof imagePath !== 'string' || imagePath.trim().length === 0) {
      return {
        status: 400,
        data: { error: 'Image path must be a non-empty string' },
      };
    }

    return postImageToEndpoint('/worldlabs/image-input', imagePath, true);
  },
);

ipcMain.handle(
  'api:find-photo-attributes',
  async (_event, imagePath: unknown) => {
    if (typeof imagePath !== 'string' || imagePath.trim().length === 0) {
      return {
        status: 400,
        data: { error: 'Image path must be a non-empty string' },
      };
    }

    return postImageToEndpoint('/analyze/photo-attributes', imagePath);
  },
);

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

// In development Electron defaults the app name to "Electron" on macOS.
app.setName('Timefold');

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(getAssetPath('icon.png'));
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
