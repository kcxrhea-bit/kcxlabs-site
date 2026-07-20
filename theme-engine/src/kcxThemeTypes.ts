export type KCxThemeToken = "orange" | "cyan" | "violet" | "surface" | "ink";
export const kcxTheme = { orange: "#ff7a1a", cyan: "#3be7ff", violet: "#8a5cff", surface: "#121214", ink: "#050506" } as const;
export const getThemeToken = (token: KCxThemeToken) => kcxTheme[token];
