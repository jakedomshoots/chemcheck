import { compressImage } from "@/lib/proof-of-service/photoUtils";

export const MAX_TICKET_PHOTOS = 4;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

/** Compresses a picked photo (falls back to the original file if the browser cannot). */
export async function prepareTicketPhoto(file) {
  try {
    const dataUrl = await readAsDataUrl(file);
    const result = await compressImage(dataUrl, { maxWidth: 1600, maxHeight: 1600, quality: 0.8, format: "jpeg" });
    const blob = await dataUrlToBlob(result.dataUrl);
    return { blob, previewUrl: result.dataUrl };
  } catch {
    const previewUrl = typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(file) : "";
    return { blob: file, previewUrl };
  }
}

/** Uploads to a Convex storage upload URL and returns the storage id. */
export async function uploadTicketPhoto(blob, uploadUrl) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  if (!response.ok) {
    throw new Error("Photo upload failed. Check your connection and try again.");
  }
  const body = await response.json();
  if (!body?.storageId) throw new Error("Photo upload failed. Try again.");
  return body.storageId;
}
