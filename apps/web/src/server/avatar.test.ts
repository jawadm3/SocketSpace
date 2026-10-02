/**
 * Avatar presets, the builder's options and the check on saved settings (PROF-06, PROF-07).
 */
import { describe, expect, it } from 'vitest';

import { partChoice, withColor, withPartChoice } from '@/lib/avatar-builder';

import { avatarBuilder, presetGallery, renderAvatarSvg, sanitizeAvatarConfig } from './avatar';

describe('preset gallery (PROF-06)', () => {
  it('offers 24 different, renderable presets in 6 CC0 styles', () => {
    const presets = presetGallery(4);
    expect(presets).toHaveLength(24);
    expect(new Set(presets.map((p) => p.config.style)).size).toBe(6);
    expect(new Set(presets.map((p) => p.config.seed)).size).toBe(24);
    for (const preset of presets) expect(preset.dataUri).toMatch(/^data:image\/svg\+xml/);
  });
});

describe('avatar builder (PROF-07)', () => {
  const lorelei = avatarBuilder().find((s) => s.style === 'lorelei');

  it("lists each style's parts and colours from DiceBear's own description", () => {
    expect(avatarBuilder().map((s) => s.label)).toEqual([
      'Sketch',
      'Portrait',
      'Doodle',
      'Pixel',
      'Blob',
      'Critter',
    ]);
    const parts = new Map(lorelei?.parts.map((p) => [p.key, p]));
    expect(parts.get('hair')?.optional).toBe(false);
    expect(parts.get('glasses')?.optional).toBe(true);
    expect(parts.get('hairAccessories')?.label).toBe('Hair accessories');
    expect(parts.get('hair')?.values[0]).toEqual({ value: 'variant01', label: 'Style 1' });
    expect(lorelei?.colors.find((c) => c.key === 'backgroundColor')?.values[0]).toMatch(
      /^#[0-9a-f]{6}$/,
    );
  });

  it('accepts real choices and refuses anything else', () => {
    const good = sanitizeAvatarConfig({
      style: 'lorelei',
      seed: 'abc',
      options: {
        hairVariant: 'variant05',
        glassesVariant: 'variant02',
        glassesProbability: 100,
        backgroundColor: '#E1E9FB',
      },
    });
    expect(good?.options).toEqual({
      hairVariant: 'variant05',
      glassesVariant: 'variant02',
      glassesProbability: 100,
      backgroundColor: '#e1e9fb',
    });
    const refused: Record<string, string | number>[] = [
      { hairVariant: 'not-a-variant' },
      { title: 'injected text' },
      { glassesProbability: 50 },
      { hairProbability: 0 },
      { backgroundColor: '#123456' },
    ];
    for (const options of refused) {
      expect(
        sanitizeAvatarConfig({ style: 'lorelei', seed: 'abc', options }),
        JSON.stringify(options),
      ).toBeNull();
    }
    expect(sanitizeAvatarConfig({ style: 'identicon', seed: 'abc' })).toBeNull();
  });

  it('turns a choice into options that change the picture', () => {
    const glasses = lorelei?.parts.find((p) => p.key === 'glasses');
    if (!glasses) throw new Error('lorelei has no glasses part');
    const on = withPartChoice({}, glasses, { kind: 'value', value: 'variant02' });
    const off = withPartChoice(on, glasses, { kind: 'none' });
    expect(on).toEqual({ glassesVariant: 'variant02', glassesProbability: 100 });
    expect(off).toEqual({ glassesProbability: 0 });
    expect(partChoice(off, glasses)).toEqual({ kind: 'none' });
    expect(withPartChoice(off, glasses, { kind: 'surprise' })).toEqual({});
    const render = (options: Record<string, string | number>) =>
      renderAvatarSvg({ style: 'lorelei', seed: 'same', options });
    expect(render(on)).not.toBe(render(off));
    expect(withColor({ backgroundColor: '#e1e9fb' }, 'backgroundColor', null)).toEqual({});
  });
});
