import { defineConfig } from "eslint/config";
import parser from "next/dist/compiled/babel/eslint-parser.js";

export default defineConfig([
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/coverage/**"]
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: "module",
        ecmaVersion: "latest",
        babelOptions: {
          presets: ["next/babel"]
        }
      }
    }
  }
]);
