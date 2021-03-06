import * as compilationCache from '../src/compilationCache';
import * as translationCache from '../src/translationCache';
import * as bobrilDepsHelpers from '../src/bobrilDepsHelpers';
import * as ts from "typescript";
import * as pathPlatformDependent from "path";
const path = pathPlatformDependent.posix; // This works everythere, just use forward slashes
import * as fs from "fs";
import * as pathUtils from '../src/pathUtils';

describe("compilationCache", () => {
    it("works", (done) => {
        var cc = new compilationCache.CompilationCache();
        var tc = new translationCache.TranslationDb();
        function write(fn: string, b: Buffer) {
            let dir = path.dirname(path.join(__dirname.replace(/\\/g,'/'), 'ccout', fn));
            pathUtils.mkpathsync(dir);
            fs.writeFileSync(path.join(__dirname.replace(/\\/g,'/'), 'ccout', fn), b);
        }
        let project:compilationCache.IProject = {
            dir: path.join(__dirname.replace(/\\/g,'/'), 'cc'),
            main: 'app.ts',
            options: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
            debugStyleDefs: true,
            releaseStyleDefs: false,
            spriteMerge: true,
            writeFileCallback: write,
            compileTranslation: tc
        };
        cc.compile(project).then(() => {
            let moduleNames = Object.keys(project.moduleMap);
            let moduleMap = <{ [name:string]:string }>Object.create(null);
            for (let i = 0; i < moduleNames.length; i++) {
                let name=moduleNames[i];
                if (project.moduleMap[name].internalModule)
                    continue;
                moduleMap[name] = project.moduleMap[name].jsFile;
            }
            bobrilDepsHelpers.updateIndexHtml(project);
            bobrilDepsHelpers.writeTranslationFile('en-US', tc.getMessageArrayInLang('en-US'), 'en-US.js', write);
            tc.addLang('cs-CZ');
            let trs = tc.getForTranslationLang('cs-CZ');
            trs[0][0]='Ahoj';
            trs[1][0]='Právě je {now, date, LLLL}';
            tc.setForTranslationLang('cs-CZ',trs);
            bobrilDepsHelpers.writeTranslationFile('cs-CZ', tc.getMessageArrayInLang('cs-CZ'), 'cs-CZ.js', write);
        }).then(done, e=>{
            fail(e);
            done();
        });
    }, 60000);
});
