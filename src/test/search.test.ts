import * as assert from 'assert';
import * as vscode from 'vscode';
import { extractClassNames, checkClassUsageInFiles } from '../search';

suite('Search utilities', () => {
	test('extractClassNames finds classes from CSS', () => {
		const css = `
		.foo, .bar > .baz:hover { color: red }
		#id .qux { display: none }
		`;

		const result = extractClassNames(css);
		assert.ok(result.has('foo'));
		assert.ok(result.has('bar'));
		assert.ok(result.has('baz'));
		assert.ok(result.has('qux'));
	});

	test('checkClassUsageInFiles detects class in class attribute and ngClass', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const classNames = new Set<string>(['foo', 'ngtest', 'missing']);
		const usedClassNames = new Set<string>();

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
			await checkClassUsageInFiles([fileUri], textDecoder, classNames, usedClassNames);
			assert.ok(usedClassNames.has('foo'));
			assert.ok(usedClassNames.has('ngtest'));
			assert.ok(!usedClassNames.has('missign'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

	test('checkClassUsageInFiles detects [class.name] binding', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const classNames = new Set<string>(['active', 'missing']);
		const usedClassNames = new Set<string>();

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
			await checkClassUsageInFiles([fileUri], textDecoder, classNames, usedClassNames);
			assert.ok(usedClassNames.has('active'));
			assert.ok(!usedClassNames.has('missing'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});
});
