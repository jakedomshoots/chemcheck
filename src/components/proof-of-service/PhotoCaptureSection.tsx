/**
 * PhotoCaptureSection Component
 * Manages multiple photo captures for a single category (before/after)
 * Requirements: 1.1, 1.6, 1.7
 */

import { useState, useEffect, useCallback, type ElementType } from 'react';
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
  embedded?: boolean;
  streamlined?: boolean;
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
  embedded = false,
  streamlined = false,
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
  const Shell: ElementType = embedded ? 'div' : Card;
  const shellClassName = streamlined
    ? 'p-3'
    : embedded
      ? 'rounded-raised border border-line bg-white/65 p-4 shadow-sm'
      : 'p-4';

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
      <Shell className={shellClassName}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-surface-2 rounded-lg">
            <Image className="w-5 h-5 text-ink-secondary" />
          </div>
          <div>
            <h3 className="font-semibold text-ink">{displayTitle}</h3>
            <p className="text-sm text-ink-muted">{displayDescription}</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full" />
        </div>
      </Shell>
    );
  }

  if (streamlined) {
    const tone =
      category === 'before'
        ? {
            iconWrap: 'bg-[var(--status-watch-soft)] text-watch',
            badge: 'bg-[var(--status-watch-soft)] text-watch',
          }
        : {
            iconWrap: 'bg-[var(--status-ok-soft)] text-ok',
            badge: 'bg-[var(--status-ok-soft)] text-ok',
          };

    return (
      <Shell className={shellClassName}>
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone.iconWrap}`}>
            <Image className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-ink">{displayTitle}</h3>
              {photos.length > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone.badge}`}>
                  {photos.length}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs font-medium text-ink-muted">{displayDescription}</p>
          </div>
          {!isCapturing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCapturing(true)}
              disabled={disabled}
              className="h-10 shrink-0 rounded-full border border-line bg-white px-4 text-xs font-semibold text-ink shadow-sm hover:border-[var(--status-info-line)] hover:bg-brand-softer"
            >
              {photos.length > 0 ? (
                <>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add
                </>
              ) : (
                <>
                  <Camera className="mr-1.5 h-3.5 w-3.5" />
                  Capture
                </>
              )}
            </Button>
          )}
        </div>

        {photos.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="relative group">
                <img
                  src={photo.dataUrl}
                  alt={`${category} photo`}
                  className="h-16 w-full rounded-xl object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleDeletePhoto(photo.id)}
                  className="absolute right-1 top-1 rounded-full bg-[var(--status-critical-soft)]0 p-1 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                  aria-label="Delete photo"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {isCapturing && (
          <div className="mt-3">
            <PhotoCapture
              serviceLogId={serviceLogId}
              customerId={customerId}
              category={category}
              onPhotoCapture={handlePhotoCapture}
              disabled={disabled}
            />
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell className={shellClassName}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg ${
              category === 'before' ? 'bg-[var(--status-watch-soft)]' : 'bg-[var(--status-ok-soft)]'
            }`}
          >
            <Image
              className={`w-5 h-5 ${
                category === 'before' ? 'text-watch' : 'text-ok'
              }`}
            />
          </div>
          <div>
            <h3 className="font-semibold text-ink">{displayTitle}</h3>
            <p className="text-sm text-ink-muted">{displayDescription}</p>
          </div>
        </div>
        {/* Photo count badge */}
        {photos.length > 0 && (
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${
              category === 'before'
                ? 'bg-[var(--status-watch-soft)] text-watch'
                : 'bg-[var(--status-ok-soft)] text-ok'
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
                className="absolute top-2 right-2 p-1.5 bg-[var(--status-critical-soft)]0 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
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
          className="w-full border-2 border-line text-ink-secondary hover:bg-surface-2 hover:border-line"
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
    </Shell>
  );
}
