// Caches the latest GPS fix on an interval so detections can log location without blocking inference.
// Lower GPS_REFRESH_MS for denser spatial data; costs battery.
export const GPS_REFRESH_MS = 3000;

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 2000,
};

export function createGpsTracker(onFix) {
  let cachedFix = null;
  let intervalId = null;

  function applyPosition(position) {
    cachedFix = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };
    onFix?.(cachedFix);
  }

  function refresh() {
    if (!navigator.geolocation) {
      return;
    }
    navigator.geolocation.getCurrentPosition(applyPosition, () => {}, GEO_OPTIONS);
  }

  return {
    start() {
      refresh();
      intervalId = window.setInterval(refresh, GPS_REFRESH_MS);
    },
    stop() {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    },
    getFix() {
      return cachedFix;
    },
  };
}
