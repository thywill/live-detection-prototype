# Live Detection Tool

Real-time object detection and image classification on a live camera feed, running entirely in the browser, with GPS tagging on each result. Part of ongoing AR research into machine vision and geographic bias.

> **Work in progress.**

## What it does

- Runs machine-vision models on a live camera feed — on-device, no server
- Detection (YOLOS, DETR): boxes around each object
- Classification (MobileNet): labels the whole frame
- Captures GPS with each detection and exports the data as CSV / JSON

## Tech

Vanilla JS + Transformers.js, WebGPU with WASM fallback. Runs on desktop and iPad.

## Run locally

```bash
npm start
```

Camera and GPS need localhost or https.
