/**
 * PhotoCapture Component
 * Handles camera access, photo capture, and metadata attachment for proof-of-service
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, X, MapPin, Clock, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  CapturedPhoto,
  GeoLocation,
  createCapturedPhoto,
  getCurrentLocation,
  savePhoto,
} from '@/lib/proof-of-service';

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
  const startCamera = useCallback(async () => {
    if (disabled) return;

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
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

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
  }, [disabled]);

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

      // Convert to data URL (JPEG for smaller file size)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

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
          onClick={startCamera}
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
            onClick={startCamera}
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
    return (
      <Card className="p-4 border-2 border-green-200 bg-green-50">
        <div className="relative">
          <img
            src={previewUrl}
            alt={`${category} photo preview`}
            className="w-full rounded-lg"
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <span className="px-2 py-1 bg-green-600 text-white text-xs font-medium rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" />
              Captured
            </span>
          </div>
          <div className="absolute bottom-2 left-2 flex gap-2">
            <span className="px-2 py-1 bg-black/60 text-white text-xs rounded-full flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Just now
            </span>
            <span
              className={`px-2 py-1 text-white text-xs rounded-full flex items-center gap-1 ${
                locationStatus === 'success' ? 'bg-green-600' : 'bg-slate-500'
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

        {/* Category badge */}
        <div className="absolute top-2 left-2">
          <span className="px-2 py-1 bg-cyan-600 text-white text-xs font-medium rounded-full capitalize">
            {category}
          </span>
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={stopCamera}
          className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Capture button */}
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={capturePhoto}
          disabled={cameraState !== 'active' || isCapturing}
          className="w-16 h-16 bg-white border-4 border-cyan-500 rounded-full flex items-center justify-center hover:bg-cyan-50 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="w-12 h-12 bg-cyan-500 rounded-full" />
        </button>
      </div>
      <p className="text-center text-sm text-slate-600 mt-2">Tap to capture</p>
    </Card>
  );
}

export default PhotoCapture;
