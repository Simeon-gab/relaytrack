/**
 * Dark map styling for /dispatch — control-room feel (SPEC section 4).
 * Tuned to the near-black base token #0A0A0B; roads readable, POI noise off.
 */
export const DISPATCH_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#141416" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8b8b90" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0a0b" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2a2a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#232327" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#33333a" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#6f6f75" }] },
  { featureType: "water", stylers: [{ color: "#0e1a24" }] },
  { featureType: "landscape", stylers: [{ color: "#111113" }] },
];
