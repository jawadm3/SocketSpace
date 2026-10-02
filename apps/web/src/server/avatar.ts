/**
 * Renders DiceBear avatars on the server, from a saved settings object (D-023). The result is an
 * SVG `data:` URI shown with <img>, so viewing an avatar makes no request to any third party, and
 * an SVG inside <img> cannot run scripts.
 *
 * Stage C offers a small preset gallery; Stage D adds every CC0 style and the builder.
 */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { Avatar, Style } from '@dicebear/core';
import lorelei from '@dicebear/styles/lorelei.json';
import notionists from '@dicebear/styles/notionists.json';
import openPeeps from '@dicebear/styles/open-peeps.json';
import thumbs from '@dicebear/styles/thumbs.json';

import type { AvatarConfig, AvatarStyle } from '@socketspace/shared/profile';

/** The styles the Stage C preset gallery offers (all CC0 1.0). */
export const GALLERY_STYLES = [
  'notionists',
  'lorelei',
  'thumbs',
  'open-peeps',
] as const satisfies readonly AvatarStyle[];
export type GalleryStyle = (typeof GALLERY_STYLES)[number];

const styles: Record<GalleryStyle, Style> = {
  notionists: new Style(notionists),
  lorelei: new Style(lorelei),
  thumbs: new Style(thumbs),
  'open-peeps': new Style(openPeeps),
};

export function isGalleryStyle(style: string): style is GalleryStyle {
  return (GALLERY_STYLES as readonly string[]).includes(style);
}

/** An SVG data URI for `config`, or `null` if its style is not available yet. */
export function renderAvatar(config: AvatarConfig, size = 96): string | null {
  if (!isGalleryStyle(config.style)) return null;
  return new Avatar(styles[config.style], { seed: config.seed, size }).toDataUri();
}

export interface PresetAvatar {
  config: AvatarConfig;
  dataUri: string;
}

/** A fresh set of presets: `perStyle` random seeds for each gallery style. */
export function presetGallery(perStyle = 4): PresetAvatar[] {
  return GALLERY_STYLES.flatMap((style) =>
    Array.from({ length: perStyle }, () => {
      const config: AvatarConfig = { style, seed: randomBytes(6).toString('hex') };
      return { config, dataUri: renderAvatar(config) ?? '' };
    }),
  );
}
