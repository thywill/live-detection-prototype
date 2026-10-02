// Caches the latest device orientation (compass heading + tilt) so detections can log it without blocking inference.
// Heading is raw magnetic degrees clockwise from north; no declination is applied.
// cameraHeading corrects it for screen rotation so it is the direction the back camera faces.

// webkitCompassHeading (and 360 - alpha) follow the device's portrait top edge, not the back camera,
// so in landscape the raw value is off by the screen rotation. camera = raw + SIGN * screenAngle.
// Confirm against the field data (iPad, true ≈ 333°): landscape upright read 240 and flipped read 60,
// so with whichever angle (90 / 270) each orientation reports, the result must land near 333.
// Flip to -1 if the corrected value moves the wrong way.
const SCREEN_ANGLE_SIGN = 1;

// iOS only delivers orientation events after requestPermission() runs inside a user gesture,
// so call this synchronously from the click handler, before any await.
export function requestCompassPermission() {
  const OrientationEvent = window.DeviceOrientationEvent;
  if (!OrientationEvent) {
    return Promise.resolve("unavailable");
  }
  if (typeof OrientationEvent.requestPermission !== "function") {
    return Promise.resolve("granted");
  }
  return OrientationEvent.requestPermission().catch(() => "denied");
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function readScreenAngle() {
  return finiteOrNull(screen.orientation?.angle ?? window.orientation);
}

// window.orientation reports -90 where screen.orientation reports 270; normalizing handles both.
function toCameraHeading(heading, screenAngle) {
  if (heading == null || screenAngle == null) {
    return null;
  }
  return normalizeDegrees(
    heading + SCREEN_ANGLE_SIGN * normalizeDegrees(screenAngle),
  );
}

export function createCompassTracker(onReading) {
  let cachedReading = null;
  // Plain "deviceorientation" alpha is relative on Android, so prefer the absolute event where it exists.
  const eventName =
    "ondeviceorientationabsolute" in window
      ? "deviceorientationabsolute"
      : "deviceorientation";

  function handleOrientation(event) {
    let heading = null;
    let accuracy = null;
    if (Number.isFinite(event.webkitCompassHeading)) {
      heading = normalizeDegrees(event.webkitCompassHeading);
      // iOS reports a negative accuracy when the compass is uncalibrated.
      accuracy =
        event.webkitCompassAccuracy >= 0 ? event.webkitCompassAccuracy : null;
    } else if (
      (eventName === "deviceorientationabsolute" || event.absolute) &&
      Number.isFinite(event.alpha)
    ) {
      heading = normalizeDegrees(360 - event.alpha);
    }

    const screenAngle = readScreenAngle();
    cachedReading = {
      heading,
      cameraHeading: toCameraHeading(heading, screenAngle),
      accuracy,
      beta: finiteOrNull(event.beta),
      gamma: finiteOrNull(event.gamma),
      screenAngle,
    };
    onReading?.(cachedReading);
  }

  return {
    start() {
      window.addEventListener(eventName, handleOrientation);
    },
    stop() {
      window.removeEventListener(eventName, handleOrientation);
    },
    getReading() {
      return cachedReading;
    },
  };
}
