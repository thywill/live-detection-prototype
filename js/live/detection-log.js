// caption is reserved for a future optional field (§6).

const log = [];

export function getLiveDetectionLog() {
  return log;
}

export function getLiveDetectionLogCount() {
  return log.length;
}

export function clearLiveDetectionLog() {
  log.length = 0;
}

function normalizeBbox(box, frameW, frameH) {
  return {
    xmin: box.xmin / frameW,
    ymin: box.ymin / frameH,
    xmax: box.xmax / frameW,
    ymax: box.ymax / frameH,
  };
}

export function logDetectionFrame({
  detections,
  frameW,
  frameH,
  inferenceMs,
  timestamp,
  gpsFix,
  backend,
  modelId,
}) {
  for (const detection of detections) {
    const bbox = {
      xmin: detection.box.xmin,
      ymin: detection.box.ymin,
      xmax: detection.box.xmax,
      ymax: detection.box.ymax,
    };

    log.push({
      timestamp,
      lat: gpsFix?.lat ?? null,
      lon: gpsFix?.lon ?? null,
      gps_accuracy: gpsFix?.accuracy ?? null,
      gps_timestamp: gpsFix?.timestamp ?? null,
      model: modelId,
      dtype: backend.dtype,
      device: backend.device,
      label: detection.label,
      confidence: detection.score,
      bbox,
      bbox_norm: normalizeBbox(bbox, frameW, frameH),
      frame_w: frameW,
      frame_h: frameH,
      inference_ms: inferenceMs,
    });
  }

  return log.length;
}
