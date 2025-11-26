import * as assert from 'assert';
import * as vscode from 'vscode';
import { TwigExtractorService } from '../../services/twig-extractor.service';
import { DetectedCSSClass } from '../../models';

suite('Twig Extractor Service', () => {
    const twigExtractorService = new TwigExtractorService();

    test('isFileOfInterest returns true for .twig files', () => {
        assert.ok(twigExtractorService.isFileOfInterest('template.twig'));
        assert.ok(twigExtractorService.isFileOfInterest('components/header.twig'));
    });

    test('isFileOfInterest returns false for non-twig files', () => {
        assert.strictEqual(twigExtractorService.isFileOfInterest('style.css'), false);
        assert.strictEqual(twigExtractorService.isFileOfInterest('script.js'), false);
        assert.strictEqual(twigExtractorService.isFileOfInterest('component.vue'), false);
    });

    test('extractClassNames extracts class names from style blocks', () => {
        const content = `
            <div class="container">
                <h1>Hello</h1>
            </div>
            <style>
                .container {
                    width: 100%;
                }
                .header {
                    font-size: 24px;
                }
            </style>
        `;

        const result = twigExtractorService.extractClassNames(content);
        const classNames = Array.from(result).map(c => c.name);

        assert.ok(classNames.includes('container'));
        assert.ok(classNames.includes('header'));
        assert.strictEqual(result.size, 2);
    });

    test('extractClassNames marks all classes as global', () => {
        const content = `
            <style>
                .global-class {
                    color: red;
                }
            </style>
        `;

        const result = twigExtractorService.extractClassNames(content);
        const classArray = Array.from(result);

        assert.ok(classArray.every(c => c.isGlobal));
    });

    test('extractClassNames handles multiple style blocks', () => {
        const content = `
            <style>
                .class-one {
                    color: red;
                }
            </style>
            <div>Content</div>
            <style>
                .class-two {
                    color: blue;
                }
            </style>
        `;

        const result = twigExtractorService.extractClassNames(content);
        const classNames = Array.from(result).map(c => c.name);

        assert.ok(classNames.includes('class-one'));
        assert.ok(classNames.includes('class-two'));
        assert.strictEqual(result.size, 2);
    });

    test('extractClassNames handles nested selectors', () => {
        const content = `
            <style>
                .parent {
                    .child {
                        color: red;
                    }
                }
                .standalone {
                    margin: 0;
                }
            </style>
        `;

        const result = twigExtractorService.extractClassNames(content);
        const classNames = Array.from(result).map(c => c.name);

        assert.ok(classNames.includes('parent'));
        assert.ok(classNames.includes('child'));
        assert.ok(classNames.includes('standalone'));
    });

    test('extractClassNames returns empty set when no style blocks exist', () => {
        const content = `
            <div class="container">
                <h1>No styles here</h1>
            </div>
        `;

        const result = twigExtractorService.extractClassNames(content);

        assert.strictEqual(result.size, 0);
    });

    test('extractClassNames handles empty style blocks', () => {
        const content = `
            <style></style>
            <style>
            </style>
        `;

        const result = twigExtractorService.extractClassNames(content);

        assert.strictEqual(result.size, 0);
    });

    test('getUsedClassesInFiles detects classes in HTML class attributes', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'container', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 9], isGlobal: true },
            { name: 'header', cssClassStartOffset: [1, 0], cssClassEndOffset: [1, 6], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/template.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `
                <div class="container">
                    <h1 class="header">Title</h1>
                </div>
            `]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('container'));
            assert.ok(usedClassNames.has('header'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles detects classes in Twig variable interpolation', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'dynamic-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 13], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/dynamic.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div class="{{ 'dynamic-class' }}">Content</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('dynamic-class'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles detects classes in Twig set statements', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'set-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 9], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/set.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `{% set className = 'set-class' %}<div class="{{ className }}">Content</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('set-class'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles detects classes in Twig filters', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'filter-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 12], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/filter.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div class="{{ baseClass|default('filter-class') }}">Content</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('filter-class'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles should NOT detect classes in script blocks', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'js-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 8], isGlobal: true },
            { name: 'visible-class', cssClassStartOffset: [1, 0], cssClassEndOffset: [1, 13], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/script.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `
                <script>element.classList.add('js-class');</script>
                <div class="visible-class">Visible</div>
            `]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.strictEqual(usedClassNames.size, 1);
            assert.ok(!usedClassNames.has('js-class'));
            assert.ok(usedClassNames.has('visible-class'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles should not detect classes in Twig comments', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'commented-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 15], isGlobal: true },
            { name: 'active-class', cssClassStartOffset: [1, 0], cssClassEndOffset: [1, 12], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/twig-comment.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `{# <div class="commented-class">Ignored</div> #}<div class="active-class">Visible</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.strictEqual(usedClassNames.size, 1);
            assert.ok(usedClassNames.has('active-class'));
            assert.ok(!usedClassNames.has('commented-class'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles should not detect classes in HTML comments', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'html-commented', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 14], isGlobal: true },
            { name: 'visible', cssClassStartOffset: [1, 0], cssClassEndOffset: [1, 7], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/html-comment.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<!-- <div class="html-commented">Ignored</div> --><div class="visible">Visible</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.strictEqual(usedClassNames.size, 1);
            assert.ok(usedClassNames.has('visible'));
            assert.ok(!usedClassNames.has('html-commented'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles returns empty set when no classes are used', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'unused-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 12], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/unused.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div class="different-class"><h1>Title</h1></div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.strictEqual(usedClassNames.size, 0);
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles handles multiline class attributes', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'multiline-class-1', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 17], isGlobal: true },
            { name: 'multiline-class-2', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 17], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/multiline.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div class="multiline-class-1 multiline-class-2">Content</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('multiline-class-1'));
            assert.ok(usedClassNames.has('multiline-class-2'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles handles Twig concatenation with tilde', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'concat-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 12], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/concat.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div class="{{ 'prefix-' ~ 'concat-class' }}">Content</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('concat-class'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles handles Twig ternary operators', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'active-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 12], isGlobal: true },
            { name: 'inactive-class', cssClassStartOffset: [1, 0], cssClassEndOffset: [1, 14], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/ternary.twig');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div class="{{ isActive ? 'active-class' : 'inactive-class' }}">Content</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await twigExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('active-class'));
            assert.ok(usedClassNames.has('inactive-class'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });
});