/** emitted text with the precedence of its outermost operator; higher binds tighter */
export interface Fragment {
  readonly prec: number
  readonly text: string
}

export const frag = (prec: number, text: string): Fragment => ({ prec, text })

/** the fragment's text, parenthesized when it binds looser than `min` */
export const at = (fragment: Fragment, min: number): string => (fragment.prec >= min ? fragment.text : `(${fragment.text})`)

/** a brace-delimited block with each line indented */
export const braces = (lines: readonly string[]): string =>
  lines.length === 0 ? "{}" : `{\n${lines.flatMap((line) => line.split("\n")).map((line) => (line === "" ? line : `  ${line}`)).join("\n")}\n}`
