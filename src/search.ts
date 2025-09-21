import path from 'path';
import * as vscode from 'vscode';
import ignore from 'ignore';
import { existsSync, readFileSync } from 'fs';
import * as constants from './constants';
import { TextDecoder } from 'util';
import FilesWithCss from './enums/fileWithCss';
import { GenericExtractorService } from './services/generic-extractor.service';
import { VueExtractorService } from './services/vue-extractor.service';
import { FoundCSS } from './models';
import { Extractor } from './services/extractor.interface';

export async function findUnusedClassesAndMark(diagnosticCollection: vscode.DiagnosticCollection) {
	const unusedCssClasses = await findUnusedClassesInCurrentFile();
	if (unusedCssClasses) {
		markUnusedClasses(unusedCssClasses, diagnosticCollection);
	}
}
async function findUnusedClassesInCurrentFile(): Promise< FoundCSS[] | null> {
	const standardExtractor = new GenericExtractorService();
	const vueExtractor = new VueExtractorService();
	const extractors: Extractor[] = [standardExtractor, vueExtractor];

	const workspaceMainPaths = vscode.workspace.workspaceFolders;
	if (!workspaceMainPaths) {
		return null;
	}

	const currentDocument = vscode.window.activeTextEditor?.document;
	if (!currentDocument) {
		return null;
	}

	const extractorToUse = extractors.find(ext => ext.isFileOfInterest(currentDocument.fileName));
	if(!extractorToUse) {
		return null;
	}	

	const currentFileWorkspace = workspaceMainPaths?.find(x => currentDocument.uri.fsPath.includes(x.uri.fsPath));
	if (!currentFileWorkspace) {
		return null;
	}

	const ig = ignore();
	const gitignorePath = path.join(currentFileWorkspace.uri.fsPath, '.gitignore');
	if (existsSync(gitignorePath)) {
		const gitignoreContent = readFileSync(gitignorePath, 'utf8');
		ig.add(gitignoreContent);
	}

	if (ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, currentDocument.uri.fsPath))) {
		return null;
	}

	const fileContent = await vscode.workspace.fs.readFile(currentDocument.uri);
	const textDecoder = new TextDecoder("utf-8");
	const fileContentString = textDecoder.decode(fileContent);

	const classNames = extractorToUse.extractClassNames(fileContentString); 
	let usedClassNames = new Set<string>();

	const filesWithCss = Object.values(FilesWithCss);
	const allPotentialFilesThatUseCss = await vscode.workspace.findFiles(`**/*.{${filesWithCss.join(',')}}`, "**/node_modules/**");
	const currentCssPath = path.dirname(currentDocument.uri.fsPath);

	const potentialFilesCloseToCurrentFile = allPotentialFilesThatUseCss.filter(x => {
		return x.fsPath.includes(currentCssPath) && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
	});
	const usedClasses = await extractorToUse.getUsedClassesInFiles(potentialFilesCloseToCurrentFile, classNames);
	usedClasses.forEach(className => usedClassNames.add(className));

	const config = vscode.workspace.getConfiguration('unusedCssFinder');
	const enableFallbackSearch = config.get<boolean>('enableFallbackSearch', true);

	// ! if no files are found near the .css file we go up the tree (and fallback is enabled in settings)
	if (potentialFilesCloseToCurrentFile.length === 0 && enableFallbackSearch) {
		const relativePath = path.relative(currentFileWorkspace.uri.fsPath, currentDocument.uri.fsPath);
		const relativePathSplitted = relativePath.split(path.sep);

		for (let i = relativePathSplitted.length - 3; i >= 0; i--) {
			const potentialPath = path.join(currentFileWorkspace.uri.fsPath, ...relativePathSplitted.slice(0, i + 1));
			const potentialFiles = allPotentialFilesThatUseCss.filter(x => {
				const fileDir = path.dirname(x.fsPath);
				return fileDir === potentialPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
			});
			const usedClasses = await extractorToUse.getUsedClassesInFiles(potentialFiles, classNames);
			usedClasses.forEach(className => usedClassNames.add(className));
		}

		// ! Lastly look for files in workspace main folder
		const potentialFilesInRoot = allPotentialFilesThatUseCss.filter(x => {
			const fileDir = path.dirname(x.fsPath);
			return fileDir === currentFileWorkspace.uri.fsPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath));
		});
		const usedClasses = await extractorToUse.getUsedClassesInFiles(potentialFilesInRoot, classNames);
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