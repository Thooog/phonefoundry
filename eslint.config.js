import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.vite/**',
      // 脚本用 --user-data-dir 起的临时 Chrome profile，里面是浏览器扩展的第三方代码。
      // 用 .tmp-* 通配而不是固定名字 —— 每个探针都有自己的 profile 后缀。
      '**/.tmp-chrome-profile*/**',
    ],
  },

  js.configs.recommended,
  ...vue.configs['flat/recommended'],

  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 代码规范：2 空格、无分号偏好由 prettier 处理，这里只管正确性
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',

      // Vue：组件名 PascalCase（多单词）
      'vue/multi-word-component-names': 'off',
      'vue/component-name-in-template-casing': ['warn', 'PascalCase'],
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': ['warn', 2],
      'vue/script-indent': 'off',
    },
  },

  // 架构边界：ESLint 能拦住的先拦住，脚本再兜底扫描
  {
    files: ['packages/player-ui/**/*.{js,vue}', 'apps/player/**/*.{js,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pinia', message: '作品端不得使用 pinia（只读渲染，无 store）' },
            { name: 'vue-router', message: '作品端使用自研极简导航栈，不得引入 vue-router' },
            { name: 'fflate', message: 'fflate 仅用于创作端导出' },
          ],
          patterns: [
            {
              group: ['@phone-sim/creator', '@phone-sim/exporter', '**/apps/creator/**'],
              message: '作品端不得依赖编辑端或导出器',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['packages/shared/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vue', message: 'shared 必须框架无关' },
            { name: 'pinia', message: 'shared 必须框架无关' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'shared 不得触碰 DOM' },
        { name: 'window', message: 'shared 不得触碰 window' },
        { name: 'localStorage', message: 'shared 不得触碰存储' },
        { name: 'indexedDB', message: 'shared 不得触碰存储' },
      ],
    },
  },

  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
]
