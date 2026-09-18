import { ScreenshotFrame } from "../components/ScreenshotFrame";
import contactDetailShot from "../assets/shots/contact-detail.png";
import contactsShot from "../assets/shots/contacts.png";

export function Showcase() {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-6 py-[96px]">
      <p className="mb-8 text-center text-caption text-fog">
        Your whole family's calendar — every otonan, birthday, and holiday in
        one place
      </p>
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 md:grid-cols-2">
        <ScreenshotFrame
          src={contactsShot}
          label="Contacts with countdown badges and occasion chips"
        />
        <ScreenshotFrame
          src={contactDetailShot}
          label="Contact detail — otonan and birthday occasions with pawukon labels"
        />
      </div>
    </section>
  );
}
