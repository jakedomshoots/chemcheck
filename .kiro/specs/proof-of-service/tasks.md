# Implementation Plan: Proof of Service

## Overview

This implementation plan builds the Proof of Service feature incrementally, starting with the data layer, then core utilities, followed by UI components, and finally integration. Each task builds on previous work to ensure no orphaned code.

## Tasks

- [x] 1. Extend database schema for proof-of-service
  - [x] 1.1 Update serviceLogs table with time tracking fields
    - Add `start_time`, `end_time`, `duration_ms` fields to schema
    - Add `photo_count`, `has_before_photos`, `has_after_photos` fields
    - _Requirements: 3.1, 3.2, 4.2_
  - [x] 1.2 Create servicePhotos table
    - Define table with service_log_id, customer_id, category, storage_id, timestamp, location fields
    - Add indexes for by_service_log and by_customer queries
    - _Requirements: 1.5, 2.1_
  - [x] 1.3 Update serviceLogs mutations for time tracking
    - Modify create mutation to accept start_time, end_time
    - Add duration calculation on save
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Implement offline storage service
  - [x] 2.1 Create IndexedDB wrapper for photo storage
    - Implement database initialization with photos object store
    - Add savePhoto, getPhotos, deletePhoto methods
    - _Requirements: 6.1_
  - [x] 2.2 Create localStorage wrapper for time tracking state
    - Implement saveTimeState, getTimeState, clearTimeState methods
    - Add cleanup for stale entries (older than 24h)
    - _Requirements: 3.5, 6.2_
  - [x] 2.3 Write property tests for offline storage
    - **Property 3: Photo Persistence Round-Trip**
    - **Validates: Requirements 1.5, 6.1**

- [x] 3. Implement photo capture utilities
  - [x] 3.1 Create photo metadata types and validation
    - Define CapturedPhoto, GeoLocation interfaces
    - Implement validatePhotoMetadata function
    - _Requirements: 2.1, 2.2_
  - [x] 3.2 Create geolocation utility
    - Implement getCurrentLocation with permission handling
    - Add fallback for denied/unavailable location
    - _Requirements: 1.3, 1.4_
  - [x] 3.3 Create timestamp utility
    - Implement generateTimestamp in ISO 8601 format
    - Add validateTimestampWithinRange function
    - _Requirements: 1.2, 2.2_
  - [x] 3.4 Write property tests for photo utilities
    - **Property 1: Photo Metadata Completeness**
    - **Property 2: Timestamp Validation**
    - **Validates: Requirements 1.2, 2.1, 2.2**

- [x] 4. Implement time tracking hook
  - [x] 4.1 Create useTimeTracker hook
    - Implement startTracking, stopTracking functions
    - Add duration calculation and display formatting
    - Persist state to localStorage on changes
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 4.2 Add timezone conversion utilities
    - Store times in UTC
    - Display in user's local timezone
    - _Requirements: 3.6_
  - [x] 4.3 Write property tests for time tracking
    - **Property 5: Time Tracking Duration Calculation**
    - **Property 6: Time Storage in UTC**
    - **Validates: Requirements 3.3, 3.6**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create PhotoCapture component
  - [x] 6.1 Implement camera access and capture UI
    - Create component with before/after category selection
    - Implement camera stream access with permission handling
    - Add capture button and preview
    - _Requirements: 1.1, 1.3_
  - [x] 6.2 Integrate metadata attachment
    - Attach timestamp on capture
    - Request and attach geolocation
    - Store to IndexedDB immediately
    - _Requirements: 1.2, 1.3, 1.5_
  - [x] 6.3 Add multiple photo support
    - Allow capturing multiple photos per category
    - Display photo count indicator
    - _Requirements: 1.6_

- [x] 7. Create PhotoGallery component
  - [x] 7.1 Implement photo display grid
    - Show thumbnails with metadata overlay
    - Display timestamp and location for each photo
    - _Requirements: 1.7, 2.3_
  - [x] 7.2 Add photo deletion capability
    - Implement delete button with confirmation
    - Remove from IndexedDB and update count
    - _Requirements: 1.6_

- [x] 8. Create ProofStatus indicator component
  - [x] 8.1 Implement status badge display
    - Show photo count indicator
    - Show time tracking indicator
    - Show sync status (synced/pending/failed)
    - _Requirements: 4.3, 6.4_
  - [x] 8.2 Write property tests for sync status
    - **Property 10: Sync Status Accuracy**
    - **Validates: Requirements 6.4**

- [x] 9. Integrate proof-of-service into NewServiceLog page
  - [x] 9.1 Add TimeTracker integration
    - Start tracking on component mount
    - Stop tracking on form submit
    - Display elapsed time during service
    - _Requirements: 3.1, 3.2_
  - [x] 9.2 Add PhotoCapture sections
    - Add before photos section at top
    - Add after photos section before submit
    - Show photo gallery for captured photos
    - _Requirements: 1.1, 1.6, 1.7_
  - [x] 9.3 Update form submission to include proof data
    - Include start_time, end_time, duration_ms
    - Include photo_count, has_before_photos, has_after_photos
    - _Requirements: 3.1, 3.2, 4.1_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement photo sync to Convex
  - [x] 11.1 Create servicePhotos mutations
    - Implement uploadPhoto mutation with file storage
    - Implement getPhotosByServiceLog query
    - Implement deletePhoto mutation
    - _Requirements: 1.5, 2.4_
  - [x] 11.2 Create sync service
    - Implement background sync for pending photos
    - Handle sync failures with retry logic
    - Update sync status in IndexedDB
    - _Requirements: 6.3, 6.4_
  - [x] 11.3 Write property tests for photo immutability
    - **Property 11: Photo Metadata Immutability**
    - **Validates: Requirements 2.4**

- [x] 12. Implement service visit summary
  - [x] 12.1 Create summary generation function
    - Generate summary with all required fields
    - Include proof-of-service metadata
    - _Requirements: 4.1, 4.2_
  - [x] 12.2 Update service history display
    - Add proof-of-service indicators to history cards
    - Show duration, photo count on each entry
    - _Requirements: 4.3_
  - [x] 12.3 Write property tests for summary completeness
    - **Property 7: Service Summary Completeness**
    - **Validates: Requirements 4.2, 4.5**

- [x] 13. Implement proof-of-service filtering
  - [x] 13.1 Add filter options to service history
    - Add filter for "has photos"
    - Add filter for "has time tracking"
    - Add filter for "complete proof"
    - _Requirements: 4.4_
  - [x] 13.2 Write property tests for filter accuracy
    - **Property 9: Proof-of-Service Filter Accuracy**
    - **Validates: Requirements 4.4**

- [x] 14. Implement business settings for requirements
  - [x] 14.1 Add proof-of-service settings to business schema
    - Add require_photos setting
    - Add per-service-type requirements
    - _Requirements: 5.1, 5.3_
  - [x] 14.2 Implement requirement validation
    - Check requirements before allowing service completion
    - Display clear error messages for missing requirements
    - _Requirements: 5.2, 5.4_
  - [x] 14.3 Write property tests for requirement enforcement
    - **Property 8: Requirement Enforcement**
    - **Validates: Requirements 5.2, 5.4**

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation uses React with TypeScript for type safety
- Convex is used for backend storage and real-time sync
- IndexedDB provides offline photo storage
- localStorage provides lightweight time tracking state persistence
