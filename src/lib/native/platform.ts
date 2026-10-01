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

// ============================================
// Today's Route Glance — native widget hook
// ============================================

/**
 * The data a home-screen widget or Live Activity needs to mirror the
 * in-app "Today's Route" glance card (src/components/route/TodayGlance.jsx).
 * Plain JSON: it crosses the Capacitor bridge and lands in an App Group
 * UserDefaults suite, so no Dates, Maps or functions.
 */
export interface TodayGlancePayload {
    /** Schema version so the Swift side can ignore payloads it does not understand. */
    version: 1;
    /** ISO 8601 */
    generatedAt: string;
    /** Local calendar date, YYYY-MM-DD */
    date: string;
    totalStops: number;
    completedStops: number;
    skippedStops: number;
    remainingStops: number;
    /** 0-100 */
    progressPercent: number;
    nextStop: {
        customerId: string;
        name: string;
        address: string;
        /** Universal link understood by Apple/Google Maps; empty when no address. */
        mapsUrl: string;
    } | null;
    /** ISO 8601, null when nothing is pending */
    estimatedFinishAt: string | null;
    /** Deep link the widget opens on tap. */
    deepLink: string;
}

export interface TodayGlanceInput {
    date: string;
    totalStops: number;
    completedStops: number;
    skippedStops: number;
    nextStop?: { customerId: string | number; name: string; address?: string | null; mapsUrl?: string } | null;
    estimatedFinishAt?: Date | string | null;
    now?: Date;
}

/**
 * Build the glance payload from in-app route state.
 * Pure and platform-agnostic so Home can compute it on every render and
 * tests can assert on it without a native shell.
 */
export function buildTodayGlancePayload(input: TodayGlanceInput): TodayGlancePayload {
    const total = Math.max(0, Math.round(input.totalStops || 0));
    const completed = Math.min(total, Math.max(0, Math.round(input.completedStops || 0)));
    const skipped = Math.min(total - completed, Math.max(0, Math.round(input.skippedStops || 0)));
    const remaining = Math.max(0, total - completed - skipped);
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const now = input.now ?? new Date();

    let estimatedFinishAt: string | null = null;
    if (input.estimatedFinishAt) {
        const finish = input.estimatedFinishAt instanceof Date ? input.estimatedFinishAt : new Date(input.estimatedFinishAt);
        estimatedFinishAt = Number.isFinite(finish.getTime()) ? finish.toISOString() : null;
    }

    const nextStop = input.nextStop
        ? {
              customerId: String(input.nextStop.customerId),
              name: input.nextStop.name || 'Next stop',
              address: (input.nextStop.address || '').trim(),
              mapsUrl: input.nextStop.mapsUrl || '',
          }
        : null;

    return {
        version: 1,
        generatedAt: now.toISOString(),
        date: input.date,
        totalStops: total,
        completedStops: completed,
        skippedStops: skipped,
        remainingStops: remaining,
        progressPercent,
        nextStop,
        estimatedFinishAt,
        deepLink: nextStop ? `chemcheck://route/today?next=${encodeURIComponent(nextStop.customerId)}` : 'chemcheck://route/today',
    };
}

/** Name of the (future) native plugin that mirrors the glance into a widget. */
export const TODAY_GLANCE_PLUGIN = 'TodayGlanceWidget';

/**
 * Hand the glance payload to the native widget bridge when one is registered.
 *
 * Today this is a documented no-op outside a shell that ships the
 * `TodayGlanceWidget` plugin (see the Swift plan below and
 * `plugins.TodayGlanceWidget` in capacitor.config.json). It resolves `false`
 * when nothing consumed the payload, so callers can keep the web card as the
 * only surface without branching.
 */
export async function publishTodayGlance(payload: TodayGlancePayload): Promise<boolean> {
    try {
        if (!isNativePlatform() || !isPluginAvailable(TODAY_GLANCE_PLUGIN)) return false;
        const { registerPlugin } = await import('@capacitor/core');
        const plugin = registerPlugin<{ update(options: { payload: TodayGlancePayload }): Promise<void> }>(TODAY_GLANCE_PLUGIN);
        await plugin.update({ payload });
        return true;
    } catch {
        // The widget is a mirror of the app, never a dependency of it.
        return false;
    }
}

/*
 * ============================================================================
 * Swift widget plan (not implemented here; no Swift files are added)
 * ============================================================================
 *
 * Goal: a WidgetKit home-screen widget and a Live Activity that mirror the
 * TodayGlance card: stops done / remaining, next stop + "Open in Maps",
 * estimated finish time, progress bar.
 *
 * 1. App Group
 *    - Add capability `group.com.chemcheck.app` to both the App target and
 *      the widget extension target (ios/App/App.xcodeproj).
 *    - Mirror `plugins.TodayGlanceWidget.appGroup` in capacitor.config.json.
 *
 * 2. Capacitor plugin `TodayGlanceWidget` (ios/App/App/TodayGlanceWidgetPlugin.swift)
 *    - `@objc(TodayGlanceWidgetPlugin) public class TodayGlanceWidgetPlugin: CAPPlugin, CAPBridgedPlugin`
 *      with `jsName = "TodayGlanceWidget"` and one method `update`.
 *    - `update(_ call: CAPPluginCall)`: read `call.getObject("payload")`,
 *      JSON-encode it, write to `UserDefaults(suiteName: appGroup)` under
 *      key `todayGlance.v1`, then `WidgetCenter.shared.reloadTimelines(ofKind: "TodayGlanceWidget")`.
 *    - If the payload carries `nextStop`, start/update a Live Activity
 *      (`ActivityKit`, `TodayRouteAttributes`) with the same fields; end it
 *      when `remainingStops == 0`.
 *    - Register the plugin in the app's `CAPBridgeViewController` subclass
 *      (`capacitorDidLoad` -> `bridge?.registerPluginInstance(...)`).
 *
 * 3. Widget extension target `TodayGlanceWidget` (ios/TodayGlanceWidget/)
 *    - `TodayGlanceEntry: TimelineEntry` decoding `TodayGlancePayload`
 *      (same field names as this TypeScript interface; `version` gate).
 *    - `TodayGlanceProvider: TimelineProvider` reading the App Group
 *      UserDefaults; placeholder shows "No route today".
 *    - Views: `.systemSmall` (progress ring + remaining count),
 *      `.systemMedium` (next stop name/address + finish time + progress bar),
 *      `.accessoryRectangular` for the Lock Screen.
 *    - Tapping uses `widgetURL(URL(string: payload.deepLink))`; the app
 *      handles `chemcheck://route/today?next=<id>` via @capacitor/app
 *      `appUrlOpen` and routes to Home / NewServiceLog.
 *    - Maps button (iOS 17+ interactive widgets): `Link(destination: payload.nextStop.mapsUrl)`.
 *
 * 4. Live Activity (`TodayRouteAttributes: ActivityAttributes`)
 *    - ContentState: completedStops, totalStops, nextStopName, estimatedFinishAt.
 *    - Dynamic Island compact: "3/8", expanded: next stop + finish time.
 *    - Add `NSSupportsLiveActivities = YES` to Info.plist when wiring this.
 *
 * 5. JS side (already in place)
 *    - Home computes `buildTodayGlancePayload(...)` from the same state the
 *      TodayGlance card renders and calls `publishTodayGlance(payload)`.
 *      Until the plugin exists the call resolves `false` and nothing else changes.
 * ============================================================================
 */
