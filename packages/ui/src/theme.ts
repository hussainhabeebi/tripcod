// Tripcod Travel Solutions brand palette (from the Tripcod logo)
// Applied as CSS custom properties — override per-tenant via server-side injection
export const BRAND = {
  charcoal:     "#4B4D4F",
  charcoalDark: "#2F3032",
  amber:        "#FFB005",
  white:        "#FFFFFF",
} as const;

export const DEFAULT_THEME = {
  primaryColor:   BRAND.charcoal,
  secondaryColor: BRAND.amber,
  accentColor:    BRAND.amber,
  fontFamily:     "Inter",
  borderRadius:   "8px",
} as const;

// Generates inline CSS for tenant-specific theme injection (used in layout.tsx)
export function generateThemeCSS(config: {
  primaryColor:   string;
  secondaryColor: string;
  accentColor:    string;
  fontFamily:     string;
}): string {
  return `
    :root {
      --color-primary:   ${config.primaryColor};
      --color-secondary: ${config.secondaryColor};
      --color-accent:    ${config.accentColor};
      --font-body:       ${config.fontFamily}, system-ui, sans-serif;
      --border-radius:   8px;
    }
  `.trim();
}
