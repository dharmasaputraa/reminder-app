import { motion } from "motion/react";
import { Button } from "../components/Button";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import calendarHeroShot from "../assets/shots/calendar-hero.png";

const REPO = "https://github.com/dharmasaputraa/wiminder";

export function Hero() {
  return (
    <section className="relative mx-auto w-full max-w-[1200px] overflow-x-clip px-6 pb-[96px] pt-[96px]">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="max-w-[720px]"
      >
        <p className="mb-5 font-mono text-[12px] tracking-[-0.013em] text-fog">
          self-hosted · docker · single binary
        </p>
        <h1 className="text-[40px] font-[510] leading-none tracking-[-0.022em] text-paper md:text-[64px]">
          Never miss an otonan again
        </h1>
        <p className="mt-6 max-w-[560px] text-[16px] leading-[1.5] text-fog">
          wiminder watches the 210-day pawukon cycle for every birth date you
          add, and delivers each otonan, birthday, and anniversary via Gotify,
          Telegram, or email — from one container on your own server.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" href="#deploy">
            Get started
          </Button>
          <Button href={REPO}>View source</Button>
        </div>
      </motion.div>

      {/* The exact calendar from the app, bleeding slightly past the column —
          the style reference's product-screenshot-first hero. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        className="relative mt-16 md:-mx-6 lg:-mx-12"
      >
        {/* Hero gradient floor — the only gradient on the page */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,rgba(8,9,10,0)_10%,rgba(208,214,224,0.13)_100%)]"
        />
        <ScreenshotFrame
          src={calendarHeroShot}
          label="The wiminder calendar — September 2026 with otonan badges and the family agenda"
          loading="eager"
        />
      </motion.div>
    </section>
  );
}
