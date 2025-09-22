import * as vscode from 'vscode';
import { DetectedCSSClass } from '../models';

export interface IExtractor {
    isFileOfInterest(fileName: string): boolean
    extractClassNames(fileContent: string): Set<DetectedCSSClass>
    getUsedClassesInFiles(files: vscode.Uri[], classNames: Set<DetectedCSSClass>): Promise<Set<string>>
}