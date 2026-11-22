import { MIN_HOUSEHOLDS_PER_HEX } from "@second-home/shared";

// Placeholder page. The read-only H3 discovery map is built in Step 4.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-3xl font-bold">Second Home</h1>
      <p>Gujarat → San Antonio</p>
      <p className="text-sm text-zinc-500">k-anonymity threshold: {MIN_HOUSEHOLDS_PER_HEX}</p>
    </main>
  );
}
