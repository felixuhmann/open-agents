import type { ComponentProps } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FallbackLogo } from "@/components/FallbackLogo";
import { avatarSrc } from "@/lib/queries";
import { cn } from "@/lib/utils";

type AgentAvatarProps = ComponentProps<typeof Avatar> & {
  avatar: string | null | undefined;
  displayName: string;
  /** Tailwind size class for the fallback mark inside the circle. */
  logoClassName?: string;
};

/**
 * Agent profile picture with the shared fallback mark when no custom avatar
 * is configured. Avoids the old initials-on-primary-blue treatment.
 */
export function AgentAvatar({
  avatar,
  displayName,
  className,
  logoClassName,
  size,
  ...props
}: AgentAvatarProps) {
  return (
    <Avatar className={className} size={size} {...props}>
      {avatar ? <AvatarImage src={avatarSrc(avatar)} alt={displayName} /> : null}
      <AvatarFallback className="overflow-hidden bg-muted text-foreground">
        <FallbackLogo className={cn("size-[82%]", logoClassName)} />
      </AvatarFallback>
    </Avatar>
  );
}
