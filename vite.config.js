import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// IMPORTANT: base must match your GitHub Pages repo name when using user/organization pages
// For https://zabre.github.io/elden-ring-3d-forge/ the base is "/elden-ring-3d-forge/"
export default defineConfig({
  base: '/elden-ring-3d-forge/',
  plugins: [react()],
})
