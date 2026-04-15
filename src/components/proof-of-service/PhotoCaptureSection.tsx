/**
 * PhotoCaptureSection Component
 * Manages multiple photo captures for a single category (before/after)
 * Requirements: 1.1, 1.6, 1.7
 */

import { useState, useEffect, useCallback } from 'react';
import { Camera, Plus, Image, Trash2, MapPin, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PhotoCapture } from './PhotoCapture';
import {
  CapturedPhoto,
  getPhotos,
  deletePhoto,
  recordToCapturedPhoto,
  OfflinePhotoRecord,
} from '@/lib/proof-of-service';

// ============================================
// Types
// ============================================

export interface PhotoCaptureSectionProps {
  serviceLogId: string | null;
  customerId: string;
  category: 'before' | 'after';
  title?: string;
  description?: string;
  disabled?: boolean;
  onPhotosChange?: (photos: CapturedPhoto[]) => void;
}

// ============================================
// Component
// ============================================

export function PhotoCaptureSection({
  serviceLogId,
  customerId,
  category,
  title,
  description,
  disabled = false,
  onPhotosChange,
}: PhotoCaptureSectionProps) {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Default titles based on category
  const displayTitle = title || (category === 'before' ? 'Before Photos' : 'After Photos');
  const displayDescription =
    description ||
    (category === 'before'
      ? 'Capture photos of the pool before service'
      : 'Capture photos of the pool after service');

  /**
   * Load existing photos from IndexedDB
   * Filters by both customerId and serviceLogId to ensure photos from other service logs don't appear
   */
  const loadPhotos = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('[PhotoCaptureSection] Loading photos - customerId:', customerId, 'serviceLogId:', serviceLogId, 'category:', category);
      const records = await getPhotos(customerId);
      console.log('[PhotoCaptureSection] Total photos for customer:', records.length);
      
      // Filter by category AND serviceLogId to ensure isolation between service logs
      // For new service logs (serviceLogId === null), only show photos with null serviceLogId
      const categoryPhotos = records
        .filter((r: OfflinePhotoRecord) => 
          r.category === category && 
          (serviceLogId === null ? r.serviceLogId === null : r.serviceLogId === serviceLogId)
        )
        .map((r: OfflinePhotoRecord) => recordToCapturedPhoto(r));
      
      console.log('[PhotoCaptureSection] Filtered photos for category', category, ':', categoryPhotos.length);
      setPhotos(categoryPhotos);
      onPhotosChange?.(categoryPhotos);
    } catch (error) {
      console.error('[PhotoCaptureSection] Failed to load photos:', error);
    } finally {
      setIsLoading(false);
    }
  }, [customerId, category, serviceLogId, onPhotosChange]);

  // Load photos on mount
  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  /**
   * Handle new photo capture
   */
  const handlePhotoCapture = useCallback(
    (photo: CapturedPhoto) => {
      setPhotos((prev) => {
        const updated = [...prev, photo];
        onPhotosChange?.(updated);
        return updated;
      });
      setIsCapturing(false);
    },
    [onPhotosChange]
  );

  /**
   * Handle photo deletion
   */
  const handleDeletePhoto = useCallback(
    async (photoId: string) => {
      try {
        await deletePhoto(photoId);
        setPhotos((prev) => {
          const updated = prev.filter((p) => p.id !== photoId);
          onPhotosChange?.(updated);
          return updated;
        });
      } catch (error) {
        console.error('Failed to delete photo:', error);
      }
    },
    [onPhotosChange]
  );

  /**
   * Format timestamp for display
   */
  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Unknown time';
    }
  };

  // ============================================
  // Render
  // ============================================

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Image className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{displayTitle}</h3>
            <p className="text-sm text-slate-500">{displayDescription}</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg ${
              category === 'before' ? 'bg-amber-100' : 'bg-green-100'
            }`}
          >
            <Image
              className={`w-5 h-5 ${
                category === 'before' ? 'text-amber-600' : 'text-green-600'
              }`}
            />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{displayTitle}</h3>
            <p className="text-sm text-slate-500">{displayDescription}</p>
          </div>
        </div>
        {/* Photo count badge */}
        {photos.length > 0 && (
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${
              category === 'before'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700'
            }`}
          >
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <img
                src={photo.dataUrl}
                alt={`${category} photo`}
                className="w-full h-32 object-cover rounded-lg"
              />
              {/* Metadata overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent rounded-b-lg">
                <div className="flex items-center gap-2 text-white text-xs">
                  <Clock className="w-3 h-3" />
                  <span>{formatTimestamp(photo.timestamp)}</span>
                  {photo.location && (
                    <>
                      <MapPin className="w-3 h-3 ml-1" />
                      <span>GPS</span>
                    </>
                  )}
                </div>
              </div>
              {/* Delete button */}
              <button
                type="button"
                onClick={() => handleDeletePhoto(photo.id)}
                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                aria-label="Delete photo"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Capture UI */}
      {isCapturing ? (
        <PhotoCapture
          serviceLogId={serviceLogId}
          customerId={customerId}
          category={category}
          onPhotoCapture={handlePhotoCapture}
          disabled={disabled}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsCapturing(true)}
          disabled={disabled}
          className="w-full border-2 border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
        >
          {photos.length > 0 ? (
            <>
              <Plus className="w-4 h-4 mr-2" />
              Add Another Photo
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 mr-2" />
              Capture Photo
            </>
          )}
        </Button>
      )}
    </Card>
  );
}

export default PhotoCaptureSection;
