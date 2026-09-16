import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from 'cn'

function Accordion({
  className,
  // Base UI defaults to single-open; the spec wants multi-open rows.
  multiple = true,
  ...props
}: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('w-full', className)}
      multiple={multiple}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('group/accordion-item border-b last:border-b-0', className)}
      {...props}
    />
  )
}

function AccordionHeader({ className, ...props }: AccordionPrimitive.Header.Props) {
  return (
    <AccordionPrimitive.Header
      data-slot="accordion-header"
      className={cn('flex', className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Trigger
      data-slot="accordion-trigger"
      className={cn(
        'group/accordion-trigger flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]/accordion-trigger:rotate-180"
      />
    </AccordionPrimitive.Trigger>
  )
}

function AccordionContent({
  className,
  keepMounted = true,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      // Editors inside (e.g. OccasionPrefsEditor) keep uncontrolled inputs
      // alive while the row is collapsed.
      keepMounted={keepMounted}
      className={cn('text-sm', className)}
      {...props}
    />
  )
}

export { Accordion, AccordionItem, AccordionHeader, AccordionTrigger, AccordionContent }
