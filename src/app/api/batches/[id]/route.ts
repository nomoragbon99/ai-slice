import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, json } from "@/lib/http";
import { validateSession } from "@/lib/auth/session";
import { getBatchView } from "@/lib/batches";

// Polled by the batch page while work is running. Read-only, own batches only.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await validateSession();
    if (!auth) return errorResponse(401, "UNAUTHENTICATED", "Sign in to view this batch.");

    const { id } = await params;
    // Not a UUID can't be a batch; answering 404 here also keeps Postgres from rejecting the cast.
    if (!z.uuid().safeParse(id).success) return errorResponse(404, "NOT_FOUND", "Batch not found.");

    const view = await getBatchView(id, auth.user.id);
    if (!view) return errorResponse(404, "NOT_FOUND", "Batch not found.");
    return json(200, view);
  } catch (error) {
    console.error("GET /api/batches/[id] failed:", error);
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }
}
