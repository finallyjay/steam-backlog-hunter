import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"
import prettierConfig from "eslint-config-prettier"

/** @type {import("eslint").Linter.FlatConfig[]} */
const config = [
  ...nextVitals,
  ...nextTypeScript,
  prettierConfig,
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
