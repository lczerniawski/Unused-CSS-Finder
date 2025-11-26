import * as vscode from 'vscode';
import { Uri } from "vscode";
import { IExtractor } from "./extractor.interface";
import * as postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { CSSClassPosition, CSSClassRange, DetectedCSSClass } from '../models';
import { FileExtension } from '../constants';

interface TwigStyleBlock {
    content: string;
    loc: {
        start: { line: number; column: number };
        end: { line: number; column: number };
    };
}

export class TwigExtractorService implements IExtractor {
    textDecoder = new TextDecoder("utf-8");

    isFileOfInterest(fileName: string): boolean {
        return [...FileExtension.twig].some(ext => fileName.endsWith(ext));
    }

    extractClassNames(fileContent: string): Set<DetectedCSSClass> {
        const classNames = new Set<DetectedCSSClass>();
        const styleBlocks = this.extractStyleBlocks(fileContent);

        styleBlocks.forEach(styleBlock => {
            const root = postcss.parse(styleBlock.content);
            root.walkRules(rule => {
                selectorParser(selectors => {
                    selectors.walkClasses(classNode => {
                        const cssClassRange = this.getClassPosition(styleBlock, rule.selector);
                        if (!cssClassRange) {
                            return;
                        }

                        classNames.add({
                            name: classNode.value,
                            cssClassStartOffset: [cssClassRange.start.line, cssClassRange.start.character],
                            cssClassEndOffset: [cssClassRange.end.line, cssClassRange.end.character],
                            isGlobal: true // All Twig styles are global
                        });
                    });
                }).processSync(rule.selector);
            });
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
            
            let searchableContent = potentialFileContentString;
            
            // If it's a Twig file, extract only HTML/Twig template content
            if (potentialFile.fsPath.endsWith(FileExtension.twig)) {
                searchableContent = this.extractTemplateContent(potentialFileContentString);
            }
            
            // Remove Twig comments
            searchableContent = searchableContent.replace(/\{#[\s\S]*?#\}/g, '');
            // Remove HTML comments
            searchableContent = searchableContent.replace(/<!--[\s\S]*?-->/g, '');

            for (const className of classNames) {
                const escapedClassName = className.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // Twig/HTML class attribute patterns
                const staticClassRegex = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapedClassName}\\b[^"']*["']`, 'gms');
                // Twig variable interpolation {{ variable }}
                const twigVarRegex = new RegExp(`\\{\\{[^}]*["'\`].*\\b${escapedClassName}\\b.*["'\`][^}]*\\}\\}`, 'gms');
                // Twig set statements
                const twigSetRegex = new RegExp(`\\{%\\s*set[^%]*["'\`].*\\b${escapedClassName}\\b.*["'\`][^%]*%\\}`, 'gms');
                // Twig filters
                const twigFilterRegex = new RegExp(`\\|[^}%]*["'\`].*\\b${escapedClassName}\\b.*["'\`]`, 'gms');

                if (staticClassRegex.test(searchableContent) ||
                    twigVarRegex.test(searchableContent) ||
                    twigSetRegex.test(searchableContent) ||
                    twigFilterRegex.test(searchableContent)) {
                    usedClassNames.add(className.name);
                }
            }
        }

        return usedClassNames;
    }

    private extractTemplateContent(fileContent: string): string {
        let content = fileContent;
        
        // Remove <style> blocks
        content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        
        return content;
    }

    private extractStyleBlocks(fileContent: string): TwigStyleBlock[] {
        const styleBlocks: TwigStyleBlock[] = [];
        const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
        let match;

        while ((match = styleRegex.exec(fileContent)) !== null) {
            const content = match[1];
            
            const contentStart = match.index + match[0].indexOf(content);
            const contentBefore = fileContent.substring(0, contentStart);
            const contentLines = contentBefore.split('\n');
            const contentStartLine = contentLines.length - 1;

            styleBlocks.push({
                content,
                loc: {
                    start: { line: contentStartLine, column: contentLines[contentLines.length - 1].length },
                    end: { line: contentStartLine + content.split('\n').length - 1, column: 0 }
                }
            });
        }

        return styleBlocks;
    }

    private getClassPosition(styleBlock: TwigStyleBlock, selector: string): CSSClassRange | null {
        const startOfStyle = styleBlock.loc.start.line;
        const regex = new RegExp(`(?<![a-zA-Z0-9-])${selector.trim().substring(1)}\\s*\\{`, 'g');
        const match = regex.exec(styleBlock.content);

        if (match) {
            const contentBeforeSelector = styleBlock.content.substring(0, match.index);
            const lastNewlineIndex = contentBeforeSelector.lastIndexOf('\n') + 1;
            const newLinesBeforeStyle = (contentBeforeSelector.match(/\n/g) || []).length;

            const startPosition = new CSSClassPosition(
                startOfStyle + newLinesBeforeStyle,
                match.index - lastNewlineIndex
            );
            const endPosition = new CSSClassPosition(
                startPosition.line,
                startPosition.character + selector.length
            );

            return new CSSClassRange(startPosition, endPosition);
        }

        return null;
    }
}