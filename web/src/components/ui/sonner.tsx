import { Toaster as Sonner, type ToasterProps } from "sonner"

function Toaster({ ...props }: ToasterProps) {
  return <Sonner position="top-right" {...props} />
}

export { Toaster }
