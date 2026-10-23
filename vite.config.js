import { defineConfig } from 'vite'

// The page's path on its site: '/', at the root of justasimpletree.com as
// under the dev server, unless BASE_PATH says otherwise
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
})
