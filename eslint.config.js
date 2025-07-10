export default [
  {
    files: ['**/*.mjs'],
    ignores: ['**/*.test.mjs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        process: 'readonly'
      },
    },
    rules: {
    },
  },
];
