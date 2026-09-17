/** Brand logos for the channel chips; gotify is the primary brand and also
 *  the fallback for any unrecognized channel type. */
import gotifyLogo from '../assets/gotify-logo.svg'
import telegramLogo from '../assets/telegram-logo.svg'
import gmailLogo from '../assets/gmail-logo.svg'

// eslint-disable-next-line react/only-export-components -- logo map is data, not a component
export const CHANNEL_LOGOS: Record<string, string> = {
  gotify: gotifyLogo,
  telegram: telegramLogo,
  email: gmailLogo,
}

export function ChannelIcon({ type }: { type: string }) {
  return (
    <img
      src={CHANNEL_LOGOS[type] ?? gotifyLogo}
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 object-contain"
      loading="lazy"
    />
  )
}
