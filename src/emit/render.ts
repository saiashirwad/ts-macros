// text targets carry precedence in the rendered value instead of threading
// a context through the walk: a parent parenthesizes any child looser than
// the position it puts it in
export interface Fragment {
  readonly prec: number
  readonly text: string
}

export const frag = (prec: number, text: string): Fragment => ({ prec, text })

export const at = (fragment: Fragment, min: number): string => (fragment.prec >= min ? fragment.text : `(${fragment.text})`)

export const indent = (lines: readonly string[]): string =>
  lines
    .flatMap((line) => line.split("\n"))
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n")

export const braces = (lines: readonly string[]): string => (lines.length === 0 ? "{}" : `{\n${indent(lines)}\n}`)
