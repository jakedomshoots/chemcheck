import {
  clearAllPhotos,
  clearSyncedPhotos,
  enforceStorageLimits,
  getPhotoStorageStats,
  getTotalPhotoSizeBytes,
  photoStorageLimits,
} from './offlinePhotoStorage';

export {
  clearAllPhotos,
  clearSyncedPhotos,
  enforceStorageLimits,
  getPhotoStorageStats,
  getTotalPhotoSizeBytes,
  photoStorageLimits,
};

export function formatStorageBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
