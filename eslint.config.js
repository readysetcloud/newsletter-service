export default [
  { ignores: ["dashboard-ui/**"]},
  {
    files: ['**/*.mjs'],
    ignores: ['**/*.test.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly'
      },
    },
    rules: {
    },
  },
];
