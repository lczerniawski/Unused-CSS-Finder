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
			assert.ok(!usedClassNames.has('missing'));
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


	test('checkClassUsageInFiles handles non-scoped (global) classes across multiple files', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const classNames = new Set<string>(['global-class', 'another-class']);
		const usedClassNames = new Set<string>();

		const fileAUri = vscode.Uri.file('/fake/path/fileA.html');
		const fileBUri = vscode.Uri.file('/fake/path/fileB.html');
		const fileContentsMap = new Map<string, string>([
			[fileAUri.fsPath, `<div class="global-class"></div>`],
			[fileBUri.fsPath, `<span class="another-class"></span>`]
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
			await checkClassUsageInFiles([fileAUri, fileBUri], textDecoder, classNames, usedClassNames);
			assert.strictEqual(usedClassNames.size, 2);
			assert.ok(usedClassNames.has('global-class'));
			assert.ok(usedClassNames.has('another-class'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

	test('checkClassUsageInFiles handles scoped classes correctly', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const fileAUri = vscode.Uri.file('/fake/path/fileA.vue');
		const fileBUri = vscode.Uri.file('/fake/path/fileB.vue');

		const scopedClassNames = new Set<ScopedClassName>([
			{ className: 'scoped-a', fsPath: fileAUri.fsPath },
			{ className: 'scoped-b', fsPath: fileBUri.fsPath },
			{ className: 'unused-scoped', fsPath: fileAUri.fsPath },
		]);
		const usedScopedClassNames = new Set<ScopedClassName>();

		const fileContentsMap = new Map<string, string>([
			// fileA uses its own scoped class, and a class from another component's scope (which should not be matched)
			[fileAUri.fsPath, `<div class="scoped-a scoped-b"></div>`],
			[fileBUri.fsPath, `<div class="scoped-b"></div>`],
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
			await checkClassUsageInFiles([fileAUri, fileBUri], textDecoder, new Set(), new Set(), scopedClassNames, usedScopedClassNames);
			assert.strictEqual(usedScopedClassNames.size, 2, 'Should find 2 used scoped classes');
			// Check that the used classes are the correct ones from the correct files
			assert.ok(
				Array.from(usedScopedClassNames).some(c => c.className === 'scoped-a' && c.fsPath === fileAUri.fsPath),
				'Did not find used scoped class "scoped-a" for fileA'
			);
			assert.ok(
				Array.from(usedScopedClassNames).some(c => c.className === 'scoped-b' && c.fsPath === fileBUri.fsPath),
				'Did not find used scoped class "scoped-b" for fileB'
			);
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

	test('checkClassUsageInFiles detects Vue :class object syntax', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const classNames = new Set<string>(['vue-class-obj', 'missing-vue']);
		const usedClassNames = new Set<string>();
		const fileUri = vscode.Uri.file('/fake/path/vue1.vue');
		const fileContentsMap = new Map<string, string>([
			[fileUri.fsPath, `<div :class="{ 'vue-class-obj': isActive }"></div>`]
		]);

		const originalFs = vscode.workspace.fs;
		Object.defineProperty(vscode.workspace, 'fs', {
			value: { readFile: (uri: vscode.Uri) => Promise.resolve(Buffer.from(fileContentsMap.get(uri.fsPath) ?? '')) },
			configurable: true
		});

		try {
			await checkClassUsageInFiles([fileUri], textDecoder, classNames, usedClassNames);
			assert.ok(usedClassNames.has('vue-class-obj'));
			assert.ok(!usedClassNames.has('missing-vue'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

	test('checkClassUsageInFiles detects Vue :class array syntax', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const classNames = new Set<string>(['vue-class-arr', 'missing-vue']);
		const usedClassNames = new Set<string>();
		const fileUri = vscode.Uri.file('/fake/path/vue2.vue');
		const fileContentsMap = new Map<string, string>([
			[fileUri.fsPath, `<div :class="['vue-class-arr', errorClass]"></div>`]
		]);

		const originalFs = vscode.workspace.fs;
		Object.defineProperty(vscode.workspace, 'fs', {
			value: { readFile: (uri: vscode.Uri) => Promise.resolve(Buffer.from(fileContentsMap.get(uri.fsPath) ?? '')) },
			configurable: true
		});

		try {
			await checkClassUsageInFiles([fileUri], textDecoder, classNames, usedClassNames);
			assert.ok(usedClassNames.has('vue-class-arr'));
			assert.ok(!usedClassNames.has('missing-vue'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

	test('checkClassUsageInFiles should not detect classes in HTML comments', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const classNames = new Set<string>(['commented-out']);
		const usedClassNames = new Set<string>();
		const fileUri = vscode.Uri.file('/fake/path/comment.html');
		const fileContentsMap = new Map<string, string>([
			[fileUri.fsPath, `<!-- <div class="commented-out">This should not be found</div> -->`]
		]);

		const originalFs = vscode.workspace.fs;
		Object.defineProperty(vscode.workspace, 'fs', {
			value: { readFile: (uri: vscode.Uri) => Promise.resolve(Buffer.from(fileContentsMap.get(uri.fsPath) ?? '')) },
			configurable: true
		});

		try {
			await checkClassUsageInFiles([fileUri], textDecoder, classNames, usedClassNames);
			assert.strictEqual(usedClassNames.size, 0);
			assert.ok(!usedClassNames.has('commented-out'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});

	test('checkClassUsageInFiles handles classes with underscores', async () => {
		const textDecoder = new TextDecoder('utf-8');
		const classNames = new Set<string>(['class_with_underscore']);
		const usedClassNames = new Set<string>();
		const fileUri = vscode.Uri.file('/fake/path/underscore.html');
		const fileContentsMap = new Map<string, string>([
			[fileUri.fsPath, `<div class="class_with_underscore"></div>`]
		]);

		const originalFs = vscode.workspace.fs;
		Object.defineProperty(vscode.workspace, 'fs', {
			value: { readFile: (uri: vscode.Uri) => Promise.resolve(Buffer.from(fileContentsMap.get(uri.fsPath) ?? '')) },
			configurable: true
		});

		try {
			await checkClassUsageInFiles([fileUri], textDecoder, classNames, usedClassNames);
			assert.ok(usedClassNames.has('class_with_underscore'));
		} finally {
			Object.defineProperty(vscode.workspace, 'fs', { value: originalFs, configurable: true });
		}
	});
});
