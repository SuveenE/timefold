# Timefold

Timefold is a desktop application built with Electron, React, and TypeScript. It provides a modern local development setup with fast reloads for renderer updates, Electron main/preload bundling, and production packaging support.

## Home Screen

The current home screen UI is shown below:

![Timefold home screen](assets/home.png)

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
