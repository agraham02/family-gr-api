import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
    {
        ignores: ["node_modules/**", "dist/**"],
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            // TypeScript-specific rules
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],

            // General rules
            "no-console": "off",
            "prefer-const": "warn",
        },
    },
];
