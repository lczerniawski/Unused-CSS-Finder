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
import { GenericExtractorService } from './services/generic-extractor.service';
import { VueExtractorService } from './services/vue-extractor.service';
import { FoundCSS } from './models';

export async function findUnusedClassesAndMark(diagnosticCollection: vscode.DiagnosticCollection) {
	const unusedCssClasses = await findUnusedClassesInCurrentFile();
	if (unusedCssClasses) {
		markUnusedClasses(unusedCssClasses, diagnosticCollection);
	}
}
async function findUnusedClassesInCurrentFile(): Promise< FoundCSS[] | null> {
	var standardExtractor = new GenericExtractorService();
	var vueExtractor = new VueExtractorService();

	const textDecoder = new TextDecoder("utf-8");
	const workspaceMainPaths = vscode.workspace.workspaceFolders;
	if (!workspaceMainPaths) {
		return null;
	}

	// TODO This should be part of the method for service that will tell if this file is worth checking
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

	const classNames = sfc.isSFC(fileContentString) ? vueExtractor.extractClassNames(fileContentString) : standardExtractor.extractClassNames(fileContentString);
	let usedClassNames = new Set<string>();

	const filesWithCss = Object.values(FilesWithCss);
	const allPotentialFilesThatUseCss = await vscode.workspace.findFiles(`**/*.{${filesWithCss.join(',')}}`, "**/node_modules/**");
	const currentCssPath = path.dirname(currentCssDocument.uri.fsPath);

	const potentialFilesCloseToCurrentFile = allPotentialFilesThatUseCss.filter(x => {
		return x.fsPath.includes(currentCssPath) && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
	});
	const usedClasses = sfc.isSFC(fileContentString) ? await vueExtractor.getUsedClassesInFiles(potentialFilesCloseToCurrentFile, classNames) : await standardExtractor.getUsedClassesInFiles(potentialFilesCloseToCurrentFile, classNames);
	usedClasses.forEach(className => usedClassNames.add(className));

	const config = vscode.workspace.getConfiguration('unusedCssFinder');
	const enableFallbackSearch = config.get<boolean>('enableFallbackSearch', true);

	// ! if no files are found near the .css file we go up the tree (and fallback is enabled in settings)
	if (potentialFilesCloseToCurrentFile.length === 0 && enableFallbackSearch) {
		const relativePath = path.relative(currentFileWorkspace.uri.fsPath, currentCssDocument.uri.fsPath);
		const relativePathSplitted = relativePath.split(path.sep);

		for (let i = relativePathSplitted.length - 3; i >= 0; i--) {
			const potentialPath = path.join(currentFileWorkspace.uri.fsPath, ...relativePathSplitted.slice(0, i + 1));
			const potentialFiles = allPotentialFilesThatUseCss.filter(x => {
				const fileDir = path.dirname(x.fsPath);
				return fileDir === potentialPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
			});
			const usedClasses = sfc.isSFC(fileContentString) ? await vueExtractor.getUsedClassesInFiles(potentialFiles, classNames) : await standardExtractor.getUsedClassesInFiles(potentialFiles, classNames);
			usedClasses.forEach(className => usedClassNames.add(className));
		}

		// ! Lastly look for files in workspace main folder
		const potentialFilesInRoot = allPotentialFilesThatUseCss.filter(x => {
			const fileDir = path.dirname(x.fsPath);
			return fileDir === currentFileWorkspace.uri.fsPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
		});
		const usedClasses = sfc.isSFC(fileContentString) ? await vueExtractor.getUsedClassesInFiles(potentialFilesInRoot, classNames) : await standardExtractor.getUsedClassesInFiles(potentialFilesInRoot, classNames);
		usedClasses.forEach(className => usedClassNames.add(className));
	}

	const unusedCssClasses = [...classNames].filter(className => !usedClassNames.has(className.name));
	return unusedCssClasses; 
}

function markUnusedClasses(unusedCssClasses: Array<FoundCSS>, diagnosticCollection: vscode.DiagnosticCollection) {
	const document = vscode.window.activeTextEditor?.document;
	if (!document) {
		return;
	}

	const diagnostics: vscode.Diagnostic[] = [];
	for (const css of unusedCssClasses) {
		const ruleStartOffset = document.offsetAt(
			new vscode.Position(css.cssClassStartOffset[0], css.cssClassStartOffset[1])
		);
		const ruleEndOffset = document.offsetAt(
			new vscode.Position(css.cssClassEndOffset[0], css.cssClassEndOffset[1])
		);

		const startPos = document.positionAt(ruleStartOffset);
		const endPos = document.positionAt(ruleEndOffset);

		const range = new vscode.Range(startPos, endPos);
		const diagnostic = new vscode.Diagnostic(range, 'Potentially unused class', vscode.DiagnosticSeverity.Warning);
		diagnostic.source = "css";
		diagnostic.code = constants.DiagnosticCode;
		diagnostics.push(diagnostic);
	}

	diagnosticCollection.set(document.uri, diagnostics);
}