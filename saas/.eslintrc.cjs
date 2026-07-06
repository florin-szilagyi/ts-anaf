module.exports = {
  root: false,
  extends: ['../.eslintrc.js'],
  parserOptions: {
    project: null,
    ecmaFeatures: { jsx: true },
  },
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  rules: {
    // Next.js server/client components rely on default exports for pages/layouts.
    'import/no-default-export': 'off',
  },
};
