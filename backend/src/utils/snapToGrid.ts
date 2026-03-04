export function snapToGrid(lat: number, lng: number, gridMeters = 500) {
  const latRadians = (lat * Math.PI) / 180;
  const latMeters = lat * 111320;
  const lngMeters = lng * (111320 * Math.cos(latRadians));

  const latMetersSnapped = Math.round(latMeters / gridMeters) * gridMeters;
  const lngMetersSnapped = Math.round(lngMeters / gridMeters) * gridMeters;

  const latSnapped = latMetersSnapped / 111320;
  const lngSnapped = lngMetersSnapped / (111320 * Math.cos(latRadians));

  return {
    approxLat: Number(latSnapped.toFixed(6)),
    approxLng: Number(lngSnapped.toFixed(6)),
    pinPrecisionM: gridMeters
  };
}

