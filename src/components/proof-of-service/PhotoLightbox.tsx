/**
 * PhotoLightbox Component
 * 
 * Full-screen photo viewer with:
 * - Pinch-to-zoom and pan gestures
 * - Swipe navigation between photos
 * - Photo info overlay
 * - Integration with PhotoEditor
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
    X,
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    Edit3,
    Download,
    Trash2,
    Info,
    MapPin,
    Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhotoEditor } from './PhotoEditor';
import type { CapturedPhoto } from '@/lib/proof-of-service/types';

// ============================================
// Types
// ============================================

export interface PhotoLightboxProps {
    photos: CapturedPhoto[];
    initialIndex: number;
    onClose: () => void;
    onEdit?: (photo: CapturedPhoto, editedDataUrl: string) => void;
    onDelete?: (photo: CapturedPhoto) => void;
    onDownload?: (photo: CapturedPhoto) => void;
}

interface GestureState {
    scale: number;
    translateX: number;
    translateY: number;
    lastDistance: number;
    lastX: number;
    lastY: number;
    isPinching: boolean;
    isDragging: boolean;
}

const DEFAULT_GESTURE_STATE: GestureState = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    lastDistance: 0,
    lastX: 0,
    lastY: 0,
    isPinching: false,
    isDragging: false,
};

// ============================================
// Component
// ============================================

export function PhotoLightbox({
    photos,
    initialIndex,
    onClose,
    onEdit,
    onDelete,
    onDownload,
}: PhotoLightboxProps) {
    // State
    const [currentIndex, setCurrentIndex] = useState(
        Math.max(0, Math.min(initialIndex, photos.length - 1))
    );
    const [gesture, setGesture] = useState<GestureState>(DEFAULT_GESTURE_STATE);
    const [showInfo, setShowInfo] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // Early return for empty photos array
    if (photos.length === 0) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
                <p className="text-white">No photos available</p>
                <button onClick={onClose} className="absolute top-4 right-4 text-white">
                    <X className="w-6 h-6" />
                </button>
            </div>
        );
    }

    const currentPhoto = photos[currentIndex];

    /**
     * Reset gesture state when changing photos
     */
    useEffect(() => {
        setGesture(DEFAULT_GESTURE_STATE);
    }, [currentIndex]);

    /**
     * Navigate to previous photo
     */
    const navigateToPrevious = useCallback(() => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
    }, [currentIndex]);

    /**
     * Navigate to next photo
     */
    const navigateToNext = useCallback(() => {
        if (currentIndex < photos.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    }, [currentIndex, photos.length]);

    /**
     * Zoom in
     */
    const zoomIn = useCallback(() => {
        setGesture(prev => ({
            ...prev,
            scale: Math.min(prev.scale * 1.5, 5),
        }));
    }, []);

    /**
     * Zoom out
     */
    const zoomOut = useCallback(() => {
        setGesture(prev => ({
            ...prev,
            scale: Math.max(prev.scale / 1.5, 1),
            translateX: prev.scale / 1.5 <= 1 ? 0 : prev.translateX,
            translateY: prev.scale / 1.5 <= 1 ? 0 : prev.translateY,
        }));
    }, []);

    /**
     * Reset zoom
     */
    const resetZoom = useCallback(() => {
        setGesture(DEFAULT_GESTURE_STATE);
    }, []);

    /**
     * Handle keyboard navigation
     */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isEditing) return;

            switch (e.key) {
                case 'Escape':
                    onClose();
                    break;
                case 'ArrowLeft':
                    navigateToPrevious();
                    break;
                case 'ArrowRight':
                    navigateToNext();
                    break;
                case '+':
                case '=':
                    zoomIn();
                    break;
                case '-':
                    zoomOut();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isEditing, onClose, navigateToPrevious, navigateToNext, zoomIn, zoomOut]);

    /**
     * Handle touch start for pinch-zoom and pan
     */
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            // Pinch start
            const distance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            setGesture(prev => ({
                ...prev,
                isPinching: true,
                lastDistance: distance,
            }));
        } else if (e.touches.length === 1 && gesture.scale > 1) {
            // Pan start (only when zoomed in)
            setGesture(prev => ({
                ...prev,
                isDragging: true,
                lastX: e.touches[0].clientX,
                lastY: e.touches[0].clientY,
            }));
        }
    }, [gesture.scale]);

    /**
     * Handle touch move for pinch-zoom and pan
     */
    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        e.preventDefault();

        if (gesture.isPinching && e.touches.length === 2) {
            // Pinch move
            const distance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );

            const scaleDelta = distance / gesture.lastDistance;
            const newScale = Math.min(Math.max(gesture.scale * scaleDelta, 1), 5);

            setGesture(prev => ({
                ...prev,
                scale: newScale,
                lastDistance: distance,
                // Reset position if zooming out to 1x
                translateX: newScale <= 1 ? 0 : prev.translateX,
                translateY: newScale <= 1 ? 0 : prev.translateY,
            }));
        } else if (gesture.isDragging && e.touches.length === 1) {
            // Pan move
            const deltaX = e.touches[0].clientX - gesture.lastX;
            const deltaY = e.touches[0].clientY - gesture.lastY;

            setGesture(prev => ({
                ...prev,
                translateX: prev.translateX + deltaX,
                translateY: prev.translateY + deltaY,
                lastX: e.touches[0].clientX,
                lastY: e.touches[0].clientY,
            }));
        }
    }, [gesture]);

    /**
     * Handle touch end
     */
    const handleTouchEnd = useCallback(() => {
        setGesture(prev => ({
            ...prev,
            isPinching: false,
            isDragging: false,
        }));
    }, []);

    /**
     * Handle mouse wheel for zoom
     */
    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(Math.max(gesture.scale * delta, 1), 5);

        setGesture(prev => ({
            ...prev,
            scale: newScale,
            translateX: newScale <= 1 ? 0 : prev.translateX,
            translateY: newScale <= 1 ? 0 : prev.translateY,
        }));
    }, [gesture.scale]);

    /**
     * Setup non-passive wheel listener
     */
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    /**
     * Handle edit save
     */
    const handleEditSave = useCallback((editedDataUrl: string) => {
        if (onEdit && currentPhoto) {
            onEdit(currentPhoto, editedDataUrl);
        }
        setIsEditing(false);
    }, [currentPhoto, onEdit]);

    /**
     * Handle delete
     */
    const handleDelete = useCallback(() => {
        if (onDelete && currentPhoto) {
            onDelete(currentPhoto);
            // Navigate to next photo or close if last
            if (photos.length === 1) {
                onClose();
            } else if (currentIndex >= photos.length - 1) {
                setCurrentIndex(currentIndex - 1);
            }
        }
    }, [currentPhoto, currentIndex, photos.length, onDelete, onClose]);

    /**
     * Handle download
     */
    const handleDownload = useCallback(() => {
        if (onDownload && currentPhoto) {
            onDownload(currentPhoto);
        } else if (currentPhoto) {
            // Default download behavior
            const extension = currentPhoto.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
            const link = document.createElement('a');
            link.href = currentPhoto.dataUrl;
            link.download = `photo-${currentPhoto.id}.${extension}`;
            link.click();
        }
    }, [currentPhoto, onDownload]);

    /**
     * Format timestamp for display
     */
    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleString();
    };

    // Render photo editor if editing
    if (isEditing && currentPhoto) {
        return (
            <div className="fixed inset-0 z-50 bg-black">
                <PhotoEditor
                    imageDataUrl={currentPhoto.dataUrl}
                    onSave={handleEditSave}
                    onCancel={() => setIsEditing(false)}
                />
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-black">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/70 to-transparent">
                <div className="flex items-center gap-2 text-white">
                    <span className="text-sm font-medium">
                        {currentIndex + 1} / {photos.length}
                    </span>
                    <span className="px-2 py-0.5 bg-cyan-500/80 text-xs rounded-full capitalize">
                        {currentPhoto?.category}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowInfo(!showInfo)}
                        className={`p-2 rounded-full transition-colors ${showInfo ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white'
                            }`}
                        aria-label={showInfo ? 'Hide photo info' : 'Show photo info'}
                    >
                        <Info className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 text-white/70 hover:text-white"
                        aria-label="Close lightbox"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
            </div>

            {/* Photo Info Overlay */}
            {showInfo && currentPhoto && (
                <div className="absolute top-16 left-4 right-4 z-10 p-4 bg-black/80 rounded-lg text-white text-sm">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-cyan-400" />
                            <span>{formatTimestamp(currentPhoto.timestamp)}</span>
                        </div>
                        {currentPhoto.location && (
                            <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-cyan-400" />
                                <span>
                                    {currentPhoto.location.address ||
                                        `${currentPhoto.location.latitude.toFixed(6)}, ${currentPhoto.location.longitude.toFixed(6)}`}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Main Image Container */}
            <div
                ref={containerRef}
                className="absolute inset-0 flex items-center justify-center overflow-hidden"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {currentPhoto && (
                    <img
                        ref={imageRef}
                        src={currentPhoto.dataUrl}
                        alt={`Photo ${currentIndex + 1}`}
                        className="max-w-full max-h-full object-contain select-none"
                        style={{
                            transform: `scale(${gesture.scale}) translate(${gesture.translateX / gesture.scale}px, ${gesture.translateY / gesture.scale}px)`,
                            transition: gesture.isDragging || gesture.isPinching ? 'none' : 'transform 0.2s ease-out',
                        }}
                        draggable={false}
                        onDoubleClick={gesture.scale > 1 ? resetZoom : zoomIn}
                    />
                )}
            </div>

            {/* Navigation Arrows */}
            {photos.length > 1 && (
                <>
                    <button
                        type="button"
                        onClick={navigateToPrevious}
                        disabled={currentIndex === 0}
                        className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Previous photo"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button
                        type="button"
                        onClick={navigateToNext}
                        disabled={currentIndex === photos.length - 1}
                        className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Next photo"
                    >
                        <ChevronRight className="w-6 h-6" />
                    </button>
                </>
            )}

            {/* Bottom Toolbar */}
            <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-4 p-4 bg-gradient-to-t from-black/70 to-transparent">
                {/* Zoom Controls */}
                <div className="flex items-center gap-2 bg-black/50 rounded-full px-3 py-1">
                    <button
                        type="button"
                        onClick={zoomOut}
                        disabled={gesture.scale <= 1}
                        className="p-1 text-white/70 hover:text-white disabled:opacity-30"
                        aria-label="Zoom out"
                    >
                        <ZoomOut className="w-5 h-5" />
                    </button>
                    <span className="text-white text-sm min-w-[3rem] text-center">
                        {Math.round(gesture.scale * 100)}%
                    </span>
                    <button
                        type="button"
                        onClick={zoomIn}
                        disabled={gesture.scale >= 5}
                        className="p-1 text-white/70 hover:text-white disabled:opacity-30"
                        aria-label="Zoom in"
                    >
                        <ZoomIn className="w-5 h-5" />
                    </button>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    {onEdit && (
                        <button
                            type="button"
                            onClick={() => setIsEditing(true)}
                            className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                            title="Edit photo"
                            aria-label="Edit photo"
                        >
                            <Edit3 className="w-5 h-5" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleDownload}
                        className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                        title="Download photo"
                        aria-label="Download photo"
                    >
                        <Download className="w-5 h-5" />
                    </button>
                    {onDelete && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="p-2 bg-black/50 hover:bg-red-600/70 text-white rounded-full transition-colors"
                            title="Delete photo"
                            aria-label="Delete photo"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Thumbnail Strip */}
            {photos.length > 1 && (
                <div className="absolute bottom-20 left-0 right-0 flex justify-center gap-2 px-4 overflow-x-auto">
                    {photos.map((photo, index) => (
                        <button
                            key={photo.id}
                            type="button"
                            onClick={() => setCurrentIndex(index)}
                            className={`flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${index === currentIndex
                                ? 'border-cyan-500 scale-110'
                                : 'border-transparent opacity-60 hover:opacity-100'
                                }`}
                        >
                            <img
                                src={photo.dataUrl}
                                alt={`Thumbnail ${index + 1}`}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
