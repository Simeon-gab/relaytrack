/**
 * Google Maps JS API loader. Single provider for tiles/geocoding/ETA
 * (SPEC section 2) — do not add other map SDKs beside this.
 *
 * One script tag per page load, shared promise so every map component on the
 * page awaits the same load. Client-side only.
 */

declare global {
  interface Window {
    __relaytrackMapsReady?: () => void;
  }
}

let mapsPromise: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser"));
  }
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise<typeof google.maps>((resolve, reject) => {
    window.__relaytrackMapsReady = () => resolve(window.google.maps);
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      loading: "async",
      callback: "__relaytrackMapsReady",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}
