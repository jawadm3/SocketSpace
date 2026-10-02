/**
 * Renders DiceBear avatars on the server, from a saved settings object (D-023). The result is an
 * SVG `data:` URI shown with <img>, so viewing an avatar makes no request to any third party, and
 * an SVG inside <img> cannot run scripts.
 *
 * Browsers get avatars either as these data URIs (onboarding) or from `/api/avatar`, which renders
 * the same SVG on our own server, so no third party is ever involved.
 */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { Avatar, Style } from '@dicebear/core';
import critters from '@dicebear/styles/critters.json';
import lorelei from '@dicebear/styles/lorelei.json';
import notionists from '@dicebear/styles/notionists.json';
import openPeeps from '@dicebear/styles/open-peeps.json';
import pixelArt from '@dicebear/styles/pixel-art.json';
import thumbs from '@dicebear/styles/thumbs.json';

import type { AvatarConfig, AvatarStyle } from '@socketspace/shared/profile';

/** The styles the preset gallery offers (all CC0 1.0): 6 styles x 4 = 24 presets (PROF-06). */
export const GALLERY_STYLES = [
  'notionists',
  'lorelei',
  'open-peeps',
  'pixel-art',
  'thumbs',
  'critters',
] as const satisfies readonly AvatarStyle[];
export type GalleryStyle = (typeof GALLERY_STYLES)[number];

const styles: Record<GalleryStyle, Style> = {
  notionists: new Style(notionists),
  lorelei: new Style(lorelei),
  thumbs: new Style(thumbs),
  'open-peeps': new Style(openPeeps),
  'pixel-art': new Style(pixelArt),
  critters: new Style(critters),
};

export function isGalleryStyle(style: string): style is GalleryStyle {
  return (GALLERY_STYLES as readonly string[]).includes(style);
}

/**
 * Only a style's own look options are passed on to DiceBear (`hairVariant`, `skinColor`,
 * `glassesProbability`, ...). General options such as `title` (text placed inside the SVG) are
 * dropped, so a saved avatar can only change how the picture looks.
 */
const LOOK_OPTION = /^[a-z][A-Za-z0-9]*(?:Variant|Color|Probability)$/;

function lookOptions(options: AvatarConfig['options']): Record<string, unknown> {
  if (!options) return {};
  return Object.fromEntries(Object.entries(options).filter(([key]) => LOOK_OPTION.test(key)));
}

function render(config: AvatarConfig, size: number): Avatar | null {
  if (!isGalleryStyle(config.style)) return null;
  try {
    const options = { ...lookOptions(config.options), seed: config.seed, size };
    return new Avatar(styles[config.style], options);
  } catch {
    // An option DiceBear does not accept: show the fallback instead of failing the page.
    return null;
  }
}

/** An SVG data URI for `config`, or `null` if its style is not available. */
export function renderAvatar(config: AvatarConfig, size = 96): string | null {
  return render(config, size)?.toDataUri() ?? null;
}

/** The SVG markup for `config` (for `/api/avatar`), or `null`. */
export function renderAvatarSvg(config: AvatarConfig, size = 96): string | null {
  return render(config, size)?.toString() ?? null;
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
