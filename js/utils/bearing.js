// Compass bearing of a detected object from its horizontal position in the frame (pinhole camera model).
// Bearings are magnetic, like the heading they are built on; no declination is applied.

// Long-side field of view from photo EXIF: M1 iPad Pro 12.9" (5th gen) wide camera, 29 mm equivalent, 4:3.
// The browser video stream may be cropped relative to the photo sensor, so this needs field verification.
const CAMERA_LONG_SIDE_FOV_DEG = 61.7;

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

// The long side of the frame always spans the long-side FOV, so portrait and non-4:3 streams scale from it.
function fovForSide(side, frameW, frameH) {
  const longSide = Math.max(frameW, frameH);
  if (side >= longSide) {
    return CAMERA_LONG_SIDE_FOV_DEG;
  }
  const halfLong = toRadians(CAMERA_LONG_SIDE_FOV_DEG) / 2;
  return toDegrees(2 * Math.atan(Math.tan(halfLong) * (side / longSide)));
}

export function horizontalFovDeg(frameW, frameH) {
  return fovForSide(frameW, frameW, frameH);
}

export function verticalFovDeg(frameW, frameH) {
  return fovForSide(frameH, frameW, frameH);
}

export function objectBearing(box, frameW, frameH, cameraHeading) {
  if (!box || cameraHeading == null || !frameW || !frameH) {
    return null;
  }
  const x = (box.xmin + box.xmax) / 2 / frameW;
  const halfFov = toRadians(horizontalFovDeg(frameW, frameH)) / 2;
  const offset = toDegrees(Math.atan((x - 0.5) * 2 * Math.tan(halfFov)));
  return (((cameraHeading + offset) % 360) + 360) % 360;
}
