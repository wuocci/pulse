import { createContext, useContext } from "react";

// What differs between the browser and the wrapped native app (ADR 0011). The web versions live here;
// Capacitor's (Geolocation, Preferences) replace them at the wrap. Nothing else touches the device directly.

export interface LatLon {
  lat: number;
  lon: number;
}

// Why the device gave no location: the person refused, or it couldn't get a fix.
export type LocationFailure = "denied" | "unavailable";

export class LocationError extends Error {
  readonly reason: LocationFailure;

  constructor(reason: LocationFailure) {
    super(`Location ${reason}`);
    this.reason = reason;
  }
}

export interface DeviceLocation {
  // Rejects with a LocationError.
  current(): Promise<LatLon>;
  // Calls back on every new fix until the returned function is called.
  watch(onFix: (point: LatLon) => void, onError: (error: LocationError) => void): () => void;
}

// Small values kept on the device. Async, because Capacitor's Preferences is.
export interface DeviceStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface Platform {
  location: DeviceLocation;
  storage: DeviceStorage;
}

const toLatLon = ({ coords }: GeolocationPosition): LatLon => ({ lat: coords.latitude, lon: coords.longitude });
const toError = (error: GeolocationPositionError) =>
  new LocationError(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");

export const webPlatform: Platform = {
  location: {
    current: () =>
      new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) return reject(new LocationError("unavailable"));
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(toLatLon(position)),
          (error) => reject(toError(error)),
          { enableHighAccuracy: true, timeout: 15_000 },
        );
      }),
    watch(onFix, onError) {
      if (!("geolocation" in navigator)) {
        onError(new LocationError("unavailable"));
        return () => {};
      }
      const id = navigator.geolocation.watchPosition(
        (position) => onFix(toLatLon(position)),
        (error) => onError(toError(error)),
        { enableHighAccuracy: true },
      );
      return () => navigator.geolocation.clearWatch(id);
    },
  },
  // Storage can be unavailable (private mode, blocked site data): then nothing is remembered.
  storage: {
    async get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Not remembered; the URL still holds the point.
      }
    },
  },
};

const PlatformContext = createContext<Platform>(webPlatform);

export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): Platform {
  return useContext(PlatformContext);
}
