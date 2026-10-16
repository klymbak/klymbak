import type { ReactNode } from "react";
import { useTheme } from "styled-components";
import { configureFormatting } from "@klymbak/react";

type Colors = Record<string, string | undefined>;

/** Relative luminance of a #rrggbb color, to tell Strapi's dark theme from its light one. */
function luminance(hex: string | undefined): number {
  const match = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!match) return 1;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Klymbak's CSS variables, filled from the Strapi design system theme in use. */
function variables(c: Colors): string {
  const vars: Record<string, string | undefined> = {
    "--kl-font": "inherit",
    "--kl-radius": "4px",
    "--kl-radius-sm": "4px",
    "--kl-bg": c.neutral0,
    "--kl-canvas": c.neutral100,
    "--kl-surface": c.neutral0,
    "--kl-surface-muted": c.neutral100,
    "--kl-surface-hover": c.neutral150,
    "--kl-border": c.neutral150,
    "--kl-border-strong": c.neutral200,
    "--kl-text": c.neutral800,
    "--kl-text-muted": c.neutral600,
    "--kl-text-faint": c.neutral500,
    "--kl-accent": c.buttonPrimary600 ?? c.primary600,
    "--kl-accent-hover": c.buttonPrimary500 ?? c.primary700,
    "--kl-accent-soft": c.primary100,
    "--kl-accent-text": c.buttonNeutral0 ?? "#ffffff",
    "--kl-focus": c.primary600,
    "--kl-user-bubble": c.primary100,
    "--kl-success": c.success600,
    "--kl-success-soft": c.success100,
    "--kl-warning": c.warning600,
    "--kl-warning-soft": c.warning100,
    "--kl-danger": c.danger600,
    "--kl-danger-soft": c.danger100,
    "--kl-info": c.primary600,
    "--kl-info-soft": c.primary100,
    "--kl-neutral": c.neutral600,
    "--kl-neutral-soft": c.neutral150,
  };
  return Object.entries(vars)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
}

/** "light" or "dark", following the theme the admin panel uses right now. */
export function useStrapiThemeMode(): "light" | "dark" {
  const theme = useTheme() as unknown as { colors?: Colors } | undefined;
  return luminance(theme?.colors?.neutral0) < 0.5 ? "dark" : "light";
}

let formattingLocale: string | undefined;

/**
 * Dates and numbers in the admin's interface language (Strapi sets it on <html lang>), not the
 * operating system's, which is what the browser's Intl formatters fall back to.
 */
function useAdminLocale() {
  const lang = typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
  if (lang !== formattingLocale) {
    formattingLocale = lang;
    configureFormatting({ locale: lang });
  }
}

/**
 * Dresses the Klymbak components inside it in the admin's own colors, font, radius and locale.
 * The selector outranks the stylesheet's `.kl-root` and `[data-kl-theme]` rules.
 */
export function StrapiTheme({ children, className = "" }: { children: ReactNode; className?: string }) {
  const theme = useTheme() as unknown as { colors?: Colors } | undefined;
  useAdminLocale();
  const css = theme?.colors ? `.kl-strapi .kl-root.kl-root{${variables(theme.colors)}}` : "";
  return (
    <div className={`kl-strapi ${className}`.trim()}>
      {css && <style>{css}</style>}
      {children}
    </div>
  );
}
