import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves project sites from /<repository>/.
  // Keep the root base during local development and previews.
  base: process.env.GITHUB_ACTIONS ? '/puzzle-city/' : '/',
});
