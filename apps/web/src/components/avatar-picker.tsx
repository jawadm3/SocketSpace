'use client';

/**
 * Choosing a profile picture (D-023, PROF-06 to PROF-08): a gallery of presets, "Make your own"
 * with a live preview, starting from whichever preset was picked, or "Upload a photo". The choice
 * is submitted as two hidden fields, `avatar` (the settings, as JSON) and `avatarKind`; the
 * server checks both. Previews come from our own server, so no third party is involved.
 *
 * A photo is uploaded as soon as it is chosen: the server checks it, crops it to a square,
 * re-encodes it and removes its metadata (location, camera), and answers with an ID. The form
 * then submits only that ID.
 */
import { Shuffle, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { IMAGE_ACCEPT, mediaPath } from '@socketspace/shared/media';
import type { AvatarConfig } from '@socketspace/shared/profile';

import { avatarSrc } from '@/lib/avatar-url';
import {
  partChoice,
  withColor,
  withPartChoice,
  type AvatarOptions,
  type BuilderStyle,
  type PartChoice,
} from '@/lib/avatar-builder';
import { uploadImage } from '@/lib/uploads';

export interface PresetChoice {
  config: AvatarConfig;
  /** Image source: a data URI from the server, or an /api/avatar URL after shuffling. */
  src: string;
}

export type PickedAvatar =
  | { kind: 'preset' | 'custom'; config: AvatarConfig }
  /** An uploaded photo, by the ID the upload answered with. */
  | { kind: 'photo'; attachmentId: string };

function randomSeed(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const src = (config: AvatarConfig) => avatarSrc({ kind: 'generated', config }) ?? '';

function Gallery({
  presets,
  selected,
  onPick,
  onShuffle,
}: {
  presets: PresetChoice[];
  selected: AvatarConfig | null;
  onPick: (config: AvatarConfig) => void;
  onShuffle: () => void;
}) {
  const name = useId();
  return (
    <div>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
        {presets.map((preset, index) => {
          const checked =
            selected?.style === preset.config.style &&
            selected.seed === preset.config.seed &&
            !selected.options;
          return (
            <label
              key={`${preset.config.style}-${preset.config.seed}`}
              className="cursor-pointer rounded-2xl border-2 border-transparent bg-surface-2 p-1 has-checked:border-accent has-focus-visible:outline-3 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name={name}
                checked={checked}
                onChange={() => {
                  onPick(preset.config);
                }}
                className="sr-only"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG, tiny */}
              <img
                src={preset.src}
                alt={`Picture ${String(index + 1)} (${preset.config.style} style)`}
                width={72}
                height={72}
                className="h-auto w-full rounded-xl"
              />
            </label>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onShuffle}
        className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent underline"
      >
        <Shuffle aria-hidden="true" className="h-4 w-4" />
        Show me others
      </button>
    </div>
  );
}

function choiceValue(choice: PartChoice): string {
  if (choice.kind === 'value') return `v:${choice.value}`;
  return choice.kind;
}

function Builder({
  builder,
  config,
  onChange,
}: {
  builder: BuilderStyle[];
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
}) {
  const spec = builder.find((s) => s.style === config.style) ?? builder[0];
  const options: AvatarOptions = (config.options as AvatarOptions | undefined) ?? {};
  const set = (next: AvatarOptions) => {
    onChange(
      Object.keys(next).length > 0
        ? { style: config.style, seed: config.seed, options: next }
        : { style: config.style, seed: config.seed },
    );
  };
  if (!spec) return null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex shrink-0 flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG */}
        <img
          src={src(config)}
          alt="Preview of your picture"
          width={128}
          height={128}
          className="h-32 w-32 rounded-2xl bg-surface-2"
        />
        <button
          type="button"
          onClick={() => {
            onChange({ style: config.style, seed: randomSeed() });
          }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent underline"
        >
          <Shuffle aria-hidden="true" className="h-4 w-4" />
          Surprise me
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <fieldset>
          <legend className="text-sm font-semibold">Style</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {builder.map((style) => (
              <button
                key={style.style}
                type="button"
                aria-pressed={style.style === config.style}
                onClick={() => {
                  onChange({ style: style.style as AvatarConfig['style'], seed: config.seed });
                }}
                className="flex items-center gap-1.5 rounded-xl border border-line bg-card px-2 py-1 text-sm aria-pressed:border-accent aria-pressed:bg-accent-soft"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG */}
                <img
                  src={src({ style: style.style as AvatarConfig['style'], seed: config.seed })}
                  alt=""
                  width={28}
                  height={28}
                  className="rounded-lg"
                />
                {style.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          {spec.parts.map((part) => (
            <label key={part.key} className="flex flex-col gap-1 text-sm font-semibold">
              {part.label}
              <select
                value={choiceValue(partChoice(options, part))}
                onChange={(event) => {
                  const raw = event.target.value;
                  const choice: PartChoice =
                    raw === 'none'
                      ? { kind: 'none' }
                      : raw === 'surprise'
                        ? { kind: 'surprise' }
                        : { kind: 'value', value: raw.slice(2) };
                  set(withPartChoice(options, part, choice));
                }}
                className="min-h-10 rounded-xl border border-line bg-card px-3 font-normal"
              >
                <option value="surprise">Surprise me</option>
                {part.optional ? <option value="none">None</option> : null}
                {part.values.map((v) => (
                  <option key={v.value} value={`v:${v.value}`}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {spec.colors.map((color) => (
          <fieldset key={color.key}>
            <legend className="text-sm font-semibold">{color.label}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {color.values.map((value, index) => {
                const chosen = options[color.key] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={chosen}
                    aria-label={`${color.label} ${String(index + 1)} of ${String(color.values.length)}`}
                    onClick={() => {
                      set(withColor(options, color.key, chosen ? null : value));
                    }}
                    className="h-8 w-8 rounded-full border-2 border-line aria-pressed:border-ink aria-pressed:ring-2 aria-pressed:ring-accent"
                    style={{ backgroundColor: value }}
                  />
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function PhotoUpload({
  picked,
  canUpload,
  onUploaded,
}: {
  picked: string | null;
  canUpload: boolean;
  onUploaded: (attachmentId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const inputId = useId();

  if (!canUpload) {
    return (
      <p className="text-sm text-ink-2">
        Confirm your email address to upload a photo: we sent you a link. Until then, pick a picture
        from the gallery or make your own; you can switch to a photo later in settings.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {picked ? (
        // eslint-disable-next-line @next/next/no-img-element -- our own media route
        <img
          src={mediaPath(picked)}
          alt="Your uploaded photo"
          width={128}
          height={128}
          className="h-32 w-32 shrink-0 rounded-2xl bg-surface-2 object-cover"
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm text-ink-2">
          JPEG, PNG, WebP or GIF, up to 4 MB. We crop it to a square and remove hidden details such
          as where and when it was taken.
        </p>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="avatar-photo-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            setProblem('');
            void uploadImage(file, 'avatar').then((result) => {
              setBusy(false);
              if (result.ok) onUploaded(result.attachment.id);
              else setProblem(result.message);
            });
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-semibold disabled:opacity-50"
        >
          <Upload aria-hidden="true" className="h-4 w-4" />
          {busy ? 'Uploading…' : picked ? 'Choose another photo' : 'Choose a photo'}
        </button>
        <p role="status" className="sr-only">
          {busy ? 'Uploading your photo…' : picked ? 'Photo uploaded.' : ''}
        </p>
        {problem ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Tab = 'gallery' | 'builder' | 'photo';

export function AvatarPicker({
  presets: initialPresets,
  builder,
  initial,
  error,
  canUpload,
}: {
  presets: PresetChoice[];
  builder: BuilderStyle[];
  initial: PickedAvatar | null;
  error?: string | undefined;
  /** Photos need a confirmed email address (the server checks too). */
  canUpload: boolean;
}) {
  const [presets, setPresets] = useState(initialPresets);
  const [picked, setPicked] = useState<PickedAvatar | null>(initial);
  const [tab, setTab] = useState<Tab>(
    initial?.kind === 'custom' ? 'builder' : initial?.kind === 'photo' ? 'photo' : 'gallery',
  );
  const baseId = useId();
  const builderConfig: AvatarConfig = (picked && picked.kind !== 'photo'
    ? picked.config
    : undefined) ??
    initialPresets[0]?.config ?? {
      style: 'lorelei',
      seed: 'socketspace',
    };
  const pickedSrc = picked
    ? picked.kind === 'photo'
      ? mediaPath(picked.attachmentId)
      : src(picked.config)
    : null;

  return (
    <fieldset aria-describedby={error ? `${baseId}-error` : undefined}>
      <legend className="text-sm font-semibold text-ink">Profile picture</legend>
      <input
        type="hidden"
        name="avatar"
        value={
          picked
            ? JSON.stringify(
                picked.kind === 'photo' ? { attachmentId: picked.attachmentId } : picked.config,
              )
            : ''
        }
      />
      <input type="hidden" name="avatarKind" value={picked?.kind ?? ''} />
      {pickedSrc ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own avatar or media route */}
          <img
            src={pickedSrc}
            alt=""
            width={40}
            height={40}
            data-testid="picked-avatar"
            className="h-10 w-10 rounded-xl bg-surface-2 object-cover"
          />
          Selected picture
        </p>
      ) : null}
      <div role="tablist" aria-label="How to choose" className="mt-2 flex gap-1">
        {(
          [
            ['gallery', 'Gallery'],
            ['builder', 'Make your own'],
            ['photo', 'Upload a photo'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${baseId}-${value}-tab`}
            aria-selected={tab === value}
            aria-controls={`${baseId}-${value}`}
            onClick={() => {
              setTab(value);
              if (value === 'builder') setPicked({ kind: 'custom', config: builderConfig });
            }}
            className="rounded-xl px-3 py-1.5 text-sm font-semibold text-ink-2 aria-selected:bg-accent-soft aria-selected:text-ink"
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-${tab}`}
        aria-labelledby={`${baseId}-${tab}-tab`}
        className="mt-3"
      >
        {tab === 'photo' ? (
          <PhotoUpload
            picked={picked?.kind === 'photo' ? picked.attachmentId : null}
            canUpload={canUpload}
            onUploaded={(attachmentId) => {
              setPicked({ kind: 'photo', attachmentId });
            }}
          />
        ) : tab === 'gallery' ? (
          <Gallery
            presets={presets}
            selected={picked?.kind === 'preset' ? picked.config : null}
            onPick={(config) => {
              setPicked({ kind: 'preset', config });
            }}
            onShuffle={() => {
              setPresets(
                presets.map((p) => {
                  const config: AvatarConfig = { style: p.config.style, seed: randomSeed() };
                  return { config, src: src(config) };
                }),
              );
            }}
          />
        ) : (
          <Builder
            builder={builder}
            config={builderConfig}
            onChange={(config) => {
              setPicked({ kind: 'custom', config });
            }}
          />
        )}
      </div>
      {error ? (
        <p id={`${baseId}-error`} className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
