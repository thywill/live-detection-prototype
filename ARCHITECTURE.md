# Architecture

In-browser live object detection. Camera, model, and log all stay on the device.

```
camera (getUserMedia)
  → detect  (models.js loads Transformers.js; objects.js runs the pipeline and draws boxes)
  → stats   (live-detection.js updates the sidebar)
  → record  (detection-log.js: one row per object + GPS from geolocation.js)
  → export  (export-live.js → CSV / JSON via export.js)
```

Entry: `js/main.js` calls `initLiveDetectionPage()`.
