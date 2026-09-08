import type { User } from "@tracklane/domain";
import { CircleDashed } from "lucide-react";
import { initials } from "@/lib/issues";
import { cn } from "@/lib/utils";

const sizes = { xs: "size-5 text-[0.5625rem]", sm: "size-6 text-[0.625rem]", md: "size-8 text-caption" } as const;

export function UserAvatar({
  user,
  size = "sm",
  className,
}: {
  user: Pick<User, "name" | "avatarHue"> | undefined;
  size?: keyof typeof sizes;
  className?: string;
}) {
  if (!user) {
    return <CircleDashed aria-label="Unassigned" strokeWidth={1.5} className={cn("shrink-0 text-muted-foreground", sizes[size], className)} />;
  }
  return (
    <span
      role="img"
      aria-label={user.name}
      title={user.name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none", sizes[size], className)}
      style={{ backgroundColor: `oklch(0.62 0.13 ${user.avatarHue})` }}
    >
      {initials(user.name)}
    </span>
  );
}
