import type { Config } from "tailwindcss";

/**
 * Dual-theme token layer (2026-10-29).
 *
 * Every colour resolves through a CSS variable holding an RGB triplet, so
 * opacity modifiers keep working (`bg-ink/10` -> `rgb(var(--c-ink) / 0.1)`).
 *
 * Light values are byte-identical to the previously shipped palette
 * (#f8f8fa / #252b3a / #5145e8 ...), so adopting this layer changes NOTHING in
 * light mode. Dark values are the violet direction from the design reference,
 * measured at 12/12 WCAG AA pairs in src/lib/ui/contrast.ts.
 *
 * Both blocks live in globals.css: :root and [data-theme="dark"].
 */
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // surfaces
        paper: token("paper"),
        card: token("card"),
        "card-elevated": token("card-elevated"),
        sidebar: token("sidebar"),
        topbar: token("topbar"),
        line: token("line"),
        // text
        ink: { DEFAULT: token("ink"), soft: token("ink-soft") },
        // accent + status
        accent: { DEFAULT: token("accent"), soft: token("accent-soft"), deep: token("accent-deep") },
        success: token("success"),
        warn: token("warn"),
        danger: token("danger"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "0.875rem" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
