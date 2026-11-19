import { color, type ColorTheme, type ThemeName } from '@flero/ui-tokens';
import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

export interface Theme {
  name: ThemeName;
  c: ColorTheme;
}

const ThemeContext = createContext<Theme>({ name: 'dark', c: color.dark });

/** Follows the OS appearance; FLERO Gece is designed dark-first, light is fully supported from the same tokens. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const name: ThemeName = useColorScheme() === 'light' ? 'light' : 'dark';
  return <ThemeContext.Provider value={{ name, c: color[name] }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Renders children in a fixed theme (design review screens compare dark and light side by side). */
export function ForceTheme({ name, children }: { name: ThemeName; children: ReactNode }) {
  return <ThemeContext.Provider value={{ name, c: color[name] }}>{children}</ThemeContext.Provider>;
}

/** Registered in the root layout. Display = Bricolage Grotesque (names, titles); UI = Inter. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  display: 'BricolageGrotesque_700Bold',
  displayHeavy: 'BricolageGrotesque_800ExtraBold',
} as const;
