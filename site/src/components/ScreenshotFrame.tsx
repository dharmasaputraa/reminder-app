export function ScreenshotFrame({ label }: { label: string }) {
  return (
    <div className="rounded-xl bg-carbon p-6 shadow-card-inset">
      <div className="flex items-center gap-1.5 pb-4">
        <span className="size-2.5 rounded-full bg-graphite" />
        <span className="size-2.5 rounded-full bg-graphite" />
        <span className="size-2.5 rounded-full bg-graphite" />
      </div>
      <div className="flex min-h-[280px] items-center justify-center rounded-md bg-obsidian px-6 py-16">
        <p className="text-caption text-fog">{label}</p>
      </div>
    </div>
  );
}
