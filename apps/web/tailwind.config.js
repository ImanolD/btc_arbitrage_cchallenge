/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        terminal: {
          bg: "#0a0e14",
          panel: "#0f141c",
          border: "#1c2530",
          muted: "#5b6b7d",
          text: "#c9d3df",
          green: "#1ec97b",
          red: "#ff4d6d",
          amber: "#ffb347",
          blue: "#4dabf7",
        },
      },
    },
  },
  plugins: [],
};
