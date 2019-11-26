const fs = require("fs");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;


class Config
{
    constructor(obj)
    {        
        this.watch = obj.watch===true;
        this.inPointName = obj.inPointName;
        this._fromPaths = obj.fromPaths;
        this.targetPath = obj.targetPath;
        this.gsIndexPath = obj.gsIndexPath;

        let invalid = this.valid();
        if (invalid) {
            throw new Error(`Config ${JSON.stringify(obj)} not valid!\r\n${invalid}`);
        }
    }

    /**
     * @returns {Array<string>}
     * */
    get fromPaths() { return this._fromPaths; }

    valid()
    {
        let valid = '';
        if (!this.inPointName) valid+= 'Unset inPointName.\r\n';
        if (!this.targetPath) valid += 'Unset targetPath.\r\n';
        if (!this.gsIndexPath) valid += 'Unset gsIndexPath.\r\n';
        if (!this._fromPaths) valid += 'Unset fromPaths.\r\n'; else
        if (!this._fromPaths.forEach) valid += 'Argument fromPath is not array.\r\n';
        return valid;
    }

}

class Configs
{
    constructor(obj)
    {
        
        this._configs = [];
        if (obj.configs)
            if (obj.configs.forEach)
                obj.configs.forEach(c => this._configs.push(new Config(c)));
        if (this._configs.length == 0) throw new Error(`Configs not setted!`);
    }
    /**
     * @returns {Array<Config>}
     * */
    get configs() { return this._configs; }
}

class FileGS
{
    constructor(path, inFolder)
    {
        this.path = path;    
        let t = path.split('/');
        this.name = t[t.length - 1].replace('.html', '');
        this.inFolder = inFolder;        
        this.fullData = '';
        this.counter = 0;
        this.searchTmpls();
    }

    getSavePath() { return this.inFolder.getSavePath() + '_' + this.name; }

    searchTmpls()
    {
        let file = this;
        let data = fs.readFileSync(this.path, "utf8");
        
        const dom = new JSDOM(data);      
        dom.window.document.querySelectorAll('template').forEach(t =>
        {
            let tmpl_name = t.getAttribute('data-tmpl_name');
            if (!tmpl_name) return;
            let d = dom.window.document.createElement("div");
            d.innerHTML = t.innerHTML;
            let name = tmpl_name.charAt(0).toUpperCase()+tmpl_name.slice(1);
            this.createJSCode(name, d);
            
        });
    }

    /**
     * 
     * @param {string} tmpl_name
     * @param {Element} tt
     */
    createJSCode(tmpl_name, tt)
    {       
        let attrs = [];
        /**         
         * @param {Element} el
         */
        let q = 0;
        function search(el)
        {   
            if (el.nodeType === 1) {
                let attr = el.getAttribute('data-tmpl');
                if (attr) { attrs.push(attr); }               
            }            
            el.childNodes.forEach(e => search(e));          
        }
        search(tt);
        let t = `export class ${tmpl_name} {\r\n    constructor(initObj){\r\n`;
        attrs.forEach(a => { t = t.concat(`        this._${a}=null;\r\n`); })
        t = t.concat('        Object.assign(this, initObj);\r\n    }\r\n');
        attrs.forEach(a =>
        {
            t = t.concat(`   /**
    *@returns {WrapperGS}
    **/
    get ${a}(){return this._${a}};\r\n`);
        })
        t = t.concat('}\r\n\r\n');
        this.fullData += t;        
        this.counter++;
    }
}

class FolderGS
{
    constructor(config, path, inFolder = null, base=false)
    {
        this._config = config;
        this.path = path;
        this.inFolder = inFolder;
        let t = path.split('/');
        this.name = t[t.length - 1];
        this.files = [];
        this.folders = [];
        this.fullData = '';        
        if (!base) {
            if (!inFolder) console.log(`Start watching for ${this.path}`);
            this._searchAll();
            if (this.config.watch) this.startWatch();
        }
    }
    /**
     * @returns {Config}
     * */
    get config() { return this._config; }

    getSavePath()
    {
        if (this.inFolder) return this.inFolder.getSavePath() + '_' + this.name; else
            return this.name;
    }

    //import { WrapperGS, GS } from "";

    save()
    {
        let imports = [];
        let folder = this;
        function writeCode(f)
        {
            f.fullData = `import { WrapperGS, GS } from "${folder.config.gsIndexPath}";\r\n\r\n` + f.fullData;
            imports.push({ path: `./${f.getSavePath()}.js`, name: f.name });
            fs.writeFileSync(`${folder.config.targetPath}/${f.getSavePath()}.js`, f.fullData);
            console.log(`${f.getSavePath()}.js created!`);
        }
        
        this.folders.forEach(f =>
        {
            if (f.fullData === '') return;
            writeCode(f);            
        });

        let data = '';
        this.files.forEach((f) =>
        {
            if (f.counter > 1 && f.name != this.name) {
                writeCode(f);
            } else            
                data = data.concat(f.fullData)
        });
        imports.forEach(i =>
        {          
            data = data.concat(`import * as ${i.name}_ext from '${i.path}';\r\nexport let ${i.name}=${i.name}_ext;\r\n\r\n`);
        })
        this.fullData = data;  
        if (!this.inFolder) {            
            fs.writeFileSync(`${this.config.targetPath}/${this.getSavePath()}.js`, this.fullData);         
            console.log(`${this.getSavePath()}.js created!`);
        }
            
    }

    startWatch()
    {        
        let folder = this;       
        this._watcher = fs.watch(this.path, (event, filename) =>
        {
            if (!filename) return;
            clearTimeout(this._t);
            this._t = setTimeout(() => { folder._onChanged() }, 1000);
        });      
    }
    stopWatch() { this._watcher.close(); }


    _clear()
    {      
        this.files = [];
        this.folders.forEach(f => f.stopWatch());
        this.folders = [];
    }

    _searchAll()
    {       
        let folder = this;
        fs.readdirSync(this.path).forEach(function (inst)
        {
            inst = folder.path + '/' + inst;
            let stat = fs.statSync(inst);
            if (stat && stat.isDirectory()) { folder.folders.push(new FolderGS(folder.config, inst, folder)); } else
            {
                let t = inst.split('.');
                if (t[t.length - 1].toLowerCase() !== 'html') return;
                folder.files.push(new FileGS(inst, folder));
            }
        });        
        this.save();
    };

    _onChanged()
    {        
        this._clear();
        this._searchAll();
    }        
}

function gslib_creator()
{
	let configs;
	try {
		let data = fs.readFileSync('./gslib_creator.json');
		configs = new Configs(JSON.parse(data));
	} catch (e) {    
		console.log(e.message);
		console.log('Error reading gslib_creator.json file. Stoped...'); return;
	}

	configs.configs.forEach(config =>
	{
		let agr = new FolderGS(config, config.inPointName, null, true);
		config.fromPaths.forEach(path => agr.folders.push(new FolderGS(config, path)));
		agr.save();
	});
}