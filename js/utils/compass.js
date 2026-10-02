// Caches the latest device orientation (compass heading + tilt) so detections can log it without blocking inference.
// Heading is raw magnetic degrees clockwise from north; no declination is applied.

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

    cachedReading = {
      heading,
      accuracy,
      beta: finiteOrNull(event.beta),
      gamma: finiteOrNull(event.gamma),
      screenAngle: readScreenAngle(),
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
