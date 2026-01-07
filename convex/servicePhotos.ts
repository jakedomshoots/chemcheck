import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { enforceRateLimit } from "./rateLimit";

/**
 * Service Photos mutations and queries for Proof of Service feature
 * Requirements: 1.5 - Store photos securely with associated service log
 * Requirements: 2.4 - Prevent modification of photo metadata after capture
 */

// Helper: Verify service log ownership
async function verifyServiceLogOwnership(
  ctx: any,
  serviceLogId: Id<"serviceLogs">,
  userEmail: string
): Promise<{ serviceLog: any; customer: any }> {
  const serviceLog = await ctx.db.get(serviceLogId);
  if (!serviceLog) {
    throw new Error("Service log not found");
  }

  const customer = await ctx.db.get(serviceLog.customer_id);
  if (!customer || customer.created_by !== userEmail) {
    throw new Error("Access denied");
  }

  return { serviceLog, customer };
}

// Helper: Verify customer ownership
async function verifyCustomerOwnership(
  ctx: any,
  customerId: Id<"customers">,
  userEmail: string
): Promise<any> {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.created_by !== userEmail) {
    throw new Error("Customer not found or access denied");
  }
  return customer;
}

/**
 * Generate a URL for uploading a photo to Convex storage
 * Returns a temporary upload URL that can be used to upload the photo data
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Upload a photo and create a servicePhotos record
 * Requirements: 1.5 - Store photos securely with associated service log
 * Requirements: 2.4 - Metadata is set at creation and cannot be modified
 */
export const uploadPhoto = mutation({
  args: {
    service_log_id: v.id("serviceLogs"),
    customer_id: v.id("customers"),
    storage_id: v.id("_storage"),
    category: v.string(),
    timestamp: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    accuracy: v.optional(v.number()),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Enforce rate limiting
    enforceRateLimit(identity.email!, 'serviceLog.create');

    // Verify ownership of service log and customer
    await verifyServiceLogOwnership(ctx, args.service_log_id, identity.email!);
    await verifyCustomerOwnership(ctx, args.customer_id, identity.email!);

    // Validate category
    if (args.category !== "before" && args.category !== "after") {
      throw new Error('Category must be "before" or "after"');
    }

    // Validate timestamp format (ISO 8601)
    const timestampDate = new Date(args.timestamp);
    if (isNaN(timestampDate.getTime())) {
      throw new Error("Invalid timestamp format. Expected ISO 8601.");
    }

    // Validate storage_id exists before creating photo record
    // This prevents orphaned metadata referencing non-existent files
    const storageUrl = await ctx.storage.getUrl(args.storage_id);
    if (!storageUrl) {
      throw new Error("Invalid storage_id: file does not exist in storage");
    }

    // Create the photo record
    const photoId = await ctx.db.insert("servicePhotos", {
      service_log_id: args.service_log_id,
      customer_id: args.customer_id,
      storage_id: args.storage_id,
      category: args.category,
      timestamp: args.timestamp,
      latitude: args.latitude,
      longitude: args.longitude,
      accuracy: args.accuracy,
      address: args.address,
      created_at: Date.now(),
    });

    // Update photo counts on the service log
    await updateServiceLogPhotoCounts(ctx, args.service_log_id);

    return photoId;
  },
});

/**
 * Get all photos for a service log
 * Requirements: 1.7 - Display all associated photos with timestamps and location data
 * 
 * Note: Throws an error if any photo's storage file is missing to surface data integrity issues.
 * This is consistent with getPhoto behavior.
 */
export const getPhotosByServiceLog = query({
  args: { service_log_id: v.id("serviceLogs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Verify ownership
    await verifyServiceLogOwnership(ctx, args.service_log_id, identity.email!);

    const photos = await ctx.db
      .query("servicePhotos")
      .withIndex("by_service_log", (q) => q.eq("service_log_id", args.service_log_id))
      .collect();

    // Get URLs for each photo
    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => {
        const url = await ctx.storage.getUrl(photo.storage_id);

        // Throw error if storage file is missing to surface data integrity issues
        // This is consistent with getPhoto behavior
        if (!url) {
          throw new Error(
            `Photo storage file not found for photo ${photo._id}. ` +
            `The file may have been deleted or expired. storage_id: ${photo.storage_id}`
          );
        }

        return {
          ...photo,
          url,
        };
      })
    );

    return photosWithUrls;
  },
});

/**
 * Get all photos for a customer
 * 
 * Note: Throws an error if any photo's storage file is missing to surface data integrity issues.
 * This is consistent with getPhoto behavior.
 */
export const getPhotosByCustomer = query({
  args: { customer_id: v.id("customers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Verify ownership
    await verifyCustomerOwnership(ctx, args.customer_id, identity.email!);

    const photos = await ctx.db
      .query("servicePhotos")
      .withIndex("by_customer", (q) => q.eq("customer_id", args.customer_id))
      .collect();

    // Get URLs for each photo
    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => {
        const url = await ctx.storage.getUrl(photo.storage_id);

        // Throw error if storage file is missing to surface data integrity issues
        // This is consistent with getPhoto behavior
        if (!url) {
          throw new Error(
            `Photo storage file not found for photo ${photo._id}. ` +
            `The file may have been deleted or expired. storage_id: ${photo.storage_id}`
          );
        }

        return {
          ...photo,
          url,
        };
      })
    );

    return photosWithUrls;
  },
});

/**
 * Get a single photo by ID
 */
export const getPhoto = query({
  args: { photo_id: v.id("servicePhotos") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const photo = await ctx.db.get(args.photo_id);
    if (!photo) {
      throw new Error("Photo not found");
    }

    // Verify ownership through customer
    await verifyCustomerOwnership(ctx, photo.customer_id, identity.email!);

    const url = await ctx.storage.getUrl(photo.storage_id);

    // Handle case where storage file no longer exists
    if (!url) {
      throw new Error("Photo storage file not found. The file may have been deleted or expired.");
    }

    return {
      ...photo,
      url,
    };
  },
});

/**
 * Delete a photo
 * Requirements: 1.6 - Support deleting photos
 */
export const deletePhoto = mutation({
  args: { photo_id: v.id("servicePhotos") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Enforce rate limiting
    enforceRateLimit(identity.email!, 'serviceLog.delete');

    const photo = await ctx.db.get(args.photo_id);
    if (!photo) {
      throw new Error("Photo not found");
    }

    // Verify ownership through customer
    await verifyCustomerOwnership(ctx, photo.customer_id, identity.email!);

    // Delete database record first, then storage
    // This ordering ensures that if storage deletion fails, we don't have
    // orphaned metadata pointing to a deleted file. If db deletion succeeds
    // but storage deletion fails, we have an orphaned file (recoverable)
    // rather than orphaned metadata (data integrity issue).
    const serviceLogId = photo.service_log_id;
    const storageId = photo.storage_id;

    await ctx.db.delete(args.photo_id);

    try {
      await ctx.storage.delete(storageId);
    } catch (storageError) {
      // Log the inconsistency - storage file may be orphaned
      // This is safer than the reverse (orphaned metadata pointing to deleted file)
      console.error(
        `Storage deletion failed after db record deleted. Orphaned storage_id: ${storageId}`,
        storageError
      );
      // Don't re-throw - the photo record is already deleted, which is the primary goal
    }

    // Update photo counts on the service log
    await updateServiceLogPhotoCounts(ctx, serviceLogId);
  },
});

/**
 * Helper function to update photo counts on a service log
 */
async function updateServiceLogPhotoCounts(
  ctx: any,
  serviceLogId: Id<"serviceLogs">
): Promise<void> {
  const photos = await ctx.db
    .query("servicePhotos")
    .withIndex("by_service_log", (q: any) => q.eq("service_log_id", serviceLogId))
    .collect();

  const beforePhotos = photos.filter((p: any) => p.category === "before");
  const afterPhotos = photos.filter((p: any) => p.category === "after");

  await ctx.db.patch(serviceLogId, {
    photo_count: photos.length,
    has_before_photos: beforePhotos.length > 0,
    has_after_photos: afterPhotos.length > 0,
  });
}
