
import * as assert from 'assert';
import * as vscode from 'vscode';
import { GenericExtractorService } from '../../services/generic-extractor.service';
import { DetectedCSSClass } from '../../models';

suite('Generic Extractor Service', () => {
    const genericExtractorService = new GenericExtractorService();

	test('extractClassNames finds classes from CSS', () => {
		const css = `
		.foo, .bar > .baz:hover { color: red }
		#id .qux { display: none }
		`;

		const result = Array.from(genericExtractorService.extractClassNames(css)).map(x => x.name);
		assert.ok(result.includes('foo'));
		assert.ok(result.includes('bar'));
		assert.ok(result.includes('baz'));
		assert.ok(result.includes('qux'));
	});

	test('getUsedClassesInFiles detects class in class attribute and ngClass', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'foo', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
            { name: 'ngtest', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 6], isGlobal: true },
            { name: 'missing', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 7], isGlobal: true }
        ]);

		const fileUri = vscode.Uri.file('/fake/path/file1.html');
		const fileContentsMap = new Map<string, string>([
			[fileUri.fsPath, `<div class="foo other"></div>\n<div [ngClass]="{'ngtest': cond}"></div>`]
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
			const usedClassNames = await genericExtractorService.getUsedClassesInFiles([fileUri], classNames);
			assert.ok(usedClassNames.has('foo'));
			assert.ok(usedClassNames.has('ngtest'));
			assert.ok(!usedClassNames.has('missing'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

	test('getUsedClassesInFiles detects [class.name] binding', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'active', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 6], isGlobal: true },
            { name: 'missing', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 7], isGlobal: true }
        ]);

		const fileUri = vscode.Uri.file('/fake/path/file2.html');
		const fileContentsMap = new Map<string, string>([
			[fileUri.fsPath, `<button [class.active]="isActive">Click</button>`]
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
			const usedClassNames = await genericExtractorService.getUsedClassesInFiles([fileUri], classNames);
			assert.ok(usedClassNames.has('active'));
			assert.ok(!usedClassNames.has('missing'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

    test('extractClassNames handles complex selectors with pseudo-classes and combinators', () => {
        const css = `
        .container .item:hover::before { content: ""; }
        .btn-primary.active:focus { outline: none; }
        .parent > .child + .sibling ~ .other { margin: 0; }
        `;

        const result = Array.from(genericExtractorService.extractClassNames(css)).map(x => x.name);
        assert.ok(result.includes('container'));
        assert.ok(result.includes('item'));
        assert.ok(result.includes('btn-primary'));
        assert.ok(result.includes('active'));
        assert.ok(result.includes('parent'));
        assert.ok(result.includes('child'));
        assert.ok(result.includes('sibling'));
        assert.ok(result.includes('other'));
    });

    test('extractClassNames handles media queries and nested rules', () => {
        const css = `
        @media (max-width: 768px) {
            .mobile-only { display: block; }
        }
        .wrapper {
            .nested { color: blue; }
        }
        `;

        const result = Array.from(genericExtractorService.extractClassNames(css)).map(x => x.name);
        assert.ok(result.includes('mobile-only'));
        assert.ok(result.includes('wrapper'));
        assert.ok(result.includes('nested'));
    });

    test('extractClassNames ignores IDs and other selectors', () => {
        const css = `
        #header { background: white; }
        div[data-test] { color: red; }
        .valid-class { font-size: 16px; }
        `;

        const result = Array.from(genericExtractorService.extractClassNames(css)).map(x => x.name);
        assert.strictEqual(result.length, 1);
        assert.ok(result.includes('valid-class'));
    });

    test('getUsedClassesInFiles detects classes in className attribute', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'btn', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
            { name: 'btn-primary', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 11], isGlobal: true },
            { name: 'unused', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 6], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/component.tsx');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<button className="btn btn-primary">Submit</button>`]
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
            const usedClassNames = await genericExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('btn'));
            assert.ok(usedClassNames.has('btn-primary'));
            assert.ok(!usedClassNames.has('unused'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles handles classes with special characters', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'test-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 10], isGlobal: true },
            { name: 'test_underscore', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 15], isGlobal: true },
            { name: 'test123', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 7], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/file.html');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div class="test-class test_underscore test123"></div>`]
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
            const usedClassNames = await genericExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('test-class'));
            assert.ok(usedClassNames.has('test_underscore'));
            assert.ok(usedClassNames.has('test123'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles ignores HTML comments', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'visible', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 7], isGlobal: true },
            { name: 'commented', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 9], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/file.html');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `
                <div class="visible">Visible</div>
                <!-- <div class="commented">This is commented out</div> -->
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
            const usedClassNames = await genericExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('visible'));
            assert.ok(!usedClassNames.has('commented'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles handles ngClass object syntax', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'error', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 5], isGlobal: true },
            { name: 'warning', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 7], isGlobal: true },
            { name: 'unused', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 6], isGlobal: true }
        ]);

        const fileUri = vscode.Uri.file('/fake/path/component.html');
        const fileContentsMap = new Map<string, string>([
            [fileUri.fsPath, `<div [ngClass]="{ 'error': hasError, 'warning': hasWarning }"></div>`]
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
            const usedClassNames = await genericExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('error'));
            assert.ok(usedClassNames.has('warning'));
            assert.ok(!usedClassNames.has('unused'));
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('getUsedClassesInFiles stops early when all classes are found', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'found', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 5], isGlobal: true }
        ]);

        const fileUri1 = vscode.Uri.file('/fake/path/file1.html');
        const fileUri2 = vscode.Uri.file('/fake/path/file2.html');
        const fileContentsMap = new Map<string, string>([
            [fileUri1.fsPath, `<div class="found">Found</div>`],
            [fileUri2.fsPath, `<div class="other">Other</div>`]
        ]);

        const originalFs = vscode.workspace.fs;
        let readFileCallCount = 0;
        Object.defineProperty(vscode.workspace, 'fs', {
            value: {
                readFile: (uri: vscode.Uri) => {
                    readFileCallCount++;
                    const content = fileContentsMap.get(uri.fsPath) ?? '';
                    return Promise.resolve(Buffer.from(content));
                }
            },
            configurable: true
        });

        try {
            const usedClassNames = await genericExtractorService.getUsedClassesInFiles([fileUri1, fileUri2], classNames);
            assert.ok(usedClassNames.has('found'));
            assert.strictEqual(readFileCallCount, 1); // Should stop after first file
        } finally {
            Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
        }
    });

    test('isFileOfInterest returns true for CSS file extensions', () => {
        assert.ok(genericExtractorService.isFileOfInterest('styles.css'));
        assert.ok(genericExtractorService.isFileOfInterest('component.scss'));
        assert.ok(genericExtractorService.isFileOfInterest('theme.less'));
        assert.ok(genericExtractorService.isFileOfInterest('variables.sass'));
    });

    test('isFileOfInterest returns false for non-CSS file extensions', () => {
        assert.ok(!genericExtractorService.isFileOfInterest('component.ts'));
        assert.ok(!genericExtractorService.isFileOfInterest('template.html'));
        assert.ok(!genericExtractorService.isFileOfInterest('data.json'));
        assert.ok(!genericExtractorService.isFileOfInterest('readme.md'));
    });

    test('extractClassNames handles empty CSS gracefully', () => {
        const css = '';
        const result = Array.from(genericExtractorService.extractClassNames(css));
        assert.strictEqual(result.length, 0);
    });

    test('extractClassNames handles CSS with no classes', () => {
        const css = `
        #id { color: red; }
        div { margin: 0; }
        [data-attr] { padding: 10px; }
        `;
        const result = Array.from(genericExtractorService.extractClassNames(css));
        assert.strictEqual(result.length, 0);
    });
});