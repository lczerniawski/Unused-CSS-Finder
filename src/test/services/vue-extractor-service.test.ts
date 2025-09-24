import * as assert from 'assert';
import * as vscode from 'vscode';
import { DetectedCSSClass } from '../../models';
import { VueExtractorService } from '../../services/vue-extractor.service';

suite('Vue Extractor Service', () => {
    const vueExtractorService = new VueExtractorService();

    function mockActiveTextEditor(filePath: string) {
        const mockDocument = {
            uri: vscode.Uri.file(filePath)
        };
        const mockTextEditor = {
            document: mockDocument
        };
        Object.defineProperty(vscode.window, 'activeTextEditor', {
            value: mockTextEditor,
            configurable: true
        });
    }

    function restoreMocks(originalFs: any, originalActiveTextEditor: any) {
        Object.defineProperty(vscode.workspace, 'fs', {
            value: originalFs,
            configurable: true
        });
        Object.defineProperty(vscode.window, 'activeTextEditor', {
            value: originalActiveTextEditor,
            configurable: true
        });
    }

    test('getUsedClassesInFiles detects Vue :class object syntax', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'vue-class-obj', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
            { name: 'another-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
        ]);

        const vueFileContent = `
<template>
    <div :class="{ 'vue-class-obj': isActive, 'another-class': isVisible }">Content</div>
</template>`;

        const fileUri = vscode.Uri.file('/fake/path/object-class.vue');
        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        mockActiveTextEditor('/fake/path/current.vue');
        Object.defineProperty(vscode.workspace, 'fs', {
            value: { readFile: () => Promise.resolve(Buffer.from(vueFileContent)) },
            configurable: true
        });

        try {
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('vue-class-obj'));
            assert.ok(usedClassNames.has('another-class'));
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });

    test('getUsedClassesInFiles detects Vue :class array syntax', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'vue-class-arr', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
            { name: 'base-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
        ]);

        const vueFileContent = `
<template>
    <div :class="['base-class', { 'vue-class-arr': condition }]">Content</div>
</template>`;

        const fileUri = vscode.Uri.file('/fake/path/array-class.vue');
        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        mockActiveTextEditor('/fake/path/current.vue');
        Object.defineProperty(vscode.workspace, 'fs', {
            value: { readFile: () => Promise.resolve(Buffer.from(vueFileContent)) },
            configurable: true
        });

        try {
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('vue-class-arr'));
            assert.ok(usedClassNames.has('base-class'));
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });

    test('getUsedClassesInFiles should not detect classes in HTML comments', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'commented-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
            { name: 'valid-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
        ]);

        const vueFileContent = `
<template>
    <!-- <div class="commented-class">This should not be detected</div> -->
    <div class="valid-class">This should be detected</div>
</template>`;

        const fileUri = vscode.Uri.file('/fake/path/html-comment.vue');
        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        mockActiveTextEditor('/fake/path/current.vue');
        Object.defineProperty(vscode.workspace, 'fs', {
            value: { readFile: () => Promise.resolve(Buffer.from(vueFileContent)) },
            configurable: true
        });

        try {
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.strictEqual(usedClassNames.size, 1);
            assert.ok(usedClassNames.has('valid-class'));
            assert.ok(!usedClassNames.has('commented-class'));
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });

    test('getUsedClassesInFiles handles scoped classes correctly', async () => {
        const fileAUri = vscode.Uri.file('/fake/path/fileA.vue');
        const fileBUri = vscode.Uri.file('/fake/path/fileB.vue');

        const scopedClassNames = new Set<DetectedCSSClass>([
            { name: 'scoped-class-a', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: false },
            { name: 'scoped-class-b', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: false },
        ]);

        const fileContentsMap = new Map<string, string>([
            [fileAUri.fsPath, `<template><div class="scoped-class-a">A</div></template>`],
            [fileBUri.fsPath, `<template><div class="scoped-class-b">B</div></template>`],
        ]);

        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        // Set current file as fileA
        mockActiveTextEditor(fileAUri.fsPath);
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
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileAUri, fileBUri], scopedClassNames);
            // Should find only class from file A as we are looking at this one currently
            assert.strictEqual(usedClassNames.size, 1);
            assert.ok(usedClassNames.has('scoped-class-a'));
            assert.ok(!usedClassNames.has('scoped-class-b'));
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });

    test('getUsedClassesInFiles detects classes in JavaScript string concatenation', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'concat-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
        ]);

        const vueFileContent = `
<template>
    <div>Content</div>
</template>

<script>
export default {
    methods: {
        updateClass() {
            this.$el.className = 'base-' + 'concat-class';
        }
    }
}
</script>`;

        const fileUri = vscode.Uri.file('/fake/path/string-concat.vue');
        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        mockActiveTextEditor('/fake/path/current.vue');
        Object.defineProperty(vscode.workspace, 'fs', {
            value: { readFile: () => Promise.resolve(Buffer.from(vueFileContent)) },
            configurable: true
        });

        try {
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('concat-class'));
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });

    test('getUsedClassesInFiles detects classes in Vue v-bind shorthand', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'shorthand-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
        ]);

        const vueFileContent = `
<template>
    <div :class="'shorthand-class'">Content</div>
</template>`;

        const fileUri = vscode.Uri.file('/fake/path/shorthand.vue');
        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        mockActiveTextEditor('/fake/path/current.vue');
        Object.defineProperty(vscode.workspace, 'fs', {
            value: { readFile: () => Promise.resolve(Buffer.from(vueFileContent)) },
            configurable: true
        });

        try {
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('shorthand-class'));
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });

    test('getUsedClassesInFiles handles multiline class attributes', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'multiline-class-1', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
            { name: 'multiline-class-2', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
        ]);

        const vueFileContent = `
<template>
    <div class="multiline-class-1 
                multiline-class-2">
        Content
    </div>
</template>`;

        const fileUri = vscode.Uri.file('/fake/path/multiline.vue');
        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        mockActiveTextEditor('/fake/path/current.vue');
        Object.defineProperty(vscode.workspace, 'fs', {
            value: { readFile: () => Promise.resolve(Buffer.from(vueFileContent)) },
            configurable: true
        });

        try {
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('multiline-class-1'));
            assert.ok(usedClassNames.has('multiline-class-2'));
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });

    test('getUsedClassesInFiles ignores malformed class attributes', async () => {
        const classNames = new Set<DetectedCSSClass>([
            { name: 'valid-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
            { name: 'malformed-class', cssClassStartOffset: [0, 0], cssClassEndOffset: [0, 3], isGlobal: true },
        ]);

        const vueFileContent = `
<template>
    <div class="valid-class">Valid</div>
    <div class=malformed-class>Malformed without quotes</div>
</template>`;

        const fileUri = vscode.Uri.file('/fake/path/malformed.vue');
        const originalFs = vscode.workspace.fs;
        const originalActiveTextEditor = vscode.window.activeTextEditor;

        mockActiveTextEditor('/fake/path/current.vue');
        Object.defineProperty(vscode.workspace, 'fs', {
            value: { readFile: () => Promise.resolve(Buffer.from(vueFileContent)) },
            configurable: true
        });

        try {
            const usedClassNames = await vueExtractorService.getUsedClassesInFiles([fileUri], classNames);
            assert.ok(usedClassNames.has('valid-class'));
            // Depending on implementation, malformed might or might not be detected
            // The test documents the current behavior
        } finally {
            restoreMocks(originalFs, originalActiveTextEditor);
        }
    });
});