import * as vscode from 'vscode';
import { Uri } from "vscode";
import { IExtractor } from "./extractor.interface";
import * as postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { CSSClassPosition, CSSClassRange, DetectedCSSClass } from '../models';
import { FileExtension } from '../constants';
import { parse, SFCDescriptor } from '@vue/compiler-sfc';

export class VueExtractorService implements IExtractor {
	textDecoder = new TextDecoder("utf-8");

    isFileOfInterest(fileName: string): boolean {
        return [...FileExtension.vue].some(ext => fileName.endsWith(ext));
    }

    extractClassNames(fileContent: string): Set<DetectedCSSClass> {
        const classNames = new Set<DetectedCSSClass>();
        const descriptor = this.getDescriptor(fileContent);

        const globalRoot = postcss.parse(this.extractStyling(descriptor, false)); 
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

        const scopedRoot = postcss.parse(this.extractStyling(descriptor, true));
        scopedRoot.walkRules(rule => {
            selectorParser(selectors => {
                selectors.walkClasses(classNode => {
                    const cssClassRange = this.getClassPosition(descriptor, rule.selector); 
                    if (!cssClassRange) {
                        return;
                    }

                    classNames.add({
                        name: classNode.value,
                        cssClassStartOffset: [cssClassRange!.start.line, cssClassRange!.start.character],
                        cssClassEndOffset: [cssClassRange!.end.line, cssClassRange!.end.character],
                        isGlobal: false 
                    });
                });
            }).processSync(rule.selector);
        });

        return classNames;
    }

    async getUsedClassesInFiles(files: Uri[], classNames: Set<DetectedCSSClass>): Promise<Set<string>> {
        const currentDocumentPath = vscode.window.activeTextEditor!.document.uri.path;
        const usedClassNames = new Set<string>();

        for (const potentialFile of files) {
            if (classNames.size === usedClassNames.size) {
                break;
            }

            const potentialFileContent = await vscode.workspace.fs.readFile(potentialFile); 
            const potentialFileContentString = this.textDecoder.decode(potentialFileContent);
            let searchableContent = potentialFileContentString;
            if (potentialFile.fsPath.endsWith(FileExtension.vue)) {
                const descriptor = this.getDescriptor(potentialFileContentString);
                const templateContent = descriptor.template?.content ?? '';
                const scriptContent = descriptor.script?.content ?? '';
                searchableContent = `${templateContent}\n${scriptContent}`;
            }

            for (const className of classNames) {
                if (!className.isGlobal && currentDocumentPath !== potentialFile.fsPath){
                    continue;
                }


                const escapedClassName = className.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // Vue template class attribute patterns
                const staticClassRegex = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapedClassName}\\b[^"']*["']`, 'gms');
                
                // Vue dynamic class binding patterns
                const dynamicClassRegex = new RegExp(`:class\\s*=\\s*["'][^"']*\\b${escapedClassName}\\b[^"']*["']`, 'gms');
                
                // Vue object-style class binding
                const objectClassRegex = new RegExp(`["']${escapedClassName}["']\\s*:\\s*(true|[^,}]+)`, 'gms');
                
                // Vue array-style class binding
                const arrayClassRegex = new RegExp(`["']${escapedClassName}["']`, 'gms');
                
                // JavaScript/TypeScript usage in script sections
                const jsClassRegex = new RegExp(`(className|class).*["'].*\\b${escapedClassName}\\b.*["']`, 'gms');
                
                // classList.add/remove/toggle/contains usage
                const classListRegex = new RegExp(`classList\\.(add|remove|toggle|contains)\\s*\\(\\s*["']${escapedClassName}["']\\s*\\)`, 'gms');

                if (staticClassRegex.test(searchableContent) || 
                    dynamicClassRegex.test(searchableContent) ||
                    objectClassRegex.test(searchableContent) ||
                    arrayClassRegex.test(searchableContent) ||
                    jsClassRegex.test(searchableContent) ||
                    classListRegex.test(searchableContent)) {
                    usedClassNames.add(className.name);
                }
            }
        }

        return usedClassNames;
    }

    private getDescriptor(fileContent: string): SFCDescriptor {
        const parseResult = parse(fileContent);
        return parseResult.descriptor;
    }

    private extractStyling(descriptor: SFCDescriptor, scoped: boolean) {
        if(scoped && descriptor.styles && descriptor.styles.length > 0) {
            return descriptor.styles.reduce((accumulator, style)=>{
                if(style.scoped) {
                    return accumulator + style.content;
                }
                return accumulator;
            }, '');
        } else if (descriptor.styles && descriptor.styles.length > 0) {
            return descriptor.styles.reduce((accumulator, style)=>{
                if(style.scoped === undefined) {
                    return accumulator + style.content;
                }
                return accumulator;
            }, '');
        }

        return '';
    }

    private getClassPosition(descriptor: SFCDescriptor, selector: string): CSSClassRange | null  {
        let range: CSSClassRange | null = null;

        descriptor.styles.forEach(style => {
            const startOfStyle = style.loc.start.line;

            // Construct a regex to find the specific class selector.
            // It looks for the class name (with the leading '.' removed) followed by an opening curly brace '{'.
            // The negative look behind `(?<![...])` ensures we match the whole class name and not part of a longer one.
            const regex = new RegExp(`(?<![a-zA-Z0-9-])${selector.trim().substring(1)}\\s*\\{`, 'g');
            const match = regex.exec(style.content);

            if(match) {
                const contentBeforeSelector = style.content.substring(0, match.index);
                const lastNewlineIndex = contentBeforeSelector.lastIndexOf('\n') + 1;
                const newLinesBeforeStyle = (contentBeforeSelector.match(/\n/g) || []).length - 1;

                const startPosition = new CSSClassPosition(startOfStyle + newLinesBeforeStyle, match.index - lastNewlineIndex);
                const endPosition = new CSSClassPosition(startPosition.line, selector.length);

                range = new CSSClassRange(startPosition, endPosition);
            }
        });

        return range;
    }

}