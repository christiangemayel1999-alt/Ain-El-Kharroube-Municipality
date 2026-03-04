export const VILLAGE_CENTER = {
  lat: 33.93444,
  lng: 35.69972
};

export function sectionFromCoordinates(lat: number, lng: number) {
  const latDiff = lat - VILLAGE_CENTER.lat;
  const lngDiff = lng - VILLAGE_CENTER.lng;

  // Bearing-like angle from north, clockwise, split into 10 equal sectors.
  const bearing = (Math.atan2(lngDiff, latDiff) * 180) / Math.PI;
  const normalized = (bearing + 360) % 360;
  const sectionNumber = Math.floor(normalized / 36) + 1;
  const padded = String(sectionNumber).padStart(2, "0");

  return {
    sectionNumber,
    code: `SEC-${padded}`,
    name: `Section ${sectionNumber}`
  };
}
