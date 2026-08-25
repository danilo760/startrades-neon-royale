import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StarTrades Neon Royale" },
      {
        name: "description",
        content: "StarTrades Neon Royale — an empty React starter project.",
      },
      { property: "og:title", content: "StarTrades Neon Royale" },
      {
        property: "og:description",
        content: "StarTrades Neon Royale — an empty React starter project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "StarTrades Neon Royale" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="neon-stage relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div className="neon-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="neon-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 flex flex-col items-center gap-6">
        <span className="neon-chip rounded-full border border-neon-cyan/40 bg-neon-cyan/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.3em] text-neon-cyan">
          React Starter
        </span>
        <h1 className="neon-title text-5xl font-black leading-tight tracking-tight sm:text-7xl">
          StarTrades
          <span className="block neon-accent">Neon Royale</span>
        </h1>
        <p className="max-w-md text-sm text-muted-foreground sm:text-base">
          An empty project ready for you to build on. No database, no
          authentication — just a clean React slate.
        </p>
      </div>
    </main>
  );
}
