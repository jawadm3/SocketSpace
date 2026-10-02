/**
 * Theme choice (D-021): which theme and which light/dark mode the page uses. Stored in a cookie so
 * the server renders the right theme on the very first frame (no flash), and per account in the
 * database (Stage F adds the picker).
 */
import {
  COLOR_MODES,
  DEFAULT_THEME,
  THEMES,
  type ColorMode,
  type Theme,
} from '@socketspace/shared/domain';

export const THEME_COOKIE = 'ss_theme';

export interface ThemeChoice {
  theme: Theme;
  mode: ColorMode;
}

export const DEFAULT_THEME_CHOICE: ThemeChoice = { theme: DEFAULT_THEME, mode: 'system' };

/** Reads a cookie value such as `airmail.dark`; anything unexpected falls back to the default. */
export function parseThemeCookie(value: string | undefined): ThemeChoice {
  if (!value) return DEFAULT_THEME_CHOICE;
  const [theme, mode] = value.split('.');
  const validTheme = (THEMES as readonly string[]).includes(theme ?? '');
  const validMode = (COLOR_MODES as readonly string[]).includes(mode ?? '');
  return {
    theme: validTheme ? (theme as Theme) : DEFAULT_THEME,
    mode: validMode ? (mode as ColorMode) : 'system',
  };
}

export function themeCookieValue(choice: ThemeChoice): string {
  return `${choice.theme}.${choice.mode}`;
}
