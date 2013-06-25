var bgpage = chrome.extension.getBackgroundPage();
var chrome_bookmarks = bgpage.chrome_bookmarks;

document.getElementById("wipe").onclick = function() {
    var wo = document.getElementById("wipe-out");
    wo.innerHTML = "deleting all bookmarks: please wait&hellip;";
    chrome_bookmarks.__clearAll(function() {
        wo.innerHTML = "done!";
        setTimeout(function() { wo.innerHTML = ""; location.reload(); }, 2000);
    });
};

document.getElementById("fileimport").addEventListener("change", function(e) {
    loadBookmarksFile(this.files[0]);
}, false);

function loadBookmarksFile(fileobj) {
    var io = document.getElementById("import-out");
    io.innerHTML = "loading&hellip;";
    var reader = new FileReader();
    reader.onloadend = function(e) {
        var to_create = bgpage.parseNetscapeBookmarksFile(e.target.result);
        var folder_id_mapping = {"0": "0"}, count = 0, total = to_create.folders.length + to_create.bookmarks.length;

        function next_folder() {
            var make_folder = to_create.folders.shift();
            if (make_folder) {
                count += 1;
                io.innerHTML = "loading (" + count + "/" + total + ") &hellip;";
                chrome_bookmarks.create({
                    title: make_folder.title,
                    parentId: folder_id_mapping[make_folder.temporaryParentId]
                }, function(created_folder) {
                    if (created_folder) folder_id_mapping[make_folder.temporaryId] = created_folder.id;
                    next_folder();
                });
            } else {
                next_bookmark();
            }
        }

        function next_bookmark() {
            var make_bookmark = to_create.bookmarks.shift();
            if (make_bookmark) {
                count += 1;
                io.innerHTML = "loading (" + count + "/" + total + ") &hellip;";
                chrome_bookmarks.create({
                    title: make_bookmark.title,
                    url: make_bookmark.url,
                    parentId: folder_id_mapping[make_bookmark.temporaryParentId]
                }, function(created_bookmark) {
                    next_bookmark();
                });
            } else {
                io.innerHTML = "done: " + total + " bookmarks imported";
                setTimeout(function() {
                    io.innerHTML = "";
                    document.getElementById("importarea").open = false;
                    document.getElementById("fileimport").value = "";
                }, 2000);
            }
        }
        next_folder();
    };
    reader.readAsText(fileobj);
}

var BOOKMARK_TO_MOVE;
function addBookmarkToFolder(bookmark, parent_element, options) {
    function doubleClickEditing(el, actual_text, callback) {
        el.ondblclick = function() {
            var complete = function() {
                var v = inp.value;
                inp.parentNode.removeChild(inp);
                callback(v);
            }
            var inp = document.createElement("input");
            inp.value = actual_text;
            inp.className = "editing";
            inp.style.width = el.offsetWidth + "px";
            inp.style.height = el.offsetHeight + "px";
            inp.style.top = (el.offsetTop + el.parentNode.parentNode.parentNode.offsetTop) + "px";
            inp.style.left = (el.offsetLeft + el.parentNode.parentNode.parentNode.offsetLeft) + "px";
            inp.onkeypress = function(e) {
                var keyCode = e.keyCode || e.which;
                if (keyCode == '13') {
                    complete();
                    return false;
                }
            };
            document.body.appendChild(inp);
            inp.focus();
            inp.onblur = function() {
                complete();
            };
        };
    }

    var tr = document.createElement("tr");
    var title = document.createElement("td");
    var titletext = bookmark.title || "Untitled";
    if (titletext.length > 40) {
        titletext = titletext.substr(0,37) + "...";
        title.title = bookmark.title;
    }
    title.appendChild(document.createTextNode(titletext));
    tr.appendChild(title);
    doubleClickEditing(title, bookmark.title, function(value) {
        if (value !== bookmark.title) {
            chrome_bookmarks.update(bookmark.id, {title: value});
        }
    });
    if (bookmark.url) {
        var url = document.createElement("td");
        var urltext = bookmark.url;
        if (urltext.length > 40) {
            urltext = urltext.substr(0,37) + "...";
            url.title = bookmark.url;
        }
        url.appendChild(document.createTextNode(urltext));
        tr.className = "bookmark";
        tr.appendChild(url);
        doubleClickEditing(url, bookmark.url, function(value) {
            if (value !== bookmark.url) {
                chrome_bookmarks.update(bookmark.id, {url: value});
            }
        });
        var lnk = document.createElement("td");
        var a = document.createElement("a");
        a.href = bookmark.url;
        a.appendChild(document.createTextNode("open"));
        lnk.appendChild(a);
        tr.appendChild(lnk);
    } else {
        title.setAttribute("colspan", "3");
        tr.className = "folder";
        /* used for drag and drop.
           Disabled because you can't scroll the page by dragging a thing to the
           top of the window, although you can scroll by dragging to the bottom.
           https://code.google.com/p/chromium/issues/detail?id=253469

        tr.addEventListener("dragover", function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        }, false);
        tr.addEventListener("dragenter", function(e) { this.classList.add("over"); }, false);
        tr.addEventListener("dragleave", function(e) { this.classList.remove("over"); }, false);
        tr.addEventListener("drop", function(e) {
            e.stopPropagation();
            this.classList.remove("over");
            var to_move = parseInt(e.dataTransfer.getData("text/plain"), 10);
            chrome_bookmarks.move(to_move, {parentId: bookmark.id});
            setTimeout(function() { tr.scrollIntoView(); }, 150);
        }, false);
        */
        var newfol = document.createElement("button");
        newfol.appendChild(document.createTextNode("+ new folder"));
        title.appendChild(newfol);
        newfol.className = "newfolder";
        newfol.onclick = function() {
            chrome_bookmarks.create({title: "New folder", parentId: bookmark.id});
        };
        var tohere = document.createElement("button");
        tohere.appendChild(document.createTextNode("move to here"));
        title.appendChild(tohere);
        tohere.className = "tohere";
        tohere.onclick = function() {
            chrome_bookmarks.move(BOOKMARK_TO_MOVE, {parentId: bookmark.id});
            document.body.classList.remove("dragging");
        };
    }
    tr.setAttribute("data-bookmark-id", bookmark.id);
    var del = document.createElement("td");
    var dela = document.createElement("button");
    dela.appendChild(document.createTextNode("delete"));
    del.appendChild(dela);
    dela.onclick = function(e) {
        chrome_bookmarks.getChildren(bookmark.id, function(children) {
            children.forEach(function(child) {
                chrome_bookmarks.move(child.id, {parentId: bookmark.parentId});
            });
        });
        chrome_bookmarks.remove(bookmark.id);
        e.preventDefault();
        return false;
    };
    tr.appendChild(del);

    var mov = document.createElement("td");
    var movb = document.createElement("button");
    movb.appendChild(document.createTextNode("move"));
    mov.appendChild(movb);
    tr.appendChild(mov);
    movb.onclick = function() {
        document.querySelector("#bmlightbox h2 span").firstChild.nodeValue = bookmark.title;
        BOOKMARK_TO_MOVE = bookmark.id;
        document.body.classList.add("dragging");
    };

    /* used for drag and drop.
       Disabled because you can't scroll the page by dragging a thing to the
       top of the window, although you can scroll by dragging to the bottom.
       https://code.google.com/p/chromium/issues/detail?id=253469

    mov.onmouseover = function() {
        mover.style.width = mov.offsetWidth + "px";
        mover.style.height = mov.offsetHeight + "px";
        mover.style.top = (mov.offsetTop + mov.parentNode.parentNode.parentNode.offsetTop) + "px";
        mover.style.left = (mov.offsetLeft + mov.parentNode.parentNode.parentNode.offsetLeft) + "px";
        mover.setAttribute("data-bookmark-id", bookmark.id);
        mover.setAttribute("data-bookmark-title", bookmark.title || bookmark.url);
    };
    */

    tr.setAttribute("data-depth", parseInt(parent_element.getAttribute("data-depth"), 10) + 1);
    if (parent_element.nextSibling) {
        parent_element.parentNode.insertBefore(tr, parent_element.nextSibling);
    } else {
        parent_element.parentNode.appendChild(tr);
    }
    if (options.fade) tr.classList.add("yellow"); setTimeout(function() { tr.classList.remove("yellow"); }, 250);
}

document.getElementById("lightboxcancel").onclick = function() {
    document.body.classList.remove("dragging");
}

/* used for drag and drop.
   Disabled because you can't scroll the page by dragging a thing to the
   top of the window, although you can scroll by dragging to the bottom.
   https://code.google.com/p/chromium/issues/detail?id=253469

   We create this separate "mover" element as the thing which is dragged because
   Blink really really doesn't like it if you fiddle with the display of the thing
   you're dragging while you're dragging it.

var mover = document.getElementById("mover");
mover.addEventListener("dragstart", function(e) {
    document.body.classList.add("dragging");
    e.dataTransfer.setData("text/plain", this.getAttribute("data-bookmark-id"));
    var mt = document.getElementById("movertext");
    mt.firstChild.nodeValue = mover.getAttribute("data-bookmark-title");
    e.dataTransfer.setDragImage(mt, 0, 0);
}, false);
mover.addEventListener("dragend", function(e) {
    document.body.classList.remove("dragging");
}, false);
*/

function loadBookmarkTree(parent) {
    var parent_element = document.querySelector("[data-bookmark-id='" + parent + "']");
    if (!parent_element) return;
    chrome_bookmarks.getChildren(parent, function(bookmarks) {
        bookmarks.forEach(function(bookmark) {
            addBookmarkToFolder(bookmark, parent_element, {fade: false});
            if (!bookmark.url) {
                loadBookmarkTree(bookmark.id);
            }
        });
    });
}

var searchtimeout;
document.getElementById("filter").onkeyup = document.getElementById("filter").onsearch = function() {
    var fltr = this, bkm = document.getElementById("bookmarks");
    clearTimeout(searchtimeout);
    searchtimeout = setTimeout(function() {
        if (fltr.value) {
            bkm.classList.add("filtered");
            chrome_bookmarks.search(fltr.value, function(r) {
                var styl = [], already = {};
                r.forEach(function(b) {
                    styl.push("#bookmarks.filtered tr[data-bookmark-id='"+ b.id +"']");
                    if (already[b.parentId] === undefined) {
                        styl.push("#bookmarks.filtered tr[data-bookmark-id='"+ b.parentId +"']");
                        already[b.parentId] = "done";
                    }
                });
                var fstyle = document.getElementById("filter-styles");
                if (fstyle) fstyle.parentNode.removeChild(fstyle);
                fstyle = document.createElement("style");
                fstyle.id = "filter-styles";
                var styles = styl.join(",") + " {display: table-row}";
                fstyle.appendChild(document.createTextNode(styles));
                document.getElementsByTagName("head")[0].appendChild(fstyle);
            });
        } else {
            bkm.classList.remove("filtered");
        }
    }, 500);
};

document.querySelector('#bookmarks tr[data-bookmark-id="0"] button').onclick = function() {
    chrome_bookmarks.create({parentId: "0", title: "New folder"});
};

document.getElementById("export").onclick = function() {
    var FOLDERS = [], BOOKMARKS = [], pending = {};
    function loadBookmarkTreeForExport(parent) {
        pending[parent] = "";
        chrome_bookmarks.getChildren(parent, function(bookmarks) {
            bookmarks.forEach(function(bookmark) {
                if (!bookmark.url) {
                    FOLDERS.push({temporaryParentId: bookmark.parentId, temporaryId: bookmark.id,
                        title: bookmark.title});
                    loadBookmarkTreeForExport(bookmark.id);
                } else {
                    BOOKMARKS.push({temporaryParentId: bookmark.parentId, temporaryId: bookmark.id,
                        title: bookmark.title, url: bookmark.url});
                }
            });
            delete pending[parent];
            if (Object.keys(pending).length === 0) {
                var bm = {folders: FOLDERS, bookmarks: BOOKMARKS};
                var output = bgpage.exportAsNetscapeBookmarksFile(bm);
                var a = document.createElement("a");
                var blob = new Blob([output]);
                a.href = window.URL.createObjectURL(blob);
                a.download = "Opera bookmarks.html";
                a.click();
            }
        });
    }
    loadBookmarkTreeForExport("0");
};

chrome_bookmarks.onCreated.addListener(function(id, bookmark) {
    var parentFolder = document.querySelector("tr[data-bookmark-id='" + bookmark.parentId + "']");
    if (parentFolder) {
        addBookmarkToFolder(bookmark, parentFolder, {fade: true});
    }
});
chrome_bookmarks.onRemoved.addListener(function(id, removeInfo) {
    var bookmarkItem = document.querySelector("tr[data-bookmark-id='" + id + "']");
    if (bookmarkItem) {
        bookmarkItem.parentNode.removeChild(bookmarkItem);
    }
});
chrome_bookmarks.onMoved.addListener(function(id, moveInfo) {
    var moving = document.querySelector("tr[data-bookmark-id='" + id + "']");
    var newParent = document.querySelector("tr[data-bookmark-id='" + moveInfo.parentId + "']");
    if (moving && newParent) {
        // delete and recreate the tr, so that it forgets the stuff it was closed over
        moving.parentNode.removeChild(moving);
        chrome_bookmarks.get(id, function(children) {
            if (children.length > 0) {
                addBookmarkToFolder(children[0], newParent, {fade: true});
            }
        });
    }
});
chrome_bookmarks.onChanged.addListener(function(id, changeInfo) {
    var bookmarkItem = document.querySelector("tr[data-bookmark-id='" + id + "']");
    if (bookmarkItem) {
        if (changeInfo.title) {
            bookmarkItem.getElementsByTagName("td")[0].firstChild.nodeValue = changeInfo.title;
        }
        if (changeInfo.url) {
            bookmarkItem.getElementsByTagName("td")[1].firstChild.nodeValue = changeInfo.url;
        }
    }
    bookmarkItem.classList.add("yellow"); setTimeout(function() { bookmarkItem.classList.remove("yellow"); }, 250);
});

loadBookmarkTree("0");

if (localStorage.getItem("firstrun") === "yes") {
    localStorage.removeItem("firstrun");
    document.getElementById("importarea").open = true;
} else {
    document.getElementById("importarea").open = false;
};