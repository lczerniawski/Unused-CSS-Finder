import * as vscode from 'vscode';
import { Uri } from "vscode";
import { Extractor } from "./extractor.interface";
import * as postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { FoundCSS } from '../models';
import * as vue from '../singleFileComponents/vue';

export class VueExtractorService implements Extractor {
	textDecoder = new TextDecoder("utf-8");

    extractClassNames(fileContent: string): Set<FoundCSS> {
        const classNames = new Set<FoundCSS>();

        const globalRoot = postcss.parse(vue.extractStyling(fileContent, false)); 
        globalRoot.walkRules(rule => {
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

        const scopedRoot = postcss.parse(vue.extractStyling(fileContent, true));
        scopedRoot.walkRules(rule => {
            selectorParser(selectors => {
                selectors.walkClasses(classNode => {
                    const sfcMarkerRange = vue.getClassPosition(fileContent, rule.selector); // TODO return tuple instead of range
                    classNames.add({
                        name: classNode.value,
                        cssClassStartOffset: [sfcMarkerRange!.start.line, sfcMarkerRange!.start.character],
                        cssClassEndOffset: [sfcMarkerRange!.end.line, sfcMarkerRange!.end.character],
                        isGlobal: false 
                    });
                });
            }).processSync(rule.selector);
        });

        return classNames;
    }

    async getUsedClassesInFiles(files: Uri[], classNames: Set<FoundCSS>): Promise<Set<string>> {
        const currentDocumentPath = vscode.window.activeTextEditor!.document.uri.path;
        const usedClassNames = new Set<string>();

        for (const potentialFile of files) {
            if (classNames.size === usedClassNames.size) {
                break;
            }

            const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile); // TODO Here should extract only Template part of file
            const potentialFileContentString = this.textDecoder.decode(potentialFileContent);

            for (const className of classNames) {
                if (!className.isGlobal && currentDocumentPath !== potentialFile.fsPath){
                    continue;
                }

                const classAttrRegex = new RegExp(`(className|class|ngClass).*("|').*(\\b${className.name}\\b).*("|')`, 'g');
                const classBindingRegex = new RegExp(`\\[class\\.${className.name}\\]\\s*=`, 'g'); // TODO Add Vue specific handling 

                if (classAttrRegex.test(potentialFileContentString) || classBindingRegex.test(potentialFileContentString)) {
                    usedClassNames.add(className.name);
                }
            }
        }

        return usedClassNames;
    }
}