// Tailwind v4 ships a single PostCSS plugin and reads its theme tokens
// straight from the imported CSS — no `tailwind.config.js` file is
// needed. See `src/app/globals.css` for the `@theme` block.

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
