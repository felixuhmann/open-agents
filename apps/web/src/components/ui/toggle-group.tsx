import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("inline-flex w-fit items-center", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "rounded-none border-l-0 first:border-l data-[state=on]:bg-muted data-[state=on]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
