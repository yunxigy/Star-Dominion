import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/openwrite': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        timeout: 600000,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/plagiarism': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/plagiarism/, ''),
      },
      '/ow-api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/ow-api/, '/api'),
      },
      '/wuwa': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/wuwa/, ''),
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
