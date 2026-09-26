import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SignOutButton } from "./SignOutButton";
import { UploadForm } from "./UploadForm";

// Layer 2 of 2: the real session check (proxy.ts only checks that a cookie exists).
export const dynamic = "force-dynamic";

const RECENT_BATCHES = 10;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const batches = await db.batch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: RECENT_BATCHES,
    include: { _count: { select: { receipts: true } } },
  });

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <p className="text-[15px]">
          Signed in as <span className="font-medium">{user.name}</span>
        </p>
        <SignOutButton />
      </header>

      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Upload receipts</h1>
        <UploadForm />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Recent uploads</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-[var(--slate)]">No uploads yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/batches/${b.id}`} className="text-[var(--signal)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--signal)]">
                  {b.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                </Link>{" "}
                <span className="text-[var(--slate)]">
                  · {b._count.receipts} receipt{b._count.receipts === 1 ? "" : "s"} · {b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
