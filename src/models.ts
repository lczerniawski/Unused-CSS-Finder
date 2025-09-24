export interface DetectedCSSClass {
    name: string;
    cssClassStartOffset: [number, number]
    cssClassEndOffset: [number, number]
    isGlobal: boolean
}

export class CSSClassPosition {
    line: number;
    character: number;

    constructor(line: number, character: number) {
        this.line = line;
        this.character = character;
    }
}

export class CSSClassRange {
    start: CSSClassPosition;
    end: CSSClassPosition;

    constructor(start: CSSClassPosition, end: CSSClassPosition) {
        this.start = start;
        this.end = end;
    }
}