/**
 * PhotoCapture Component
 * Handles camera access, photo capture, burst capture, and metadata
 * attachment for proof-of-service
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Camera,
  X,
  MapPin,
  Clock,
  AlertCircle,
  Check,
  Zap,
  ZapOff,
  Grid3X3,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Layers,
  Images,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  CapturedPhoto,
  GeoLocation,
  createCapturedPhoto,
  getCurrentLocation,
  savePhoto,
  compressImage,
  formatFileSize,
} from '@/lib/proof-of-service';
import {
  isNativeCameraAvailable,
  isNativeMultiPickAvailable,
  pickNativePhotos,
  takeNativePhoto,
} from '@/lib/native/camera';

// ============================================
// Types
// ============================================

export interface PhotoCaptureProps {
  serviceLogId: string | null;
  customerId: string;
  category: 'before' | 'after';
  onPhotoCapture: (photo: CapturedPhoto) => void;
  disabled?: boolean;
}

type CameraState = 'idle' | 'requesting' | 'active' | 'error';

interface CameraError {
  type: 'permission' | 'unavailable' | 'in-use' | 'unknown';
  message: string;
}

type FlashMode = 'off' | 'on' | 'auto';
type FacingMode = 'environment' | 'user';

export interface BurstFrame {
  id: string;
  dataUrl: string;
  selected: boolean;
  originalSize: number;
  compressedSize: number;
}

// ============================================
// Constants
// ============================================

/** Frames per burst. Five is enough to pick a sharp one without flooding storage. */
export const BURST_MAX_FRAMES = 5;
/** Gap between web frame grabs; fast enough to feel like a burst, slow enough to differ. */
export const BURST_INTERVAL_MS = 180;
/** How long the shutter must be held before a tap becomes a burst. */
export const HOLD_TO_BURST_MS = 350;

/** The compression every captured frame goes through (same as single capture). */
const CAPTURE_COMPRESSION = {
  quality: 0.85,
  maxWidth: 1920,
  maxHeight: 1080,
  format: 'jpeg' as const,
};

function frameId(): string {
  return `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ============================================
// Component
// ============================================

export function PhotoCapture({
  serviceLogId,
  customerId,
  category,
  onPhotoCapture,
  disabled = false,
}: PhotoCaptureProps) {
  // State
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'pending' | 'success' | 'failed'>('pending');
  const [compressionStats, setCompressionStats] = useState<{ original: number; compressed: number } | null>(null);
  const [attachedCount, setAttachedCount] = useState(0);

  // Camera control state
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [showGrid, setShowGrid] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [hasFlash, setHasFlash] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  // Burst state
  const [burstMode, setBurstMode] = useState(false);
  const [burstFrames, setBurstFrames] = useState<BurstFrame[]>([]);
  const [burstProgress, setBurstProgress] = useState<string | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdBurstStartedRef = useRef(false);
  const burstActiveRef = useRef(false);
  const holdReleasedRef = useRef(false);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  /**
   * Request camera access and start video stream
   */
  const startCamera = useCallback(async (overrideFacingMode?: FacingMode) => {
    if (disabled) return;

    const targetFacingMode = overrideFacingMode ?? facingMode;

    setCameraState('requesting');
    setCameraError(null);

    try {
      // Check if camera API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available');
      }

      // Request camera access with preference for back camera on mobile
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: targetFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      // Check for camera capabilities
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities = videoTrack.getCapabilities?.() as MediaTrackCapabilities & {
          torch?: boolean;
          zoom?: { min: number; max: number };
        };

        // Check flash/torch support
        if (capabilities?.torch) {
          setHasFlash(true);
        }

        // Check zoom support
        if (capabilities?.zoom) {
          setMaxZoom(capabilities.zoom.max || 1);
        }
      }

      // Check for multiple cameras
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');
      setHasMultipleCameras(cameras.length > 1);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraState('active');
    } catch (error) {
      const err = error as Error;
      let cameraErr: CameraError;

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        cameraErr = {
          type: 'permission',
          message: 'Camera permission denied. Please enable camera access in your browser settings.',
        };
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        cameraErr = {
          type: 'unavailable',
          message: 'No camera found on this device.',
        };
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        cameraErr = {
          type: 'in-use',
          message: 'Camera is in use by another application. Please close other apps using the camera.',
        };
      } else {
        cameraErr = {
          type: 'unknown',
          message: err.message || 'Failed to access camera.',
        };
      }

      setCameraError(cameraErr);
      setCameraState('error');
    }
  }, [disabled, facingMode]);

  /**
   * Resolve the device location once per capture/attach. Never throws.
   */
  const resolveLocation = useCallback(async (): Promise<GeoLocation | null> => {
    const locationResult = await getCurrentLocation({ timeout: 5000 });
    if (locationResult.success && locationResult.location) {
      setLocationStatus('success');
      return locationResult.location;
    }
    setLocationStatus('failed');
    return null;
  }, []);

  /**
   * Wrapper to start camera from button click.
   * On native platforms, bypasses the web camera and uses the native camera modal.
   */
  const handleStartCamera = useCallback(async () => {
    if (disabled) return;

    // Native path: use Capacitor camera plugin directly
    if (isNativeCameraAvailable()) {
      setIsCapturing(true);
      setLocationStatus('pending');

      try {
        const nativeResult = await takeNativePhoto(
          facingMode === 'user' ? 'user' : 'environment'
        );

        // Compress the native photo through the same pipeline
        const compressionResult = await compressImage(nativeResult.dataUrl, CAPTURE_COMPRESSION);

        const dataUrl = compressionResult.dataUrl;
        setCompressionStats({
          original: compressionResult.originalSize,
          compressed: compressionResult.compressedSize,
        });

        // Get location
        const location = await resolveLocation();

        // Create photo, save, and notify parent
        const photo = createCapturedPhoto(dataUrl, category, location);
        await savePhoto(photo, customerId, serviceLogId);
        setPreviewUrl(dataUrl);
        setAttachedCount(1);
        onPhotoCapture(photo);
      } catch (error) {
        console.error('Native camera failed:', error);
        // If user cancelled, just return silently
        const errMsg = (error as Error)?.message || '';
        if (!errMsg.includes('cancel')) {
          setCameraError({
            type: 'unknown',
            message: errMsg || 'Failed to capture photo. Please try again.',
          });
          setCameraState('error');
        }
      } finally {
        setIsCapturing(false);
      }
      return;
    }

    // Web fallback: open the web camera stream
    startCamera();
  }, [startCamera, disabled, facingMode, category, customerId, serviceLogId, onPhotoCapture, resolveLocation]);

  /**
   * Native burst stand-in: multi-select from the gallery in one sheet.
   * Sequential native camera calls are too slow to feel like a burst.
   */
  const handlePickNativeBurst = useCallback(async () => {
    if (disabled) return;
    setIsCapturing(true);
    setBurstProgress('Opening photo library…');

    try {
      const picked = await pickNativePhotos(BURST_MAX_FRAMES);
      if (picked.length === 0) return;

      const frames: BurstFrame[] = [];
      for (const [index, photo] of picked.entries()) {
        setBurstProgress(`Preparing photo ${index + 1} of ${picked.length}…`);
        const compressed = await compressImage(photo.dataUrl, CAPTURE_COMPRESSION);
        frames.push({
          id: frameId(),
          dataUrl: compressed.dataUrl,
          selected: true,
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
        });
      }
      setBurstFrames(frames);
    } catch (error) {
      const errMsg = (error as Error)?.message || '';
      if (!errMsg.toLowerCase().includes('cancel')) {
        setCameraError({ type: 'unknown', message: errMsg || 'Could not load photos. Please try again.' });
        setCameraState('error');
      }
    } finally {
      setIsCapturing(false);
      setBurstProgress(null);
    }
  }, [disabled]);

  /**
   * Toggle flash/torch
   */
  const toggleFlash = useCallback(async () => {
    if (!hasFlash || !streamRef.current) return;

    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;

    const newMode: FlashMode = flashMode === 'off' ? 'on' : 'off';

    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: newMode === 'on' } as MediaTrackConstraintSet],
      });
      setFlashMode(newMode);
    } catch (error) {
      console.warn('Flash control not supported:', error);
    }
  }, [hasFlash, flashMode]);

  /**
   * Apply zoom level
   */
  const applyZoom = useCallback(async (level: number) => {
    if (!streamRef.current || maxZoom <= 1) return;

    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;

    const clampedLevel = Math.max(1, Math.min(level, maxZoom));

    try {
      await videoTrack.applyConstraints({
        advanced: [{ zoom: clampedLevel } as unknown as MediaTrackConstraintSet],
      });
      setZoomLevel(clampedLevel);
    } catch (error) {
      console.warn('Zoom control not supported:', error);
    }
  }, [maxZoom]);

  /**
   * Stop camera stream
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState('idle');
    setPreviewUrl(null);
  }, []);

  // Release camera stream when app is backgrounded (important for iOS WebView memory).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && streamRef.current) {
        stopCamera();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopCamera]);

  /**
   * Switch between front and back camera
   */
  const switchCamera = useCallback(async () => {
    if (!hasMultipleCameras) return;

    const newFacingMode = facingMode === 'environment' ? 'user' : 'environment';

    // Reset capability-dependent state before switching
    setZoomLevel(1);
    setHasFlash(false);
    setMaxZoom(1);
    setFacingMode(newFacingMode);

    // Stop current stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Restart camera with new facing mode - startCamera will re-detect capabilities
    await startCamera(newFacingMode);
  }, [facingMode, hasMultipleCameras, startCamera]);

  /**
   * Grab one frame from the live video and run it through compression.
   */
  const grabFrame = useCallback(async (): Promise<BurstFrame> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) throw new Error('Camera is not ready');

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    ctx.drawImage(video, 0, 0);

    // Convert to initial data URL
    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.95);

    // Compress the image for optimal storage
    const compressionResult = await compressImage(rawDataUrl, CAPTURE_COMPRESSION);

    return {
      id: frameId(),
      dataUrl: compressionResult.dataUrl,
      selected: true,
      originalSize: compressionResult.originalSize,
      compressedSize: compressionResult.compressedSize,
    };
  }, []);

  /**
   * Capture photo from video stream
   */
  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || cameraState !== 'active') return;

    setIsCapturing(true);
    setLocationStatus('pending');

    try {
      const frame = await grabFrame();
      const dataUrl = frame.dataUrl;
      setCompressionStats({ original: frame.originalSize, compressed: frame.compressedSize });

      // Request geolocation (non-blocking)
      const location = await resolveLocation();

      // Create captured photo with metadata
      const photo = createCapturedPhoto(dataUrl, category, location);

      // Save to IndexedDB immediately
      await savePhoto(photo, customerId, serviceLogId);

      // Set preview
      setPreviewUrl(dataUrl);
      setAttachedCount(1);

      // Notify parent
      onPhotoCapture(photo);

      // Stop camera after capture
      stopCamera();
    } catch (error) {
      console.error('Failed to capture photo:', error);
      setCameraError({
        type: 'unknown',
        message: (error as Error)?.message || 'Failed to capture photo. Please try again.',
      });
      setCameraState('error');
    } finally {
      setIsCapturing(false);
    }
  }, [cameraState, category, customerId, serviceLogId, onPhotoCapture, stopCamera, grabFrame, resolveLocation]);

  /**
   * Web burst: grab up to BURST_MAX_FRAMES frames in quick succession.
   * When `untilReleased` is set (tap-and-hold) the burst ends early on release.
   */
  const captureBurst = useCallback(async (untilReleased = false) => {
    if (!videoRef.current || !canvasRef.current || cameraState !== 'active') return;
    if (burstActiveRef.current) return;

    burstActiveRef.current = true;
    setIsCapturing(true);
    const frames: BurstFrame[] = [];

    try {
      for (let index = 0; index < BURST_MAX_FRAMES; index += 1) {
        if (untilReleased && holdReleasedRef.current && frames.length > 0) break;
        setBurstProgress(`Capturing frame ${index + 1} of ${BURST_MAX_FRAMES}…`);
        frames.push(await grabFrame());
        if (index < BURST_MAX_FRAMES - 1) await wait(BURST_INTERVAL_MS);
      }
      setBurstFrames(frames);
    } catch (error) {
      console.error('Burst capture failed:', error);
      if (frames.length > 0) {
        setBurstFrames(frames);
      } else {
        setCameraError({
          type: 'unknown',
          message: (error as Error)?.message || 'Burst capture failed. Please try again.',
        });
        setCameraState('error');
      }
    } finally {
      burstActiveRef.current = false;
      setIsCapturing(false);
      setBurstProgress(null);
    }
  }, [cameraState, grabFrame]);

  /**
   * Shutter press: short tap captures one (or a burst when burst mode is on),
   * tap-and-hold always captures a burst.
   */
  const handleShutterPointerDown = useCallback(() => {
    if (cameraState !== 'active' || isCapturing) return;
    holdReleasedRef.current = false;
    holdBurstStartedRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      holdBurstStartedRef.current = true;
      void captureBurst(true);
    }, HOLD_TO_BURST_MS);
  }, [cameraState, isCapturing, captureBurst]);

  const handleShutterPointerUp = useCallback(() => {
    holdReleasedRef.current = true;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const handleShutterClick = useCallback(() => {
    // A click that followed a hold-burst already did its work.
    if (holdBurstStartedRef.current) {
      holdBurstStartedRef.current = false;
      return;
    }
    if (burstMode) {
      void captureBurst(false);
    } else {
      void capturePhoto();
    }
  }, [burstMode, captureBurst, capturePhoto]);

  /**
   * Burst review: toggle a frame, discard all, or attach the selected ones.
   */
  const toggleBurstFrame = useCallback((id: string) => {
    setBurstFrames((frames) => frames.map((frame) => (frame.id === id ? { ...frame, selected: !frame.selected } : frame)));
  }, []);

  const discardBurst = useCallback(() => {
    setBurstFrames([]);
  }, []);

  const attachBurst = useCallback(async () => {
    const selected = burstFrames.filter((frame) => frame.selected);
    if (selected.length === 0) return;

    setIsCapturing(true);
    setLocationStatus('pending');
    setBurstProgress(`Attaching ${selected.length} ${selected.length === 1 ? 'photo' : 'photos'}…`);

    try {
      // One location read for the whole burst: frames were taken within a second of each other.
      const location = await resolveLocation();

      let totalOriginal = 0;
      let totalCompressed = 0;
      for (const frame of selected) {
        const photo = createCapturedPhoto(frame.dataUrl, category, location);
        await savePhoto(photo, customerId, serviceLogId);
        onPhotoCapture(photo);
        totalOriginal += frame.originalSize;
        totalCompressed += frame.compressedSize;
      }

      setCompressionStats({ original: totalOriginal, compressed: totalCompressed });
      setAttachedCount(selected.length);
      setPreviewUrl(selected[selected.length - 1].dataUrl);
      setBurstFrames([]);
      // Release the camera; the preview takes over.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraState('idle');
    } catch (error) {
      console.error('Failed to attach burst:', error);
      setCameraError({
        type: 'unknown',
        message: (error as Error)?.message || 'Failed to save photos. Please try again.',
      });
      setCameraState('error');
    } finally {
      setIsCapturing(false);
      setBurstProgress(null);
    }
  }, [burstFrames, category, customerId, serviceLogId, onPhotoCapture, resolveLocation]);

  /**
   * Retake photo - clear preview and restart camera
   */
  const retakePhoto = useCallback(() => {
    setPreviewUrl(null);
    setAttachedCount(0);
    if (isNativeCameraAvailable()) {
      void handleStartCamera();
      return;
    }
    startCamera();
  }, [startCamera, handleStartCamera]);

  const selectedBurstCount = burstFrames.filter((frame) => frame.selected).length;

  // ============================================
  // Render
  // ============================================

  // Burst review (web burst or native multi-pick) takes precedence over everything else
  if (burstFrames.length > 0) {
    return (
      <Card className="p-4 border-2 border-[var(--status-info-line)] bg-brand-softer">
        <BurstReviewStrip
          category={category}
          frames={burstFrames}
          busy={isCapturing}
          progressLabel={burstProgress}
          onToggle={toggleBurstFrame}
          onDiscard={discardBurst}
          onAttach={attachBurst}
        />
      </Card>
    );
  }

  // Idle state - show capture button
  if (cameraState === 'idle' && !previewUrl) {
    const multiPick = isNativeMultiPickAvailable();
    return (
      <Card className="p-4 border-2 border-dashed border-line hover:border-[var(--status-info-line)] transition-colors">
        <button
          type="button"
          onClick={handleStartCamera}
          disabled={disabled || isCapturing}
          aria-label={`Capture ${category} photo`}
          className="w-full flex flex-col items-center justify-center gap-3 py-6 text-ink-secondary hover:text-brand-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="p-3 bg-surface-2 rounded-full">
            <Camera className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="text-center">
            <p className="font-medium">Capture {category} photo</p>
            <p className="text-sm text-ink-muted">Tap to open camera</p>
          </div>
        </button>
        {multiPick && (
          <Button
            type="button"
            variant="outline"
            onClick={handlePickNativeBurst}
            disabled={disabled || isCapturing}
            aria-label={`Choose up to ${BURST_MAX_FRAMES} ${category} photos from your library`}
            className="mt-2 h-11 w-full rounded-full border border-line text-sm font-semibold text-ink"
          >
            <Images className="mr-2 h-4 w-4" aria-hidden="true" />
            {burstProgress || `Choose up to ${BURST_MAX_FRAMES} from library`}
          </Button>
        )}
        {burstProgress && (
          <p className="sr-only" role="status" aria-live="polite">{burstProgress}</p>
        )}
      </Card>
    );
  }

  // Error state
  if (cameraState === 'error' && cameraError) {
    return (
      <Card className="p-4 border-2 border-[var(--status-critical-line)] bg-[var(--status-critical-soft)]">
        <div className="flex flex-col items-center gap-3 py-4" role="alert">
          <div className="p-3 bg-[var(--status-critical-soft)] rounded-full">
            <AlertCircle className="w-6 h-6 text-critical" aria-hidden="true" />
          </div>
          <div className="text-center">
            <p className="font-medium text-critical">Camera Error</p>
            <p className="text-sm text-critical mt-1" data-testid="camera-error-message">{cameraError.message}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleStartCamera}
            className="mt-2 h-11"
          >
            Try Again
          </Button>
        </div>
      </Card>
    );
  }

  // Preview state - show captured photo
  if (previewUrl) {
    const compressionPercent = compressionStats
      ? Math.round((1 - compressionStats.compressed / compressionStats.original) * 100)
      : null;

    return (
      <Card className="p-4 border-2 border-[var(--status-ok-line)] bg-[var(--status-ok-soft)]">
        <div className="relative">
          <img
            src={previewUrl}
            alt={`${category} photo preview`}
            className="w-full rounded-lg"
          />
          <div className="absolute top-2 right-2 flex flex-col gap-2 items-end">
            <span className="px-2 py-1 bg-[var(--status-ok)] text-white text-xs font-medium rounded-full flex items-center gap-1" role="status">
              <Check className="w-3 h-3" aria-hidden="true" />
              {attachedCount > 1 ? `${attachedCount} captured` : 'Captured'}
            </span>
            {compressionStats && compressionPercent !== null && compressionPercent > 0 && (
              <span className="px-2 py-1 bg-brand text-white text-xs font-medium rounded-full">
                {formatFileSize(compressionStats.compressed)} ({compressionPercent}% smaller)
              </span>
            )}
          </div>
          <div className="absolute bottom-2 left-2 flex gap-2">
            <span className="px-2 py-1 bg-black/60 text-white text-xs rounded-full flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              Just now
            </span>
            <span
              className={`px-2 py-1 text-white text-xs rounded-full flex items-center gap-1 ${locationStatus === 'success' ? 'bg-[var(--status-ok)]' : 'bg-black/60'
                }`}
            >
              <MapPin className="w-3 h-3" aria-hidden="true" />
              {locationStatus === 'success' ? 'Location saved' : 'No location'}
            </span>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retakePhoto}
            className="h-11 flex-1"
          >
            <Camera className="w-4 h-4 mr-1" aria-hidden="true" />
            {attachedCount > 1 ? 'Add more' : 'Retake'}
          </Button>
        </div>
      </Card>
    );
  }

  // Active camera state
  return (
    <Card className="p-4 border-2 border-[var(--status-info-line)] bg-brand-softer">
      <div className="relative">
        {/* Video preview */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full rounded-lg bg-black"
          aria-label="Live camera preview"
        />

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

        {/* Grid overlay */}
        {showGrid && (
          <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden" aria-hidden="true">
            {/* Vertical lines */}
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
            {/* Horizontal lines */}
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
          </div>
        )}

        {/* Loading overlay */}
        {(cameraState === 'requesting' || isCapturing) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg" role="status" aria-live="polite">
            <div className="text-white text-center">
              <div className="animate-spin motion-reduce:animate-none w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm">
                {cameraState === 'requesting' ? 'Starting camera...' : burstProgress || 'Capturing...'}
              </p>
            </div>
          </div>
        )}

        {/* Top controls bar */}
        <div className="absolute top-2 left-2 right-2 flex justify-between items-start">
          {/* Category badge */}
          <span className="px-2 py-1 bg-brand text-white text-xs font-medium rounded-full capitalize">
            {category}
          </span>

          {/* Top right controls */}
          <div className="flex gap-2">
            {/* Burst toggle */}
            <button
              type="button"
              onClick={() => setBurstMode((mode) => !mode)}
              aria-pressed={burstMode}
              aria-label={burstMode ? 'Burst mode on' : 'Burst mode off'}
              data-testid="burst-toggle"
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${burstMode
                ? 'bg-brand text-white'
                : 'bg-black/60 hover:bg-black/80 text-white'
                }`}
              title={burstMode ? 'Burst mode on' : 'Burst mode off'}
            >
              <Layers className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Grid toggle */}
            <button
              type="button"
              onClick={() => setShowGrid(!showGrid)}
              aria-pressed={showGrid}
              aria-label="Toggle grid"
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${showGrid
                ? 'bg-brand text-white'
                : 'bg-black/60 hover:bg-black/80 text-white'
                }`}
              title="Toggle grid"
            >
              <Grid3X3 className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Flash toggle */}
            {hasFlash && (
              <button
                type="button"
                onClick={toggleFlash}
                aria-pressed={flashMode === 'on'}
                aria-label={flashMode === 'on' ? 'Turn off flash' : 'Turn on flash'}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${flashMode === 'on'
                  ? 'bg-[var(--status-watch)] text-white'
                  : 'bg-black/60 hover:bg-black/80 text-white'
                  }`}
                title={flashMode === 'on' ? 'Turn off flash' : 'Turn on flash'}
              >
                {flashMode === 'on' ? <Zap className="w-4 h-4" aria-hidden="true" /> : <ZapOff className="w-4 h-4" aria-hidden="true" />}
              </button>
            )}

            {/* Close button */}
            <button
              type="button"
              onClick={stopCamera}
              aria-label="Close camera"
              className="flex h-11 w-11 items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Bottom controls bar - Zoom */}
        {maxZoom > 1 && (
          <div className="absolute bottom-2 left-4 right-4">
            <div className="flex items-center gap-2 bg-black/60 rounded-full px-3 py-1.5">
              <ZoomOut className="w-4 h-4 text-white/70" aria-hidden="true" />
              <input
                type="range"
                min={1}
                max={maxZoom}
                step={0.1}
                value={zoomLevel}
                onChange={(e) => applyZoom(parseFloat(e.target.value))}
                aria-label="Camera zoom"
                aria-valuetext={`${zoomLevel.toFixed(1)}x zoom`}
                className="flex-1 h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
              />
              <ZoomIn className="w-4 h-4 text-white/70" aria-hidden="true" />
              <span className="text-white text-xs font-medium min-w-[2rem] text-right">
                {zoomLevel.toFixed(1)}x
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom capture section */}
      <div className="mt-3 flex items-center justify-center gap-4">
        {/* Camera switch button */}
        {hasMultipleCameras && (
          <button
            type="button"
            onClick={switchCamera}
            aria-label="Switch camera"
            className="flex h-12 w-12 items-center justify-center bg-surface-2 hover:bg-line rounded-full transition-colors"
            title="Switch camera"
          >
            <RotateCcw className="w-5 h-5 text-ink-secondary" aria-hidden="true" />
          </button>
        )}

        {/* Main capture button */}
        <button
          type="button"
          onClick={handleShutterClick}
          onPointerDown={handleShutterPointerDown}
          onPointerUp={handleShutterPointerUp}
          onPointerLeave={handleShutterPointerUp}
          onPointerCancel={handleShutterPointerUp}
          disabled={cameraState !== 'active' || isCapturing}
          aria-label={burstMode ? `Capture ${category} burst` : `Capture ${category} photo`}
          data-testid="shutter-button"
          className="w-16 h-16 bg-white border-4 border-brand rounded-full flex items-center justify-center hover:bg-brand-softer active:scale-95 motion-reduce:transform-none transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          <div className={`rounded-full bg-brand ${burstMode ? 'h-10 w-10 ring-4 ring-inset ring-white/60' : 'h-12 w-12'}`} aria-hidden="true" />
        </button>

        {/* Spacer for centering (matches switch button width) */}
        {hasMultipleCameras && <div className="w-12" aria-hidden="true" />}
      </div>
      <p className="text-center text-sm text-ink-secondary mt-2">
        {burstMode ? `Tap for a ${BURST_MAX_FRAMES}-frame burst` : 'Tap to capture · hold for burst'}
      </p>
    </Card>
  );
}

// ============================================
// Burst review strip
// ============================================

export interface BurstReviewStripProps {
  category: 'before' | 'after';
  frames: BurstFrame[];
  busy?: boolean;
  progressLabel?: string | null;
  onToggle: (id: string) => void;
  onDiscard: () => void;
  onAttach: () => void;
}

/**
 * Thumbnail strip for reviewing burst frames before they are attached.
 * Each thumbnail is a toggle button; deselected frames are never saved.
 */
export function BurstReviewStrip({
  category,
  frames,
  busy = false,
  progressLabel = null,
  onToggle,
  onDiscard,
  onAttach,
}: BurstReviewStripProps) {
  const selectedCount = frames.filter((frame) => frame.selected).length;
  const selectedBytes = frames.filter((frame) => frame.selected).reduce((sum, frame) => sum + frame.compressedSize, 0);

  return (
    <div data-testid="burst-review">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {frames.length} {category} {frames.length === 1 ? 'frame' : 'frames'} captured
          </p>
          <p className="text-xs text-ink-secondary" role="status" aria-live="polite" aria-atomic="true">
            {progressLabel || `${selectedCount} selected · ${formatFileSize(selectedBytes)}`}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={busy}
          className="h-11 text-ink-secondary"
          aria-label="Discard all frames"
        >
          <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
          Discard
        </Button>
      </div>

      <ul className="mt-3 grid grid-cols-5 gap-2" aria-label="Burst frames">
        {frames.map((frame, index) => (
          <li key={frame.id}>
            <button
              type="button"
              onClick={() => onToggle(frame.id)}
              disabled={busy}
              aria-pressed={frame.selected}
              aria-label={`Frame ${index + 1}${frame.selected ? ', selected' : ', not selected'}`}
              data-testid={`burst-frame-${index + 1}`}
              className={`relative block aspect-square min-h-11 w-full overflow-hidden rounded-control border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${frame.selected ? 'border-brand' : 'border-line opacity-60'
                }`}
            >
              <img src={frame.dataUrl} alt="" className="h-full w-full object-cover" />
              <span
                className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-white ${frame.selected ? 'bg-brand' : 'bg-black/50'
                  }`}
                aria-hidden="true"
              >
                {frame.selected ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          onClick={onAttach}
          disabled={busy || selectedCount === 0}
          className="h-11 flex-1 rounded-full bg-brand text-white shadow-cta hover:bg-brand-strong disabled:bg-surface-2 disabled:text-ink-muted"
          data-testid="burst-attach"
        >
          <Check className="mr-2 h-4 w-4" aria-hidden="true" />
          Attach {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'}
        </Button>
      </div>
    </div>
  );
}
