// ==UserScript==
// @name         Real English/American Voice Pronunciation
// @namespace    DQM/pronounce-it
// @version      1.4.2
// @description  Instantly pronounce the highlighted word with REAL English/American sound
// @author       DQM
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://raw.githubusercontent.com/jashkenas/underscore/master/underscore-min.js
// @require      https://raw.githubusercontent.com/newhope/javascript-lemmatizer/master/js/lemmatizer.js
// @match        http://*/*
// @match        https://*/*
// @connect      oxforddictionaries.com
// @connect      oxfordlearnersdictionaries.com
// @connect      forvo.com
// @connect      githubusercontent.com
// ==/UserScript==

/**
 * Changed logs
 *
 * v1.4.2
 * Add Forvo datasource
 * Fix textarea
 * 
 * v1.4.1
 * Add data source www.oxforddictionaries.com
 * 
 * v1.4.0
 * Change script name
 * Support multiple data sources provider
 *
 * v1.3.0
 * Use lemmatizer to get word original form if not found
 * 
 * v1.2.0
 * Add "r" key to replay/read the last word
 * 
 * v1.1.1
 * Script is now compatible with FF (Greasemonkey) & Chrome (Tampermonkey)
 * 
 * v1.1.0
 * Use JS promise to perform ajax request
 * if no word found, try convert NOUN to singular form then lookup
 * 
 * v1.0.1
 * Optimize audio player
 * 
 * v1.0.0
 * Initial release
 * 
 */


// Current data source driver, @see DATA_SOURCES
// Available data source: OD_US, OLD_US, FORVO_EN
var DS_DRIVER = 'OLD_US';

var DATA_SOURCES = {
    OD_US: {
        name: 'Oxford Dictionaries - https://www.oxforddictionaries.com/',
        method: 'GET',
        url: 'https://www.oxforddictionaries.com/definition/american_english/{WORD}',
        mediaType: 'audio/mpeg',
        mediaGrabber: function(text) {
            // something look like:
            // data-src-mp3="http://www.oxforddictionaries.com/media/american_english/us_pron/a/all/allow/allow__us_1.mp3"
            var match = /data-src-mp3="(.*?)"/.exec(text);
            if (match) {
                return match[1].replace('http:', 'https:');
            }
        }
    },
    OLD_US: {
        name: 'Oxford Learner Dictionaries - https://www.oxfordlearnersdictionaries.com/',
        method: 'GET',
        url: 'https://www.oxfordlearnersdictionaries.com/definition/american_english/{WORD}',
        mediaType: 'audio/mpeg',
        mediaGrabber: function(text) {
            // something look like:
            // data-src-mp3="http://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/a/ali/alias/alias__us_2_rr.mp3"
            var match = /data-src-mp3="(.*?)"/.exec(text);
            if (match) {
                return match[1].replace('http:', 'https:');
            }
        }
    },
    FORVO_EN: {
        name: 'Forvo - http://forvo.com/',
        method: 'GET',
        url: 'http://forvo.com/word/{WORD}/#en',
        mediaType: 'audio/mpeg',
        mediaGrabber: function(text) {
            // onclick="Play(615721,'OTA1NDM4NS8zOS85MDU0Mzg1XzM5XzM3MDdfMTE1MTgyLm1wMw==','OTA1NDM4NS8zOS85MDU0Mzg1XzM5XzM3MDdfMTE1MTgyLm9nZw==',false,'ci83L3I3XzkwNTQzODVfMzlfMzcwN18xMTUxODIubXAz','ci83L3I3XzkwNTQzODVfMzlfMzcwN18xMTUxODIub2dn','h')
            var match = /onclick="Play\(\d+,'.*?','.*?',\w+,'(.*?)'/.exec(text);
            if (match) {
                try {
                    var decoded = atob(match[1]);
                    if (decoded) {
                        // http://audio.forvo.com/audios/mp3/r/7/r7_9054385_39_3707_115182.mp3
                        return 'http://audio.forvo.com/audios/mp3/' + decoded;
                    }
                } catch (e) {

                }
                
            }
        }  
    }
};

var selected = '';


var CACHED = {};

var UW = unsafeWindow;
var CONSOLE = null;
if (typeof console != 'undefined' && typeof console.log != 'undefined') {
    CONSOLE = console;
} else if (typeof UW.console != 'undefined' && typeof UW.console.log != 'undefined') {
    CONSOLE = UW.console;
}

function l() {
    
    if (arguments.length > 0 && CONSOLE) {
        CONSOLE.log.apply(CONSOLE, arguments);
    }
}

var lemmatizer = new Lemmatizer();

var audioPlayer = document.createElement('audio');
var lastPlayed = false;
audioPlayer.autoPlay = true;
audioPlayer.type = DATA_SOURCES[DS_DRIVER].mediaType;
audioPlayer.addEventListener("canplaythrough", function() {
    audioPlayer.play();
});
function quickPlaySound(url) {
    if ( ! url) {
        url = lastPlayed;
    } else {
        lastPlayed = url;
    }

    if (url) {
        audioPlayer.src = url;
    }
}

/**
 * Get current selected/highlighted text
 * 
 * @returns {string}
 */
function getSelectedText() {
    
    var text = '';
    if (window.getSelection) {
        text = window.getSelection().toString();
    } else if (document.selection && document.selection.type != "Control") {
        text = document.selection.createRange().text;
    }
    
    return text;
}

/**
 * Trim whitespace & newline from begin & end of string
 * @param text
 * @returns {string}
 */
function trim(text) {
    
    if (typeof String.trim === 'function') {
        return ( text || '' ).trim();
    }
    var str = ( text || '' ).replace(/^\s\s*/, ''),
            ws = /\s/,
            i = str.length;
    while (ws.test(str.charAt(--i)));
    return str.slice(0, i + 1);
}

function GM_XMLHttpPromiseRequest (options) {
    
    return new Promise(function (resolve, reject) {

        GM_xmlhttpRequest({
            method: options.method,
            url: options.url,
            onload: function(resp) {

                if (resp.status == 200) {
                    resolve(resp.responseText);
                } else {
                    reject(resp);
                }
            }
        });
        
    });
}

(function startProcessing() {
    'use strict';
    l('Driver: ' + DATA_SOURCES[DS_DRIVER].name);

    function onWordFound(responseText) {
        
        l('Found word, extracting MP3 URL');
        
        var url = DATA_SOURCES[DS_DRIVER].mediaGrabber(responseText);

        if (url) {
            CACHED[selected] = url;
            l('Load & play sound', url);
            quickPlaySound(url);
        } else {
            l('Fail to grab media with driver', DS_DRIVER);
        }
    }
    
    function onTextMayBeSelected() {

        selected = getSelectedText();
        selected = trim(selected);

        if (selected.length) {

            selected = selected.toLowerCase();
            selected = selected.replace(/\u00A0/g, ' '); // \n => space
            selected = selected.replace(/\s+/g, ' '); // multi space => single space

            var match = selected.match(/\s/g);
            if (match && match.length > 1) {
                l('Maximum 2 words a time, IGNORED this time');
                return true;
            }

            if (typeof CACHED[selected] !== 'undefined' && CACHED[selected]) {

                l('Cache hit on word', selected);
                // cache hit
                quickPlaySound(CACHED[selected]);

            } else {

                l('Looking for word', selected);

                var request_url = DATA_SOURCES[DS_DRIVER].url.replace('{WORD}', encodeURIComponent(selected));
                GM_XMLHttpPromiseRequest({
                    method: DATA_SOURCES[DS_DRIVER].method,
                    url: request_url
                })
                .then(onWordFound)
                .catch(function(resp) {

                    l('Word not found, try lemmatizing it');
                    var singular = lemmatizer.only_lemmas(selected);
                    if (singular) {
                        singular = singular[0];
                    }

                    if (singular != selected) {

                        l('Original form found', singular);
                        GM_XMLHttpPromiseRequest({
                            method: DATA_SOURCES[DS_DRIVER].method,
                            url: DATA_SOURCES[DS_DRIVER].url.replace('{WORD}', singular)
                        }).then(onWordFound).catch(function(resp) {
                            CACHED[selected] = false; // Not found
                            l('Word not found', resp);
                        });

                    } else {

                        l('Fail to lemmatize', singular);
                    }
                });
            }
        }
    }
    
    document.addEventListener('mouseup', onTextMayBeSelected, false);

    // Register R to Read/Replay last word
    document.addEventListener('keyup', function(e){
        if (e.keyCode == 82 /* r */) {
            if (e.target.nodeName != 'INPUT' && e.target.nodeName != 'TEXTAREA') {
                quickPlaySound(false);
            }
        }
    }, false);

})();
