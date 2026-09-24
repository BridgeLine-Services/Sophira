import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // calm academic palette: ink on warm paper, indigo accent
        paper: "#faf9f7",
        ink: { DEFAULT: "#1f2937", soft: "#6b7280" },
        accent: { DEFAULT: "#4f46e5", soft: "#eef2ff" },
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
