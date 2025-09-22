export interface DetectedCSSClass {
    name: string;
    cssClassStartOffset: [number, number]
    cssClassEndOffset: [number, number]
    isGlobal: boolean
}