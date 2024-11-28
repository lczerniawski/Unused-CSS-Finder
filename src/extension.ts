import * as vscode from 'vscode';
import * as constants from './constants';
import { UnusedCssCodeActionProvider } from './unused-css-code-action.provider';
import { findUnusedClassesAndMark } from './search';

let diagnosticCollection: vscode.DiagnosticCollection;

export async function activate(context: vscode.ExtensionContext) {
	diagnosticCollection = vscode.languages.createDiagnosticCollection(constants.DiagnosticCode);
	context.subscriptions.push(diagnosticCollection);

	const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument(async () => await findUnusedClassesAndMark(diagnosticCollection));
	context.subscriptions.push(onDidOpenTextDocument);

	const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(async () => await findUnusedClassesAndMark(diagnosticCollection));
	context.subscriptions.push(onDidChangeTextDocument);

	const quickFixAction = vscode.languages.registerCodeActionsProvider('css', new UnusedCssCodeActionProvider(), {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
	});
	context.subscriptions.push(quickFixAction);

	await findUnusedClassesAndMark(diagnosticCollection);
}

export function deactivate() { 
	if(diagnosticCollection) {
		diagnosticCollection.dispose();
	}
}

