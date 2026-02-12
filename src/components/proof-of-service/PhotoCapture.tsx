/**
 * PhotoCapture Component
 * Handles camera access, photo capture, and metadata attachment for proof-of-service
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, X, MapPin, Clock, AlertCircle, Check, Loader2, Zap, ZapOff, Grid3X3, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
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
import { isNativeCameraAvailable, takeNativePhoto } from '@/lib/native/camera';

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

  // Camera control state
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [showGrid, setShowGrid] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [hasFlash, setHasFlash] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
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
        const compressionResult = await compressImage(nativeResult.dataUrl, {
          quality: 0.85,
          maxWidth: 1920,
          maxHeight: 1080,
          format: 'jpeg',
        });

        const dataUrl = compressionResult.dataUrl;
        setCompressionStats({
          original: compressionResult.originalSize,
          compressed: compressionResult.compressedSize,
        });

        // Get location
        let location: GeoLocation | null = null;
        const locationResult = await getCurrentLocation({ timeout: 5000 });
        if (locationResult.success && locationResult.location) {
          location = locationResult.location;
          setLocationStatus('success');
        } else {
          setLocationStatus('failed');
        }

        // Create photo, save, and notify parent
        const photo = createCapturedPhoto(dataUrl, category, location);
        await savePhoto(photo, customerId, serviceLogId);
        setPreviewUrl(dataUrl);
        onPhotoCapture(photo);
      } catch (error) {
        console.error('Native camera failed:', error);
        // If user cancelled, just return silently
        const errMsg = (error as Error)?.message || '';
        if (!errMsg.includes('cancel')) {
          setCameraError({
            type: 'unknown',
            message: 'Failed to capture photo. Please try again.',
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
  }, [startCamera, disabled, facingMode, category, customerId, serviceLogId, onPhotoCapture]);

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
   * Capture photo from video stream
   */
  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || cameraState !== 'active') return;

    setIsCapturing(true);
    setLocationStatus('pending');

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;

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
      const compressionResult = await compressImage(rawDataUrl, {
        quality: 0.85,
        maxWidth: 1920,
        maxHeight: 1080,
        format: 'jpeg',
      });

      const dataUrl = compressionResult.dataUrl;
      setCompressionStats({
        original: compressionResult.originalSize,
        compressed: compressionResult.compressedSize,
      });

      // Request geolocation (non-blocking)
      let location: GeoLocation | null = null;
      const locationResult = await getCurrentLocation({ timeout: 5000 });

      if (locationResult.success && locationResult.location) {
        location = locationResult.location;
        setLocationStatus('success');
      } else {
        setLocationStatus('failed');
      }

      // Create captured photo with metadata
      const photo = createCapturedPhoto(dataUrl, category, location);

      // Save to IndexedDB immediately
      await savePhoto(photo, customerId, serviceLogId);

      // Set preview
      setPreviewUrl(dataUrl);

      // Notify parent
      onPhotoCapture(photo);

      // Stop camera after capture
      stopCamera();
    } catch (error) {
      console.error('Failed to capture photo:', error);
    } finally {
      setIsCapturing(false);
    }
  }, [cameraState, category, customerId, serviceLogId, onPhotoCapture, stopCamera]);

  /**
   * Retake photo - clear preview and restart camera
   */
  const retakePhoto = useCallback(() => {
    setPreviewUrl(null);
    startCamera();
  }, [startCamera]);

  // ============================================
  // Render
  // ============================================

  // Idle state - show capture button
  if (cameraState === 'idle' && !previewUrl) {
    return (
      <Card className="p-4 border-2 border-dashed border-slate-300 hover:border-cyan-400 transition-colors">
        <button
          type="button"
          onClick={handleStartCamera}
          disabled={disabled}
          className="w-full flex flex-col items-center justify-center gap-3 py-6 text-slate-600 hover:text-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="p-3 bg-slate-100 rounded-full">
            <Camera className="w-6 h-6" />
          </div>
          <div className="text-center">
            <p className="font-medium">Capture {category} photo</p>
            <p className="text-sm text-slate-500">Tap to open camera</p>
          </div>
        </button>
      </Card>
    );
  }

  // Error state
  if (cameraState === 'error' && cameraError) {
    return (
      <Card className="p-4 border-2 border-red-200 bg-red-50">
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="p-3 bg-red-100 rounded-full">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <div className="text-center">
            <p className="font-medium text-red-700">Camera Error</p>
            <p className="text-sm text-red-600 mt-1">{cameraError.message}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleStartCamera}
            className="mt-2"
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
      <Card className="p-4 border-2 border-green-200 bg-green-50">
        <div className="relative">
          <img
            src={previewUrl}
            alt={`${category} photo preview`}
            className="w-full rounded-lg"
          />
          <div className="absolute top-2 right-2 flex flex-col gap-2 items-end">
            <span className="px-2 py-1 bg-green-600 text-white text-xs font-medium rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" />
              Captured
            </span>
            {compressionStats && compressionPercent !== null && compressionPercent > 0 && (
              <span className="px-2 py-1 bg-cyan-600 text-white text-xs font-medium rounded-full">
                {formatFileSize(compressionStats.compressed)} ({compressionPercent}% smaller)
              </span>
            )}
          </div>
          <div className="absolute bottom-2 left-2 flex gap-2">
            <span className="px-2 py-1 bg-black/60 text-white text-xs rounded-full flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Just now
            </span>
            <span
              className={`px-2 py-1 text-white text-xs rounded-full flex items-center gap-1 ${locationStatus === 'success' ? 'bg-green-600' : 'bg-slate-500'
                }`}
            >
              <MapPin className="w-3 h-3" />
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
            className="flex-1"
          >
            <Camera className="w-4 h-4 mr-1" />
            Retake
          </Button>
        </div>
      </Card>
    );
  }

  // Active camera state
  return (
    <Card className="p-4 border-2 border-cyan-200 bg-cyan-50">
      <div className="relative">
        {/* Video preview */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full rounded-lg bg-black"
        />

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Grid overlay */}
        {showGrid && (
          <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
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
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
            <div className="text-white text-center">
              <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm">
                {cameraState === 'requesting' ? 'Starting camera...' : 'Capturing...'}
              </p>
            </div>
          </div>
        )}

        {/* Top controls bar */}
        <div className="absolute top-2 left-2 right-2 flex justify-between items-start">
          {/* Category badge */}
          <span className="px-2 py-1 bg-cyan-600 text-white text-xs font-medium rounded-full capitalize">
            {category}
          </span>

          {/* Top right controls */}
          <div className="flex gap-2">
            {/* Grid toggle */}
            <button
              type="button"
              onClick={() => setShowGrid(!showGrid)}
              className={`p-2 rounded-full transition-colors ${showGrid
                ? 'bg-cyan-500 text-white'
                : 'bg-black/60 hover:bg-black/80 text-white'
                }`}
              title="Toggle grid"
            >
              <Grid3X3 className="w-4 h-4" />
            </button>

            {/* Flash toggle */}
            {hasFlash && (
              <button
                type="button"
                onClick={toggleFlash}
                className={`p-2 rounded-full transition-colors ${flashMode === 'on'
                  ? 'bg-yellow-500 text-white'
                  : 'bg-black/60 hover:bg-black/80 text-white'
                  }`}
                title={flashMode === 'on' ? 'Turn off flash' : 'Turn on flash'}
              >
                {flashMode === 'on' ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
              </button>
            )}

            {/* Close button */}
            <button
              type="button"
              onClick={stopCamera}
              className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Bottom controls bar - Zoom */}
        {maxZoom > 1 && (
          <div className="absolute bottom-2 left-4 right-4">
            <div className="flex items-center gap-2 bg-black/60 rounded-full px-3 py-1.5">
              <ZoomOut className="w-4 h-4 text-white/70" />
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
              <ZoomIn className="w-4 h-4 text-white/70" />
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
            className="p-3 bg-slate-200 hover:bg-slate-300 rounded-full transition-colors"
            title="Switch camera"
          >
            <RotateCcw className="w-5 h-5 text-slate-600" />
          </button>
        )}

        {/* Main capture button */}
        <button
          type="button"
          onClick={capturePhoto}
          disabled={cameraState !== 'active' || isCapturing}
          className="w-16 h-16 bg-white border-4 border-cyan-500 rounded-full flex items-center justify-center hover:bg-cyan-50 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          <div className="w-12 h-12 bg-cyan-500 rounded-full" />
        </button>

        {/* Spacer for centering (matches switch button width) */}
        {hasMultipleCameras && <div className="w-12" />}
      </div>
      <p className="text-center text-sm text-slate-600 mt-2">Tap to capture</p>
    </Card>
  );
}

export default PhotoCapture;
