import * as vscode from 'vscode';
import * as constants from './constants';
import { UnusedCssCodeActionProvider } from './unused-css-code-action.provider';
import { findUnusedClassesAndMark } from './search';
import { GenericExtractorService } from './services/generic-extractor.service';
import { VueExtractorService } from './services/vue-extractor.service';
import { IExtractor } from './services/extractor.interface';
import { TwigExtractorService } from './services/twig-extractor.service';

let diagnosticCollection: vscode.DiagnosticCollection;

export async function activate(context: vscode.ExtensionContext) {
	const standardExtractor = new GenericExtractorService();
	const vueExtractor = new VueExtractorService();
	const twigExtractor = new TwigExtractorService();
	const extractors: IExtractor[] = [standardExtractor, vueExtractor, twigExtractor];

	diagnosticCollection = vscode.languages.createDiagnosticCollection(constants.DiagnosticCode);
	context.subscriptions.push(diagnosticCollection);

	const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(async (textDocumentChangeEvent) => 
		await findUnusedClassesAndMark(textDocumentChangeEvent.document, extractors, diagnosticCollection)
	);
	context.subscriptions.push(onDidChangeTextDocument);

	const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(async (textEditor) => {
		if(!textEditor?.document) {
			return;
		}
		await findUnusedClassesAndMark(textEditor?.document, extractors, diagnosticCollection);
	}
	);
	context.subscriptions.push(onDidChangeActiveTextEditor);

	const quickFixAction = vscode.languages.registerCodeActionsProvider('css', new UnusedCssCodeActionProvider(), {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
	});
	context.subscriptions.push(quickFixAction);

	const currentDocument = vscode.window.activeTextEditor?.document;
	if (!currentDocument) {
		return;
	}

	await findUnusedClassesAndMark(currentDocument, extractors, diagnosticCollection);
}

export function deactivate() {
	if (diagnosticCollection) {
		diagnosticCollection.dispose();
	}
}

