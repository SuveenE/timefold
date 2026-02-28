import { useEffect, useState } from 'react';
import type { ImageCardModalProps } from '../types/gallery';
import { buildExpectedSplatName, formatCapturedAt } from '../utils/gallery';
import SplatViewer from './SplatViewer';

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
          <h2 className="image-card-title">{image.name}</h2>

          <dl className="image-card-meta">
            <div>
              <dt>Date</dt>
              <dd>{formatCapturedAt(image.capturedAt)}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{image.country?.trim() || 'Unknown country'}</dd>
            </div>
          </dl>

          <div className="image-card-splat">
            <h3>Gaussian splat</h3>

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
                <p className="image-card-splat-note">{splat.name}</p>
                <p className="image-card-splat-path">{splat.path}</p>
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
      </article>
    </div>
  );
}
