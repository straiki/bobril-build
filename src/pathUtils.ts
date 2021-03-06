import * as pathPlatformDependent from "path";
const path = pathPlatformDependent.posix; // This works everythere, just use forward slashes
import * as fs from "fs";

export function dirOfNodeModule(name: string) {
    return path.dirname(require.resolve(name).replace(/\\/g, "/"));
}

export function currentDirectory() {
    return process.cwd().replace(/\\/g, "/");
}

export function isAbsolutePath(name: string) {
    return /^([a-zA-Z]\:)?\//.test(name);
}

export function join(...paths: string[]) {
    if (paths.length === 0) return '';
    let pos = paths.length - 1;
    let p = paths[pos];
    while (pos-- > 0) {
        if (isAbsolutePath(p)) return p;
        p = path.join(paths[pos], p);
    }
    return p;
}

export function mkpathsync(dirpath: string) {
    try {
        if (!fs.statSync(dirpath).isDirectory()) {
            throw new Error(dirpath + ' exists and is not a directory');
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            mkpathsync(path.dirname(dirpath));
            fs.mkdirSync(dirpath);
        } else {
            throw err;
        }
    }
};

export function fileModifiedTime(path: string): number {
    try {
        return fs.statSync(path).mtime.getTime();
    } catch (er) {
        return null;
    }
}