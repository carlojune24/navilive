import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex h-7 w-12 shrink-0 items-center border-2 border-ink p-0.5 transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-ink data-[state=unchecked]:bg-sheet",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-sheet data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-ink"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
