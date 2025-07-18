import path from 'path';
import * as vscode from 'vscode';
import ignore from 'ignore';
import { existsSync, readFileSync } from 'fs';
import * as constants from './constants';
import { TextDecoder } from 'util';
import * as postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

export async function findUnusedClassesAndMark(diagnosticCollection: vscode.DiagnosticCollection) {
	const unusedCssClasses = await findUnusedClassesInCurrentFile();
	if (unusedCssClasses) {
		markUnusedClasses(unusedCssClasses, diagnosticCollection);
	}
}

async function findUnusedClassesInCurrentFile(): Promise<Array<string> | null> {
	const textDecoder = new TextDecoder("utf-8");
	const workspaceMainPaths = vscode.workspace.workspaceFolders;
	if (!workspaceMainPaths) {
		return null;
	}

	const currentCssDocument = vscode.window.activeTextEditor?.document;
	const cssExtensions = ['.css', '.scss', '.less', '.sass'];
	if (!currentCssDocument || !cssExtensions.some(ext => currentCssDocument.fileName.endsWith(ext))) {
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
	let usedClassNames = new Set<string>();

	const allPotentialFilesThatUseCss = await vscode.workspace.findFiles("**/*.{html,jsx,tsx,js,ts,php}", "**/node_modules/**");
	const currentCssPath = path.dirname(currentCssDocument.uri.fsPath);

	const potentialFilesDeepInTree = allPotentialFilesThatUseCss.filter(x => {
		return x.fsPath.includes(currentCssPath) && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
	});
	await checkClassUsageInFiles(potentialFilesDeepInTree, textDecoder, classNames, usedClassNames);

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
	return unusedCssClasses;
}

function extractClassNames(cssContent: string): Set<string> {
	const classNames = new Set<string>();

	const root = postcss.parse(cssContent);
	root.walkRules(rule => {
		selectorParser(selectors => {
			selectors.walkClasses(classNode => {
				classNames.add(classNode.value);
			});
		}).processSync(rule.selector);
	});

	return classNames;
}

async function checkClassUsageInFiles(potentialFiles: vscode.Uri[], textDecoder: TextDecoder, classNames: Set<string>, usedClassNames: Set<string>) {
	for (const potentialFile of potentialFiles) {
		if (classNames.size === usedClassNames.size) {
			break;
		}

		const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile);
		const potentialFileContentString = textDecoder.decode(potentialFileContent);

		for (const className of classNames) {
			const classUsageRegex = new RegExp(`(className|class).*("|').*(\\b${className}\\b).*("|')`, 'g');
			if (classUsageRegex.test(potentialFileContentString)) {
				usedClassNames.add(className);
			}
		}
	}
}

function markUnusedClasses(unusedCssClasses: Array<string>, diagnosticCollection: vscode.DiagnosticCollection) {
	const document = vscode.window.activeTextEditor?.document;
	if (!document) {
		return;
	}

	const diagnostics: vscode.Diagnostic[] = [];
	const css = document.getText();
	const root = postcss.parse(css);

	root.walkRules(rule => {
		const selector = rule.selector;
		let hasUnusedClass = false;

		selectorParser(selectors => {
			selectors.walkClasses(classNode => {
				const className = classNode.value;
				if (unusedCssClasses.includes(className)) {
					hasUnusedClass = true;
				}
			});
		}).processSync(selector);

		if (hasUnusedClass) {
			const ruleStartOffset = document.offsetAt(
				new vscode.Position(rule.source!.start!.line - 1, rule.source!.start!.column - 1)
			);
			const ruleEndOffset = document.offsetAt(
				new vscode.Position(rule.source!.end!.line - 1, rule.source!.end!.column - 1)
			);

			const startPos = document.positionAt(ruleStartOffset);
			const endPos = document.positionAt(ruleEndOffset);

			const range = new vscode.Range(startPos, endPos);
			const diagnostic = new vscode.Diagnostic(range, 'Potentially unused class', vscode.DiagnosticSeverity.Warning);
			diagnostic.source = "css";
			diagnostic.code = constants.DiagnosticCode;
			diagnostics.push(diagnostic);
		}
	});

	diagnosticCollection.set(document.uri, diagnostics);
}