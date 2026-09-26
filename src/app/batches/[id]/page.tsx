import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getBatchView } from "@/lib/batches";
import { BatchStatus } from "./BatchStatus";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const view = await getBatchView(id, user.id);
  if (!view) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <Link href="/dashboard" className="self-start text-sm text-[var(--signal)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--signal)]">
        ← Dashboard
      </Link>
      <BatchStatus initial={view} />
    </main>
  );
}
