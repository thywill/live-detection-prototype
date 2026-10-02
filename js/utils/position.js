// Estimates where a detected object is: distance from its apparent height, then a point projected from the viewer's GPS fix.
import { verticalFovDeg } from "./bearing.js";

// Typical real-world heights (m) used as size priors. Labels not listed get no distance.
const OBJECT_HEIGHTS_M = new Map([
  ["person", 1.7],
  ["car", 1.5],
  ["bicycle", 1.0],
  ["motorcycle", 1.1],
  ["bench", 0.9],
  ["chair", 0.9],
  ["dog", 0.6],
  ["potted plant", 0.6],
  ["fire hydrant", 0.8],
  ["stop sign", 0.75],
  ["bottle", 0.25],
  ["cup", 0.1],
]);
const MIN_DISTANCE_M = 1;
const MAX_DISTANCE_M = 60;
// A box within this fraction of the frame height from the top or bottom edge is treated as cut off.
const EDGE_MARGIN = 0.01;
// Columbus, OH (approx.); verify with the NOAA calculator. West is negative: true = magnetic + declination.
const MAGNETIC_DECLINATION_DEG = -7;
const MAX_HEADING_ACCURACY_DEG = 30;
const METERS_PER_DEGREE_LAT = 111320;

export const DISTANCE_METHOD = "size_prior";

const toRadians = (degrees) => (degrees * Math.PI) / 180;

export function estimateDistance(label, box, frameW, frameH) {
  const realHeight = OBJECT_HEIGHTS_M.get(String(label ?? "").toLowerCase());
  if (!realHeight || !box || !frameW || !frameH) {
    return null;
  }
  const top = box.ymin / frameH;
  const bottom = box.ymax / frameH;
  if (top <= EDGE_MARGIN || bottom >= 1 - EDGE_MARGIN) {
    return null;
  }
  const boxHeight = bottom - top;
  if (!(boxHeight > 0)) {
    return null;
  }
  const halfFov = toRadians(verticalFovDeg(frameW, frameH)) / 2;
  const distance = realHeight / (2 * Math.tan(halfFov) * boxHeight);
  return Math.min(MAX_DISTANCE_M, Math.max(MIN_DISTANCE_M, distance));
}

// On iOS a missing accuracy means the compass is uncalibrated, so it fails; platforms that never report accuracy pass.
function passesHeadingGate(orientation) {
  const accuracy = orientation?.accuracy;
  if (accuracy == null) {
    return !orientation?.accuracySupported;
  }
  return accuracy <= MAX_HEADING_ACCURACY_DEG;
}

export function projectPosition(gpsFix, bearing, distance, orientation) {
  if (
    gpsFix?.lat == null ||
    gpsFix?.lon == null ||
    bearing == null ||
    distance == null ||
    !passesHeadingGate(orientation)
  ) {
    return null;
  }
  const trueBearing = toRadians(
    (((bearing + MAGNETIC_DECLINATION_DEG) % 360) + 360) % 360,
  );
  return {
    lat: gpsFix.lat + (distance * Math.cos(trueBearing)) / METERS_PER_DEGREE_LAT,
    lon:
      gpsFix.lon +
      (distance * Math.sin(trueBearing)) /
        (METERS_PER_DEGREE_LAT * Math.cos(toRadians(gpsFix.lat))),
  };
}
