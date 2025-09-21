import path from 'path';
import * as vscode from 'vscode';
import ignore from 'ignore';
import { existsSync, readFileSync } from 'fs';
import * as constants from './constants';
import { TextDecoder } from 'util';
import * as postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import * as sfc from './singleFileComponents/sfc';
import FileExtension from './enums/fileExtensions';
import FilesWithCss from './enums/fileWithCss';


export async function findUnusedClassesAndMark(diagnosticCollection: vscode.DiagnosticCollection) {
	const unusedCssClasses = await findUnusedClassesInCurrentFile();
	if (unusedCssClasses) {
		markUnusedClasses(unusedCssClasses.unusedCssClasses, unusedCssClasses.unusedScopedCssClasses, diagnosticCollection);
	}
}

async function findUnusedClassesInCurrentFile(): Promise<{unusedCssClasses: Array<string>, unusedScopedCssClasses: Array<ScopedClassName>} | null> {
	const textDecoder = new TextDecoder("utf-8");
	const workspaceMainPaths = vscode.workspace.workspaceFolders;
	if (!workspaceMainPaths) {
		return null;
	}

	const currentCssDocument = vscode.window.activeTextEditor?.document;
	const cssExtensions = [FileExtension.css, FileExtension.scss, FileExtension.less, FileExtension.sass];
	const fileExtensions = [FileExtension.vue];
	if (!currentCssDocument || ![...cssExtensions, ...fileExtensions].some(ext => currentCssDocument.fileName.endsWith(ext))) {
		return null;
	}

	const currentFileWorkspace = workspaceMainPaths?.find(x => currentCssDocument.uri.fsPath.includes(x.uri.fsPath));
	if (!currentFileWorkspace) {
		return null;
	}

	const ig = ignore();
	const gitignorePath = path.join(currentFileWorkspace.uri.fsPath, '.gitignore');
	if (existsSync(gitignorePath)) {
		const gitignoreContent = readFileSync(gitignorePath, 'utf8');
		ig.add(gitignoreContent);
	}

	if (ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, currentCssDocument.uri.fsPath))) {
		return null;
	}

	const fileContent = await vscode.workspace.fs.readFile(currentCssDocument.uri);
	const fileContentString = textDecoder.decode(fileContent);

	const classNames = extractClassNames(fileContentString);
	const scopedClassNames = extractScopedClassNames(fileContentString, currentCssDocument.uri.fsPath);

	let usedClassNames = new Set<string>();
	let usedScopedClassNames = new Set<ScopedClassName>();

	const filesWithCss = Object.values(FilesWithCss);
	const allPotentialFilesThatUseCss = await vscode.workspace.findFiles(`**/*.{${filesWithCss.join(',')}}`, "**/node_modules/**");
	const currentCssPath = path.dirname(currentCssDocument.uri.fsPath);

	const potentialFilesDeepInTree = allPotentialFilesThatUseCss.filter(x => {
		return x.fsPath.includes(currentCssPath) && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
	});
	await checkClassUsageInFiles(potentialFilesDeepInTree, textDecoder, classNames, usedClassNames, scopedClassNames, usedScopedClassNames);

	const config = vscode.workspace.getConfiguration('unusedCssFinder');
	const enableFallbackSearch = config.get<boolean>('enableFallbackSearch', true);

	// ! if no files are found near the .css file we go up the tree (and fallback is enabled in settings)
	if (potentialFilesDeepInTree.length === 0 && enableFallbackSearch) {
		const relativePath = path.relative(currentFileWorkspace.uri.fsPath, currentCssDocument.uri.fsPath);
		const relativePathSplitted = relativePath.split(path.sep);

		for (let i = relativePathSplitted.length - 3; i >= 0; i--) {
			const potentialPath = path.join(currentFileWorkspace.uri.fsPath, ...relativePathSplitted.slice(0, i + 1));
			const potentialFiles = allPotentialFilesThatUseCss.filter(x => {
				const fileDir = path.dirname(x.fsPath);
				return fileDir === potentialPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
			});
			await checkClassUsageInFiles(potentialFiles, textDecoder, classNames, usedClassNames);
		}

		// ! Lastly look for files in workspace main folder
		const potentialFilesInRoot = allPotentialFilesThatUseCss.filter(x => {
			const fileDir = path.dirname(x.fsPath);
			return fileDir === currentFileWorkspace.uri.fsPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
		});
		await checkClassUsageInFiles(potentialFilesInRoot, textDecoder, classNames, usedClassNames);
	}

	const unusedCssClasses = [...classNames].filter(className => !usedClassNames.has(className));
	const unusedScopedCssClasses = [...scopedClassNames].filter(className => !usedScopedClassNames.has(className));
	return {unusedCssClasses: unusedCssClasses, unusedScopedCssClasses: unusedScopedCssClasses};
}

export function extractClassNames(cssContent: string): Set<string> {
	const classNames = new Set<string>();

	const root = sfc.isSFC(cssContent)? postcss.parse(sfc.extractStyling(cssContent, false)) : postcss.parse(cssContent);
	root.walkRules(rule => {
		selectorParser(selectors => {
			selectors.walkClasses(classNode => {
				classNames.add(classNode.value);
			});
		}).processSync(rule.selector);
	});

	return classNames;
}

export function extractScopedClassNames(fileContent: string, fsPath: string): Set<ScopedClassName> {
	const classNames = new Set<ScopedClassName>();

	const root = postcss.parse(sfc.extractStyling(fileContent, true));
	root.walkRules(rule => {
		selectorParser(selectors => {
			selectors.walkClasses(classNode => {
				classNames.add({fsPath: fsPath, className: classNode.value});
			});
		}).processSync(rule.selector);
	});

	return classNames;
}

/**
 * A helper function to determine if a class name is used within a string of file content.
 * This prevents code duplication for checking global vs. scoped classes.
 * @param className The CSS class name to search for.
 * @param content The string content of the file to search within.
 * @returns True if the class is found, otherwise false.
 */
function isClassUsed(className: string, content: string): boolean {
	// First, remove all HTML comments to prevent matching classes inside them.
	const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');

	// Regex for standard attributes like class="...", className='...'
	// Group 1: (class(Name)?), Group 2: (Name), Group 3: (["']).
	const classAttrRegex = new RegExp(`(class(Name)?)\\s*=\\s*(["'])(.*?)(?<![\\w-])${className}(?![\\w-])(.*?)\\3`, 'g');
	// Regex for Angular's specific class binding syntax, e.g., [class.active]="..."
	const classBindingRegex = new RegExp(`\\[class\\.${className}\\]\\s*=`, 'g');
    // Regex to find [ngClass] attributes and extract their value. Handles both ' and " quotes.
    const ngClassRegex = new RegExp(`\\[ngClass\\]\\s*=\\s*(["'])(.*?)\\1`, 'g');

	// Test for standard class attributes and Angular's [class.name] binding first for performance.
	if (classAttrRegex.test(contentWithoutComments) || classBindingRegex.test(contentWithoutComments)) {
		return true;
	}
    
    // If not found, perform a more detailed check for [ngClass].
    let match;
    while ((match = ngClassRegex.exec(contentWithoutComments)) !== null) {
        const ngClassValue = match[2]; // The value is in the second capturing group
        // Check if the class name exists as a whole word inside the ngClass value.
        // This handles string, array, and object syntaxes without complex parsing.
        const classInNgClassRegex = new RegExp(`(?<![\\w-])${className}(?![\\w-])`);
        if (classInNgClassRegex.test(ngClassValue)) {
            return true;
        }
    }

	return false;
}

export async function checkClassUsageInFiles(potentialFiles: vscode.Uri[], textDecoder: TextDecoder, classNames: Set<string>, usedClassNames: Set<string>, scopedClassNames?: Set<ScopedClassName>, usedScopedClassNames?: Set<ScopedClassName>) {
	for (const potentialFile of potentialFiles) {
		// Early exit if all global and scoped classes have been found.
		if (classNames.size === usedClassNames.size && (!scopedClassNames || scopedClassNames.size === usedScopedClassNames?.size)) {
			break;
		}

		const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile);
		const potentialFileContentString = textDecoder.decode(potentialFileContent);

		// Check for usage of global (non-scoped) class names.
		for (const className of classNames) {
			if (isClassUsed(className, potentialFileContentString)) {
				usedClassNames.add(className);
			}
		}

		// Check for usage of scoped class names, but only if we are inside the relevant file.
		if (scopedClassNames && usedScopedClassNames) {
			for (const scopedClassName of scopedClassNames) {
				if (potentialFile.fsPath === scopedClassName.fsPath) {
					if (isClassUsed(scopedClassName.className, potentialFileContentString)) {
						usedScopedClassNames.add(scopedClassName);
					}
				}
			}
		}
	}
}

/**
 * A helper function that processes a PostCSS root, checks for unused classes using a provided checker function,
 * and returns an array of VS Code diagnostics. This encapsulates the duplicated logic from the original function.
 * @param root The PostCSS root node to walk through.
 * @param isUnused A function that takes a class name and returns true if it's unused.
 * @param sfcMarker An object containing information about the Single File Component, if applicable.
 * @returns An array of diagnostics for the unused classes found.
 */
function createDiagnosticsFromRules(
	root: postcss.Root,
	isUnused: (className: string) => boolean,
	sfcMarker: { css: string; sfcType: FileExtension; } | null
): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];

	root.walkRules(rule => {
		let hasUnusedClass = false;
		const selector = rule.selector;

		selectorParser(selectors => {
			selectors.walkClasses(classNode => {
				if (isUnused(classNode.value)) {
					hasUnusedClass = true;
				}
			});
		}).processSync(selector);

		if (hasUnusedClass && rule.source) {
			const startPos = new vscode.Position(rule.source.start!.line - 1, rule.source.start!.column - 1);
			const endPos = new vscode.Position(rule.source.end!.line - 1, rule.source.end!.column - 1);
			
			let range = new vscode.Range(startPos, endPos);

			// If we're in an SFC, get a more precise range for the style block.
			if (sfcMarker) {
				const sfcMarkerRange = sfc.getMarkerPositions(sfcMarker.sfcType, sfcMarker.css, selector);
				if (sfcMarkerRange) {
					range = sfcMarkerRange;
				}
			}

			const diagnostic = new vscode.Diagnostic(range, 'Potentially unused class', vscode.DiagnosticSeverity.Warning);
			diagnostic.source = "css";
			diagnostic.code = constants.DiagnosticCode;
			diagnostics.push(diagnostic);
		}
	});

	return diagnostics;
}

function markUnusedClasses(unusedCssClasses: Array<string>, unusedScopedCssClasses: Array<ScopedClassName>, diagnosticCollection: vscode.DiagnosticCollection) {
	const document = vscode.window.activeTextEditor?.document;
	if (!document) {
		return;
	}

	let css = '';
	let scopedCss = '';
	let sfcMarker: { css: string, sfcType: FileExtension } | null = null;
	
	switch (path.parse(document.fileName).ext) {
		case FileExtension.vue:
			const fullText = document.getText();
			css = sfc.extractStyling(fullText, false);
			scopedCss = sfc.extractStyling(fullText, true);
			sfcMarker = { 
				css: fullText, 
				sfcType: FileExtension.vue
			};
			break;
	
		default:
			css = document.getText();
			break;
	}

	const root = postcss.parse(css);
	const scopedRoot = postcss.parse(scopedCss);
	
	// Create diagnostics for global (non-scoped) classes
	const globalDiagnostics = createDiagnosticsFromRules(
		root,
		(className) => unusedCssClasses.includes(className),
		sfcMarker
	);

	// Create diagnostics for scoped classes
	const scopedDiagnostics = createDiagnosticsFromRules(
		scopedRoot,
		(className) => unusedScopedCssClasses.some(
			scoped => scoped.fsPath === document.uri.fsPath && scoped.className === className
		),
		sfcMarker
	);

	// Combine all diagnostics and set them for the document
	diagnosticCollection.set(document.uri, [...globalDiagnostics, ...scopedDiagnostics]);
}
