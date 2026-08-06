


export const isTTY = Boolean(process.stdout.isTTY);
export const useColor = isTTY && !process.env.NO_COLOR;

export function paint(code: string, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}


export function style(codes: string, text: string): string {
  return paint(codes, text);
}


export function rgb(r: number, g: number, b: number, text: string): string {
  return paint(`38;2;${r};${g};${b}`, text);
}


export function fg256(n: number, text: string): string {
  return paint(`38;5;${n}`, text);
}

export const reset = (text: string) => paint("0", text);
export const bold = (text: string) => paint("1", text);
export const dim = (text: string) => paint("2", text);
export const italic = (text: string) => paint("3", text);
export const underline = (text: string) => paint("4", text);
export const inverse = (text: string) => paint("7", text);

export const red = (text: string) => paint("31", text);
export const green = (text: string) => paint("32", text);
export const yellow = (text: string) => paint("33", text);
export const blue = (text: string) => paint("34", text);
export const magenta = (text: string) => paint("35", text);
export const cyan = (text: string) => paint("36", text);
export const white = (text: string) => paint("37", text);
export const gray = (text: string) => paint("90", text);

export const boldRed = (text: string) => paint("1;31", text);
export const boldGreen = (text: string) => paint("1;32", text);
export const boldYellow = (text: string) => paint("1;33", text);
export const boldBlue = (text: string) => paint("1;34", text);
export const boldMagenta = (text: string) => paint("1;35", text);
export const boldCyan = (text: string) => paint("1;36", text);
export const boldWhite = (text: string) => paint("1;37", text);


export const theme = {

  primary: (text: string) => rgb(158, 134, 200, text),

  accent: (text: string) => rgb(110, 196, 197, text),

  success: (text: string) => rgb(126, 184, 131, text),

  warning: (text: string) => rgb(229, 192, 123, text),

  error: (text: string) => rgb(224, 108, 117, text),

  text: (text: string) => rgb(215, 218, 224, text),

  muted: (text: string) => fg256(245, text),

  faint: (text: string) => fg256(240, text),

  diffAdd: (text: string) => rgb(126, 184, 131, text),

  diffDel: (text: string) => rgb(224, 108, 117, text),

  diffContext: (text: string) => fg256(245, text),

  primaryBold: (text: string) => paint("1", rgb(158, 134, 200, text)),
};


function boldOf(painter: (text: string) => string): (text: string) => string {
  return (text) => paint("1", painter(text));
}

export const themeBold = {
  primary: boldOf(theme.primary),
  accent: boldOf(theme.accent),
  success: boldOf(theme.success),
  warning: boldOf(theme.warning),
  error: boldOf(theme.error),
  text: boldOf(theme.text),
};


export const ERASE_LINE = "\r\x1b[K";

export const CURSOR_UP = "\x1b[1A";

export const HIDE_CURSOR = "\x1b[?25l";

export const SHOW_CURSOR = "\x1b[?25h";


export function stripAnsi(text: string): string {

  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}


export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}


export function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}
