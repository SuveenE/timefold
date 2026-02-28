import { useEffect, useState } from 'react';
import type { ImageAiAttributes, ImageCardModalProps } from '../types/gallery';
import { buildExpectedSplatName, formatCapturedAt } from '../utils/gallery';
import SplatViewer from './SplatViewer';

type MetadataRow = {
  key: string;
  label: string;
  value: string;
};

const AI_ATTRIBUTE_FIELDS: {
  key: keyof ImageAiAttributes;
  label: string;
}[] = [
  { key: 'detectedObjects', label: 'Detected objects' },
  { key: 'primarySubject', label: 'Primary subject' },
  { key: 'sceneLocation', label: 'Scene location' },
  { key: 'timeOfDay', label: 'Time of day' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'sky', label: 'Sky' },
  { key: 'weather', label: 'Weather' },
  { key: 'season', label: 'Season' },
  { key: 'environmentLandscape', label: 'Environment / landscape' },
  { key: 'activity', label: 'Activity' },
  { key: 'peopleCount', label: 'People count' },
  { key: 'socialContext', label: 'Social context' },
  { key: 'moodVibe', label: 'Mood / vibe' },
  { key: 'aestheticStyleColor', label: 'Aesthetic / style / color' },
  { key: 'ocrText', label: 'OCR text' },
];

const formatAttributeValues = (values: string[]): string | null => {
  const cleanedValues = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (cleanedValues.length === 0) {
    return null;
  }

  return cleanedValues.join(', ');
};

export default function ImageCardModal({
  image,
  splat,
  isSplatLoading,
  splatLookupError,
  onClose,
}: ImageCardModalProps) {
  const [isImageLoading, setIsImageLoading] = useState(true);

  useEffect(() => {
    if (!image) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [image, onClose]);

  useEffect(() => {
    if (!image) {
      return;
    }

    setIsImageLoading(true);
  }, [image]);

  if (!image) {
    return null;
  }

  const expectedSplatName = buildExpectedSplatName(image.name);
  const isPlySplat = Boolean(splat && /\.ply$/i.test(splat.name));
  const baseRows: MetadataRow[] = [
    {
      key: 'file-name',
      label: 'File name',
      value: image.name,
    },
    {
      key: 'local-date',
      label: 'Local date',
      value: formatCapturedAt(image.capturedAt),
    },
    {
      key: 'country',
      label: 'Country',
      value: image.country?.trim() || 'Unknown country',
    },
  ];
  const { aiAttributes } = image;
  const aiRows: MetadataRow[] = aiAttributes
    ? AI_ATTRIBUTE_FIELDS.reduce<MetadataRow[]>((currentRows, field) => {
        const fieldValues = aiAttributes[field.key] ?? [];
        const formattedFieldValues = formatAttributeValues(fieldValues);

        if (!formattedFieldValues) {
          return currentRows;
        }

        return [
          ...currentRows,
          {
            key: `ai-${field.key}`,
            label: field.label,
            value: formattedFieldValues,
          },
        ];
      }, [])
    : [];
  const metadataRows = [...baseRows, ...aiRows];

  return (
    <div className="image-card-overlay">
      <button
        type="button"
        className="image-card-backdrop"
        aria-label="Close image details"
        onClick={onClose}
      />
      <article
        className="image-card"
        role="dialog"
        aria-modal="true"
        aria-label="Image details"
      >
        <button
          type="button"
          className="image-card-close"
          aria-label="Close image card"
          onClick={onClose}
        >
          close
        </button>

        <section className="image-card-details">
          <div className="image-card-splat">
            <h3>Explore world</h3>

            {isSplatLoading ? (
              <p className="image-card-splat-note">
                Checking for matching file...
              </p>
            ) : null}

            {!isSplatLoading && splatLookupError ? (
              <p className="image-card-splat-note">{splatLookupError}</p>
            ) : null}

            {!isSplatLoading && !splatLookupError && splat ? (
              <>
                <SplatViewer splat={splat} />
                {isPlySplat && splat.previewText ? (
                  <pre className="image-card-splat-preview">
                    {splat.previewText}
                  </pre>
                ) : null}
                {isPlySplat && !splat.previewText ? (
                  <p className="image-card-splat-note">
                    No preview text available for this `.ply` file.
                  </p>
                ) : null}
                {!isPlySplat ? (
                  <p className="image-card-splat-note">
                    Preview text is unavailable for `.spz` splats.
                  </p>
                ) : null}
                {isPlySplat && splat.isBinary ? (
                  <p className="image-card-splat-note">
                    Binary `.ply` detected. Showing header preview.
                  </p>
                ) : null}
              </>
            ) : null}

            {!isSplatLoading && !splatLookupError && !splat ? (
              <p className="image-card-splat-note">
                No matching file found at `splats/{expectedSplatName}`.
              </p>
            ) : null}
          </div>
        </section>

        <aside className="image-card-side">
          <div
            className={`image-card-media ${
              isImageLoading ? 'is-loading' : 'is-loaded'
            }`}
          >
            {isImageLoading ? (
              <span className="media-loading-indicator" aria-hidden="true">
                Loading...
              </span>
            ) : null}
            <img
              src={image.url}
              alt={image.name}
              onLoad={() => setIsImageLoading(false)}
              onError={() => setIsImageLoading(false)}
            />
          </div>

          <dl className="image-card-side-meta">
            {metadataRows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </article>
    </div>
  );
}
