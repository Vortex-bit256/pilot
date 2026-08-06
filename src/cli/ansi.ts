


export const isTTY = Boolean(process.stdout.isTTY);
export const useColor = isTTY && !process.env.NO_COLOR;

export function paint(code: string, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const dim = (text: string) => paint("2", text);
export const red = (text: string) => paint("31", text);
export const green = (text: string) => paint("32", text);
export const cyan = (text: string) => paint("36", text);
export const yellow = (text: string) => paint("33", text);
