import { Field } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FileTextIcon, ImageIcon, ArchiveIcon } from "lucide-react"

const categories = [
  {
    value: "documents",
    label: "Documents",
    icon: (
      <FileTextIcon className="size-4" />
    ),
  },
  {
    value: "images",
    label: "Images",
    icon: (
      <ImageIcon className="size-4" />
    ),
  },
  {
    value: "archives",
    label: "Archives",
    icon: (
      <ArchiveIcon className="size-4" />
    ),
  },
]

export function Pattern() {
  return (
    <Field className="max-w-xs">
      <Select defaultValue={categories[0]} items={categories}>
        <SelectTrigger className="w-[200px]">
          <SelectValue>
            {(item: (typeof categories)[number]) => (
              <span className="flex items-center gap-2">
                {item.icon}
                <span>{item?.label}</span>
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {categories.map((category) => (
              <SelectItem key={category.value} value={category}>
                <span className="flex items-center gap-2">
                  {category.icon}
                  <span>{category.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}