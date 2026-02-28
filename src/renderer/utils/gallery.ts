import type { ClusterLayout, ExploreLayout } from '../types/gallery';

export const MAX_RENDERED_IMAGES = 220;
export const MAX_FILTER_CHIPS = 6;
export const SETTINGS_STORAGE_KEY = 'timefold.settings';
export const LAST_ACTIVE_FOLDER_STORAGE_KEY = 'timefold.lastActiveFolder';
export const CLOUD_DRAG_ROTATION_PER_PIXEL = 0.18;
export const CLOUD_ZOOM_MIN = -520;
export const CLOUD_ZOOM_MAX = 920;
export const CLOUD_ZOOM_PER_WHEEL = 0.72;
export const EXPLORE_DRAG_ROTATION_PER_PIXEL = 0.18;
export const EXPLORE_ZOOM_MIN = -520;
export const EXPLORE_ZOOM_MAX = 920;
export const EXPLORE_ZOOM_PER_WHEEL = 0.72;

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

export const isInteractivePointerTarget = (
  target: EventTarget | null,
): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest('button, a, input, select, textarea, [role="button"]'),
  );
};

export const buildMetadataLocation = (albumLocation: string): string => {
  const normalizedPath = albumLocation.replace(/[\\/]+$/, '');
  const separator =
    normalizedPath.includes('\\') && !normalizedPath.includes('/') ? '\\' : '/';
  return `${normalizedPath}${separator}metadata`;
};

export const buildExpectedSplatName = (imageName: string): string => {
  const imageBaseName = imageName.replace(/\.[^.]+$/, '');
  return `${imageBaseName}.ply`;
};

export const formatCapturedAt = (capturedAt?: string | null): string => {
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

export const createClusterLayout = (
  seedKey: string,
  index: number,
  total: number,
): ClusterLayout => {
  const random = createRandom(createSeed(`${seedKey}:${index}:${total}`));
  const safeTotal = Math.max(total, 1);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const unitY = 1 - ((index + 0.5) / safeTotal) * 2;
  const radial = Math.sqrt(Math.max(0, 1 - unitY * unitY));
  const theta = goldenAngle * index + (random() - 0.5) * 0.22;
  const sphereRadius = 312 + (random() - 0.5) * 54;
  const depth = random();
  const orbitDuration = 13 + random() * 14;
  const sphereX =
    Math.cos(theta) * radial * sphereRadius + (random() - 0.5) * 16;
  const sphereY = unitY * sphereRadius * 1.02 + (random() - 0.5) * 22;
  const sphereZ =
    Math.sin(theta) * radial * sphereRadius + (random() - 0.5) * 16;

  return {
    sphereX,
    sphereY,
    sphereZ,
    width: 64 + random() * 90 + depth * 38,
    rotation: (random() - 0.5) * 7,
    orbitX: (random() - 0.5) * (8 + (1 - depth) * 14),
    orbitY: (random() - 0.5) * (8 + (1 - depth) * 12),
    orbitDuration,
    orbitDelay: random() * 20,
    counterDuration: orbitDuration,
    bobX: (random() - 0.5) * 10,
    bobY: (random() - 0.5) * 14,
    bobDuration: 4 + random() * 6,
    opacity: clamp(0.72 + depth * 0.28, 0.7, 1),
    blur: 0,
  };
};

export const createExploreLayout = (
  seedKey: string,
  index: number,
  total: number,
): ExploreLayout => {
  const random = createRandom(
    createSeed(`explore:${seedKey}:${index}:${total}`),
  );
  const safeTotal = Math.max(total, 1);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const unitY = 1 - ((index + 0.5) / safeTotal) * 2;
  const radial = Math.sqrt(Math.max(0, 1 - unitY * unitY));
  const theta = goldenAngle * index + (random() - 0.5) * 0.18;
  const sphereRadius = 330 + (random() - 0.5) * 70;
  const x = Math.cos(theta) * radial * sphereRadius + (random() - 0.5) * 18;
  const y = unitY * sphereRadius * 1.02 + (random() - 0.5) * 22;
  const z = Math.sin(theta) * radial * sphereRadius + (random() - 0.5) * 18;
  const depthHint = clamp((z + sphereRadius) / (sphereRadius * 2), 0, 1);

  return {
    x,
    y,
    z,
    width: 92 + random() * 132 + depthHint * 26,
    rotation: 0,
    opacity: clamp(0.62 + depthHint * 0.35, 0.5, 1),
  };
};
