import js from '@eslint/js'
import globals from 'globals'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'
import stylelint from 'eslint-config-stylelint'

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'public/**',
            'server/**',
            '**/*.scss',
            'src/**/*.test.*',
        ],
    },
    // Базовый набор правил eslint
    js.configs.recommended,
    // Базовые и типизированные правила TypeScript
    ...tseslint.configs.recommendedTypeChecked,
    // eslint-config-stylelint
    ...stylelint,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.es2021,
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            '@typescript-eslint/strict-boolean-expressions': [
                'error',
                {
                    allowString: false,
                    allowNumber: false,
                },
            ],
            'no-console': 'off',
            'no-use-before-define': 'off',
            '@typescript-eslint/no-use-before-define': 'error',
            // Браузерное приложение: правила eslint-plugin-n из eslint-config-stylelint не применимы
            'n/no-unsupported-features/node-builtins': 'off',
            'sort-imports': ['error', {
                ignoreCase: false,
                ignoreDeclarationSort: true,
                ignoreMemberSort: false,
                memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
                allowSeparatedGroups: true,
            }],

            '@stylistic/linebreak-style': ['error', 'unix'], // символ(ы) конца строки
            '@stylistic/quotes': ['error', 'single'], // использовать одинарные кавычки
            '@stylistic/semi': ['error', 'never'], // точка с запятой в конце операторов
            '@stylistic/indent': ['error', 4, { SwitchCase: 1 }], // отступы в коде из 4 пробелов с учетом switch...case
            '@stylistic/no-trailing-spaces': 'error', // не должно быть пробелов в конце строки
            '@stylistic/brace-style': ['error', '1tbs'], // правила для фигурных скобок для блоков кода
            '@stylistic/keyword-spacing': 'error', // пробел слева и справа для ключевых слов
            '@stylistic/no-multi-spaces': 'error', // не допускается несколько пробелов подряд
            '@stylistic/no-multiple-empty-lines': 'error', // не больше 2 пустых строк подряд
            '@stylistic/comma-dangle': ['error', { // запятая после последнего элемента массива или объекта
                arrays: 'always-multiline',
                objects: 'always-multiline',
                imports: 'always-multiline',
                exports: 'always-multiline',
                functions: 'never',
            }],
        },
    },
)
