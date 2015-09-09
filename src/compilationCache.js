var ts = require("typescript");
var fs = require("fs");
var path = require("path");
var imageOps = require("./imageOps");
var imgCache = require("./imgCache");
require('bluebird');
var BuildHelpers = require('./buildHelpers');
function reportDiagnostic(diagnostic, logcb) {
    var output = '';
    if (diagnostic.file) {
        var loc = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        output += diagnostic.file.fileName + "(" + (loc.line + 1) + "," + (loc.character + 1) + "): ";
    }
    var category = ts.DiagnosticCategory[diagnostic.category].toLowerCase();
    output += category + " TS" + diagnostic.code + ": " + ts.flattenDiagnosticMessageText(diagnostic.messageText, ts.sys.newLine) + ts.sys.newLine;
    logcb(output);
}
function reportDiagnostics(diagnostics, logcb) {
    for (var i = 0; i < diagnostics.length; i++) {
        reportDiagnostic(diagnostics[i], logcb);
    }
}
var CompilationCache = (function () {
    function CompilationCache(resolvePathStringLiteral) {
        this.resolvePathStringLiteral = resolvePathStringLiteral || (function (nn) { return path.join(path.dirname(nn.getSourceFile().fileName), nn.text); });
        this.defaultLibFilename = path.join(path.dirname(path.resolve(require.resolve('typescript'))), 'lib.es6.d.ts');
        this.defaultLibFilenameNorm = this.defaultLibFilename.replace(/\\/g, '/');
        this.cacheFiles = Object.create(null);
        this.imageCache = new imgCache.ImgCache();
    }
    CompilationCache.prototype.clearFileTimeModifications = function () {
        var cacheFiles = this.cacheFiles;
        var names = Object.keys(cacheFiles);
        for (var i = 0; i < names.length; i++) {
            cacheFiles[names[i]].curTime = undefined;
        }
    };
    CompilationCache.prototype.forceRebuild = function () {
        var cacheFiles = this.cacheFiles;
        var names = Object.keys(cacheFiles);
        for (var i = 0; i < names.length; i++) {
            cacheFiles[names[i]].infoTime = undefined;
            cacheFiles[names[i]].outputTime = undefined;
        }
    };
    CompilationCache.prototype.compile = function (project) {
        var _this = this;
        project.logCallback = project.logCallback || (function (text) { return console.log(text); });
        project.writeFileCallback = project.writeFileCallback || (function (filename, content) { return fs.writeFileSync(filename, content); });
        this.clearMaxTimeForDeps();
        var mainCache = this.calcMaxTimeForDeps(project.main, project.dir);
        if (mainCache.maxTimeForDeps !== null && project.spriteMerge == null && project.textForTranslationReplacer == null) {
            // nothing needs to be build, evrything is fresh
            return Promise.resolve(null);
        }
        var program = ts.createProgram([project.main], project.options, this.createCompilerHost(this, project.dir, project.writeFileCallback));
        var diagnostics = program.getSyntacticDiagnostics();
        reportDiagnostics(diagnostics, project.logCallback);
        if (diagnostics.length === 0) {
            var diagnostics_1 = program.getGlobalDiagnostics();
            reportDiagnostics(diagnostics_1, project.logCallback);
            if (diagnostics_1.length === 0) {
                var diagnostics_2 = program.getSemanticDiagnostics();
                reportDiagnostics(diagnostics_2, project.logCallback);
            }
        }
        var bundleCache = null;
        if (project.spriteMerge) {
            if (project.imgBundleCache) {
                bundleCache = project.imgBundleCache;
            }
            else {
                bundleCache = new imgCache.ImgBundleCache(this.imageCache);
                project.imgBundleCache = bundleCache;
            }
            bundleCache.clear(false);
        }
        var tc = program.getTypeChecker();
        var sourceFiles = program.getSourceFiles();
        for (var i = 0; i < sourceFiles.length; i++) {
            var src = sourceFiles[i];
            if (src.hasNoDefaultLib)
                continue; // skip searching default lib
            var cached = this.getCachedFileExistence(src.fileName, project.dir);
            if (cached.sourceTime !== cached.infoTime) {
                cached.info = BuildHelpers.gatherSourceInfo(src, tc, this.resolvePathStringLiteral);
                cached.infoTime = cached.sourceTime;
            }
            if (project.spriteMerge) {
                var info = cached.info;
                for (var j = 0; j < info.sprites.length; j++) {
                    var si = info.sprites[j];
                    bundleCache.add(project.remapImages ? project.remapImages(si.name) : path.join(project.dir, si.name), si.color, si.width, si.height, si.x, si.y);
                }
            }
            if (project.textForTranslationReporter) {
                var trs = cached.info.trs;
                for (var j = 0; j < trs.length; j++) {
                    var message = trs[j].message;
                    if (typeof message === 'string')
                        project.textForTranslationReporter(trs[j]);
                }
            }
        }
        var prom = Promise.resolve(null);
        if (project.spriteMerge) {
            if (bundleCache.wasChange()) {
                prom = prom.then(function () { return bundleCache.build(); });
                prom = prom.then(function (bi) {
                    return imageOps.savePNG2Buffer(bi);
                });
                prom = prom.then(function (b) {
                    project.writeFileCallback('bundle.png', b);
                    return null;
                });
            }
        }
        prom = prom.then(function () {
            for (var i = 0; i < sourceFiles.length; i++) {
                var src = sourceFiles[i];
                if (src.hasNoDefaultLib)
                    continue; // skip searching default lib
                var cached = _this.getCachedFileExistence(src.fileName, project.dir);
                if (cached.maxTimeForDeps !== null && cached.outputTime != null && cached.maxTimeForDeps <= cached.outputTime
                    && project.spriteMerge == null && project.textForTranslationReplacer == null) {
                    continue;
                }
                var restorationMemory = [];
                var info = cached.info;
                if (project.remapImages && !project.spriteMerge) {
                    for (var j = 0; j < info.sprites.length; j++) {
                        var si = info.sprites[j];
                        var newname = project.remapImages(si.name);
                        if (newname != si.name) {
                            restorationMemory.push(BuildHelpers.rememberCallExpression(si.callExpression));
                            BuildHelpers.setArgument(si.callExpression, 0, newname);
                        }
                    }
                }
                if (project.spriteMerge) {
                    for (var j = 0; j < info.sprites.length; j++) {
                        var si = info.sprites[j];
                        var bundlePos = bundleCache.query(project.remapImages ? project.remapImages(si.name) : path.join(project.dir, si.name), si.color, si.width, si.height, si.x, si.y);
                        restorationMemory.push(BuildHelpers.rememberCallExpression(si.callExpression));
                        BuildHelpers.setMethod(si.callExpression, "spriteb");
                        BuildHelpers.setArgument(si.callExpression, 0, bundlePos.width);
                        BuildHelpers.setArgument(si.callExpression, 1, bundlePos.height);
                        BuildHelpers.setArgument(si.callExpression, 2, bundlePos.x);
                        BuildHelpers.setArgument(si.callExpression, 3, bundlePos.y);
                        BuildHelpers.setArgumentCount(si.callExpression, 4);
                    }
                }
                if (project.textForTranslationReplacer) {
                    var trs = info.trs;
                    for (var j = 0; j < trs.length; j++) {
                        var message = trs[j].message;
                        if (typeof message === 'string') {
                            var id = project.textForTranslationReplacer(trs[j]);
                            var ce = trs[j].callExpression;
                            restorationMemory.push(BuildHelpers.rememberCallExpression(ce));
                            BuildHelpers.setArgument(ce, 0, id);
                            if (ce.arguments.length > 2) {
                                BuildHelpers.setArgumentCount(ce, 2);
                            }
                        }
                    }
                }
                for (var j = 0; j < info.styleDefs.length; j++) {
                    var sd = info.styleDefs[j];
                    if (project.debugStyleDefs) {
                        var name_1 = sd.name;
                        if (sd.userNamed)
                            continue;
                        if (!name_1)
                            continue;
                        restorationMemory.push(BuildHelpers.rememberCallExpression(sd.callExpression));
                        BuildHelpers.setArgumentCount(sd.callExpression, 3 + (sd.isEx ? 1 : 0));
                        BuildHelpers.setArgument(sd.callExpression, 2 + (sd.isEx ? 1 : 0), name_1);
                    }
                    else if (project.releaseStyleDefs) {
                        if (sd.callExpression.arguments.length === 2 + (sd.isEx ? 1 : 0))
                            continue;
                        restorationMemory.push(BuildHelpers.rememberCallExpression(sd.callExpression));
                        BuildHelpers.setArgumentCount(sd.callExpression, 2 + (sd.isEx ? 1 : 0));
                    }
                }
                program.emit(src);
                for (var j = restorationMemory.length - 1; j >= 0; j--) {
                    restorationMemory[j]();
                }
                cached.outputTime = cached.maxTimeForDeps;
            }
            if (project.spriteMerge) {
                bundleCache.clear(true);
            }
            return null;
        });
        return prom;
    };
    CompilationCache.prototype.clearMaxTimeForDeps = function () {
        var cacheFiles = this.cacheFiles;
        var names = Object.keys(cacheFiles);
        for (var i = 0; i < names.length; i++) {
            cacheFiles[names[i]].maxTimeForDeps = undefined;
        }
    };
    CompilationCache.prototype.getCachedFileExistence = function (fileName, baseDir) {
        var resolvedName = path.resolve(baseDir, fileName);
        var resolvedNameLowerCased = resolvedName.toLowerCase();
        var cached = this.cacheFiles[resolvedNameLowerCased];
        if (cached === undefined) {
            cached = { fullName: resolvedName };
            this.cacheFiles[resolvedNameLowerCased] = cached;
        }
        if (cached.curTime == null) {
            if (cached.curTime === null) {
                return cached;
            }
            try {
                cached.curTime = fs.statSync(resolvedName).mtime.getTime();
            }
            catch (er) {
                cached.curTime = null;
                return cached;
            }
        }
        return cached;
    };
    CompilationCache.prototype.updateCachedFileContent = function (cached) {
        if (cached.textTime !== cached.curTime) {
            var text;
            try {
                text = fs.readFileSync(cached.fullName).toString();
            }
            catch (er) {
                cached.textTime = null;
                return cached;
            }
            cached.textTime = cached.curTime;
            cached.text = text;
        }
    };
    CompilationCache.prototype.getCachedFileContent = function (fileName, baseDir) {
        var cached = this.getCachedFileExistence(fileName, baseDir);
        if (cached.curTime === null) {
            cached.textTime = null;
            return cached;
        }
        this.updateCachedFileContent(cached);
        return cached;
    };
    CompilationCache.prototype.calcMaxTimeForDeps = function (name, baseDir) {
        var cached = this.getCachedFileExistence(name, baseDir);
        if (cached.maxTimeForDeps !== undefined)
            return cached;
        cached.maxTimeForDeps = cached.curTime;
        if (cached.curTime === null)
            return cached;
        if (cached.outputTime == null) {
            cached.maxTimeForDeps = null;
            return cached;
        }
        if (cached.curTime === cached.infoTime) {
            var deps = cached.info.sourceDeps;
            for (var i = 0; i < deps.length; i++) {
                var depCached = this.calcMaxTimeForDeps(deps[i], baseDir);
                if (depCached.maxTimeForDeps === null) {
                    cached.maxTimeForDeps = null;
                    return cached;
                }
                if (depCached.maxTimeForDeps > cached.maxTimeForDeps) {
                    cached.maxTimeForDeps = depCached.maxTimeForDeps;
                }
            }
        }
    };
    CompilationCache.prototype.createCompilerHost = function (cc, currentDirectory, writeFileCallback) {
        function getCanonicalFileName(fileName) {
            return ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();
        }
        function getCachedFileExistence(fileName) {
            return cc.getCachedFileExistence(fileName, currentDirectory);
        }
        function getCachedFileContent(fileName) {
            return cc.getCachedFileContent(fileName, currentDirectory);
        }
        function getSourceFile(fileName, languageVersion, onError) {
            var isDefLib = fileName === cc.defaultLibFilenameNorm;
            if (isDefLib) {
                if (cc.defLibPrecompiled)
                    return cc.defLibPrecompiled;
                var text;
                try {
                    text = fs.readFileSync(cc.defaultLibFilename).toString();
                }
                catch (er) {
                    if (onError)
                        onError('Openning ' + cc.defaultLibFilename + " failed with " + er);
                    return null;
                }
                cc.defLibPrecompiled = ts.createSourceFile(fileName, text, languageVersion, true);
                return cc.defLibPrecompiled;
            }
            var cached = getCachedFileContent(fileName);
            if (cached.textTime == null) {
                return null;
            }
            if (cached.sourceTime !== cached.textTime) {
                cached.sourceFile = ts.createSourceFile(fileName, cached.text, languageVersion, true);
                cached.sourceTime = cached.textTime;
            }
            return cached.sourceFile;
        }
        function writeFile(fileName, data, writeByteOrderMark, onError) {
            try {
                writeFileCallback(fileName, new Buffer(data));
            }
            catch (e) {
                if (onError) {
                    onError(e.message);
                }
            }
        }
        function resolveModuleName(moduleName, containingFile) {
            if (moduleName.substr(0, 1) === '.') {
                return path.join(path.dirname(containingFile), moduleName) + ".ts";
            }
            // TODO: read packege.json for main.js to exchange for main.ts
            return "node_modules/" + moduleName + "/index.ts";
        }
        return {
            getSourceFile: getSourceFile,
            getDefaultLibFileName: function (options) { return cc.defaultLibFilenameNorm; },
            writeFile: writeFile,
            getCurrentDirectory: function () { return currentDirectory; },
            useCaseSensitiveFileNames: function () { return ts.sys.useCaseSensitiveFileNames; },
            getCanonicalFileName: getCanonicalFileName,
            getNewLine: function () { return '\n'; },
            fileExists: function (fileName) {
                if (fileName === cc.defaultLibFilenameNorm)
                    return true;
                var cached = getCachedFileExistence(fileName);
                if (cached.curTime === null)
                    return false;
                return true;
            },
            readFile: function (fileName) {
                var cached = getCachedFileContent(fileName);
                if (cached.textTime == null)
                    return null;
                return cached.text;
            },
            resolveModuleNames: function (moduleNames, containingFile) {
                return moduleNames.map(function (n) {
                    var r = resolveModuleName(n, containingFile);
                    //console.log(n, containingFile, r);
                    return r;
                });
            }
        };
    };
    return CompilationCache;
})();
exports.CompilationCache = CompilationCache;
