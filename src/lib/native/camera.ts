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
