import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.{js,ts,jsx,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        L: 'readonly', // Leaflet global
        alert: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        event: 'readonly',
        navigator: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        Blob: 'readonly',
        Worker: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        showErrorNotification: 'readonly',
        require: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'off', // Turn off base rule
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // TODO: re-enable and strip debug logs before 1.0 release
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all']
    }
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      '*.min.js',
      'bundle.js'
    ]
  }
);