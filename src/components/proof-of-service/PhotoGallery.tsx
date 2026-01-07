/**
 * PhotoGallery Component
 * Displays captured photos with metadata overlay and deletion capability
 * Requirements: 1.6, 1.7, 2.3
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Trash2, MapPin, Clock, Image, AlertCircle, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CapturedPhoto } from '@/lib/proof-of-service';

// ============================================
// Types
// ============================================

export interface PhotoGalleryProps {
  photos: CapturedPhoto[];
  onDelete?: (photoId: string) => void;
  readOnly?: boolean;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Format timestamp for display in user's local timezone
 * @param timestamp - ISO 8601 timestamp string
 * @returns Formatted time string
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  // Check for Invalid Date - Date constructor doesn't throw, it returns Invalid Date
  if (isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format location for display
 * Requirements: 2.3 - Show human-readable address or "Location unavailable"
 * @param location - GeoLocation object or null
 * @returns Formatted location string
 */
function formatLocation(location: CapturedPhoto['location']): string {
  if (!location) {
    return 'Location unavailable';
  }
  
  // If we have an address, use it
  if (location.address) {
    return location.address;
  }
  
  // Otherwise show coordinates with accuracy
  const lat = location.latitude.toFixed(4);
  const lng = location.longitude.toFixed(4);
  const accuracy = Math.round(location.accuracy);
  return `${lat}, ${lng} (±${accuracy}m)`;
}

// ============================================
// Component
// ============================================

export function PhotoGallery({
  photos,
  onDelete,
  readOnly = false,
}: PhotoGalleryProps) {
  const [deletePhotoId, setDeletePhotoId] = useState<string | null>(null);
  const [expandedPhotoId, setExpandedPhotoId] = useState<string | null>(null);
  const expandedViewRef = useRef<HTMLDivElement>(null);

  /**
   * Handle keyboard events for expanded view (Escape to close)
   */
  useEffect(() => {
    if (!expandedPhotoId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedPhotoId(null);
      }
    };

    // Add event listener and focus the overlay for keyboard accessibility
    document.addEventListener('keydown', handleKeyDown);
    expandedViewRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [expandedPhotoId]);

  /**
   * Handle delete confirmation
   */
  const handleDeleteConfirm = useCallback(() => {
    if (deletePhotoId && onDelete) {
      onDelete(deletePhotoId);
    }
    setDeletePhotoId(null);
  }, [deletePhotoId, onDelete]);

  /**
   * Handle delete cancel
   */
  const handleDeleteCancel = useCallback(() => {
    setDeletePhotoId(null);
  }, []);

  /**
   * Get photo being deleted for confirmation dialog
   */
  const photoToDelete = photos.find((p) => p.id === deletePhotoId);

  /**
   * Get expanded photo for full-screen view
   */
  const expandedPhoto = photos.find((p) => p.id === expandedPhotoId);

  // Empty state
  if (photos.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center justify-center text-slate-500 py-4">
          <div className="p-3 bg-slate-100 rounded-full mb-3">
            <Image className="w-6 h-6" />
          </div>
          <p className="text-sm">No photos captured yet</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Photo Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative group rounded-lg overflow-hidden bg-slate-100"
          >
            {/* Photo thumbnail */}
            <button
              type="button"
              onClick={() => setExpandedPhotoId(photo.id)}
              className="w-full aspect-square focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 rounded-lg"
            >
              <img
                src={photo.dataUrl}
                alt={`${photo.category} photo`}
                className="w-full h-full object-cover"
              />
            </button>

            {/* Category badge */}
            <div className="absolute top-2 left-2">
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                  photo.category === 'before'
                    ? 'bg-amber-500 text-white'
                    : 'bg-green-500 text-white'
                }`}
              >
                {photo.category}
              </span>
            </div>

            {/* Metadata overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
              <div className="space-y-1">
                {/* Timestamp */}
                <div className="flex items-center gap-1.5 text-white text-xs">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{formatTimestamp(photo.timestamp)}</span>
                </div>
                {/* Location */}
                <div className="flex items-center gap-1.5 text-white/80 text-xs">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{formatLocation(photo.location)}</span>
                </div>
              </div>
            </div>

            {/* Delete button - visible on hover/focus for desktop, always visible on touch devices */}
            {!readOnly && onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletePhotoId(photo.id);
                }}
                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                aria-label={`Delete ${photo.category} photo`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletePhotoId} onOpenChange={(open) => !open && handleDeleteCancel()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Delete Photo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this {photoToDelete?.category} photo. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {photoToDelete && (
            <div className="my-4">
              <img
                src={photoToDelete.dataUrl}
                alt="Photo to delete"
                className="w-full max-h-48 object-contain rounded-lg bg-slate-100"
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Expanded Photo View - Accessible modal with keyboard support */}
      {expandedPhoto && (
        <div
          ref={expandedViewRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Expanded ${expandedPhoto.category} photo`}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 focus:outline-none"
          onClick={() => setExpandedPhotoId(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setExpandedPhotoId(null);
            }
          }}
        >
          <div className="relative max-w-4xl max-h-full">
            {/* Close button */}
            <button
              type="button"
              onClick={() => setExpandedPhotoId(null)}
              className="absolute -top-12 right-0 p-2 text-white hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black rounded"
              aria-label="Close expanded view (Escape)"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Full-size image */}
            <img
              src={expandedPhoto.dataUrl}
              alt={`${expandedPhoto.category} photo`}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Metadata panel */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent rounded-b-lg">
              <div className="flex flex-wrap items-center gap-4 text-white">
                <span
                  className={`px-3 py-1 text-sm font-medium rounded-full capitalize ${
                    expandedPhoto.category === 'before'
                      ? 'bg-amber-500'
                      : 'bg-green-500'
                  }`}
                >
                  {expandedPhoto.category}
                </span>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>{formatTimestamp(expandedPhoto.timestamp)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  <span>{formatLocation(expandedPhoto.location)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PhotoGallery;
