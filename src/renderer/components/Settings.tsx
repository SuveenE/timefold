import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SettingsProps, SettingsValues } from '../types/gallery';

export default function Settings({
  settings,
  onSettingsChange,
}: SettingsProps) {
  const navigate = useNavigate();

  const setField =
    (field: keyof SettingsValues) => (event: ChangeEvent<HTMLInputElement>) => {
      onSettingsChange({
        ...settings,
        [field]: event.target.value,
      });
    };

  return (
    <main className="gallery-screen settings-screen">
      <div className="nebula" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <section className="settings-body">
        <form
          className="settings-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="ghost-button settings-back"
            onClick={() => navigate('/')}
          >
            back
          </button>

          <label className="settings-field" htmlFor="photo-album-location">
            Photo album location
            <input
              id="photo-album-location"
              type="text"
              value={settings.photoAlbumLocation}
              onChange={setField('photoAlbumLocation')}
              placeholder="/Users/you/Pictures/Album"
              autoComplete="off"
            />
          </label>

          <label className="settings-field" htmlFor="metadata-location">
            Metadata location
            <input
              id="metadata-location"
              type="text"
              value={settings.metadataLocation}
              onChange={setField('metadataLocation')}
              placeholder="/Users/you/Documents/photo-metadata.json"
              autoComplete="off"
            />
          </label>

          <label className="settings-field" htmlFor="your-name">
            Your name
            <input
              id="your-name"
              type="text"
              value={settings.yourName}
              onChange={setField('yourName')}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>
        </form>
      </section>
    </main>
  );
}
