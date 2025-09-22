import * as vscode from 'vscode';
import { Uri } from "vscode";
import { IExtractor } from "./extractor.interface";
import * as postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { DetectedCSSClass } from '../models';
import { FileExtension } from '../constants';

export class GenericExtractorService implements IExtractor {
    textDecoder = new TextDecoder("utf-8");

    isFileOfInterest(fileName: string): boolean {
        return [FileExtension.css, FileExtension.scss, FileExtension.less, FileExtension.sass].some(ext => fileName.endsWith(ext));
    }

    extractClassNames(fileContent: string): Set<DetectedCSSClass> {
        const classNames = new Set<DetectedCSSClass>();

        const root = postcss.parse(fileContent);
        root.walkRules(rule => {
            selectorParser(selectors => {
                selectors.walkClasses(classNode => {
                    classNames.add({
                        name: classNode.value,
                        cssClassStartOffset: [rule.source!.start!.line - 1, rule.source!.start!.column - 1],
                        cssClassEndOffset: [rule.source!.end!.line - 1, rule.source!.end!.column - 1],
                        isGlobal: true
                    });
                });
            }).processSync(rule.selector);
        });

        return classNames;
    }

    async getUsedClassesInFiles(files: Uri[], classNames: Set<DetectedCSSClass>): Promise<Set<string>> {
        const usedClassNames = new Set<string>();

        for (const potentialFile of files) {
            if (classNames.size === usedClassNames.size) {
                break;
            }

            const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile);
            const potentialFileContentString = this.textDecoder.decode(potentialFileContent);

            for (const className of classNames) {
                if (this.isClassUsed(className.name, potentialFileContentString)) {
                    usedClassNames.add(className.name);
                }
            }
        }

        return usedClassNames;
    }

    private escapeRegExp(input: string): string {
        return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private isClassUsed(className: string, content: string): boolean {
        const name = this.escapeRegExp(className);
        const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');

        const classAttrCapture = /(class(Name)?)\s*=\s*(['"])(.*?)\3/gs;
        let m;
        while ((m = classAttrCapture.exec(contentWithoutComments)) !== null) {
            const attrValue = m[4];
            const tokenRe = new RegExp(`(^|[^\\w-])${name}($|[^\\w-])`);
            if (tokenRe.test(attrValue)) { return true; }
        }

        const classBindingRegex = new RegExp(`\\[class\\.${name}\\]\\s*=`, 'g');
        if (classBindingRegex.test(contentWithoutComments)) { return true; }

        const ngClassRegex = /\[ngClass\]\s*=\s*(['"])(.*?)\1/gs;
        while ((m = ngClassRegex.exec(contentWithoutComments)) !== null) {
            const ngClassValue = m[2];
            const tokenRe = new RegExp(`(^|[^\\w-])${name}($|[^\\w-])`);
            if (tokenRe.test(ngClassValue)) { return true; }
        }

        return false;
    }
}