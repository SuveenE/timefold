# Timefold

[![GitHub stars](https://img.shields.io/github/stars/SuveenE/timefold?style=social)](https://github.com/SuveenE/timefold/stargazers)
![License](https://img.shields.io/github/license/SuveenE/timefold)
[![Twitter Follow](https://img.shields.io/twitter/follow/SuveenE?style=social)](https://x.com/SuveenE)

<img src="assets/icon.png" alt="Timefold logo" width="120" />

A local-first desktop photo explorer that lets you browse personal image libraries in an immersive 3D interface. Load images from your own folders, navigate memories as spatial clusters, explore by time or location, and step into AI-generated 3D worlds powered by World Labs.

> **Note:** Timefold is not officially distributed yet. To try it, clone the repo and run locally.

## Features

- **3D Image Cloud** — Your local album rendered as a floating spatial collage you can orbit, zoom, and click through.
- **Explore Modes** — Switch between free exploration, location-based grouping, and time-based grouping.
- **Gaussian Splat Previews** — Interactive `.ply` and `.spz` splat renders matched to individual images.
- **AI-Generated 3D Worlds** — Turn any photo into a navigable 3D world using the [World Labs Marble API](https://marble.worldlabs.ai/) (`https://api.worldlabs.ai/marble/v1`). The API returns `.spz` Gaussian splat files that Timefold renders inline, and you can also explore the world directly on [Marble](https://marble.worldlabs.ai/).

## Image Cloud

![Timefold image cloud feature](assets/home.png)

## Gaussian Splats

Timefold supports per-image 3D Gaussian splat previews in the image details modal.

- For each image, the app looks for a matching splat file in `splats/` inside the selected album folder.
- File matching uses the image base name — e.g. `IMG_0123.JPG` maps to `splats/IMG_0123.ply`.
- When a match is found, Timefold renders an interactive 3D preview with file and header metadata.
- If no match exists, the modal shows a clear "No matching file found" message.

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

- **Electron** — Cross-platform desktop runtime
- **React 19** — UI rendering
- **TypeScript** — Type-safe application code
- **Three.js** — 3D rendering and Gaussian splat visualization
- **Webpack** — Development and production bundling
- **Jest + ESLint** — Tests and static analysis

## Prerequisites

- Node.js 18+
- npm 9+

## Run Locally

```bash
npm install
npm start
```

This starts the Webpack dev servers and opens the Electron window.

## Quality Checks

```bash
npm run lint
npm test -- --runInBand
```

## Build for Production

```bash
npm run build
```

## License

[MIT](LICENSE)
