# Timefold - Private, local-first 3D photo explorer

<img src="assets/icon.png" alt="Timefold logo" width="120" />

Timefold is a local-first desktop photo explorer for browsing personal image libraries in an immersive 3D interface. It lets you load images from your own folders, navigate memories in spatial clusters, explore by time or location, inspect rich image attributes, and preview matching Gaussian splat reconstructions when available.

## Features

- **Image Cloud Feature**: Loads your local album into a floating 3D collage you can scan and open quickly.
- **Explore Modes**: Switch between free exploration, location-based grouping, and time-based grouping.
- **Rich Image Attributes**: Surfaces detailed per-image metadata and AI-derived attributes such as scene, mood, weather, and detected objects.
- **Private and Local by Default**: Reads directly from local folders so your photo library stays on your machine without mandatory cloud upload.
- **Gaussian Splats Feature**: Opens interactive `.ply` previews matched to selected images.

## Image Cloud Feature

The image cloud experience is shown below:

![Timefold image cloud feature](assets/home.png)

## Gaussian Splats Feature

Timefold supports per-image 3D Gaussian splat previews in the image details modal.

- For each image, the app looks for a matching `.ply` file in `splats/` inside the selected album folder.
- File matching uses the image base name. Example: `IMG_0123.JPG` maps to `splats/IMG_0123.ply`.
- When a match is found, Timefold renders an interactive 3D preview and shows a short file/header preview.
- If no matching `.ply` exists, the modal shows a clear "No matching file found" message.

### Example Album Structure

```text
MyAlbum/
  IMG_0123.JPG
  IMG_0456.JPG
  splats/
    IMG_0123.ply
    IMG_0456.ply
```

## Tech Stack

- Electron for cross-platform desktop runtime
- React 19 for UI rendering
- TypeScript for type-safe application code
- Webpack for development and production bundling
- Jest + ESLint for tests and static analysis

## Prerequisites

- Node.js 18+
- npm 9+

## Run Locally

Install dependencies and start the app in development mode:

```bash
npm install
npm start
```

This starts the webpack development servers and opens the Electron window.

## Quality Checks

Run linting and tests:

```bash
npm run lint
npm test -- --runInBand
```

## Build Production Bundles

Create optimized production artifacts:

```bash
npm run build
```
