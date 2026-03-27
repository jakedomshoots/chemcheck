import { describe, expect, it } from "vitest";
import {
  getStaleUnreferencedStorageIds,
  shouldAllowUnauthenticatedPhotoUpload,
} from "./servicePhotos";

describe("servicePhotos security helpers", () => {
  it("requires an explicit flag for unauthenticated uploads", () => {
    expect(
      shouldAllowUnauthenticatedPhotoUpload({
        CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD: "true",
      })
    ).toBe(true);

    expect(
      shouldAllowUnauthenticatedPhotoUpload({
        NODE_ENV: "development",
      })
    ).toBe(false);
  });

  it("finds stale unreferenced storage objects older than the ttl", () => {
    const staleIds = getStaleUnreferencedStorageIds({
      storageFiles: [
        { _id: "storage-1", _creationTime: 1000 },
        { _id: "storage-2", _creationTime: 5000 },
      ],
      referencedStorageIds: new Set(["storage-2"]),
      now: 10000,
      ttlMs: 3000,
    });

    expect(staleIds).toEqual(["storage-1"]);
  });
});
