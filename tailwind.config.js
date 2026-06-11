/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink:    'rgb(var(--ink-rgb) / <alpha-value>)',
        panel:  'rgb(var(--panel-rgb) / <alpha-value>)',
        line:   'rgb(var(--line-rgb) / <alpha-value>)',
        warn:   'rgb(var(--warn-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      borderRadius: { DEFAULT: '12px', sm: '8px', md: '10px', lg: '14px', xl: '18px', '2xl': '24px' }
    }
  },
  plugins: []
};
