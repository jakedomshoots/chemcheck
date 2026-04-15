/**
 * Native geolocation bridge for Capacitor
 * Uses @capacitor/geolocation when running on iOS, falls back to web APIs otherwise.
 */

import { Geolocation } from '@capacitor/geolocation';
import { isNativePlatform, isPluginAvailable } from './platform';

export interface LocationResult {
    latitude: number;
    longitude: number;
    accuracy: number;
}

/**
 * Whether native geolocation is available
 */
export function isNativeGeolocationAvailable(): boolean {
    return isNativePlatform() && isPluginAvailable('Geolocation');
}

/**
 * Get the current position using native GPS when available, web API otherwise.
 * Returns a unified LocationResult regardless of platform.
 */
export async function getCurrentLocation(): Promise<LocationResult> {
    if (isNativeGeolocationAvailable()) {
        const position = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 10000,
        });

        return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
        };
    }

    // Fallback to web Geolocation API
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                });
            },
            (error) => {
                reject(new Error(`Geolocation error: ${error.message}`));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
            }
        );
    });
}
