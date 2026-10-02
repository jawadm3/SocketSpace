/**
 * Where a browser loads an avatar from. Generated avatars come from our own `/api/avatar`, which
 * renders the saved settings to SVG (no third-party request, D-023); photos from their storage URL.
 * The settings travel in the URL, so the same avatar is the same URL and is cached for good.
 */
import type { AvatarConfig, AvatarWire } from '@socketspace/shared/profile';

function base64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function encodeAvatarConfig(config: AvatarConfig): string {
  return base64Url(JSON.stringify(config));
}

export function avatarSrc(avatar: AvatarWire | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.kind === 'photo') return avatar.url;
  return `/api/avatar?c=${encodeAvatarConfig(avatar.config)}`;
}
