import { MailIcon, MessageSquareIcon, SendIcon, type LucideIcon } from 'lucide-react'

/** Per-channel-type icon. gotify has no dedicated glyph — a plain message
 *  square stands in for it and for any unknown type. */
export function channelIcon(type: string): LucideIcon {
  switch (type) {
    case 'email':
      return MailIcon
    case 'telegram':
      return SendIcon
    default:
      return MessageSquareIcon
  }
}
