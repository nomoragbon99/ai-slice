import type { NextRequest } from "next/server";
import { aiConfig } from "@/config/ai";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
import { validateSession } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/origin";
import { consume, rateLimitResponse } from "@/lib/security/rate-limit";
import { newReceiptKey, putObject } from "@/lib/storage";
import { checkUploadFiles, detectImageType, EXTENSION_BY_MIME, type AllowedMimeType } from "@/lib/validation/upload";

// Upload one or more receipt images -> one batch. Returns 202 at once: extraction and summary run
// in the background worker, and the client polls GET /api/batches/:id for progress.
export async function POST(request: NextRequest) {
  try {
    const originError = assertSameOrigin(request);
    if (originError) return originError;

    const auth = await validateSession();
    if (!auth) return errorResponse(401, "UNAUTHENTICATED", "Sign in to upload receipts.");

    // Each upload leads to paid model calls, so it is limited per user before any file is read.
    const limit = await consume(`upload:user:${auth.user.id}`, aiConfig.upload.rateLimit);
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse(400, "VALIDATION_ERROR", "Request must be multipart/form-data.");
    }
    const files = form.getAll("files").filter((v): v is File => v instanceof File);

    const check = checkUploadFiles(files);
    if (!check.ok) return errorResponse(400, "VALIDATION_ERROR", check.message);

    // The declared type passed; now check what the bytes actually are.
    const accepted: { file: File; bytes: Uint8Array; mimeType: AllowedMimeType }[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = detectImageType(bytes);
      if (!mimeType) return errorResponse(400, "VALIDATION_ERROR", `${file.name} is not a JPEG, PNG or WebP image.`);
      accepted.push({ file, bytes, mimeType });
    }

    // Files first, then rows: a row never points at a file that doesn't exist. If the insert fails,
    // the written files are orphaned (harmless; see DECISIONS.md), never the reverse.
    const stored: { key: string; file: File; bytes: Uint8Array; mimeType: AllowedMimeType }[] = [];
    for (const item of accepted) {
      const key = newReceiptKey(EXTENSION_BY_MIME[item.mimeType]);
      await putObject(key, item.bytes);
      stored.push({ key, ...item });
    }

    const batch = await db.$transaction(async (tx) => {
      const batch = await tx.batch.create({ data: { userId: auth.user.id } });
      for (const item of stored) {
        await tx.receipt.create({
          data: {
            batchId: batch.id,
            storageKey: item.key,
            mimeType: item.mimeType,
            sizeBytes: item.bytes.byteLength,
            fileName: item.file.name.slice(0, 200),
            jobs: {
              create: { kind: "extract", batchId: batch.id, maxAttempts: aiConfig.jobs.maxAttempts.extract },
            },
          },
        });
      }
      return batch;
    });

    return json(202, { batchId: batch.id });
  } catch (error) {
    console.error("POST /api/receipts failed:", error);
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }
}
