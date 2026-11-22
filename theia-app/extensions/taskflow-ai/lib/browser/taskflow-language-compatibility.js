import * as monaco from '@theia/monaco-editor-core';

const PYTHON_LANGUAGE_ID = 'python';

const pythonKeywords = [
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for',
    'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
    'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while',
    'with', 'yield', 'None'
];

const pythonBuiltins = [
    'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray',
    'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
    'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec',
    'filter', 'float', 'format', 'frozenset', 'getattr', 'globals',
    'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance',
    'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max',
    'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
    'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
    'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
    'tuple', 'type', 'vars', 'zip'
];

export function registerPythonLanguage() {
    if (monaco.languages.getLanguages().some(({ id }) => id === PYTHON_LANGUAGE_ID)) {
        return;
    }

    monaco.languages.register({
        id: PYTHON_LANGUAGE_ID,
        extensions: ['.py', '.pyw', '.pyi'],
        aliases: ['Python', 'python'],
        mimetypes: ['text/x-python']
    });

    monaco.languages.setMonarchTokensProvider(PYTHON_LANGUAGE_ID, {
        defaultToken: '',
        tokenPostfix: '.python',
        keywords: pythonKeywords,
        builtins: pythonBuiltins,
        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
            '+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=',
            '>>=', '<<=', '**', '//', '<<', '>>', '->'
        ],
        symbols: /[=><!~?:&|+\-*\/\^%]+/,
        tokenizer: {
            root: [
                [/[ \t\r\n]+/, 'white'],
                [/#.*$/, 'comment'],
                [/@[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/, 'annotation'],
                [/[rRuUbBfF]{0,2}"""/, { token: 'string.quote', next: '@tripleDouble' }],
                [/[rRuUbBfF]{0,2}'''/, { token: 'string.quote', next: '@tripleSingle' }],
                [/[rRuUbBfF]{0,2}"/, { token: 'string.quote', next: '@doubleString' }],
                [/[rRuUbBfF]{0,2}'/, { token: 'string.quote', next: '@singleString' }],
                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@builtins': 'type.identifier',
                        '@default': 'identifier'
                    }
                }],
                [/(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?j?|\.\d[\d_]*(?:[eE][+-]?[\d_]+)?j?)/, 'number'],
                [/[{}()[\]]/, '@brackets'],
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }],
                [/[;,.]/, 'delimiter']
            ],
            doubleString: [
                [/$/, { token: '', next: '@pop' }],
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, { token: 'string.quote', next: '@pop' }]
            ],
            singleString: [
                [/$/, { token: '', next: '@pop' }],
                [/[^\\']+/, 'string'],
                [/\\./, 'string.escape'],
                [/'/, { token: 'string.quote', next: '@pop' }]
            ],
            tripleDouble: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"""/, { token: 'string.quote', next: '@pop' }],
                [/"/, 'string']
            ],
            tripleSingle: [
                [/[^\\']+/, 'string'],
                [/\\./, 'string.escape'],
                [/'''/, { token: 'string.quote', next: '@pop' }],
                [/'/, 'string']
            ]
        }
    });

    monaco.languages.setLanguageConfiguration(PYTHON_LANGUAGE_ID, {
        comments: { lineComment: '#' },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"', notIn: ['string', 'comment'] },
            { open: "'", close: "'", notIn: ['string', 'comment'] }
        ],
        surroundingPairs: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')'],
            ['"', '"'],
            ["'", "'"]
        ],
        indentationRules: {
            increaseIndentPattern: /^\s*(async\s+)?(def|class|if|elif|else|for|while|try|except|finally|with)\b.*:\s*(#.*)?$/,
            decreaseIndentPattern: /^\s*(elif|else|except|finally)\b/
        }
    });
}
