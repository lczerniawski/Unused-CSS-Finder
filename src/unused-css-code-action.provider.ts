import * as vscode from 'vscode';
import * as constants from './Constants';

export class UnusedCssCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        return context.diagnostics
            .filter(d => d.code === constants.DiagnosticCode)
            .map(d => this.createFix(document, d));
    }

    private createFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const fix = new vscode.CodeAction("Remove unused CSS class", vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.delete(document.uri, diagnostic.range);
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        return fix;
    }
}