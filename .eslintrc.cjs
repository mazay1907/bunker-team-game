module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // tsconfig.eslint.json extends the server's real tsconfig but also includes
    // root-level tooling files (e.g. vitest.config.ts) that "src/**/*"-scoped
    // tsconfig.json intentionally excludes from the build.
    project: [
      './packages/shared/tsconfig.json',
      './packages/server/tsconfig.eslint.json',
    ],
    tsconfigRootDir: __dirname,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    'no-console': 'off',
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '*.cjs'],
};
