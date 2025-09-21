import * as vscode from 'vscode';
import { parse as parseVue } from '@vue/compiler-sfc';

/**
 * Checks if a string content represents a Vue Single File Component (SFC).
 * It does this by attempting to parse the content and checking for the presence
 * of top-level blocks like <template>, <script>, or <style>.
 * @param {string} fileContent The text content of the file.
 * @returns {boolean} True if it's a valid Vue SFC, otherwise false.
 */
export function isVueSFC(fileContent: string) {
    try {
        const { descriptor } = parseVue(fileContent);
        // An SFC is considered valid if it has a template, script, scriptSetup, or at least one style block.
        return !!(descriptor.template || descriptor.script || descriptor.scriptSetup || descriptor.styles.length > 0);
    } catch (e) {
        return false;
    }
}

/**
 * Extracts the content from within the <template> block of a Vue SFC.
 * @param fileContent The full string content of the .vue file.
 * @returns The content of the template as a string, or an empty string if not found.
 */
export function extractTemplate(fileContent: string): string {
    if(isVueSFC(fileContent)) {
        const { descriptor } = parseVue(fileContent);
        if(descriptor.template) {
            return descriptor.template.content;
        }
    }
    return '';
}

/**
 * Extracts and concatenates the content from all <style> blocks in a Vue SFC.
 * It can be configured to extract either only scoped styles or only non-scoped (global) styles.
 * @param fileContent The full string content of the .vue file.
 * @param scoped A boolean indicating whether to extract scoped styles (true) or global styles (false).
 * @returns The combined content of the matching style blocks.
 */
export function extractStyling(fileContent: string, scoped: boolean) {
    if(isVueSFC(fileContent)) {
        const { descriptor } = parseVue(fileContent);

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
    }
    return '';
}

/**
 * Calculates the precise start and end position of a CSS selector within a .vue file.
 * This is used to create a VS Code diagnostic (e.g., an underline) for the unused class.
 * @param fileContent The full string content of the .vue file.
 * @param selector The CSS selector to find (e.g., '.my-class').
 * @returns A VS Code Range object if the selector is found, otherwise null.
 */
export function getClassPosition(fileContent: string, selector: string): null | vscode.Range  {
    const { descriptor } = parseVue(fileContent);

    let range: null | vscode.Range = null;

    // Iterate over each <style> block in the file.
    descriptor.styles.forEach(style => {
        const startOfStyle = style.loc.start.line;

        // Construct a regex to find the specific class selector.
        // It looks for the class name (with the leading '.' removed) followed by an opening curly brace '{'.
        // The negative lookbehind `(?<![...])` ensures we match the whole class name and not part of a longer one.
        const regex = new RegExp(`(?<![a-zA-Z0-9-])${selector.trim().substring(1)}\\s*\\{`, 'g');
        const match = regex.exec(style.content);

        if(match) {
            // Get all the content *before* the matched selector to calculate its position.
            const contentBeforeSelector = style.content.substring(0, match.index);
            // Find the position of the last newline to determine the start of the selector's line.
            const lastNewlineIndex = contentBeforeSelector.lastIndexOf('\n') + 1;
            // Count how many newlines are within the style block before our selector.
            const newLinesBeforeStyle = (contentBeforeSelector.match(/\n/g) || []).length - 1;

            // Calculate the exact start position.
            // Line: start of the <style> block + newlines within the block.
            // Character: index of the match within the block - start of its line.
            const startPosition = new vscode.Position(startOfStyle + newLinesBeforeStyle, match.index - lastNewlineIndex);
            // The end position is on the same line, extending for the length of the selector text.
            const endPosition = new vscode.Position(startPosition.line, selector.length);

            range = new vscode.Range(startPosition, endPosition);
        }
    });

    return range;
}

