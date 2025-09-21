import * as vscode from 'vscode';
import FileExtension from '../enums/fileExtensions';
import * as vue from './vue';

/**
 * Checks if the given file content represents a Single File Component (SFC).
 * This function currently only supports Vue SFCs.
 * @param fileContent The string content of the file to check.
 * @returns True if the content is a Vue SFC, otherwise false.
 * @todo To improve performance, this function could accept the file extension as a parameter,
 * allowing it to skip parsing the content if the file type is already known not to be an SFC.
 */
export function isSFC(fileContent: string): boolean {
    if(vue.isVueSFC(fileContent)) {return true;}
    return false;
}

/**
 * Extracts the main markup content from an SFC.
 * For Vue files, this specifically targets the content within the <template> block.
 * @param fileContent The full string content of the SFC.
 * @returns The template's inner content as a string, or an empty string if not an SFC or no template is found.
 */
export function extractContent(fileContent: string): string {
    if(vue.isVueSFC(fileContent)) {
        return vue.extractTemplate(fileContent);
    }
    return '';
}

/**
 * Extracts styling (CSS) from an SFC, with an option to target scoped or global styles.
 * @param fileContent The full string content of the SFC.
 * @param scoped A boolean to determine which styles to extract:
 * - `true` extracts content from `<style scoped>` blocks.
 * - `false` extracts content from non-scoped (global) `<style>` blocks.
 * @returns A concatenated string of all matching style block content.
 * @todo Similar to isSFC, performance could be improved by passing the file extension
 * to avoid unnecessary parsing of non-SFC files.
 */
export function extractStyling(fileContent: string, scoped: boolean) {
    if(vue.isVueSFC(fileContent)) {
       return vue.extractStyling(fileContent, scoped);
    }
    return '';
}

/**
 * A dispatcher function that finds the precise location (Range) of a CSS class name within an SFC.
 * It uses the file extension to determine which language-specific parser to use.
 * @param sfcType The enum representing the file extension (e.g., .vue).
 * @param fileContent The full string content of the file.
 * @param className The CSS class name to locate within the file's style blocks.
 * @returns A VS Code `Range` object for highlighting the class, or `null` if not found.
 */
export function getMarkerPositions(sfcType: FileExtension, fileContent: string, className: string): null | vscode.Range  {
    // Use a switch statement to handle different SFC types.
    switch (sfcType) {
        case FileExtension.vue:
            return vue.getClassPosition(fileContent, className);
    
        default:
            return null;
    }
}

