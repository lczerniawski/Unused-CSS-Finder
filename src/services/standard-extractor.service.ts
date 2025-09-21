import * as vscode from 'vscode';
import { Uri } from "vscode";
import { Extractor } from "./extractor.interface";
import * as postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { FoundCSS } from '../models';

export class StandardExtractorService implements Extractor {
	textDecoder = new TextDecoder("utf-8");

    extractClassNames(fileContent: string): Set<FoundCSS> {
        const classNames = new Set<FoundCSS>();

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

    async getUsedClassesInFiles(files: Uri[], classNames: Set<FoundCSS>): Promise<Set<string>> {
        const usedClassNames = new Set<string>();

        for (const potentialFile of files) {
            if (classNames.size === usedClassNames.size) {
                break;
            }

            const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile);
            const potentialFileContentString = this.textDecoder.decode(potentialFileContent);

            for (const className of classNames) {
                const classAttrRegex = new RegExp(`(className|class|ngClass).*("|').*(\\b${className.name}\\b).*("|')`, 'g');
                const classBindingRegex = new RegExp(`\\[class\\.${className.name}\\]\\s*=`, 'g'); // TODO move it to angular specific parser

                if (classAttrRegex.test(potentialFileContentString) || classBindingRegex.test(potentialFileContentString)) {
                    usedClassNames.add(className.name);
                }
            }
        }

        return usedClassNames;
    }
}