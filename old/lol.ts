import { $, type, str, generate } from "./index.ts"

const block = $.block(function* () {
  const User = yield* $.type(
    "User",
    type.object({
      name: type.string(),
    }),
  )

  const formatUser = yield* $.function(
    "formatUser",
    [$.p("user", User)] as const,
    function* ({ user }) {
      return str.concat($.prop(user, "name"), "!")
    },
    { returnType: type.string() },
  )

  const { user } = yield* $.bind({
    user: {
      value: { name: "Ada" },
      tsType: User,
    },
  })

  const { formattedUser } = yield* $.bind({
    formattedUser: $.call(formatUser, [user]),
  })
}).toBabelAST()

const { code } = generate(block)
console.log(code)
