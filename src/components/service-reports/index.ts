/**
 * Service Reports Components
 * Exports UI components for customer service reports feature
 * 
 * Currently includes:
 * - ServicePhotoGallery: Photo display grouped by category for service log history
 * - SendReportDialog: Confirmation dialog for sending SMS reports
 * - EmailPreview: Email preview component for showing email content before sending
 */

export { ServicePhotoGallery, groupPhotosByCategory } from './ServicePhotoGallery';
export type { 
  ServicePhotoGalleryProps, 
  ServicePhoto, 
  GroupedPhotos 
} from './ServicePhotoGallery';

export { SendReportDialog } from './SendReportDialog';
export type { SendReportDialogProps } from './SendReportDialog';

export { EmailPreview } from './EmailPreview';
export type { EmailPreviewProps } from './EmailPreview';
