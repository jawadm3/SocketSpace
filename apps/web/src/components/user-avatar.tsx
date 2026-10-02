/**
 * A person's picture: a generated avatar from our own /api/avatar, a photo, or, when they have
 * neither, their initial on a coloured tile. Decorative by default (the name is shown next to it).
 */
import type { PublicUser } from '@socketspace/shared/profile';

import { avatarSrc } from '@/lib/avatar-url';

const SIZES = {
  xs: 'h-6 w-6 text-[0.65rem]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
};

export function UserAvatar({
  user,
  size = 'md',
  label,
}: {
  user: Pick<PublicUser, 'nickname' | 'avatar'> | undefined;
  size?: keyof typeof SIZES;
  /** Set when the picture is shown without the name, so screen readers still know who it is. */
  label?: string;
}) {
  const src = avatarSrc(user?.avatar);
  const classes = `${SIZES[size]} shrink-0 rounded-xl bg-surface-2 object-cover`;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- our own SVG endpoint, already tiny
    return <img src={src} alt={label ?? ''} className={classes} loading="lazy" decoding="async" />;
  }
  const initial = (user?.nickname ?? '?').slice(0, 1).toUpperCase();
  return (
    <span
      className={`${classes} inline-flex items-center justify-center bg-accent-soft font-bold text-ink`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {initial}
    </span>
  );
}
