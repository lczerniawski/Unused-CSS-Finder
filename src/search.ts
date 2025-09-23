import path from 'path';
import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';
import { existsSync, readFileSync } from 'fs';
import * as constants from './constants';
import { TextDecoder } from 'util';
import { GenericExtractorService } from './services/generic-extractor.service';
import { VueExtractorService } from './services/vue-extractor.service';
import { DetectedCSSClass } from './models';
import { IExtractor } from './services/extractor.interface';

export async function findUnusedClassesAndMark(diagnosticCollection: vscode.DiagnosticCollection) {
	const standardExtractor = new GenericExtractorService(); // TODO Move to main initialization
	const vueExtractor = new VueExtractorService();
	const extractors: IExtractor[] = [standardExtractor, vueExtractor];

	const currentDocument = vscode.window.activeTextEditor?.document;
	if (!currentDocument) {
		return;
	}

	const extractorToUse = extractors.find(ext => ext.isFileOfInterest(currentDocument.fileName));
	if(!extractorToUse) {
		return;
	}	

	const workspaceMainPaths = vscode.workspace.workspaceFolders;
	if (!workspaceMainPaths) {
		return;
	}

	const currentFileWorkspace = workspaceMainPaths.find(x => currentDocument.uri.fsPath.includes(x.uri.fsPath));
	if (!currentFileWorkspace) {
		return;
	}
	const currentWorkspacePath = currentFileWorkspace.uri.fsPath;

	const ignoredFiles = initializeIgnoredFiles(currentWorkspacePath);
	if (ignoredFiles.ignores(path.relative(currentWorkspacePath, currentDocument.uri.fsPath))) {
		//* If current document is ignored we just return
		return;
	}

	const unusedCssClasses = await findUnusedClassesInCurrentDocument(currentDocument, currentWorkspacePath, extractorToUse, ignoredFiles);
	if (unusedCssClasses) {
		markUnusedClasses(unusedCssClasses, diagnosticCollection);
	}
}

function initializeIgnoredFiles(currentWorkspacePath: string): Ignore {
	const ig = ignore();
	const gitignorePath = path.join(currentWorkspacePath, '.gitignore');
	if (existsSync(gitignorePath)) {
		const gitignoreContent = readFileSync(gitignorePath, 'utf8');
		ig.add(gitignoreContent);
	}

	return ig;
}

async function findUnusedClassesInCurrentDocument(
	currentDocument: vscode.TextDocument, 
	currentWorkspacePath: string, 
	extractor: IExtractor,
	ignoredFiles: Ignore,
): Promise<DetectedCSSClass[] | null> {
	const fileContent = await vscode.workspace.fs.readFile(currentDocument.uri);
	const textDecoder = new TextDecoder("utf-8");
	const fileContentString = textDecoder.decode(fileContent);

	const classNames = extractor.extractClassNames(fileContentString); 

	const filesThatCanUseCss = [
		constants.FileExtension.html,
		constants.FileExtension.js,
		constants.FileExtension.jsx,
		constants.FileExtension.php,
		constants.FileExtension.ts,
		constants.FileExtension.tsx,
		constants.FileExtension.vue,
	];
	const allPotentialFilesThatUseCss = await vscode.workspace.findFiles(`**/*.{${filesThatCanUseCss.join(',')}}`, "**/node_modules/**");
	const currentDocumentDir = path.dirname(currentDocument.uri.fsPath);

	const potentialFilesCloseToCurrentFile = allPotentialFilesThatUseCss.filter(x => {
		return x.fsPath.includes(currentDocumentDir) && !ignoredFiles.ignores(path.relative(currentWorkspacePath, x.fsPath));
	});

	const usedClassNames = new Set<string>();
	const usedClasses = await extractor.getUsedClassesInFiles(potentialFilesCloseToCurrentFile, classNames);
	usedClasses.forEach(className => usedClassNames.add(className));

	const config = vscode.workspace.getConfiguration('unusedCssFinder');
	const enableFallbackSearch = config.get<boolean>('enableFallbackSearch', true);

	// ! if no files are found near the .css file we go up the tree (and fallback is enabled in settings)
	if (potentialFilesCloseToCurrentFile.length === 0 && enableFallbackSearch) {
		const relativePath = path.relative(currentWorkspacePath, currentDocument.uri.fsPath);
		const relativePathSplitted = relativePath.split(path.sep);

		for (let i = relativePathSplitted.length - 3; i >= 0; i--) {
			const potentialPath = path.join(currentWorkspacePath, ...relativePathSplitted.slice(0, i + 1));
			const potentialFiles = allPotentialFilesThatUseCss.filter(x => {
				const fileDir = path.dirname(x.fsPath);
				return fileDir === potentialPath && !ignoredFiles.ignores(path.relative(currentWorkspacePath, x.fsPath));
			});
			const usedClasses = await extractor.getUsedClassesInFiles(potentialFiles, classNames);
			usedClasses.forEach(className => usedClassNames.add(className));
		}

		// ! Lastly look for files in workspace main folder
		const potentialFilesInRoot = allPotentialFilesThatUseCss.filter(x => {
			const fileDir = path.dirname(x.fsPath);
			return fileDir === currentWorkspacePath && !ignoredFiles.ignores(path.relative(currentWorkspacePath, x.fsPath));
		});
		const usedClasses = await extractor.getUsedClassesInFiles(potentialFilesInRoot, classNames);
		usedClasses.forEach(className => usedClassNames.add(className));
	}

	const unusedCssClasses = [...classNames].filter(className => !usedClassNames.has(className.name));
	return unusedCssClasses; 
}

function markUnusedClasses(unusedCssClasses: Array<DetectedCSSClass>, diagnosticCollection: vscode.DiagnosticCollection) {
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