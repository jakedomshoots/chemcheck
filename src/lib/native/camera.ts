/**
 * Native camera bridge for Capacitor
 * Uses @capacitor/camera when running on iOS, falls back to web APIs otherwise.
 *
 * This module provides a unified `takeNativePhoto()` function that returns
 * a data URL string — the same format used by the existing web camera flow.
 */

import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';
import { isNativePlatform, isPluginAvailable } from './platform';

export interface NativePhotoResult {
    dataUrl: string;
    format: 'jpeg' | 'png';
}

/**
 * Whether the native camera is available on the current platform
 */
export function isNativeCameraAvailable(): boolean {
    return isNativePlatform() && isPluginAvailable('Camera');
}

/**
 * Take a photo using the native device camera
 * Only call this when `isNativeCameraAvailable()` returns true.
 *
 * @param direction - 'environment' (back) or 'user' (front)
 * @returns A data URL of the captured photo
 */
export async function takeNativePhoto(
    direction: 'environment' | 'user' = 'environment'
): Promise<NativePhotoResult> {
    const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        direction: direction === 'user' ? CameraDirection.Front : CameraDirection.Rear,
        correctOrientation: true,
        width: 1920,
        height: 1080,
        saveToGallery: false,
    });

    if (!photo.dataUrl) {
        throw new Error('Camera did not return a photo');
    }

    return {
        dataUrl: photo.dataUrl,
        format: photo.format === 'png' ? 'png' : 'jpeg',
    };
}

/**
 * Pick a photo from the device gallery
 * Only call this when `isNativeCameraAvailable()` returns true.
 *
 * @returns A data URL of the selected photo
 */
export async function pickNativePhoto(): Promise<NativePhotoResult> {
    const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        correctOrientation: true,
        width: 1920,
        height: 1080,
    });

    if (!photo.dataUrl) {
        throw new Error('No photo was selected');
    }

    return {
        dataUrl: photo.dataUrl,
        format: photo.format === 'png' ? 'png' : 'jpeg',
    };
}

/**
 * Whether the native gallery multi-select is available. `pickImages` has
 * shipped since @capacitor/camera 1.2, but we feature-detect so an older
 * shell degrades to single picks instead of throwing.
 */
export function isNativeMultiPickAvailable(): boolean {
    return isNativeCameraAvailable() && typeof (Camera as { pickImages?: unknown }).pickImages === 'function';
}

/**
 * Pick several photos from the device gallery in one sheet (the native
 * stand-in for a web burst: sequential `getPhoto` calls are far too slow).
 * Returns data URLs ready for the same compression pipeline as a capture.
 *
 * @param limit - Maximum number of photos to accept (extra picks are dropped)
 */
export async function pickNativePhotos(limit: number = 5): Promise<NativePhotoResult[]> {
    const result = await Camera.pickImages({
        quality: 85,
        correctOrientation: true,
        width: 1920,
        height: 1920,
        limit,
    });

    const picked = (result?.photos ?? []).slice(0, Math.max(1, limit));
    const results: NativePhotoResult[] = [];

    for (const photo of picked) {
        const dataUrl = await galleryPhotoToDataUrl(photo);
        if (!dataUrl) continue;
        results.push({ dataUrl, format: photo.format === 'png' ? 'png' : 'jpeg' });
    }

    return results;
}

/**
 * `pickImages` hands back a webPath (blob:/capacitor:// URL), not a data URL.
 * Fetch it into a data URL so it can flow through `compressImage`.
 */
async function galleryPhotoToDataUrl(photo: { webPath: string; path?: string }): Promise<string | null> {
    const source = photo.webPath || photo.path;
    if (!source) return null;
    if (source.startsWith('data:')) return source;

    try {
        const response = await fetch(source);
        const blob = await response.blob();
        return await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}
