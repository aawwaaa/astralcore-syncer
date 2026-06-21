// declare const console: {
//     log(...args: any[]): void;
//     error(...args: any[]): void;
//     warn(...args: any[]): void;
//     info(...args: any[]): void;
//     debug(...args: any[]): void;
//     trace(...args: any[]): void;
//     assert(condition?: boolean, ...args: any[]): void;
//     clear(): void;
//     count(label?: string): void;
//     countReset(label?: string): void;
//     dir(obj: any, options?: any): void;
//     dirxml(...args: any[]): void;
//     group(...args: any[]): void;
//     groupCollapsed(...args: any[]): void;
//     groupEnd(): void;
//     time(label?: string): void;
//     timeEnd(label?: string): void;
//     timeLog(label?: string, ...args: any[]): void;
// };


declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(handle?: number): void;

declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(handle?: number): void;

