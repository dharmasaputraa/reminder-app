import { cn } from 'cn'
import type { Channel } from '@/lib/api'
import { ChannelIcon } from '@/lib/channel-icons'

/** One selectable channel: stacked brand mark + name, state carried by the
 *  chip styling (no checkbox). Same component for occasion-level and
 *  contact-level channel selection. */
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
        'flex w-20 flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        checked ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <ChannelIcon type={channel.type} className="size-4" />
      <span className="w-full truncate text-center">{channel.name}</span>
    </button>
  )
}
