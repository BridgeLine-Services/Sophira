import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // premium academic palette (approved reference, 2026-10-15):
        // clean neutral canvas, deep-indigo accent, pale lavender highlights
        paper: "#f8f8fa",
        ink: { DEFAULT: "#252b3a", soft: "#697386" },
        accent: { DEFAULT: "#5145e8", soft: "#f0eeff", deep: "#3f35c9" },
        success: "#0f766e",
        warn: "#b45309",
        danger: "#b91c1c",
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
