/**
 * Where a browser loads an avatar from. Generated avatars come from our own `/api/avatar`, which
 * renders the saved settings to SVG (no third-party request, D-023); photos from our own
 * `/api/media/<id>`, which serves the stored, re-encoded picture (PROF-08).
 * The settings travel in the URL, so the same avatar is the same URL and is cached for good.
 */
import type { AvatarConfig, AvatarWire } from '@socketspace/shared/profile';

function base64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * One avatar, one URL: the settings are written in a fixed order (the database stores them as
 * jsonb, which reorders keys), so every device asks for, and caches, the same address.
 */
export function encodeAvatarConfig(config: AvatarConfig): string {
  const options = config.options
    ? Object.fromEntries(Object.entries(config.options).sort(([a], [b]) => a.localeCompare(b)))
    : undefined;
  return base64Url(
    JSON.stringify(
      options === undefined
        ? { style: config.style, seed: config.seed }
        : { style: config.style, seed: config.seed, options },
    ),
  );
}

export function avatarSrc(avatar: AvatarWire | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.kind === 'photo') return avatar.url;
  return `/api/avatar?c=${encodeAvatarConfig(avatar.config)}`;
}
