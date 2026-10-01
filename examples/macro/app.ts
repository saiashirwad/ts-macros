// Ordinary code using a macro module.

import { cube, polynomial } from "./polynomial.macro.ts"

const total = polynomial(2) + cube(3)
console.log(total)

polynomial("2")
