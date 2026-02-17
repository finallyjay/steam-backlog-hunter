import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

/** @type {import("eslint").Linter.FlatConfig[]} */
const config = [
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "coverage/**"],
  },
]

export default config
