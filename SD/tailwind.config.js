/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      fontFamily: {
        'art': ['Ma Shan Zheng', 'cursive'],
        'wild': ['Zhi Mang Xing', 'cursive'],
        'cang': ['Long Cang', 'cursive'],
      }
    },
  },
  plugins: [],
}