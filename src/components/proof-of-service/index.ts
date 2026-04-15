/**
 * Proof of Service Components
 * Exports UI components for photo documentation
 * 
 * Currently includes:
 * - PhotoCapture: Single photo capture with camera access
 * - PhotoCaptureSection: Multi-photo management for before/after categories
 * - PhotoGallery: Photo display grid with metadata overlay and deletion
 * - ProofStatus: Status indicator showing photos, time tracking, and sync status
 * 
 * Note: Time tracking components will be added in future tasks (Task 9)
 */

export { PhotoCapture } from './PhotoCapture';
export type { PhotoCaptureProps } from './PhotoCapture';

export { PhotoCaptureSection } from './PhotoCaptureSection';
export type { PhotoCaptureSectionProps } from './PhotoCaptureSection';

export { PhotoGallery } from './PhotoGallery';
export type { PhotoGalleryProps } from './PhotoGallery';

export { ProofStatus, formatDuration, getSyncStatusConfig } from './ProofStatus';
export type { ProofStatusProps } from './ProofStatus';
