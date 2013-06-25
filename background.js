/* This is a background script, so that it gets notified when the active
   page's URL changes (or the active page changes). It is not an event
   script because it'd get reloaded every time you changed tabs or
   navigated anywhere, which is basically all the time anyway. */

var currentAction = "add";

function Bookmarks_API(options) {
    var options = options || {};
    var get_idb = function(callback) {
        var rq = window.indexedDB.open(options.override_indexeddb_name || "bookmarks", 1);
        rq.onsuccess = function(e) {
            rq.result.onerror = function(e) {
                console.log("Bookmarks database error:", e.target.error.name, e.target,
                    e.target.errorMessage || e.target.webkitErrorMessage || "(no description available)");
            }
            callback(rq.result);
        };
        rq.onerror = function(e) {
            console.log("error opening the bookmarks idb FIXME");
        };
        rq.onupgradeneeded = function(e) {
            var db = e.target.result;
            var os = db.createObjectStore("bookmarks", {keyPath: "id", autoIncrement: true});
            os.createIndex("lc_title", "lc_title", { unique: false });
            os.createIndex("url", "url", { unique: false });
            os.createIndex("parentId", "parentId", { unique: false });
        };
    };

    var eventHandlers = {};
    var makeEventSource = function(eventname) {
        return {
            addListener: function(callback) {
                if (eventHandlers[eventname] === undefined) eventHandlers[eventname] = [];
                eventHandlers[eventname].push(callback);
            }
        };
    };
    fireEvent = function(eventname, args) {
        if (eventHandlers[eventname] !== undefined) {
            eventHandlers[eventname].forEach(function(eh) {
                eh.apply(null, args);
            });
        }
    };

    this.onCreated = makeEventSource("created");
    this.onRemoved = makeEventSource("removed");
    this.onMoved = makeEventSource("moved");
    this.onChanged = makeEventSource("changed"); // fired by .update()

    function BookmarkTreeNode(options) {
        this.id = options.id;
        this.parentId = options.parentId;
        this.index = options.index;
        this.url = options.url;
        this.title = options.title;
    }

    this.__clearAll = function(callback) {
        get_idb(function(db) {
            var trans = db.transaction(["bookmarks"], "readwrite");
            var os = trans.objectStore("bookmarks");
            os.clear();
            callback()
        });
    };

    this.get = function(idOrIdList, callback) {
        var ret = [];
        get_idb(function(db) {
            var trans = db.transaction(["bookmarks"]);
            var os = trans.objectStore("bookmarks");
            var list = Array.isArray(idOrIdList) ? idOrIdList : [idOrIdList];
            function next() {
                var next_item = list.shift();
                if (!next_item) {
                    callback(ret);
                    return;
                }
                if (next_item === "0") {
                    // "0" is the root item, which doesn't actually exist in the store
                    // create a fake item which is the root
                    ret.push(new BookmarkTreeNode({
                        parentId: null, title: "Root folder", index: 0, id: "0", url: null
                    }));
                    next();
                } else {
                    var rq = os.get(next_item);
                    rq.onsuccess = function(e) {
                        if (rq.result) ret.push(new BookmarkTreeNode(rq.result));
                        next();
                    };
                    rq.onerror = function(e) {
                        next();
                    };
                }
            }
            next();
        });
    };

    this.getChildren = function(id, callback) {
        get_idb(function(db) {
            var trans = db.transaction(["bookmarks"], "readwrite");
            var os = trans.objectStore("bookmarks");

            var keyRange = IDBKeyRange.only(id);
            var parentIndex = os.index("parentId");
            var rq = parentIndex.openCursor(keyRange);
            var ret = [];
            rq.onsuccess = function(e) {
                var crs = e.target.result;
                if (crs) {
                    ret.push(new BookmarkTreeNode(crs.value));
                    crs.continue();
                } else {
                    if (callback) callback(ret);
                }
            };
            rq.onerror = function(e) {
                console.log("Error searching bookmarks by parentId.");
            };
        });
    };

    this.create = function(bookmark, callback) {
        get_idb(function(db) {
            var trans = db.transaction(["bookmarks"], "readwrite");
            var os = trans.objectStore("bookmarks");
            var cleaned_bookmark = {
                parentId: bookmark.parentId || "0", // unparented things go in the root
                index: bookmark.index || null,
                title: bookmark.title || null,
                url: bookmark.url || null,
                lc_title: bookmark.title ? bookmark.title.toLowerCase() : null
            };
            var rq = os.add(cleaned_bookmark);
            rq.onsuccess = function(e) {
                var rq2 = os.get(e.target.result);
                rq2.onsuccess = function(e) {
                    fireEvent("created", [rq2.result.id, rq2.result]);
                    if (callback) { callback(new BookmarkTreeNode(rq2.result)); }
                };
                rq2.onerror = function(e) {
                    console.log("An error occurred while creating a bookmark.");
                    if (callback) { callback(); }
                };
            };
            rq.onerror = function(e) {
                console.log("An error occurred while creating a bookmark.");
                if (callback) { callback(); }
            };
        });
    };

    this.remove = function(id, callback) {
        get_idb(function(db) {
            var trans = db.transaction(["bookmarks"], "readwrite");
            var os = trans.objectStore("bookmarks");
            var rq = os.get(id);
            rq.onsuccess = function(e) {
                var rq2 = os.delete(id);
                rq2.onsuccess = function(e) {
                    fireEvent("removed", [id, {parentId: rq.result.parentId, index:rq.result.index}]);
                    if (callback) callback();
                };
                rq2.onerror = function(e) {
                    console.log("An error occurred while removing a bookmark.");
                    if (callback) callback();
                };
            };
            rq.onerror = function(e) {
                console.log("An error occurred while removing a bookmark.");
                if (callback) callback();
            };
        });
    };

    this.update = function(id, changes, callback) {
        get_idb(function(db) {
            var trans = db.transaction(["bookmarks"], "readwrite");
            var os = trans.objectStore("bookmarks");
            var rq = os.get(id);
            rq.onsuccess = function(e) {
                var newobj = {
                    id: rq.result.id,
                    title: changes.title || rq.result.title,
                    url: changes.url || rq.result.url,
                    index: rq.result.index,
                    parentId: rq.result.parentId
                };
                var rq3 = os.put(newobj);
                rq3.onsuccess = function(e) {
                    var changeinfo = {};
                    if (changes.title) changeinfo.title = changes.title;
                    if (changes.url) changeinfo.url = changes.url;
                    fireEvent("changed", [id, changeinfo]);
                    if (callback) callback(new BookmarkTreeNode(newobj));
                };
                rq3.onerror = function(e) {
                    console.log("An error occurred while updating a bookmark.");
                    if (callback) callback();
                };
            };
            rq.onerror = function(e) {
                console.log("An error occurred while updating a bookmark.");
                if (callback) callback();
            };
        });
    };


    this.move = function(id, destination, callback) {
        var parentId = destination.parentId || "0";
        get_idb(function(db) {
            var trans = db.transaction(["bookmarks"], "readwrite");
            var os = trans.objectStore("bookmarks");
            var rq = os.get(id);
            rq.onsuccess = function(e) {
                var newobj = { id: rq.result.id, title: rq.result.title, url: rq.result.url,
                    index: rq.result.index, parentId: parentId };
                var rq2 = os.get(parentId);
                rq2.onsuccess = function(e) {
                    var rq3 = os.put(newobj);
                    rq3.onsuccess = function(e) {
                        fireEvent("moved", [id, {
                            parentId: parentId, index:newobj.index,
                            oldIndex: rq.result.index, oldParentId: rq.result.parentId
                        }]);
                        if (callback) callback(new BookmarkTreeNode(newobj));
                    };
                    rq3.onerror = function(e) {
                        console.log("An error occurred while moving a bookmark.");
                        if (callback) callback();
                    };
                };
                rq2.onerror = function(e) {
                    console.log("An error occurred while moving a bookmark.");
                    if (callback) callback();
                };
            };
            rq.onerror = function(e) {
                console.log("An error occurred while removing a bookmark.");
                if (callback) callback();
            };
        });
    };

    this.search = function(query, callback) {
        /* chrome.bookmarks.search searches rather cleverly, so a
           bookmark with title "My great bookmark" will match on a
           search for "great" or "great bookmark" as well as on
           "my great". We are not that clever, here; we return a
           result if the query exactly matches the URL, or if the
           query is a prefix match to the title.
        */

        get_idb(function(db) {
            var ret = [];
            var trans = db.transaction(["bookmarks"]);
            var os = trans.objectStore("bookmarks");

            function matchTitles(matchers) {
                /* To search for all prefix matches, use the old CouchDB
                   trick of creating a key range which starts with the
                   query and ends with the query plus a high Unicode char. */
                var keyRange = IDBKeyRange.bound(query.toLowerCase(), query.toLowerCase() + "\ufffe");
                var titleIndex = os.index("lc_title");
                var rq = titleIndex.openCursor(keyRange);
                rq.onsuccess = function(e) {
                    var crs = e.target.result;
                    if (crs) {
                        ret.push(new BookmarkTreeNode(crs.value));
                        crs.continue();
                    } else {
                        var m2 = matchers.shift(); m2(matchers);
                    }
                };
                rq.onerror = function(e) {
                    console.log("Error searching bookmarks by title.");
                    var m2 = matchers.shift(); m2(matchers);
                };
            }

            function matchUrl(matchers) {
                var urlIndex = os.index("url");
                var rq = urlIndex.get(query);
                rq.onsuccess = function(e) {
                    if (e.target.result) ret.push(new BookmarkTreeNode(e.target.result));
                    var m2 = matchers.shift(); m2(matchers);
                };
                rq.onerror = function(e) {
                    console.log("Error searching bookmarks by URL.");
                    var m2 = matchers.shift(); m2(matchers);
                };
            }

            function returnResults() {
                if (callback) callback(ret);
            }

            /* All this matchers array stuff with shift() would be much better handled by
               returning a Promise from matchUrl etc, but we don't have promises yet. */
            matchUrl([matchTitles, returnResults]);
        });
    };
}

function selectIconAndAction(url, callback) {
    chrome_bookmarks.search(url, function(bms) {
        if (bms.length === 1) {
            chrome.browserAction.setIcon({path:"bookmarked-icon@19.png"});
            chrome.contextMenus.update("bookmarkMenu", {title: "Unbookmark this page"});
            currentAction = "remove";
        } else {
            chrome.browserAction.setIcon({path:"unbookmarked-icon@19.png"});
            chrome.contextMenus.update("bookmarkMenu", {title: "Bookmark this page"});
            currentAction = "add";
        }
        if (callback) callback();
    });
}

function bookmarkCurrentTab(callback) {
    chrome.tabs.query({currentWindow: true, active: true}, function(tabs) {
        if (tabs.length !== 1) { console.log("Unexpectedly found multiple current tabs."); return; }
        chrome_bookmarks.create({url: tabs[0].url, title: tabs[0].title}, function() {
            selectIconAndAction(tabs[0].url, function() {
                if (callback) callback();
            });
        });
    });
}

function unbookmarkCurrentTab(callback) {
    chrome.tabs.query({currentWindow: true, active: true}, function(tabs) {
        if (tabs.length !== 1) { console.log("Unexpectedly found multiple current tabs."); return; }
        chrome_bookmarks.search(tabs[0].url, function(bm) {
            if (bm.length === 1) {
                chrome_bookmarks.remove(bm[0].id, function() {
                    selectIconAndAction(bm[0].url, function() {
                        if (callback) callback();
                    });
                });
            }
        });
    });
}

function exportAsNetscapeBookmarksFile(input) {
    /* We construct the output as strings, rather than creating an HTML
       document, because the Netscape format doesn't close any of its tags,
       and is fairly invalid. We want to stick to the format more than we
       want to be a valid output document, as annoying as it is.
    */
    var txt = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        "<!-- This is an automatically generated file.",
        "     It will be read and overwritten.",
        "     DO NOT EDIT! -->",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        '<TITLE>Bookmarks</TITLE>',
        '<H1>Bookmarks</H1>'
    ];

    var output_folders = {"0": {title: null, children: []}};
    input.folders.forEach(function(input_folder) {
        output_folders[input_folder.temporaryId] = {title: input_folder.title, children: []};
        output_folders[input_folder.temporaryParentId].children.push(input_folder.temporaryId);
    });
    input.bookmarks.forEach(function(input_bookmark) {
        output_folders[input_bookmark.temporaryParentId].children.push(input_bookmark);
    });

    function escapeHTML(str) {
        var p = document.createElement("pre");
        p.appendChild(document.createTextNode(str));
        return p.innerHTML;
    }

    function dumpTreeAsText(parentId, indent) {
        var indentStr = new Array(indent + 1).join(" ");
        var fol = output_folders[parentId];
        var itxt = [indentStr + "<DT><H3>" + fol.title + "</H3>"];
        itxt.push(indentStr + "<DL><P>");
        fol.children.forEach(function(child) {
            if (child.url) {
                itxt.push(indentStr + indentStr + '<DT><A HREF="' + child.url + '">' + escapeHTML(child.title) + "</A>");
            } else {
                // skip on round 1
            }
        });
        fol.children.forEach(function(child) {
            if (child.url) {
                // skip on round 2
            } else {
                itxt = itxt.concat(dumpTreeAsText(child, indent + 3)); // will be an ID
            }
        });
        itxt.push(indentStr + "</DL><P>");
        return itxt;
    }

    txt = txt.concat(dumpTreeAsText("0", 0));
    return txt.join("\n");
}

function parseNetscapeBookmarksFile(text) {
    var out = {folders:[], bookmarks:[]};

    function recursivelyParseDl(dl, parentId) {
        var ptr = 0;
        var node = dl.childNodes[ptr];
        while (node) {
            if (node.nodeName.toLowerCase() === "dt") {
                var kid = node.firstChild;
                if (kid) {
                    if (kid.nodeName.toLowerCase() === "h3") {
                        var newTemporaryParentId = parentId + "-" + ptr;
                        out.folders.push({
                            temporaryParentId: parentId,
                            title: kid.textContent,
                            temporaryId: newTemporaryParentId
                        });

                        /* The structure here might be:
                            <dt><h3>Folder title</h3>
                                <dl>
                                   ... links in this folder ...
                                </dl>

                            or it might be
                            <dt><h3>Folder title</h3>
                            <dd>Description of folder
                                <dl>
                                   ... links in this folder ...
                                </dl>

                            where the sub-dl is inside the dd description. So we check. */

                        var dls = node.getElementsByTagName("dl");
                        if (dls.length > 0) {
                            recursivelyParseDl(dls[0], newTemporaryParentId);
                        } else if (node.nextSibling && node.nextSibling.nodeName.toLowerCase() == "dd" &&
                                   node.nextSibling.getElementsByTagName("dl").length > 0) {
                            recursivelyParseDl(node.nextSibling.getElementsByTagName("dl")[0], newTemporaryParentId);
                        }
                    } else if (kid.nodeName.toLowerCase() === "a") {
                        out.bookmarks.push({
                            url: kid.getAttribute("href"),
                            title: kid.textContent,
                            temporaryParentId: parentId // real parentId is issued on bookmark creation
                        });
                    }
                }
            }
            ptr += 1;
            node = dl.childNodes[ptr];
        }
    }

    var doc = document.implementation.createHTMLDocument();
    doc.documentElement.innerHTML = text;

    var dls = doc.documentElement.getElementsByTagName("dl");
    if (dls.length > 0) {
        var firstdl = dls[0];
        recursivelyParseDl(firstdl, "0");
    }

    return out;
}

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.url && tab.active) {
        selectIconAndAction(changeInfo.url);
    }
});
chrome.tabs.onActivated.addListener(function(activeInfo) {
    chrome.tabs.get(activeInfo.tabId, function(tab) {
        selectIconAndAction(tab.url);
    });
});

chrome.contextMenus.create({
    id: "bookmarkMenu",
    title: "Bookmark this page",
    contexts: ["page"],
    onclick: function (info, tab) {
        if (currentAction === "add") {
            bookmarkCurrentTab();
        } else if (currentAction === "remove") {
            unbookmarkCurrentTab();
        }
    }
});

chrome.runtime.onInstalled.addListener(function(details){
    if (details.reason == "install") {
        localStorage.setItem("firstrun", "yes");
        chrome.tabs.create({url: "options.html"});
    } else if(details.reason == "update") {
        var thisVersion = chrome.runtime.getManifest().version;
        console.log("Updated from " + details.previousVersion + " to " + thisVersion + "!");
    }
});

chrome.runtime.onMessageExternal.addListener(function(incoming, sender, respond) {
    var respondingAsynchronously = true;
    switch (incoming.type) {
        case "ping":
            respond({pong: "pong"});
            respondingAsynchronously = false;
            break;
        case "isBookmarked":
            if (incoming.url) {
                chrome_bookmarks.search(incoming.url, function(matches) {
                    if (matches.length > 0) {
                        respond({url: incoming.url, isBookmarked: true});
                    } else {
                        respond({url: incoming.url, isBookmarked: false});
                    }
                });
            } else {
                respond({error: "no url specified"});
                respondingAsynchronously = false;
            }
            break;
        case "addBookmark":
            // This will merrily add duplicate bookmarks.
            if (incoming.url && incoming.title) {
                chrome_bookmarks.create({url: incoming.url, title: incoming.title}, function(ret) {
                    if (ret) {
                        respond({url: incoming.url, isBookmarked: true});
                    } else {
                        respond({url: incoming.url, isBookmarked: false});
                    }
                });
            } else {
                respond({error: "specify URL and title"});
                respondingAsynchronously = false;
            }
            break;
        case "removeBookmark":
            if (incoming.url) {
                chrome_bookmarks.search(incoming.url, function(matches) {
                    if (matches.length > 0) {
                        chrome_bookmarks.remove(matches[0].id, function() {
                            respond({url: incoming.url, removed: true});
                        });
                    } else {
                        respond({error: "bookmark did not exist"});
                    }
                });
            } else {
                respond({error: "no url specified"});
                respondingAsynchronously = false;
            }
            break;
    }
    if (respondingAsynchronously) {
        console.log("we are responding async");
        return true;
    }
});


//if (chrome.bookmarks) {
//    console.log("This extension is designed for Opera, which does not provide chrome.bookmarks");
//}

chrome_bookmarks = new Bookmarks_API();
