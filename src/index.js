import axios from 'axios';
import uuid from 'node-uuid';
import  mustache from 'mustache'

const template =
    `<html>
                    <head>
                    <script src="https://cdn.rawgit.com/google/code-prettify/master/loader/run_prettify.js"></script>
                    <style>
                            pre.prettyprint {
                                border: 1px solid #BDBDBD;
                                border-width: 0 0 1px 0;
                                max-width: 100%;
                            }
                            h3 {
                                max-width: 100%;
                                overflow-wrap: break-word;
                            }
                    </style>
                    </head>
                        <body>
                            <h3>{{fileName}}</h3>
                            {{#matches}}
                                <?prettify linenums={{firstLineNumber}}?>
                                <pre class="prettyprint linenums">
{{#lines}}
{{.}}
{{/lines}}
                                </pre>
                            {{/matches}}
                        </body>
                    </html>`;

function debounce(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

module.exports = (pluginContext) => {
    const {shell,logger,preferences,app} = pluginContext;

    var houndClient = undefined;

    const initClient = prefs=> {
        if (prefs.houndBaseUrl && prefs.houndBaseUrl !== 'http://houndserver:port'){
            houndClient = axios.create({
                baseURL: prefs.houndBaseUrl
            });
        }
    };

    const showLoader = res =>{
        res.add({
            id: 'message',
            title: "Loading...",
            desc: "Results are on their way.",
            icon :"#fa fa fa-spinner fa-spin fa-3x fa-fw"
        });
    };

    const showLoginMessage = res =>{
        res.add({
            id: "message",
            title: "Please enter Hound url",
            desc: "Click this to open preferences",
            icon :"#fa fa-unlock-alt",
            payload:{
                action:'prefs'
            }
        });
    };

    const showFailedLoginMessage = res =>{
        res.add({
            id: "message",
            title: "Oops, could'nt get your results",
            desc: "Make sure plugin preferences are correct, Click here to check",
            icon: "#fa fa-exclamation-circle",
            payload: {action: 'prefs'}
        });
    };

    const hideMessage = res=> res.remove('message');

    const searchHound = (res,query_trim)=>{

        houndClient.get('/api/v1/repos')
            .then(reposResponse=>{
                var repos = reposResponse.data;
                var reposString = Object.keys(repos).join(',');
                return houndClient.get(`/api/v1/search?q=${query_trim}&rng=0:5&repos=${reposString}`)
                .then(searchRepsonse=> {
                    var searchResults = searchRepsonse.data.Results;
                    Object.keys(searchResults).forEach(x=>{
                       searchResults[x].repoUrl = repos[x].url;
                    });
                    return searchResults;
                })
            })
            .then(results=>{
                hideMessage(res);
                var repoNames = Object.keys(results);

                repoNames.forEach(repoName=>{
                    var fileMatches= results[repoName].Matches;
                    var hainResults =fileMatches.map(fileMatch=>{
                        var displayFileName = fileMatch.Filename.split('/').pop();
                        const id = uuid.v1();
                        return {
                            id: id,
                            title: displayFileName,
                            group:`${repoName}:showing 5/${results[repoName].FilesWithMatch} matches`,
                            payload: {
                            action :'open',
                                fileMatch,
                                url : `${results[repoName].repoUrl.replace('.git','')}/tree/master/${fileMatch.Filename}`
                            },
                            preview:true
                        };
                    });

                    res.add(hainResults)

                });
            })
            .catch(err=>{
                logger.log(err.message,err);
                hideMessage(res);
                showFailedLoginMessage(res);
            });
    };

    const debouncedSearchHound = debounce(searchHound,200);

    const startup = ()=>{
        initClient(preferences.get());
        preferences.on('update',initClient);
        mustache.parse(template);
    };
    const search =(query, res)=> {
        const query_trim = query.trim();
        if (query_trim.length === 0) return;

        if (!houndClient){
            showLoginMessage(res);
            return;
        }

        hideMessage(res);
        showLoader(res);

        debouncedSearchHound(res,query_trim);
    };

    const execute = (id, payload) =>{
        if (!payload) return;
        switch (payload.action){
            case 'prefs':{
                app.openPreferences('hain-plugin-hound');
                break;
            }
            case 'open':{
                if (!payload || !payload.url) return;
                shell.openExternal(payload.url);
                app.close();
                break;
            }

        }
    };
    const renderPreview =(id, payload, render)=> {
        if (!payload.fileMatch) return;

        var lines ={};

        // merge all lines to unique by line number, data has duplicates between different matchs
        payload.fileMatch.Matches.forEach(lineMatch=>{
            // add before
            for(var i=0; i< lineMatch.Before.length;i++){
                lines[lineMatch.LineNumber - lineMatch.Before.length + i] = lineMatch.Before[i];
            }

            lines[lineMatch.LineNumber] = lineMatch.Line;
            // add after
            for(var i=0; i< lineMatch.After.length;i++){
                lines[lineMatch.LineNumber + i +1] = lineMatch.After[i];
            }
        });


        // merge lines into consecutive linenumber groups keyed by first line's number
        var lineNumbers = Object.keys(lines).map(x=> parseInt(x));
        lineNumbers.sort((a,b)=> b -a);
        lineNumbers.forEach(lineNum=>{
            var prev = (lineNum - 1).toString();
            if (lines[prev] || lines[prev] === ''){
                const toArray = maybeArray => Array.isArray(maybeArray) ? [...maybeArray] : [maybeArray];
                lines[prev] = [...toArray(lines[prev]),...toArray(lines[lineNum])];
                delete lines[lineNum];
            }
        });

        // build mustache model
        var model = {fileName: payload.fileMatch.Filename,
            matches: Object.keys(lines).map(lineNum=>({
                firstLineNumber: lineNum,
                lines : lines[lineNum]
            }))};



        var htmlPreview = mustache.render(template,model);

        render(htmlPreview)


    };

    return { startup,search, execute,renderPreview }
};
