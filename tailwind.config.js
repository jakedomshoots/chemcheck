/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
        extend: {
                fontFamily: {
                    sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                    /* Data voice: lab readouts, timers, dosages */
                    mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
                },
                borderRadius: {
                        chip: 'var(--r-chip)',
                        control: 'var(--r-control)',
                        card: 'var(--r-card)',
                        raised: 'var(--r-raised)',
                        sheet: 'var(--r-sheet)',
                        lg: 'var(--radius)',
                        md: 'calc(var(--radius) - 2px)',
                        sm: 'calc(var(--radius) - 4px)'
                },
                boxShadow: {
                        card: 'var(--shadow-card)',
                        raised: 'var(--shadow-raised)',
                        cta: 'var(--shadow-cta)',
                },
                transitionTimingFunction: {
                        standard: 'var(--motion-standard)',
                        spring: 'var(--motion-spring)',
                },
                colors: {
                        brand: {
                                DEFAULT: 'var(--brand)',
                                strong: 'var(--brand-strong)',
                                ink: 'var(--brand-ink)',
                                soft: 'var(--brand-soft)',
                        },
                        ink: {
                                DEFAULT: 'var(--ink)',
                                secondary: 'var(--ink-secondary)',
                                muted: 'var(--ink-muted)',
                        },
                        surface: {
                                0: 'var(--surface-0)',
                                1: 'var(--surface-1)',
                                2: 'var(--surface-2)',
                        },
                        line: 'var(--line)',
                        background: 'hsl(var(--background))',
                        foreground: 'hsl(var(--foreground))',
                        card: {
                                DEFAULT: 'hsl(var(--card))',
                                foreground: 'hsl(var(--card-foreground))'
                        },
                        popover: {
                                DEFAULT: 'hsl(var(--popover))',
                                foreground: 'hsl(var(--popover-foreground))'
                        },
                        primary: {
                                DEFAULT: 'hsl(var(--primary))',
                                foreground: 'hsl(var(--primary-foreground))'
                        },
                        secondary: {
                                DEFAULT: 'hsl(var(--secondary))',
                                foreground: 'hsl(var(--secondary-foreground))'
                        },
                        muted: {
                                DEFAULT: 'hsl(var(--muted))',
                                foreground: 'hsl(var(--muted-foreground))'
                        },
                        accent: {
                                DEFAULT: 'hsl(var(--accent))',
                                foreground: 'hsl(var(--accent-foreground))'
                        },
                        destructive: {
                                DEFAULT: 'hsl(var(--destructive))',
                                foreground: 'hsl(var(--destructive-foreground))'
                        },
                        border: 'hsl(var(--border))',
                        input: 'hsl(var(--input))',
                        ring: 'hsl(var(--ring))',
                        chart: {
                                '1': 'hsl(var(--chart-1))',
                                '2': 'hsl(var(--chart-2))',
                                '3': 'hsl(var(--chart-3))',
                                '4': 'hsl(var(--chart-4))',
                                '5': 'hsl(var(--chart-5))'
                        },
                        sidebar: {
                                DEFAULT: 'hsl(var(--sidebar-background))',
                                foreground: 'hsl(var(--sidebar-foreground))',
                                primary: 'hsl(var(--sidebar-primary))',
                                'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
                                accent: 'hsl(var(--sidebar-accent))',
                                'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
                                border: 'hsl(var(--sidebar-border))',
                                ring: 'hsl(var(--sidebar-ring))'
                        }
                },
                keyframes: {
                        'accordion-down': {
                                from: {
                                        height: '0'
                                },
                                to: {
                                        height: 'var(--radix-accordion-content-height)'
                                }
                        },
                        'accordion-up': {
                                from: {
                                        height: 'var(--radix-accordion-content-height)'
                                },
                                to: {
                                        height: '0'
                                }
                        }
                },
                animation: {
                        'accordion-down': 'accordion-down 0.2s ease-out',
                        'accordion-up': 'accordion-up 0.2s ease-out'
                }
        }
  },
  plugins: [require("tailwindcss-animate")],
}
