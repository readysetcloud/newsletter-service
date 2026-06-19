import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { visualizer } from 'rollup-plugin-visualizer'
import { brandHtmlPlugin } from './vite-plugin-brand-html'

// https://vitejs.dev/config/
export default defineConfig(({ command: _command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const isAnalyze = process.env.ANALYZE === 'true';

  return {
    plugins: [
      react(),
      brandHtmlPlugin(),
      // Add bundle visualizer in analyze mode
      ...(isAnalyze ? [
        visualizer({
          open: true,
          filename: 'dist/stats.html',
          gzipSize: true,
          brotliSize: true,
        })
      ] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@/components': path.resolve(__dirname, './src/components'),
        '@/pages': path.resolve(__dirname, './src/pages'),
        '@/services': path.resolve(__dirname, './src/services'),
        '@/types': path.resolve(__dirname, './src/types'),
        '@/hooks': path.resolve(__dirname, './src/hooks'),
        '@/utils': path.resolve(__dirname, './src/utils'),
        '@/contexts': path.resolve(__dirname, './src/contexts'),
      },
    },
    server: {
      port: 3000,
      open: true,
    },
    // Force Vite to pre-bundle the markdown editor (and its transitive
    // @lexical/code → prismjs dependency) as a single esbuild bundle. Without
    // this, prismjs's language component files load as separate ESM modules in
    // dev and their bare `Prism` global is undefined, throwing
    // "Prism is not defined" when the issue editor mounts.
    optimizeDeps: {
      include: ['@mdxeditor/editor'],
    },
    build: {
      outDir: 'dist',
      sourcemap: mode === 'development',
      minify: 'terser',
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              if (id.includes('react-dom') || id.includes(`${path.sep}react${path.sep}`)) {
                return 'react-vendor';
              }
              if (id.includes('react-router-dom')) {
                return 'router-vendor';
              }
              if (
                id.includes('@headlessui/react') ||
                id.includes('@heroicons/react') ||
                id.includes('lucide-react')
              ) {
                return 'ui-vendor';
              }
              if (
                id.includes('react-hook-form') ||
                id.includes('@hookform/resolvers') ||
                id.includes(`${path.sep}zod${path.sep}`)
              ) {
                return 'form-vendor';
              }
              if (id.includes('aws-amplify')) {
                return 'aws-vendor';
              }
              if (id.includes('recharts')) {
                return 'chart-vendor';
              }
            }
            return undefined;
          },
          chunkFileNames: (chunkInfo) => {
            const facadeModuleId = chunkInfo.facadeModuleId
              ? chunkInfo.facadeModuleId.split('/').pop()?.replace('.tsx', '').replace('.ts', '')
              : 'chunk';

            // Create separate chunks for issue detail page components
            if (facadeModuleId?.includes('IssueDetail')) {
              return `js/issue-detail/[name]-[hash].js`;
            }

            // Create separate chunks for analytics components
            if (facadeModuleId?.includes('Chart') ||
                facadeModuleId?.includes('Analytics') ||
                facadeModuleId?.includes('GeoMap')) {
              return `js/analytics/[name]-[hash].js`;
            }

            return `js/${facadeModuleId}-[hash].js`;
          },
          entryFileNames: 'js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name?.split('.') || [];
            const ext = info[info.length - 1];
            if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext || '')) {
              return `images/[name]-[hash][extname]`;
            }
            if (/css/i.test(ext || '')) {
              return `css/[name]-[hash][extname]`;
            }
            return `assets/[name]-[hash][extname]`;
          },
        },
      },
      // Optimize bundle size
      chunkSizeWarningLimit: 1000,
      // Enable gzip compression analysis
      reportCompressedSize: true,
    },
    // Performance optimizations
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        '@headlessui/react',
        '@heroicons/react',
        'lucide-react',
        'react-hook-form',
        'zod',
        'clsx',
        'tailwind-merge',
      ],
    },
    // Environment variables
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    // Preview server configuration
    preview: {
      port: 4173,
      strictPort: true,
    },
  }
})
