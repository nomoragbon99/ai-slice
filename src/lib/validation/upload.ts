import { aiConfig } from "@/config/ai";

export type AllowedMimeType = (typeof aiConfig.upload.allowedMimeTypes)[number];

export const EXTENSION_BY_MIME: Record<AllowedMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// The browser's declared type is whatever the client says; the first bytes are what the file is.
// Only the three formats the vision model is sent are recognised.
export function detectImageType(bytes: Uint8Array): AllowedMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return "image/png";
  }
  // "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export type UploadFileCheck = { ok: true } | { ok: false; message: string };

// Shared by the upload form (instant feedback) and the route handler (the check that counts).
// Works on anything File-like so it runs in the browser and on the server.
export function checkUploadFiles(files: { name: string; size: number; type: string }[]): UploadFileCheck {
  const { maxFiles, maxFileBytes, allowedMimeTypes } = aiConfig.upload;
  if (files.length === 0) return { ok: false, message: "Choose at least one receipt image." };
  if (files.length > maxFiles) return { ok: false, message: `Upload at most ${maxFiles} receipts at a time.` };
  for (const file of files) {
    if (file.size === 0) return { ok: false, message: `${file.name} is empty.` };
    if (file.size > maxFileBytes) {
      return { ok: false, message: `${file.name} is larger than ${maxFileBytes / (1024 * 1024)} MB.` };
    }
    if (!(allowedMimeTypes as readonly string[]).includes(file.type)) {
      return { ok: false, message: `${file.name} must be a JPEG, PNG or WebP image.` };
    }
  }
  return { ok: true };
}
