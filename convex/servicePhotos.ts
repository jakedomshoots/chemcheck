import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { enforceRateLimit } from "./rateLimit";
import { FIELD_WRITE_ROLES, assertCustomerAccess } from "./access";

const runtimeEnv =
  process.env.CONVEX_DEPLOYMENT_ENV ||
  process.env.VERCEL_ENV ||
  process.env.NODE_ENV;
const allowUnauthenticatedPhotoUpload =
  process.env.CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD === "true" &&
  runtimeEnv !== "production";

/**
 * Service Photos mutations and queries for Proof of Service feature
 * Requirements: 1.5 - Store photos securely with associated service log
 * Requirements: 2.4 - Prevent modification of photo metadata after capture
 */

// Helper: Verify service log access (customer creator or active team member)
async function verifyServiceLogOwnership(
  ctx: any,
  serviceLogId: Id<"serviceLogs">,
  userEmail: string,
  write = false
): Promise<{ serviceLog: any; customer: any }> {
  const serviceLog = await ctx.db.get(serviceLogId);
  if (!serviceLog) {
    throw new Error("Service log not found");
  }

  let customer: any;
  try {
    ({ customer } = await assertCustomerAccess(
      ctx,
      serviceLog.customer_id,
      userEmail,
      write ? { roles: FIELD_WRITE_ROLES } : {}
    ));
  } catch (error) {
    if (error instanceof Error && error.message === "Insufficient role permissions") throw error;
    throw new Error("Access denied");
  }

  return { serviceLog, customer };
}

// Helper: Verify service log belongs to customer (for limited unauthenticated flows)
async function verifyServiceLogCustomerLink(
  ctx: any,
  serviceLogId: Id<"serviceLogs">,
  customerId: Id<"customers">
): Promise<{ serviceLog: any; customer: any }> {
  const serviceLog = await ctx.db.get(serviceLogId);
  if (!serviceLog) {
    throw new Error("Service log not found");
  }

  const customer = await ctx.db.get(customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }

  if (serviceLog.customer_id !== customerId) {
    throw new Error("Service log does not belong to customer");
  }

  return { serviceLog, customer };
}

// Helper: Verify customer access (creator or active team member)
async function verifyCustomerOwnership(
  ctx: any,
  customerId: Id<"customers">,
  userEmail: string,
  write = false
): Promise<any> {
  const { customer } = await assertCustomerAccess(
    ctx,
    customerId,
    userEmail,
    write ? { roles: FIELD_WRITE_ROLES } : {}
  );
  return customer;
}

/**
 * A storage file may back at most one photo record. Without this, a caller
 * could reference another tenant's storage id and later delete it.
 */
async function assertStorageIdUnclaimed(ctx: any, storageId: Id<"_storage">): Promise<void> {
  const existing = await ctx.db
    .query("servicePhotos")
    .withIndex("by_storage_id", (q: any) => q.eq("storage_id", storageId))
    .first();
  if (existing) {
    throw new Error("Invalid storage_id: file is already attached to a photo");
  }
}

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/**
 * Generate a URL for uploading a photo to Convex storage
 * Returns a temporary upload URL that can be used to upload the photo data
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity && !allowUnauthenticatedPhotoUpload) {
      throw new Error("Not authenticated");
    }
    // In dev/auth-bypass flows identity may be absent; ownership is enforced when
    // the uploadPhoto record is created.
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
    if (identity) {
      // Enforce rate limiting (database-backed for distributed rate limiting)
      await enforceRateLimit(ctx, identity.email!, 'serviceLog.create');

      // Verify access to the service log and that it belongs to the given customer
      const { serviceLog } = await verifyServiceLogOwnership(ctx, args.service_log_id, identity.email!, true);
      if (serviceLog.customer_id !== args.customer_id) {
        throw new Error("Service log does not belong to customer");
      }
    } else {
      if (!allowUnauthenticatedPhotoUpload) {
        throw new Error("Not authenticated");
      }
      // Limited fallback for auth-bypass/dev workflows:
      // still enforce that the service log and customer are linked.
      await verifyServiceLogCustomerLink(ctx, args.service_log_id, args.customer_id);
    }

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
    const metadata = await ctx.db.system.get(args.storage_id);
    if (!metadata) {
      throw new Error("Invalid storage_id: file does not exist in storage");
    }
    if (typeof metadata.contentType === "string" && metadata.contentType && !metadata.contentType.startsWith("image/")) {
      throw new Error("Invalid storage_id: file is not an image");
    }
    if (typeof metadata.size === "number" && metadata.size > MAX_PHOTO_BYTES) {
      throw new Error("Invalid storage_id: file is too large");
    }

    // A storage file can only be claimed by one photo record.
    await assertStorageIdUnclaimed(ctx, args.storage_id);

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

    // Enforce rate limiting (database-backed for distributed rate limiting)
    await enforceRateLimit(ctx, identity.email!, 'serviceLog.delete');

    const photo = await ctx.db.get(args.photo_id);
    if (!photo) {
      throw new Error("Photo not found");
    }

    // Verify ownership through customer
    await verifyCustomerOwnership(ctx, photo.customer_id, identity.email!, true);

    // Delete database record first, then storage
    // This ordering ensures that if storage deletion fails, we don't have
    // orphaned metadata pointing to a deleted file. If db deletion succeeds
    // but storage deletion fails, we have an orphaned file (recoverable)
    // rather than orphaned metadata (data integrity issue).
    const serviceLogId = photo.service_log_id;
    const storageId = photo.storage_id;

    await ctx.db.delete(args.photo_id);

    // Only delete the file if no other photo record references it (legacy
    // rows could share a storage id before uniqueness was enforced).
    const otherReference = await ctx.db
      .query("servicePhotos")
      .withIndex("by_storage_id", (q) => q.eq("storage_id", storageId))
      .first();

    try {
      if (otherReference) {
        console.warn(`Storage ${storageId} is still referenced by photo ${otherReference._id}; not deleting file.`);
      } else {
        await ctx.storage.delete(storageId);
      }
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
