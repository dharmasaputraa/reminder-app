import { ScreenshotFrame } from "../components/ScreenshotFrame";

export function Showcase() {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-6 py-[96px]">
      <p className="mb-8 text-center text-caption text-fog">
        Your whole family's calendar — every otonan, birthday, and holiday in
        one place
      </p>
      <div className="mx-auto max-w-[1040px]">
        <ScreenshotFrame label="contacts & calendar — screenshot coming soon" />
      </div>
    </section>
  );
}
