import * as vscode from 'vscode';
import { FoundCSS } from '../models';

export interface Extractor {
    extractClassNames(fileContent: string): Set<FoundCSS>
    getUsedClassesInFiles(files: vscode.Uri[], classNames: Set<FoundCSS>): Promise<Set<string>>
}