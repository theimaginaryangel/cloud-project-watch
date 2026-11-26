import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      ".cpw-data/**",
      ".tagwatch-data/**",
      "drizzle/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
