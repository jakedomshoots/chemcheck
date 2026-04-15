/**
 * Platform detection and native bridge utilities for Capacitor
 * Provides a unified API that works on both web and native iOS.
 */

import { Capacitor } from '@capacitor/core';

/**
 * Check if the app is running inside a native Capacitor shell (iOS/Android)
 */
export function isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
}

/**
 * Get the current platform: 'ios', 'android', or 'web'
 */
export function getPlatform(): 'ios' | 'android' | 'web' {
    return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
}

/**
 * Check if a specific Capacitor plugin is available on the current platform
 */
export function isPluginAvailable(pluginName: string): boolean {
    return Capacitor.isPluginAvailable(pluginName);
}
