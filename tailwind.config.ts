import type { Config } from "tailwindcss";

/**
 * Dual-theme token layer (2026-10-29) + reskin scale (2026-11-12).
 *
 * Every colour resolves through a CSS variable holding an RGB triplet, so
 * opacity modifiers keep working (`bg-ink/10` -> `rgb(var(--c-ink) / 0.1)`).
 *
 * Both theme blocks live in globals.css: :root and [data-theme="dark"].
 * The scale below (radius, elevation, type) is shared by every page so the
 * product has ONE shape language instead of a per-page opinion.
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
        // brand = the restrained purple mark (logo, brand moments ONLY) -
        // it must never carry primary actions now that teal is the accent.
        brand: { DEFAULT: token("brand"), soft: token("brand-soft") },
        "on-accent": token("on-accent"),
        success: token("success"),
        warn: token("warn"),
        danger: token("danger"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "0.875rem",
        panel: "1rem",
        tile: "1.25rem",
      },
      boxShadow: {
        // Composed from the per-theme elevation variables in globals.css, so a
        // card that sits heavily on ivory sits lightly on midnight navy.
        e1: "var(--elev-1)",
        e2: "var(--elev-2)",
        e3: "var(--elev-3)",
        accent: "var(--elev-accent)",
      },
      fontSize: {
        // A readable type ramp for people without technical backgrounds: the
        // smallest text the product uses is 12px (was 10px in places), and
        // body copy sits at 15-16px.
        "2xs": ["11px", { lineHeight: "1.35" }],
        xs: ["12px", { lineHeight: "1.45" }],
        sm: ["13.5px", { lineHeight: "1.55" }],
        base: ["15px", { lineHeight: "1.6" }],
        lg: ["17px", { lineHeight: "1.55" }],
        xl: ["20px", { lineHeight: "1.4" }],
        "2xl": ["24px", { lineHeight: "1.3" }],
        "3xl": ["30px", { lineHeight: "1.2" }],
      },
      maxWidth: {
        content: "78rem",
      },
      transitionTimingFunction: {
        calm: "cubic-bezier(0.22, 0.61, 0.36, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
