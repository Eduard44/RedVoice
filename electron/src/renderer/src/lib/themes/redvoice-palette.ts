import { type ThemeColors, type ThemeDefinition } from './t3-palettes';

// RedVoice palette: neutral dark panels in the style of video editing suites,
// with one red accent. Dark is the original; the light variant is an adaptation.
// Errors use orange so they stay distinguishable from the red action colour.
function colors(light: boolean): ThemeColors {
  const canvas = light ? '#f4f4f5' : '#1b1b1d';
  const chrome = light ? '#e9e9eb' : '#141416';
  const surface = light ? '#ffffff' : '#262629';
  const raised = light ? '#ffffff' : '#2d2d31';
  const text = light ? '#1f1f22' : '#e6e6e8';
  const muted = light ? '#66666d' : '#9d9da3';
  const border = light ? 'rgb(0 0 0 / 12%)' : 'rgb(255 255 255 / 10%)';
  const input = light ? 'rgb(0 0 0 / 20%)' : 'rgb(255 255 255 / 16%)';
  const hover = light ? '#e2e2e5' : '#303034';
  const active = light ? '#d6d6da' : '#3a3a3f';
  // Fill colour for buttons (white text on it) and its readable-as-text sibling.
  const action = light ? '#c81e22' : '#d92d30';
  const actionHover = light ? '#a9171b' : '#c4262a';
  const actionText = light ? '#b3181c' : '#ff6166';
  const error = light ? '#b54708' : '#ff7b54';
  const warning = light ? '#8a5a00' : '#f5c244';
  return {
    canvas,
    chrome,
    toolbar: chrome,
    toolbarForeground: text,
    toolbarBorder: border,
    toolbarControl: surface,
    toolbarControlForeground: text,
    toolbarControlHover: hover,
    surface,
    surfaceRaised: raised,
    surfaceOverlay: raised,
    text,
    textMuted: muted,
    border,
    input,
    focus: action,
    accent: action,
    accentForeground: '#ffffff',
    secondary: hover,
    secondaryForeground: text,
    muted: hover,
    mutedForeground: muted,
    placeholder: muted,
    secondaryLabel: muted,
    iconMuted: muted,
    error,
    errorForeground: error,
    errorSurface: light ? '#fdebe1' : '#3a251d',
    warning,
    warningForeground: warning,
    warningSurface: light ? '#fbf1d8' : '#383018',
    update: action,
    updateForeground: actionText,
    updateSurface: hover,
    accentSurface: hover,
    accentSurfaceForeground: text,
    messageSurface: surface,
    messageForeground: text,
    messageAction: action,
    messageActionForeground: '#ffffff',
    messageActionHover: actionHover,
    codeBackground: chrome,
    codeForeground: text,
    sidebar: chrome,
    sidebarForeground: text,
    sidebarMutedForeground: muted,
    sidebarControlSurface: surface,
    sidebarRowHover: hover,
    sidebarRowActive: active,
    sidebarRowSelected: surface,
    sidebarBorder: border,
    terminalBackground: canvas,
    terminalForeground: text,
    terminalCursor: actionText,
    terminalSelection: active,
    terminalScrollbar: border,
    terminalScrollbarHover: muted,
  };
}
export const REDVOICE_THEME: ThemeDefinition = {
  id: 'redvoice',
  label: 'RedVoice',
  appearance: 'dark',
  colors: colors(false),
  variants: { light: colors(true) },
};
