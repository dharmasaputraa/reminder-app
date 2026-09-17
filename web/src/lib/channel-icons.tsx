/** Theme-aware brand marks for the channel types: gotify is the primary
 *  brand and the fallback for unknown types. Every mark inherits the text
 *  color (currentColor), so it adapts to the surrounding theme. */
import type { ReactElement } from 'react'

type MarkProps = { className?: string }

/** gotify outline; the source's 1/48 stroke would be a hairline at 16px. */
function GotifyMark({ className }: MarkProps): ReactElement {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={3}
      className={className}
      aria-hidden="true"
    >
      <path d="M32.6319,35.4058c-1.59,2.4228-3.29,5.0352-7.0635,6.1748-3.7828,1.13-9.7585.9672-13.4072-.7183C8.503,39.1673,7.1718,35.94,7.8518,33.4405c.67-2.509,3.3422-4.3,4.5488-6.2247,1.1971-1.9345.929-4.003.6129-5.9183a27.9877,27.9877,0,0,1-.6129-5.0947A10.325,10.325,0,0,1,13.43,12.4655" />
      <path d="M14.5553,12.6116c-6.9429-.4788-1.4364-6.7036.9577-1.9153" />
      <path d="M15.1814,10.1307c4.5488-5.2671,21.4-6.7413,23.0758,6.6658" />
      <path d="M19.8224,7.2726c.1844-1.9982,1.2165-2.1541,2.616-.6717" />
      <path d="M38.2572,16.7965a1.214,1.214,0,0,1,1.312,1.0822,1.3446,1.3446,0,0,1-2.6335,0A1.2174,1.2174,0,0,1,38.2572,16.7965Z" />
      <path d="M37.06,18.3575c-5.5069,3.9549,5.3813,4.1232,2.509-.3855" />
      <path d="M28.6807,11.1751a5.7459,5.7459,0,1,1-5.7459,5.7459A5.7443,5.7443,0,0,1,28.6807,11.1751Z" />
      <path d="M30.596,15.724a1.3227,1.3227,0,1,1-1.197,1.3119A1.2566,1.2566,0,0,1,30.596,15.724Z" />
      <path d="M38.4967,21.148v1.7846" />
      <path d="M36.29,11.2939c2.2266-.7383,4.4755,2.8711,3.03,5.9511" />
      <path d="M26.9282,25.4537,40.0672,22.59a1.3982,1.3982,0,0,1,1.665,1.0666l.0013.006,1.7334,7.9485a1.3982,1.3982,0,0,1-1.063,1.6663L29.2553,36.1411a1.3981,1.3981,0,0,1-1.665-1.0665l-.0013-.0061L25.8556,27.12a1.3983,1.3983,0,0,1,1.0666-1.665Z" />
      <path d="M8.8844,31.3775c-5.77-2.4511-1.072-5.0228.8284-1.03" />
      <path d="M4.5,37.9894q3.1124,2.8729,5.0277-.7183" />
      <path d="M30.9815,37.7684c1.6762-.389,2.225.73,1.53,3.3333" />
      <path d="M23.1742,26.4975q1.1972,2.2889,3.8306.1341" />
      <path d="M26.0472,26.9764l9.0977,3.9647,6.2938-7.8819" />
      <path d="M28.4789,36.09l4.74-5.9877" />
      <path d="M36.56,29.1694l6.6911,3.5083" />
    </svg>
  )
}

/** Simple Icons monochrome glyph (single path, fill inherits currentColor). */
function TelegramMark({ className }: MarkProps): ReactElement {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

/** Simple Icons monochrome glyph (single path, fill inherits currentColor). */
function GmailMark({ className }: MarkProps): ReactElement {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  )
}

const MARKS: Record<string, (props: MarkProps) => ReactElement> = {
  gotify: GotifyMark,
  telegram: TelegramMark,
  email: GmailMark,
}

/** Brand mark for a channel type; unknown types fall back to gotify. */
export function ChannelIcon({ type, className }: { type: string; className?: string }) {
  const Mark = MARKS[type] ?? GotifyMark
  return <Mark className={className ?? 'size-4'} />
}
