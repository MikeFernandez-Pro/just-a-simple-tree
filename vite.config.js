import { defineConfig } from 'vite'

// The page's path on its site: '/' when served on its own, as the dev server
// does, or the repo's name under GitHub Pages, where the deploy workflow sets
// BASE_PATH to '/just-a-simple-tree/'
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
})
