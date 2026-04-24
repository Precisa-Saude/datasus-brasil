/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@precisa-saude/ui/dist/**/*.{js,mjs}',
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        'ps-amber': 'var(--ps-amber)',
        'ps-green': 'var(--ps-green)',
        'ps-mint': 'var(--ps-mint)',
        'ps-neutral': 'var(--background)',
        'ps-sand': 'var(--secondary)',
        'ps-violet': 'var(--ps-violet)',
        'ps-violet-dark': 'var(--primary)',
        'ps-violet-light': 'var(--ps-violet)',
        accent: { DEFAULT: 'var(--accent)', foreground: 'var(--accent-foreground)' },
        background: 'var(--background)',
        border: 'var(--border)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        foreground: 'var(--foreground)',
        input: 'var(--input)',
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        ring: 'var(--ring)',
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
      },
      fontFamily: {
        sans: ['Roboto', 'system-ui', 'sans-serif'],
        serif: ['Roboto Serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
