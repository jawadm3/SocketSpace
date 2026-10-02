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

import { Avatar, OptionsDescriptor, Style } from '@dicebear/core';
import critters from '@dicebear/styles/critters.json';
import lorelei from '@dicebear/styles/lorelei.json';
import notionists from '@dicebear/styles/notionists.json';
import openPeeps from '@dicebear/styles/open-peeps.json';
import pixelArt from '@dicebear/styles/pixel-art.json';
import thumbs from '@dicebear/styles/thumbs.json';

import type { AvatarConfig, AvatarStyle } from '@socketspace/shared/profile';

import type { AvatarOptions, BuilderColor, BuilderPart, BuilderStyle } from '@/lib/avatar-builder';

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

const definitions: Record<GalleryStyle, unknown> = {
  notionists,
  lorelei,
  'open-peeps': openPeeps,
  'pixel-art': pixelArt,
  thumbs,
  critters,
};

const styles = Object.fromEntries(
  GALLERY_STYLES.map((name) => [name, new Style(definitions[name] as never)]),
) as Record<GalleryStyle, Style>;

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

// The avatar builder (PROF-07) ------------------------------------------------------------------

const STYLE_LABELS: Record<GalleryStyle, string> = {
  notionists: 'Sketch',
  lorelei: 'Portrait',
  'open-peeps': 'Doodle',
  'pixel-art': 'Pixel',
  thumbs: 'Blob',
  critters: 'Critter',
};

/** Soft backgrounds that suit every theme. */
const BACKGROUNDS = [
  '#e1e9fb',
  '#fde4e1',
  '#fff1b8',
  '#dff3e4',
  '#ece3fb',
  '#ffd8b5',
  '#c9ecf2',
  '#f3f4ef',
];

/** Parts that are motion settings or have nothing to choose. */
const SKIPPED_PARTS = new Set(['animation']);

const HEX = /^#[0-9a-f]{6}$/i;

/** "hairAccessories" becomes "Hair accessories"; "bigPupils" becomes "Big pupils". */
function humanize(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b0+(\d)/g, '$1');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface StyleDefinition {
  components?: Record<string, { probability?: number }>;
  colors?: Record<string, { values?: string[] }>;
}

function buildStyle(name: GalleryStyle): BuilderStyle {
  const descriptor = new OptionsDescriptor(styles[name]).toJSON();
  const definition = definitions[name] as StyleDefinition;
  const parts: BuilderPart[] = [];
  for (const [option, field] of Object.entries(descriptor)) {
    if (!option.endsWith('Variant') || field.type !== 'enum') continue;
    const key = option.slice(0, -'Variant'.length);
    if (SKIPPED_PARTS.has(key)) continue;
    const probability = definition.components?.[key]?.probability;
    const optional =
      probability !== undefined && probability < 100 && `${key}Probability` in descriptor;
    if (field.values.length < 2 && !optional) continue;
    parts.push({
      key,
      label: humanize(key),
      optional,
      values: field.values.map((value, index) => ({
        value,
        label: /^variant\d+$/.test(value) ? `Style ${String(index + 1)}` : humanize(value),
      })),
    });
  }
  const colors: BuilderColor[] = [];
  for (const [key, color] of Object.entries(definition.colors ?? {})) {
    const values = (color.values ?? []).filter((v) => HEX.test(v)).map((v) => v.toLowerCase());
    if (values.length < 2 || !(`${key}Color` in descriptor)) continue;
    colors.push({ key: `${key}Color`, label: `${humanize(key)} colour`, values });
  }
  if ('backgroundColor' in descriptor) {
    colors.push({ key: 'backgroundColor', label: 'Background', values: BACKGROUNDS });
  }
  return { style: name, label: STYLE_LABELS[name], parts, colors };
}

let builder: BuilderStyle[] | undefined;

/** Every builder style with its parts and colours (computed once). */
export function avatarBuilder(): BuilderStyle[] {
  builder ??= GALLERY_STYLES.map(buildStyle);
  return builder;
}

/**
 * Checks saved avatar settings against what the style really offers and returns a clean copy, or
 * `null`. DiceBear quietly accepts unknown values and draws a broken picture, so this is where
 * they are refused: each part must be one of its variants, each colour one of its swatches.
 */
export function sanitizeAvatarConfig(config: AvatarConfig): AvatarConfig | null {
  if (!isGalleryStyle(config.style)) return null;
  const spec = avatarBuilder().find((s) => s.style === config.style);
  if (!spec) return null;
  const clean: AvatarOptions = {};
  for (const [option, value] of Object.entries(config.options ?? {})) {
    const variantPart = spec.parts.find((p) => option === `${p.key}Variant`);
    const switchPart = spec.parts.find((p) => p.optional && option === `${p.key}Probability`);
    const color = spec.colors.find((c) => c.key === option);
    if (
      variantPart &&
      typeof value === 'string' &&
      variantPart.values.some((v) => v.value === value)
    ) {
      clean[option] = value;
    } else if (switchPart && (value === 0 || value === 100)) {
      clean[option] = value;
    } else if (color && typeof value === 'string' && color.values.includes(value.toLowerCase())) {
      clean[option] = value.toLowerCase();
    } else {
      return null;
    }
  }
  const result: AvatarConfig =
    Object.keys(clean).length > 0
      ? { style: config.style, seed: config.seed, options: clean }
      : { style: config.style, seed: config.seed };
  return renderAvatarSvg(result, 32) ? result : null;
}
