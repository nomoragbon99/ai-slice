"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { aiConfig } from "@/config/ai";
import { checkUploadFiles } from "@/lib/validation/upload";

// Same checks as the server (count, size, declared type) for instant feedback; the server
// re-checks everything, including the file's real type from its bytes.
export function UploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const check = checkUploadFiles(files);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    const body = new FormData();
    for (const file of files) body.append("files", file);

    setPending(true);
    try {
      const response = await fetch("/api/receipts", { method: "POST", body });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const retry = response.headers.get("Retry-After");
        setError(
          (data?.error?.message ?? "Upload failed. Please try again.") + (retry ? ` Try again in ${retry} seconds.` : ""),
        );
        setPending(false);
        return;
      }
      router.push(`/batches/${data.batchId}`);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <label htmlFor="receipt-files" className="text-sm text-[var(--slate)]">
        Receipt images (JPEG, PNG or WebP, up to {aiConfig.upload.maxFiles} files,{" "}
        {aiConfig.upload.maxFileBytes / (1024 * 1024)} MB each)
      </label>
      <input
        id="receipt-files"
        name="files"
        type="file"
        multiple
        accept={aiConfig.upload.allowedMimeTypes.join(",")}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="text-sm file:mr-3 file:rounded-md file:border file:border-[var(--line)] file:bg-[var(--mist)] file:px-3 file:py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal)]"
      />
      {error && (
        <p role="alert" className="rounded-md border border-[var(--line)] bg-[var(--mist)] px-3 py-2 text-sm">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-[var(--signal)] px-4 py-2 text-[15px] font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal)] disabled:opacity-50"
      >
        {pending ? "Uploading..." : "Upload and summarise"}
      </button>
    </form>
  );
}
