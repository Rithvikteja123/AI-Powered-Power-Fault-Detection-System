/**
 * Haversine distance utilities
 */

const R = 6371000; // Earth radius in metres

function haversineMeters(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Midpoint between two lat/lon pairs
 */
function midpoint(lat1, lon1, lat2, lon2) {
  return {
    lat: (lat1 + lat2) / 2,
    lon: (lon1 + lon2) / 2,
  };
}

module.exports = { haversineMeters, midpoint };
