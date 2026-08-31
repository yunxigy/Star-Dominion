import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Keep the site's single environment file authoritative for local builds.
  // Only VITE_* variables are exposed to browser code by Vite.
  envDir: '..',
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/auth-api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/auth-api/, ''),
      },
      '/openwrite': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/openwrite/, '') || '/',
      },
      '/stock': {
        target: 'http://127.0.0.1:8014',
        changeOrigin: true,
      },
      '/stock-api': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/stock-api/, ''),
      },
      '/reports-api': {
        target: 'http://127.0.0.1:8009',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/reports-api/, ''),
      },
      '/document-api': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/document-api/, ''),
        timeout: 900000,
      },
      '/video-api': {
        target: 'http://127.0.0.1:8011',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/video-api/, ''),
        timeout: 900000,
      },
      '/webmaster-api': {
        target: 'http://127.0.0.1:8012',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/webmaster-api/, ''),
        timeout: 15000,
      },
      '/api': {
        target: 'http://localhost:8006',
        changeOrigin: true,
        timeout: 600000,
      },
      '/ws': {
        target: 'ws://localhost:8006',
        ws: true,
      },
      '/plagiarism-api': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/plagiarism-api/, ''),
      },
      '/stm32/api': {
        target: 'http://127.0.0.1:8007',
        changeOrigin: true,
        ws: true,
        rewrite: (path: string) => path.replace(/^\/stm32\/api/, ''),
      },
      '/ow-api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/ow-api/, '/api'),
      },
      '/wuwa': {
        target: 'http://localhost:8006',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/wuwa/, ''),
      },
      '/css': {
        target: 'http://localhost:8006',
        changeOrigin: true,
      },
      '/js': {
        target: 'http://localhost:8006',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://localhost:8006',
        changeOrigin: true,
      },
      '/avatars': {
        target: 'http://localhost:8006',
        changeOrigin: true,
      },
      '/audio': {
        target: 'http://localhost:8006',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 代码分割
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // PDF.js 单独分割（最大）
          'pdfjs': ['pdfjs-dist'],
          // jsPDF 单独分割
          'jspdf': ['jspdf'],
          // 图片处理库
          'image-vendor': ['html2canvas'],
          // 动画库
          'motion-vendor': ['framer-motion'],
          // PDF处理库
          'pdflib': ['pdf-lib'],
          // 工具库
          'utils': ['jszip', 'dompurify'],
        },
      },
    },
    // 压缩配置
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log'], // 移除console.log
      },
      output: {
        comments: false,
      },
    },
    // CSS 代码分割
    cssCodeSplit: true,
    // chunk 大小警告阈值
    chunkSizeWarningLimit: 300,
    // 启用源码映射（生产环境关闭）
    sourcemap: false,
  },
});
