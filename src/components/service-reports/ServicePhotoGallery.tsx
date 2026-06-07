/**
 * ServicePhotoGallery Component
 * Displays service photos grouped by category (before/after) for service log history
 * 
 * Requirements: 1.2, 1.3, 1.4
 * - Groups photos by category with clear labels
 * - Displays thumbnails in grid layout
 * - Supports lightbox view for full-size photos
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Image } from 'lucide-react';

// ============================================
// Types
// ============================================

export interface ServicePhoto {
  id: string;
  url: string;
  category: 'before' | 'after';
  timestamp: string;
}

export interface ServicePhotoGalleryProps {
  photos: ServicePhoto[];
  onPhotoClick?: (photo: ServicePhoto) => void;
}

export interface GroupedPhotos {
  before: ServicePhoto[];
  after: ServicePhoto[];
}

// ============================================
// Helper Functions
// ============================================

/**
 * Groups photos by category (before/after)
 * Requirements: 1.3 - Group photos by category with clear labels
 * 
 * @param photos - Array of service photos
 * @returns Object with before and after photo arrays
 */
export function groupPhotosByCategory(photos: ServicePhoto[]): GroupedPhotos {
  const grouped: GroupedPhotos = {
    before: [],
    after: [],
  };

  for (const photo of photos) {
    if (photo.category === 'before') {
      grouped.before.push(photo);
    } else if (photo.category === 'after') {
      grouped.after.push(photo);
    }
  }

  return grouped;
}

// ============================================
// Component
// ============================================

export function ServicePhotoGallery({
  photos,
  onPhotoClick,
}: ServicePhotoGalleryProps) {
  const [lightboxPhoto, setLightboxPhoto] = useState<ServicePhoto | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // Group photos by category
  const groupedPhotos = useMemo(() => groupPhotosByCategory(photos), [photos]);

  /**
   * Handle thumbnail click - open lightbox or call custom handler
   */
  const handlePhotoClick = useCallback((photo: ServicePhoto) => {
    if (onPhotoClick) {
      onPhotoClick(photo);
    } else {
      setLightboxPhoto(photo);
    }
  }, [onPhotoClick]);

  /**
   * Close lightbox
   */
  const closeLightbox = useCallback(() => {
    setLightboxPhoto(null);
  }, []);

  /**
   * Handle keyboard events for lightbox (Escape to close)
   * Requirements: 1.4 - Add keyboard navigation (Escape)
   */
  useEffect(() => {
    if (!lightboxPhoto) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLightbox();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    lightboxRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightboxPhoto, closeLightbox]);

  // Empty state
  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-slate-500 py-6">
        <div className="p-3 bg-slate-100 rounded-full mb-3">
          <Image className="w-6 h-6" />
        </div>
        <p className="text-sm">No photos available</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Before Photos Section */}
        {groupedPhotos.before.length > 0 && (
          <PhotoSection
            title="Before"
            photos={groupedPhotos.before}
            onPhotoClick={handlePhotoClick}
            badgeColor="bg-amber-500"
          />
        )}

        {/* After Photos Section */}
        {groupedPhotos.after.length > 0 && (
          <PhotoSection
            title="After"
            photos={groupedPhotos.after}
            onPhotoClick={handlePhotoClick}
            badgeColor="bg-green-500"
          />
        )}
      </div>

      {/* Lightbox - Requirements: 1.4 */}
      {lightboxPhoto && (
        <div
          ref={lightboxRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${lightboxPhoto.category} photo`}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 focus:outline-none"
          onClick={closeLightbox}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              closeLightbox();
            }
          }}
        >
          <div className="relative max-w-4xl max-h-full">
            {/* Close button */}
            <button
              type="button"
              onClick={closeLightbox}
              className="absolute -top-12 right-0 p-2 text-white hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black rounded"
              aria-label="Close (Escape)"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Full-size image */}
            <img
              src={lightboxPhoto.url}
              alt={`${lightboxPhoto.category} photo`}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Category badge */}
            <div className="absolute bottom-4 left-4">
              <span
                className={`px-3 py-1 text-sm font-medium rounded-full capitalize text-white ${
                  lightboxPhoto.category === 'before'
                    ? 'bg-amber-500'
                    : 'bg-green-500'
                }`}
              >
                {lightboxPhoto.category}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================
// PhotoSection Sub-component
// ============================================

interface PhotoSectionProps {
  title: string;
  photos: ServicePhoto[];
  onPhotoClick: (photo: ServicePhoto) => void;
  badgeColor: string;
}

function PhotoSection({ title, photos, onPhotoClick, badgeColor }: PhotoSectionProps) {
  return (
    <div>
      {/* Category Label - Requirements: 1.3 */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full text-white ${badgeColor}`}>
          {title}
        </span>
        <span className="text-xs text-slate-500">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </span>
      </div>

      {/* Photo Grid - Requirements: 1.2 */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => onPhotoClick(photo)}
            className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 hover:opacity-90 transition-opacity"
          >
            <img
              src={photo.url}
              alt={`${photo.category} photo`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
