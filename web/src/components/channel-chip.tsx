import { cn } from 'cn'
import type { Channel } from '@/lib/api'
import { ChannelIcon } from '@/lib/channel-icons'

/** One selectable channel: a horizontal chip — brand mark beside the full
 *  name, which is always visible (the chip sizes to its content, so long
 *  names widen it and the surrounding flex-wrap moves whole chips to the
 *  next line). State carried by the chip styling (no checkbox). Same
 *  component for occasion-level and contact-level channel selection. */
export function ChannelChip({ channel, checked, onToggle, disabled }: {
  channel: Channel
  checked: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        checked ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <ChannelIcon type={channel.type} className="size-4 shrink-0" />
      <span className="whitespace-nowrap">{channel.name}</span>
    </button>
  )
}
