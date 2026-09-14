import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/lib/theme"

function Toaster({ ...props }: ToasterProps) {
  const [theme] = useTheme()
  return <Sonner position="top-right" theme={theme} {...props} />
}

export { Toaster }
