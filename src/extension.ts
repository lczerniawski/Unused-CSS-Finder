import path from 'path';
import * as vscode from 'vscode';
import ignore from 'ignore';
import { existsSync, readFileSync } from 'fs';

export async function activate(context: vscode.ExtensionContext) {
	await mainLogic();

	// TODO this should only apply logic to created/changed file not redo whole search
	const fileCreateWatcher = vscode.workspace.onDidCreateFiles(mainLogic);
	const fileChangeWatcher = vscode.workspace.onDidChangeTextDocument(mainLogic);
	const workspaceChangeWatcher = vscode.workspace.onDidChangeWorkspaceFolders(mainLogic);

	context.subscriptions.push(fileCreateWatcher);
	context.subscriptions.push(fileChangeWatcher);
	context.subscriptions.push(workspaceChangeWatcher);

	vscode.window.showInformationMessage("Extension Unused CSS Finder is now active!");
}

export function deactivate() { }

async function mainLogic() {
	const textDecoder = new TextDecoder("utf-8");
	const workspaceMainPaths = vscode.workspace.workspaceFolders;
	if(!workspaceMainPaths) {
		vscode.window.showInformationMessage("No workspace folders found.");
		return;
	}

	const allCssFiles = await vscode.workspace.findFiles("**/*.{css,scss,less,sass}", "**/node_modules/**");
	const allPotentialFilesThatUseCss = await vscode.workspace.findFiles("**/*.{html,jsx,tsx,js,ts}", "**/node_modules/**");

	for (const cssFile of allCssFiles) {
		const currentFileWorkspace = workspaceMainPaths?.find(x => cssFile.fsPath.includes(x.uri.fsPath));
		if(!currentFileWorkspace) {
			continue;
		}

		const ig = ignore();
		const gitignorePath = path.join(currentFileWorkspace.uri.fsPath, '.gitignore');
		if(existsSync(gitignorePath)) {
			const gitignoreContent = readFileSync(gitignorePath, 'utf8');
			ig.add(gitignoreContent);
		}

		if (ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, cssFile.fsPath))) {
            continue;
        }

		const fileContent = await vscode.workspace.fs.readFile(cssFile);
		const fileContentString = textDecoder.decode(fileContent);

		const classNames = new Array<string>();
		let usedClassNames = new Set<string>();

		const classRegex = /\.([a-zA-Z0-9_-]+)\s*{/g;
		let match;
		while ((match = classRegex.exec(fileContentString)) !== null) {
			classNames.push(match[1]);
		}

		// ! First travel tree and look for files that are closer to the .css file
		const relativePath = path.relative(currentFileWorkspace.uri.fsPath, cssFile.fsPath);
		const relativePathSplitted = relativePath.split(path.sep);
		
		for(let i = relativePathSplitted.length - 2; i >= 0; i--) {
			const potentialPath = path.join(currentFileWorkspace.uri.fsPath, ...relativePathSplitted.slice(0, i + 1));
			// TODO Make sure that we only use files that are in that directory and not all that includes
			const potentialFiles = allPotentialFilesThatUseCss.filter(x => { 
				const fileDir = path.dirname(x.fsPath);
				return fileDir === potentialPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath))
			});
			// ! Look for usage of css class in files
			for(const potentialFile of potentialFiles) {
				const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile);
				const potentialFileContentString = textDecoder.decode(potentialFileContent);

				for (const className of classNames) {
					const classUsageRegex = new RegExp(`(className|class).*".*(\\b${className}\\b).*"`, 'g');
					if(classUsageRegex.test(potentialFileContentString)) {
						usedClassNames.add(className);	
					}
				}
			}
		}

		// ! Lastly look for any files in root folder
		// TODO Make sure that we only use files that are in that directory and not all that includes
		const potentialFilesInRoot = allPotentialFilesThatUseCss.filter(x => {
			const fileDir = path.dirname(x.fsPath);
			return fileDir === currentFileWorkspace.uri.fsPath && !ig.ignores(path.relative(currentFileWorkspace.uri.fsPath, x.fsPath))
		});
		// ! Look for usage of css class in files
		for(const potentialFile of potentialFilesInRoot) {
			const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile);
			const potentialFileContentString = textDecoder.decode(potentialFileContent);

			for (const className of classNames) {
				const classUsageRegex = new RegExp(`(className|class).*".*(\\b${className}\\b).*"`, 'g');
				if(classUsageRegex.test(potentialFileContentString)) {
					usedClassNames.add(className);
				}
			}
		}

		const unusedCssClasses = classNames.filter(className => !usedClassNames.has(className));
		const unusedCssClassesString = unusedCssClasses.join(',');
		vscode.window.showInformationMessage(`Unused classes for file ${cssFile}: ${unusedCssClassesString}`);
	}
}